import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireUser } from '../../common/authorization/auth.js';
import { courseAccessStatuses } from '../../common/business/bookings.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { prisma } from '../../infrastructure/database/prisma.js';

const idSchema = z.string().regex(/^\d+$/);
const roundParamsSchema = z.object({ id: idSchema });
const sessionParamsSchema = z.object({ id: idSchema });
const adminSessionQuerySchema = z.object({ roundId: idSchema.optional() });
const nullableUrlSchema = z.string().trim().url().max(2_000).nullable();
const nullableInstructionsSchema = z.string().trim().max(5_000).nullable();
const updateJoinSchema = z
  .object({
    liveJoinUrl: nullableUrlSchema.optional(),
    whatsappUrl: nullableUrlSchema.optional(),
    joiningInstructions: nullableInstructionsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one join field is required.');
const sessionValuesSchema = z.object({
  title: z.string().trim().min(1).max(255),
  sessionDate: z.string().datetime({ offset: true }),
  recordingUrl: nullableUrlSchema.optional(),
});
const updateSessionSchema = sessionValuesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one session field is required.');

const sessionInclude = {
  round: { include: { course: { select: { id: true, title: true } } } },
} satisfies Prisma.SessionInclude;

type SessionWithRound = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;

function calendarToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

function publicSession(session: SessionWithRound) {
  return {
    id: session.id.toString(),
    round: {
      id: session.round.id.toString(),
      course: {
        id: session.round.course.id.toString(),
        title: session.round.course.title,
      },
    },
    title: session.title,
    sessionDate: session.sessionDate.toISOString(),
    recordingUrl: session.recordingUrl,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function joinPayload(round: {
  id: bigint;
  joiningInstructions: string | null;
  liveJoinUrl: string | null;
  whatsappUrl: string | null;
}) {
  return {
    roundId: round.id.toString(),
    joiningInstructions: round.joiningInstructions,
    actions: {
      live: round.liveJoinUrl ? { url: round.liveJoinUrl } : null,
      whatsapp: round.whatsappUrl ? { url: round.whatsappUrl } : null,
    },
  };
}

async function requireRoundAccess(request: FastifyRequest, roundId: bigint): Promise<void> {
  const identity = await requireUser(request);
  if (identity.role === 'ADMIN') return;
  const enrolled = await prisma.booking.count({
    where: {
      roundId,
      studentId: BigInt(identity.sub),
      status: { in: courseAccessStatuses },
    },
  });
  if (enrolled === 0)
    throw new AppError(
      403,
      'Only confirmed students can access course delivery.',
      'COURSE_ACCESS_FORBIDDEN',
    );
}

async function requireRoundExists(roundId: bigint) {
  const round = await prisma.courseRound.findUnique({ where: { id: roundId } });
  if (!round) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
  return round;
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.patch(
    '/admin/rounds/:id/join',
    {
      schema: {
        tags: ['Course delivery'],
        summary: 'Set protected live and WhatsApp join details',
        description:
          'Live and WhatsApp URLs can be added only on or after the round start date. Public round responses never expose these values.',
      },
    },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(roundParamsSchema, request.params);
      const body = parseRequest(updateJoinSchema, request.body);
      const round = await requireRoundExists(BigInt(params.id));
      const addsJoinUrl =
        (body.liveJoinUrl !== undefined && body.liveJoinUrl !== null) ||
        (body.whatsappUrl !== undefined && body.whatsappUrl !== null);
      if (addsJoinUrl && round.startDate > calendarToday())
        throw new AppError(
          409,
          'Join URLs cannot be added before the round start date.',
          'ROUND_NOT_STARTED',
        );
      const updated = await prisma.courseRound.update({
        where: { id: round.id },
        data: {
          liveJoinUrl: body.liveJoinUrl,
          whatsappUrl: body.whatsappUrl,
          joiningInstructions: body.joiningInstructions,
        },
      });
      return { join: joinPayload(updated) };
    },
  );

  app.get(
    '/rounds/:id/join',
    {
      schema: {
        tags: ['Course delivery'],
        summary: 'Get the protected join-screen payload',
      },
    },
    async (request) => {
      const params = parseRequest(roundParamsSchema, request.params);
      const round = await requireRoundExists(BigInt(params.id));
      await requireRoundAccess(request, round.id);
      return { join: joinPayload(round) };
    },
  );

  app.get(
    '/rounds/:id/sessions',
    { schema: { tags: ['Sessions'], summary: 'List protected recorded sessions for a round' } },
    async (request) => {
      const params = parseRequest(roundParamsSchema, request.params);
      const roundId = BigInt(params.id);
      await requireRoundExists(roundId);
      await requireRoundAccess(request, roundId);
      const sessions = await prisma.session.findMany({
        where: { roundId },
        include: sessionInclude,
        orderBy: { sessionDate: 'asc' },
      });
      return { sessions: sessions.map(publicSession) };
    },
  );

  app.get(
    '/admin/sessions',
    { schema: { tags: ['Sessions'], summary: 'List sessions across all rounds' } },
    async (request) => {
      await requireAdmin(request);
      const query = parseRequest(adminSessionQuerySchema, request.query);
      const sessions = await prisma.session.findMany({
        where: { roundId: query.roundId ? BigInt(query.roundId) : undefined },
        include: sessionInclude,
        orderBy: { sessionDate: 'desc' },
      });
      return { sessions: sessions.map(publicSession) };
    },
  );

  app.post(
    '/rounds/:id/sessions',
    { schema: { tags: ['Sessions'], summary: 'Create a recorded session' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(roundParamsSchema, request.params);
      const body = parseRequest(sessionValuesSchema, request.body);
      const round = await requireRoundExists(BigInt(params.id));
      const session = await prisma.session.create({
        data: {
          roundId: round.id,
          title: body.title,
          sessionDate: new Date(body.sessionDate),
          recordingUrl: body.recordingUrl ?? null,
        },
        include: sessionInclude,
      });
      return reply.code(201).send({ session: publicSession(session) });
    },
  );

  app.patch(
    '/sessions/:id',
    { schema: { tags: ['Sessions'], summary: 'Update a recorded session' } },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(sessionParamsSchema, request.params);
      const body = parseRequest(updateSessionSchema, request.body);
      const sessionId = BigInt(params.id);
      const exists = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!exists) throw new AppError(404, 'Session was not found.', 'SESSION_NOT_FOUND');
      const session = await prisma.session.update({
        where: { id: sessionId },
        data: {
          title: body.title,
          sessionDate: body.sessionDate ? new Date(body.sessionDate) : undefined,
          recordingUrl: body.recordingUrl,
        },
        include: sessionInclude,
      });
      return { session: publicSession(session) };
    },
  );

  app.delete(
    '/sessions/:id',
    { schema: { tags: ['Sessions'], summary: 'Delete a recorded session' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(sessionParamsSchema, request.params);
      const deleted = await prisma.session.deleteMany({ where: { id: BigInt(params.id) } });
      if (deleted.count === 0)
        throw new AppError(404, 'Session was not found.', 'SESSION_NOT_FOUND');
      return reply.code(204).send();
    },
  );
}
