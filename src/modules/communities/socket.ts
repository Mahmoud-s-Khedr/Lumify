import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { z } from 'zod';

import type { AccessTokenPayload } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { corsOrigins } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  communityRoom,
  createCommunityMessage,
  publicCommunityMessage,
  requireCommunityCourse,
} from './service.js';

type Acknowledgement = (result: Record<string, unknown>) => unknown;

const idSchema = z.string().regex(/^\d+$/);
const courseEventSchema = z.object({ courseId: idSchema });
const sendMessageSchema = courseEventSchema.extend({
  content: z.string().max(5_000).optional(),
  attachmentIds: z.array(idSchema).max(10).default([]),
});
const deleteMessageSchema = z.object({ messageId: idSchema });
const reauthenticateSchema = z.object({ token: z.string().min(1) });

function socketError(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) return { error: error.code, message: error.message };
  return { error: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' };
}

function isAcknowledgement(value: unknown): value is Acknowledgement {
  return typeof value === 'function';
}

function acknowledge(ack: unknown, result: Record<string, unknown>): void {
  if (!isAcknowledgement(ack)) return;

  try {
    // Socket.IO acknowledgement callbacks are synchronous, but also contain errors from a
    // malformed caller so they cannot turn an event handler into an unhandled rejection.
    void Promise.resolve(ack(result)).catch(() => undefined);
  } catch {
    // A client acknowledgement is never allowed to break a community action.
  }
}

function socketSuccess(ack: unknown, payload: Record<string, unknown> = {}): void {
  acknowledge(ack, { ok: true, ...payload });
}

function socketFailure(ack: unknown, error: unknown): void {
  acknowledge(ack, socketError(error));
}

function unauthenticatedError(): AppError {
  return new AppError(401, 'Authentication is required.', 'UNAUTHENTICATED');
}

async function requireSocketIdentity(
  app: FastifyInstance,
  socket: { data: Record<string, unknown> },
): Promise<AccessTokenPayload> {
  const token = socket.data.token;
  if (typeof token !== 'string' || token.length === 0) throw unauthenticatedError();

  try {
    const identity = (await app.jwt.verify(token)) as AccessTokenPayload;
    socket.data.identity = identity;
    return identity;
  } catch {
    throw unauthenticatedError();
  }
}

async function emitToEligibleMembers(
  app: FastifyInstance,
  io: Server,
  courseId: bigint,
  event: 'community:messageCreated' | 'community:messageDeleted',
  payload: Record<string, unknown>,
): Promise<void> {
  const sockets = await io.in(communityRoom(courseId)).fetchSockets();
  await Promise.all(
    sockets.map(async (member) => {
      try {
        // A booking can be cancelled after join; remove a socket that no longer has access,
        // even when its otherwise trusted connection token has expired.
        await requireCommunityCourse(courseId, member.data.identity as AccessTokenPayload);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === 'COMMUNITY_ACCESS_FORBIDDEN' || error.code === 'COURSE_NOT_FOUND')
        )
          await member.leave(communityRoom(courseId));
        return;
      }

      try {
        // Expired credentials do not disconnect the socket or discard its room state. A
        // successful community:reauth will let it receive future messages again.
        await requireSocketIdentity(app, member);
        member.emit(event, payload);
      } catch {
        // An invalid recipient token only suppresses delivery; it does not remove the room.
      }
    }),
  );
}

export function registerCommunitySocket(app: FastifyInstance): Server {
  const io = new Server(app.server, {
    cors: {
      origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      const error = new Error('Authentication is required.');
      Object.assign(error, { data: { error: 'UNAUTHENTICATED', message: error.message } });
      return next(error);
    }
    try {
      socket.data.identity = (await app.jwt.verify(token)) as AccessTokenPayload;
      socket.data.token = token;
      return next();
    } catch {
      const error = new Error('Authentication is required.');
      Object.assign(error, { data: { error: 'UNAUTHENTICATED', message: error.message } });
      return next(error);
    }
  });

  io.on('connection', (socket) => {
    socket.on('community:reauth', async (payload: unknown, ack?: unknown) => {
      try {
        const { token } = parseRequest(reauthenticateSchema, payload);
        const identity = (await app.jwt.verify(token)) as AccessTokenPayload;
        socket.data.token = token;
        socket.data.identity = identity;
        socketSuccess(ack);
      } catch (error) {
        socketFailure(ack, error instanceof AppError ? error : unauthenticatedError());
      }
    });

    socket.on('community:join', async (payload: unknown, ack?: unknown) => {
      try {
        const identity = await requireSocketIdentity(app, socket);
        const { courseId } = parseRequest(courseEventSchema, payload);
        const course = await requireCommunityCourse(BigInt(courseId), identity);
        await socket.join(communityRoom(course.id));
        socketSuccess(ack, { courseId: course.id.toString(), readOnly: course.archived });
      } catch (error) {
        socketFailure(ack, error);
      }
    });

    socket.on('community:leave', async (payload: unknown, ack?: unknown) => {
      try {
        const identity = await requireSocketIdentity(app, socket);
        const { courseId } = parseRequest(courseEventSchema, payload);
        const course = await requireCommunityCourse(BigInt(courseId), identity);
        await socket.leave(communityRoom(course.id));
        socketSuccess(ack, { courseId: course.id.toString() });
      } catch (error) {
        socketFailure(ack, error);
      }
    });

    socket.on('community:sendMessage', async (payload: unknown, ack?: unknown) => {
      try {
        const identity = await requireSocketIdentity(app, socket);
        const body = parseRequest(sendMessageSchema, payload);
        const content = body.content?.trim() ?? null;
        const attachmentIds = body.attachmentIds ?? [];
        if (!content && attachmentIds.length === 0)
          throw new AppError(400, 'A message needs text or an attachment.', 'VALIDATION_ERROR');
        if (new Set(attachmentIds).size !== attachmentIds.length)
          throw new AppError(400, 'An attachment can only be included once.', 'VALIDATION_ERROR');

        const course = await requireCommunityCourse(BigInt(body.courseId), identity);
        if (course.archived)
          throw new AppError(
            403,
            'Archived course communities are read-only.',
            'COMMUNITY_READ_ONLY',
          );
        const message = await createCommunityMessage({
          courseId: course.id,
          senderId: BigInt(identity.sub),
          content,
          attachmentIds: attachmentIds.map(BigInt),
        });
        const publicMessage = publicCommunityMessage(message);
        await emitToEligibleMembers(app, io, course.id, 'community:messageCreated', publicMessage);
        socketSuccess(ack, { message: publicMessage });
      } catch (error) {
        socketFailure(ack, error);
      }
    });

    socket.on('community:deleteMessage', async (payload: unknown, ack?: unknown) => {
      try {
        const identity = await requireSocketIdentity(app, socket);
        const { messageId } = parseRequest(deleteMessageSchema, payload);
        const message = await prisma.communityMessage.findUnique({
          where: { id: BigInt(messageId) },
          select: { id: true, courseId: true, senderId: true, deletedAt: true },
        });
        if (!message) throw new AppError(404, 'Message was not found.', 'MESSAGE_NOT_FOUND');
        const course = await requireCommunityCourse(message.courseId, identity);
        if (course.archived)
          throw new AppError(
            403,
            'Archived course communities are read-only.',
            'COMMUNITY_READ_ONLY',
          );
        if (identity.role !== 'ADMIN' && message.senderId !== BigInt(identity.sub))
          throw new AppError(
            403,
            'You can only delete your own messages.',
            'MESSAGE_DELETE_FORBIDDEN',
          );
        if (message.deletedAt)
          throw new AppError(400, 'Message was already deleted.', 'MESSAGE_ALREADY_DELETED');
        const deleted = await prisma.communityMessage.updateMany({
          where: { id: message.id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (deleted.count === 0)
          throw new AppError(400, 'Message was already deleted.', 'MESSAGE_ALREADY_DELETED');
        const event = { id: message.id.toString(), courseId: message.courseId.toString() };
        await emitToEligibleMembers(app, io, message.courseId, 'community:messageDeleted', event);
        socketSuccess(ack, { message: event });
      } catch (error) {
        socketFailure(ack, error);
      }
    });
  });

  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });
  return io;
}
