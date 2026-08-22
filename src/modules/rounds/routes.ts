import { Prisma, type File } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireUser } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { objectStorage } from '../../infrastructure/r2/storage.js';
import { publicFile } from '../files/routes.js';

const idSchema = z.string().regex(/^\d+$/);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, {
    message: 'Invalid calendar date.',
  });
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const weekdaySchema = z.enum([
  'SATURDAY',
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
]);
const scheduleValuesSchema = z.object({ weekday: weekdaySchema, startTime: timeSchema });
const roundValuesSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  capacity: z.coerce.number().int().min(1).max(100_000),
});
const createRoundSchema = roundValuesSchema
  .extend({ schedules: z.array(scheduleValuesSchema).max(7).default([]) })
  .refine((value) => value.endDate >= value.startDate, {
    message: 'The end date must be on or after the start date.',
    path: ['endDate'],
  })
  .refine(
    (value) =>
      new Set(value.schedules.map((schedule) => schedule.weekday)).size === value.schedules.length,
    { message: 'A weekday can appear only once in a round schedule.', path: ['schedules'] },
  );
const updateRoundSchema = roundValuesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one round field is required.');
const courseParamsSchema = z.object({ courseId: idSchema });
const roundParamsSchema = z.object({ id: idSchema });
const scheduleParamsSchema = z.object({ id: idSchema, scheduleId: idSchema });
const updateScheduleSchema = scheduleValuesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one schedule field is required.');
const materialParamsSchema = z.object({ id: idSchema, materialId: idSchema });
const materialTitleSchema = z.string().trim().min(1).max(255);
const createMaterialSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FILE'), title: materialTitleSchema, fileId: idSchema }),
  z.object({
    kind: z.literal('LINK'),
    title: materialTitleSchema,
    externalUrl: z.string().url().max(2_000),
  }),
]);
const updateMaterialSchema = z
  .object({
    title: materialTitleSchema.optional(),
    kind: z.enum(['FILE', 'LINK']).optional(),
    fileId: idSchema.optional(),
    externalUrl: z.string().url().max(2_000).optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one material field is required.',
      });
    if (value.kind === 'FILE' && !value.fileId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fileId is required for a file material.',
      });
    if (value.kind === 'LINK' && !value.externalUrl)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'externalUrl is required for a link material.',
      });
    if (value.kind === undefined && (value.fileId !== undefined || value.externalUrl !== undefined))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'kind is required when changing the material source.',
      });
    if (value.kind === 'FILE' && value.externalUrl !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A file material cannot have an external URL.',
      });
    if (value.kind === 'LINK' && value.fileId !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A link material cannot have a file.',
      });
  });

const roundInclude = {
  course: { select: { id: true, title: true, archived: true } },
  schedules: { orderBy: { weekday: 'asc' as const } },
} satisfies Prisma.CourseRoundInclude;

type RoundWithDetails = Prisma.CourseRoundGetPayload<{ include: typeof roundInclude }>;
type MaterialWithFile = Prisma.RoundMaterialGetPayload<{ include: { file: true } }>;

const weekdayOrder = new Map(
  ['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map(
    (weekday, index) => [weekday, index],
  ),
);

function inputDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function inputTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

function publicSchedule(schedule: { id: bigint; weekday: string; startTime: Date }) {
  return {
    id: schedule.id.toString(),
    weekday: schedule.weekday,
    startTime: schedule.startTime.toISOString().slice(11, 16),
  };
}

function publicRound(round: RoundWithDetails) {
  return {
    id: round.id.toString(),
    course: { id: round.course.id.toString(), title: round.course.title },
    startDate: round.startDate.toISOString().slice(0, 10),
    endDate: round.endDate.toISOString().slice(0, 10),
    capacity: round.capacity,
    schedules: round.schedules
      .sort(
        (left, right) =>
          (weekdayOrder.get(left.weekday) ?? 0) - (weekdayOrder.get(right.weekday) ?? 0),
      )
      .map(publicSchedule),
    createdAt: round.createdAt.toISOString(),
    updatedAt: round.updatedAt.toISOString(),
  };
}

function publicMaterial(material: MaterialWithFile) {
  return {
    id: material.id.toString(),
    title: material.title,
    kind: material.file ? ('FILE' as const) : ('LINK' as const),
    file: material.file ? publicFile(material.file) : null,
    externalUrl: material.externalUrl,
    createdAt: material.createdAt.toISOString(),
  };
}

async function findRound(id: bigint): Promise<RoundWithDetails | null> {
  return prisma.courseRound.findUnique({ where: { id }, include: roundInclude });
}

async function requireVisibleRound(request: FastifyRequest, id: bigint): Promise<RoundWithDetails> {
  const round = await findRound(id);
  if (!round) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
  if (round.course.archived) await requireAdmin(request);
  return round;
}

async function lockEditableRound(tx: Prisma.TransactionClient, roundId: bigint): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM course_rounds WHERE id = ${roundId} FOR UPDATE
  `;
  if (rows.length === 0) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
  const bookings = await tx.booking.count({ where: { roundId } });
  if (bookings > 0)
    throw new AppError(
      409,
      'A round with bookings cannot be changed or deleted.',
      'ROUND_HAS_BOOKINGS',
    );
}

async function validateMaterialFile(fileId: bigint, uploaderId: bigint): Promise<File> {
  const file = await prisma.file.findFirst({ where: { id: fileId, uploadedById: uploaderId } });
  if (!file || !file.storageKey.startsWith('round-materials/'))
    throw new AppError(
      400,
      'The material file must be a completed round-material upload owned by the administrator.',
      'INVALID_MATERIAL_FILE',
    );
  return file;
}

async function deleteFileIfOrphaned(fileId: bigint | null): Promise<File | null> {
  if (fileId === null) return null;
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    include: { _count: { select: { courseImages: true, materials: true, receipts: true } } },
  });
  if (!file || file._count.courseImages + file._count.materials + file._count.receipts !== 0)
    return null;
  await prisma.file.delete({ where: { id: fileId } });
  return file;
}

async function requireMaterialAccess(request: FastifyRequest, roundId: bigint): Promise<void> {
  const identity = await requireUser(request);
  if (identity.role === 'ADMIN') return;
  const confirmed = await prisma.booking.count({
    where: { roundId, studentId: BigInt(identity.sub), status: 'CONFIRMED' },
  });
  if (confirmed === 0)
    throw new AppError(
      403,
      'Only confirmed students can access round materials.',
      'MATERIAL_ACCESS_FORBIDDEN',
    );
}

export async function roundRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/courses/:courseId/rounds',
    { schema: { tags: ['Rounds'], summary: 'List the rounds for a course' } },
    async (request) => {
      const params = parseRequest(courseParamsSchema, request.params);
      const course = await prisma.course.findUnique({
        where: { id: BigInt(params.courseId) },
        select: { archived: true },
      });
      if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
      if (course.archived) await requireAdmin(request);
      const rounds = await prisma.courseRound.findMany({
        where: { courseId: BigInt(params.courseId) },
        include: roundInclude,
        orderBy: { startDate: 'asc' },
      });
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
      const course = await prisma.course.findUnique({
        where: { id: BigInt(params.courseId) },
        select: { id: true },
      });
      if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
      const round = await prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: inputDate(body.startDate),
          endDate: inputDate(body.endDate),
          capacity: body.capacity,
          schedules: {
            create: (body.schedules ?? []).map((schedule) => ({
              weekday: schedule.weekday,
              startTime: inputTime(schedule.startTime),
            })),
          },
        },
        include: roundInclude,
      });
      return reply.code(201).send({ round: publicRound(round) });
    },
  );

  app.patch(
    '/rounds/:id',
    { schema: { tags: ['Rounds'], summary: 'Update a round that has no bookings' } },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(roundParamsSchema, request.params);
      const body = parseRequest(updateRoundSchema, request.body);
      const roundId = BigInt(params.id);
      const round = await prisma.$transaction(async (tx) => {
        await lockEditableRound(tx, roundId);
        const current = await tx.courseRound.findUniqueOrThrow({ where: { id: roundId } });
        const startDate = body.startDate ? inputDate(body.startDate) : current.startDate;
        const endDate = body.endDate ? inputDate(body.endDate) : current.endDate;
        if (endDate < startDate)
          throw new AppError(
            400,
            'The end date must be on or after the start date.',
            'INVALID_ROUND_DATES',
          );
        return tx.courseRound.update({
          where: { id: roundId },
          data: { startDate, endDate, capacity: body.capacity },
          include: roundInclude,
        });
      });
      return { round: publicRound(round) };
    },
  );

  app.delete(
    '/rounds/:id',
    { schema: { tags: ['Rounds'], summary: 'Delete a round that has no bookings' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(roundParamsSchema, request.params);
      const roundId = BigInt(params.id);
      const materialFileIds = await prisma.$transaction(async (tx) => {
        await lockEditableRound(tx, roundId);
        const materials = await tx.roundMaterial.findMany({
          where: { roundId },
          select: { fileId: true },
        });
        await tx.session.deleteMany({ where: { roundId } });
        await tx.roundMaterial.deleteMany({ where: { roundId } });
        await tx.roundSchedule.deleteMany({ where: { roundId } });
        await tx.courseRound.delete({ where: { id: roundId } });
        return materials.flatMap((material) => (material.fileId === null ? [] : [material.fileId]));
      });
      const uniqueFileIds = [...new Set(materialFileIds)];
      const files = await Promise.all(uniqueFileIds.map(deleteFileIfOrphaned));
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
      const roundId = BigInt(params.id);
      try {
        const round = await prisma.$transaction(async (tx) => {
          await lockEditableRound(tx, roundId);
          await tx.roundSchedule.create({
            data: { roundId, weekday: body.weekday, startTime: inputTime(body.startTime) },
          });
          return tx.courseRound.findUniqueOrThrow({
            where: { id: roundId },
            include: roundInclude,
          });
        });
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
      const roundId = BigInt(params.id);
      const scheduleId = BigInt(params.scheduleId);
      try {
        const round = await prisma.$transaction(async (tx) => {
          await lockEditableRound(tx, roundId);
          const schedule = await tx.roundSchedule.findFirst({ where: { id: scheduleId, roundId } });
          if (!schedule)
            throw new AppError(404, 'Schedule entry was not found.', 'SCHEDULE_NOT_FOUND');
          await tx.roundSchedule.update({
            where: { id: scheduleId },
            data: {
              weekday: body.weekday,
              startTime: body.startTime ? inputTime(body.startTime) : undefined,
            },
          });
          return tx.courseRound.findUniqueOrThrow({
            where: { id: roundId },
            include: roundInclude,
          });
        });
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
      const roundId = BigInt(params.id);
      await prisma.$transaction(async (tx) => {
        await lockEditableRound(tx, roundId);
        const deleted = await tx.roundSchedule.deleteMany({
          where: { id: BigInt(params.scheduleId), roundId },
        });
        if (deleted.count === 0)
          throw new AppError(404, 'Schedule entry was not found.', 'SCHEDULE_NOT_FOUND');
      });
      return reply.code(204).send();
    },
  );

  app.get(
    '/rounds/:id/materials',
    { schema: { tags: ['Round materials'], summary: 'List protected round materials' } },
    async (request) => {
      const params = parseRequest(roundParamsSchema, request.params);
      const roundId = BigInt(params.id);
      const exists = await prisma.courseRound.findUnique({
        where: { id: roundId },
        select: { id: true },
      });
      if (!exists) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
      await requireMaterialAccess(request, roundId);
      const materials = await prisma.roundMaterial.findMany({
        where: { roundId },
        include: { file: true },
        orderBy: { createdAt: 'asc' },
      });
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
      const roundId = BigInt(params.id);
      const round = await prisma.courseRound.findUnique({
        where: { id: roundId },
        select: { id: true },
      });
      if (!round) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
      if (body.kind === 'FILE')
        await validateMaterialFile(BigInt(body.fileId), BigInt(identity.sub));
      const material = await prisma.roundMaterial.create({
        data: {
          roundId,
          title: body.title,
          fileId: body.kind === 'FILE' ? BigInt(body.fileId) : null,
          externalUrl: body.kind === 'LINK' ? body.externalUrl : null,
        },
        include: { file: true },
      });
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
      const roundId = BigInt(params.id);
      const materialId = BigInt(params.materialId);
      const existing = await prisma.roundMaterial.findFirst({ where: { id: materialId, roundId } });
      if (!existing) throw new AppError(404, 'Material was not found.', 'MATERIAL_NOT_FOUND');
      if (body.kind === 'FILE' && body.fileId)
        await validateMaterialFile(BigInt(body.fileId), BigInt(identity.sub));
      const material = await prisma.roundMaterial.update({
        where: { id: materialId },
        data: {
          title: body.title,
          fileId:
            body.kind === undefined
              ? undefined
              : body.kind === 'FILE'
                ? BigInt(body.fileId!)
                : null,
          externalUrl:
            body.kind === undefined ? undefined : body.kind === 'LINK' ? body.externalUrl : null,
        },
        include: { file: true },
      });
      if (existing.fileId !== null && existing.fileId !== material.fileId) {
        const orphan = await deleteFileIfOrphaned(existing.fileId);
        if (orphan) await objectStorage().delete(orphan.storageKey);
      }
      return { material: publicMaterial(material) };
    },
  );

  app.delete(
    '/rounds/:id/materials/:materialId',
    { schema: { tags: ['Round materials'], summary: 'Delete a round material' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(materialParamsSchema, request.params);
      const material = await prisma.roundMaterial.findFirst({
        where: { id: BigInt(params.materialId), roundId: BigInt(params.id) },
      });
      if (!material) throw new AppError(404, 'Material was not found.', 'MATERIAL_NOT_FOUND');
      await prisma.roundMaterial.delete({ where: { id: material.id } });
      const orphan = await deleteFileIfOrphaned(material.fileId);
      if (orphan) await objectStorage().delete(orphan.storageKey);
      return reply.code(204).send();
    },
  );
}
