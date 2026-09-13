import type { FastifyInstance } from 'fastify';

import { requireAdmin, requireUser } from '../../common/authorization/auth.js';
import { parseRequest } from '../../common/validation/request.js';
import { publicJoinDetails, publicSession } from './presenter.js';
import {
  adminSessionQuerySchema,
  createSessionSchema,
  roundParamsSchema,
  sessionParamsSchema,
  updateJoinSchema,
  updateSessionSchema,
} from './schemas.js';
import {
  createSession,
  deleteSession,
  findRoundForDelivery,
  listAdminSessions,
  listRoundSessions,
  requireRoundAccess,
  updateJoinDetails,
  updateSession,
} from './service.js';

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
      const updated = await updateJoinDetails(BigInt(params.id), body);
      return { join: publicJoinDetails(updated) };
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
      const round = await findRoundForDelivery(BigInt(params.id));
      await requireRoundAccess(round.id, await requireUser(request));
      return { join: publicJoinDetails(round) };
    },
  );

  app.get(
    '/rounds/:id/sessions',
    { schema: { tags: ['Sessions'], summary: 'List protected recorded sessions for a round' } },
    async (request) => {
      const params = parseRequest(roundParamsSchema, request.params);
      const roundId = BigInt(params.id);
      await findRoundForDelivery(roundId);
      await requireRoundAccess(roundId, await requireUser(request));
      const sessions = await listRoundSessions(roundId);
      return { sessions: sessions.map(publicSession) };
    },
  );

  app.get(
    '/admin/sessions',
    { schema: { tags: ['Sessions'], summary: 'List sessions across all rounds' } },
    async (request) => {
      await requireAdmin(request);
      const query = parseRequest(adminSessionQuerySchema, request.query);
      const sessions = await listAdminSessions(query.roundId ? BigInt(query.roundId) : undefined);
      return { sessions: sessions.map(publicSession) };
    },
  );

  app.post(
    '/rounds/:id/sessions',
    { schema: { tags: ['Sessions'], summary: 'Create a recorded session' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(roundParamsSchema, request.params);
      const body = parseRequest(createSessionSchema, request.body);
      const session = await createSession(BigInt(params.id), body);
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
      const session = await updateSession(BigInt(params.id), body);
      return { session: publicSession(session) };
    },
  );

  app.delete(
    '/sessions/:id',
    { schema: { tags: ['Sessions'], summary: 'Delete a recorded session' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(sessionParamsSchema, request.params);
      await deleteSession(BigInt(params.id));
      return reply.code(204).send();
    },
  );
}
