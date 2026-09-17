import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

import type { AccessTokenPayload } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { corsOrigin } from '../../config/env.js';
import { publicCommunityMessage } from './presenter.js';
import {
  deleteCommunityMessageSchema,
  markCommunityReadSchema,
  sendCommunityMessageSchema,
} from './schemas.js';
import {
  communityRoom,
  deleteCommunityMessage,
  listEligibleCommunityCourseIds,
  markCommunityRead,
  requireCommunityCourse,
  sendCommunityMessage,
} from './service.js';

type Acknowledgement = (result: Record<string, unknown>) => unknown;

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

function requireSocketIdentity(socket: { data: Record<string, unknown> }): AccessTokenPayload {
  const identity = socket.data.identity;
  if (!identity || typeof identity !== 'object')
    throw new AppError(401, 'Authentication is required.', 'UNAUTHENTICATED');
  return identity as AccessTokenPayload;
}

async function emitToEligibleMembers(
  io: Server,
  courseId: bigint,
  event: 'community:messageCreated' | 'community:messageDeleted' | 'community:read',
  payload: Record<string, unknown>,
): Promise<void> {
  const sockets = await io.in(communityRoom(courseId)).fetchSockets();
  await Promise.all(
    sockets.map(async (member) => {
      try {
        // A booking can be cancelled after join, so membership is checked again before every
        // delivery even though socket authentication is established only during its handshake.
        await requireCommunityCourse(courseId, member.data.identity as AccessTokenPayload);
      } catch (error) {
        if (
          error instanceof AppError &&
          (error.code === 'COMMUNITY_ACCESS_FORBIDDEN' || error.code === 'COURSE_NOT_FOUND')
        )
          await member.leave(communityRoom(courseId));
        return;
      }
      member.emit(event, payload);
    }),
  );
}

async function joinEligibleCommunityRooms(
  socket: { data: Record<string, unknown>; join: (rooms: string[]) => void | Promise<void> },
  identity: AccessTokenPayload,
): Promise<string[]> {
  const courseIds = await listEligibleCommunityCourseIds(identity);
  await socket.join(courseIds.map(communityRoom));
  return courseIds.map((courseId) => courseId.toString());
}

export function registerCommunitySocket(app: FastifyInstance): Server {
  const io = new Server(app.server, {
    cors: {
      origin: corsOrigin,
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
      return next();
    } catch {
      const error = new Error('Authentication is required.');
      Object.assign(error, { data: { error: 'UNAUTHENTICATED', message: error.message } });
      return next(error);
    }
  });

  io.on('connection', (socket) => {
    void (async () => {
      try {
        const identity = requireSocketIdentity(socket);
        const courseIds = await joinEligibleCommunityRooms(socket, identity);
        socket.emit('community:ready', { courseIds, error: null });
      } catch (error) {
        socket.emit('community:ready', { courseIds: [], error: socketError(error).message });
      }
    })();

    socket.on('community:sendMessage', async (payload: unknown, ack?: unknown) => {
      try {
        const identity = requireSocketIdentity(socket);
        const body = parseRequest(sendCommunityMessageSchema, payload);
        const { course, message } = await sendCommunityMessage({
          courseId: BigInt(body.courseId),
          identity,
          content: body.content,
          attachmentIds: (body.attachmentIds ?? []).map(BigInt),
        });
        const publicMessage = publicCommunityMessage(message);
        await emitToEligibleMembers(io, course.id, 'community:messageCreated', publicMessage);
        socketSuccess(ack, { message: publicMessage });
      } catch (error) {
        socketFailure(ack, error);
      }
    });

    socket.on('community:deleteMessage', async (payload: unknown, ack?: unknown) => {
      try {
        const identity = requireSocketIdentity(socket);
        const { messageId } = parseRequest(deleteCommunityMessageSchema, payload);
        const message = await deleteCommunityMessage({ messageId: BigInt(messageId), identity });
        const event = { id: message.id.toString(), courseId: message.courseId.toString() };
        await emitToEligibleMembers(io, message.courseId, 'community:messageDeleted', event);
        socketSuccess(ack, { message: event });
      } catch (error) {
        socketFailure(ack, error);
      }
    });

    socket.on('community:read', async (payload: unknown, ack?: unknown) => {
      try {
        const identity = requireSocketIdentity(socket);
        const body = parseRequest(markCommunityReadSchema, payload);
        const result = await markCommunityRead({
          courseId: BigInt(body.courseId),
          identity,
          messageId: body.messageId ? BigInt(body.messageId) : undefined,
        });
        const event = {
          courseId: result.courseId.toString(),
          userId: identity.sub,
          messageId: result.messageId?.toString() ?? null,
          unreadCount: result.unreadCount,
        };
        await emitToEligibleMembers(io, result.courseId, 'community:read', event);
        socketSuccess(ack, { ...event, readCount: result.readCount });
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
