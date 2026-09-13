import { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { requireAdmin, requireUser } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { objectStorage } from '../../infrastructure/r2/storage.js';
import { publicMaterial, publicRound } from './presenter.js';
import {
  courseParamsSchema,
  createMaterialSchema,
  createRoundSchema,
  listRoundsQuerySchema,
  materialParamsSchema,
  roundParamsSchema,
  scheduleParamsSchema,
  scheduleValuesSchema,
  updateMaterialSchema,
  updateRoundSchema,
  updateScheduleSchema,
} from './schemas.js';
import {
  createMaterial,
  createRound,
  createSchedule,
  deleteFileIfOrphaned,
  deleteMaterial,
  deleteRound,
  deleteSchedule,
  findCourseForRounds,
  findRound,
  findRoundForMaterials,
  hasMaterialAccess,
  listCourseRounds,
  listMaterials,
  updateMaterial,
  updateRound,
  updateSchedule,
} from './service.js';

async function requireVisibleRound(request: FastifyRequest, id: bigint) {
  const round = await findRound(id);
  if (!round) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
  if (round.course.archived) await requireAdmin(request);
  return round;
}

async function requireMaterialAccess(request: FastifyRequest, roundId: bigint): Promise<void> {
  const identity = await requireUser(request);
  if (identity.role === 'ADMIN') return;
  if (!(await hasMaterialAccess(roundId, BigInt(identity.sub))))
    throw new AppError(
      403,
      'Only confirmed students can access round materials.',
      'MATERIAL_ACCESS_FORBIDDEN',
    );
}

export async function roundRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/courses/:courseId/rounds',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'List bookable rounds for a course',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { includeUnavailable: { type: 'string', enum: ['true'] } },
        },
      },
    },
    async (request) => {
      const params = parseRequest(courseParamsSchema, request.params);
      const query = parseRequest(listRoundsQuerySchema, request.query);
      if (query.includeUnavailable) await requireAdmin(request);
      const course = await findCourseForRounds(BigInt(params.courseId));
      if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
      if (course.archived) await requireAdmin(request);
      const rounds = await listCourseRounds(
        BigInt(params.courseId),
        Boolean(query.includeUnavailable),
      );
      return { rounds: rounds.map(publicRound) };
    },
  );

  app.get(
    '/rounds/:id',
    { schema: { tags: ['Rounds'], summary: 'Get round details and its weekly schedule' } },
    async (request) => {
      const params = parseRequest(roundParamsSchema, request.params);
      return { round: publicRound(await requireVisibleRound(request, BigInt(params.id))) };
    },
  );

  app.post(
    '/courses/:courseId/rounds',
    { schema: { tags: ['Rounds'], summary: 'Create a course round with a weekly schedule' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(courseParamsSchema, request.params);
      const body = parseRequest(createRoundSchema, request.body);
      const round = await createRound(BigInt(params.courseId), body);
      return reply.code(201).send({ round: publicRound(round) });
    },
  );

  app.patch(
    '/rounds/:id',
    {
      schema: {
        tags: ['Rounds'],
        summary: 'Update round dates before enrollment or capacity at any time',
      },
    },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(roundParamsSchema, request.params);
      const body = parseRequest(updateRoundSchema, request.body);
      return { round: publicRound(await updateRound(BigInt(params.id), body)) };
    },
  );

  app.delete(
    '/rounds/:id',
    { schema: { tags: ['Rounds'], summary: 'Delete a round that has no bookings' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(roundParamsSchema, request.params);
      const materialFileIds = await deleteRound(BigInt(params.id));
      const files = await Promise.all(
        [...new Set(materialFileIds)].map((fileId) => deleteFileIfOrphaned(fileId)),
      );
      await Promise.all(
        files.flatMap((file) => (file === null ? [] : [objectStorage().delete(file.storageKey)])),
      );
      return reply.code(204).send();
    },
  );

  app.post(
    '/rounds/:id/schedules',
    { schema: { tags: ['Rounds'], summary: 'Add a weekly schedule entry' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(roundParamsSchema, request.params);
      const body = parseRequest(scheduleValuesSchema, request.body);
      try {
        const round = await createSchedule(BigInt(params.id), body);
        return reply.code(201).send({ round: publicRound(round) });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new AppError(
            409,
            'This weekday already has a schedule entry.',
            'DUPLICATE_SCHEDULE_WEEKDAY',
          );
        throw error;
      }
    },
  );

  app.patch(
    '/rounds/:id/schedules/:scheduleId',
    { schema: { tags: ['Rounds'], summary: 'Update a weekly schedule entry' } },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(scheduleParamsSchema, request.params);
      const body = parseRequest(updateScheduleSchema, request.body);
      try {
        const round = await updateSchedule(BigInt(params.id), BigInt(params.scheduleId), body);
        return { round: publicRound(round) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new AppError(
            409,
            'This weekday already has a schedule entry.',
            'DUPLICATE_SCHEDULE_WEEKDAY',
          );
        throw error;
      }
    },
  );

  app.delete(
    '/rounds/:id/schedules/:scheduleId',
    { schema: { tags: ['Rounds'], summary: 'Delete a weekly schedule entry' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(scheduleParamsSchema, request.params);
      await deleteSchedule(BigInt(params.id), BigInt(params.scheduleId));
      return reply.code(204).send();
    },
  );

  app.get(
    '/rounds/:id/materials',
    { schema: { tags: ['Round materials'], summary: 'List protected round materials' } },
    async (request) => {
      const params = parseRequest(roundParamsSchema, request.params);
      const roundId = BigInt(params.id);
      if (!(await findRoundForMaterials(roundId)))
        throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
      await requireMaterialAccess(request, roundId);
      const materials = await listMaterials(roundId);
      return { materials: materials.map(publicMaterial) };
    },
  );

  app.post(
    '/rounds/:id/materials',
    { schema: { tags: ['Round materials'], summary: 'Add a file or link material' } },
    async (request, reply) => {
      const identity = await requireAdmin(request);
      const params = parseRequest(roundParamsSchema, request.params);
      const body = parseRequest(createMaterialSchema, request.body);
      const material = await createMaterial(BigInt(params.id), BigInt(identity.sub), body);
      return reply.code(201).send({ material: publicMaterial(material) });
    },
  );

  app.patch(
    '/rounds/:id/materials/:materialId',
    { schema: { tags: ['Round materials'], summary: 'Update a round material' } },
    async (request) => {
      const identity = await requireAdmin(request);
      const params = parseRequest(materialParamsSchema, request.params);
      const body = parseRequest(updateMaterialSchema, request.body);
      const result = await updateMaterial(
        BigInt(params.id),
        BigInt(params.materialId),
        BigInt(identity.sub),
        body,
      );
      const orphan = await deleteFileIfOrphaned(result.replacedFileId);
      if (orphan) await objectStorage().delete(orphan.storageKey);
      return { material: publicMaterial(result.material) };
    },
  );

  app.delete(
    '/rounds/:id/materials/:materialId',
    { schema: { tags: ['Round materials'], summary: 'Delete a round material' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(materialParamsSchema, request.params);
      const material = await deleteMaterial(BigInt(params.id), BigInt(params.materialId));
      const orphan = await deleteFileIfOrphaned(material.fileId);
      if (orphan) await objectStorage().delete(orphan.storageKey);
      return reply.code(204).send();
    },
  );
}
