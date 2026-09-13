import type { File, Prisma } from '@prisma/client';

import { courseAccessStatuses } from '../../common/business/bookings.js';
import { utcCalendarToday } from '../../common/dates/calendar.js';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type {
  CreateMaterialInput,
  CreateRoundInput,
  ScheduleInput,
  UpdateMaterialInput,
  UpdateRoundInput,
  UpdateScheduleInput,
} from './schemas.js';

export const roundInclude = {
  course: { select: { id: true, title: true, archived: true } },
  schedules: { orderBy: { weekday: 'asc' as const } },
  _count: { select: { bookings: { where: { status: 'CONFIRMED' } } } },
} satisfies Prisma.CourseRoundInclude;

export type RoundWithDetails = Prisma.CourseRoundGetPayload<{ include: typeof roundInclude }>;
export type MaterialWithFile = Prisma.RoundMaterialGetPayload<{ include: { file: true } }>;

function inputDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function inputTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

async function lockRound(tx: Prisma.TransactionClient, roundId: bigint): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM course_rounds WHERE id = ${roundId} FOR UPDATE
  `;
  if (rows.length === 0) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
}

async function requireRoundWithoutBookings(
  tx: Prisma.TransactionClient,
  roundId: bigint,
): Promise<void> {
  const bookings = await tx.booking.count({ where: { roundId } });
  if (bookings > 0)
    throw new AppError(
      409,
      'A round with bookings cannot have its dates or schedule changed or be deleted.',
      'ROUND_HAS_BOOKINGS',
    );
}

async function lockEditableRound(tx: Prisma.TransactionClient, roundId: bigint): Promise<void> {
  await lockRound(tx, roundId);
  await requireRoundWithoutBookings(tx, roundId);
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

export async function findCourseForRounds(courseId: bigint) {
  return prisma.course.findUnique({ where: { id: courseId }, select: { archived: true } });
}

export async function listCourseRounds(courseId: bigint, includeUnavailable: boolean) {
  const rounds = await prisma.courseRound.findMany({
    where: { courseId },
    include: roundInclude,
    orderBy: { startDate: 'asc' },
  });
  if (includeUnavailable) return rounds;
  const today = utcCalendarToday();
  return rounds.filter(
    (round) => round.startDate > today && round._count.bookings < round.capacity,
  );
}

export async function findRound(id: bigint): Promise<RoundWithDetails | null> {
  return prisma.courseRound.findUnique({ where: { id }, include: roundInclude });
}

export async function createRound(
  courseId: bigint,
  input: CreateRoundInput,
): Promise<RoundWithDetails> {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
  return prisma.courseRound.create({
    data: {
      courseId: course.id,
      startDate: inputDate(input.startDate),
      endDate: inputDate(input.endDate),
      capacity: input.capacity,
      schedules: {
        create: (input.schedules ?? []).map((schedule) => ({
          weekday: schedule.weekday,
          startTime: inputTime(schedule.startTime),
        })),
      },
    },
    include: roundInclude,
  });
}

export async function updateRound(
  roundId: bigint,
  input: UpdateRoundInput,
): Promise<RoundWithDetails> {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    if (input.startDate !== undefined || input.endDate !== undefined)
      await requireRoundWithoutBookings(tx, roundId);
    const current = await tx.courseRound.findUniqueOrThrow({ where: { id: roundId } });
    const startDate = input.startDate ? inputDate(input.startDate) : current.startDate;
    const endDate = input.endDate ? inputDate(input.endDate) : current.endDate;
    if (endDate < startDate)
      throw new AppError(
        400,
        'The end date must be on or after the start date.',
        'INVALID_ROUND_DATES',
      );
    return tx.courseRound.update({
      where: { id: roundId },
      data: { startDate, endDate, capacity: input.capacity },
      include: roundInclude,
    });
  });
}

export async function deleteRound(roundId: bigint): Promise<bigint[]> {
  return prisma.$transaction(async (tx) => {
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
}

export async function createSchedule(
  roundId: bigint,
  input: ScheduleInput,
): Promise<RoundWithDetails> {
  return prisma.$transaction(async (tx) => {
    await lockEditableRound(tx, roundId);
    await tx.roundSchedule.create({
      data: { roundId, weekday: input.weekday, startTime: inputTime(input.startTime) },
    });
    return tx.courseRound.findUniqueOrThrow({ where: { id: roundId }, include: roundInclude });
  });
}

export async function updateSchedule(
  roundId: bigint,
  scheduleId: bigint,
  input: UpdateScheduleInput,
): Promise<RoundWithDetails> {
  return prisma.$transaction(async (tx) => {
    await lockEditableRound(tx, roundId);
    const schedule = await tx.roundSchedule.findFirst({ where: { id: scheduleId, roundId } });
    if (!schedule) throw new AppError(404, 'Schedule entry was not found.', 'SCHEDULE_NOT_FOUND');
    await tx.roundSchedule.update({
      where: { id: scheduleId },
      data: {
        weekday: input.weekday,
        startTime: input.startTime ? inputTime(input.startTime) : undefined,
      },
    });
    return tx.courseRound.findUniqueOrThrow({ where: { id: roundId }, include: roundInclude });
  });
}

export async function deleteSchedule(roundId: bigint, scheduleId: bigint): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockEditableRound(tx, roundId);
    const deleted = await tx.roundSchedule.deleteMany({ where: { id: scheduleId, roundId } });
    if (deleted.count === 0)
      throw new AppError(404, 'Schedule entry was not found.', 'SCHEDULE_NOT_FOUND');
  });
}

export async function findRoundForMaterials(roundId: bigint) {
  return prisma.courseRound.findUnique({ where: { id: roundId }, select: { id: true } });
}

export async function hasMaterialAccess(roundId: bigint, studentId: bigint): Promise<boolean> {
  const confirmed = await prisma.booking.count({
    where: { roundId, studentId, status: { in: courseAccessStatuses } },
  });
  return confirmed > 0;
}

export async function listMaterials(roundId: bigint): Promise<MaterialWithFile[]> {
  return prisma.roundMaterial.findMany({
    where: { roundId },
    include: { file: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createMaterial(
  roundId: bigint,
  uploaderId: bigint,
  input: CreateMaterialInput,
): Promise<MaterialWithFile> {
  const round = await findRoundForMaterials(roundId);
  if (!round) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
  if (input.kind === 'FILE') await validateMaterialFile(BigInt(input.fileId), uploaderId);
  return prisma.roundMaterial.create({
    data: {
      roundId,
      title: input.title,
      fileId: input.kind === 'FILE' ? BigInt(input.fileId) : null,
      externalUrl: input.kind === 'LINK' ? input.externalUrl : null,
    },
    include: { file: true },
  });
}

export async function updateMaterial(
  roundId: bigint,
  materialId: bigint,
  uploaderId: bigint,
  input: UpdateMaterialInput,
): Promise<{ material: MaterialWithFile; replacedFileId: bigint | null }> {
  const existing = await prisma.roundMaterial.findFirst({ where: { id: materialId, roundId } });
  if (!existing) throw new AppError(404, 'Material was not found.', 'MATERIAL_NOT_FOUND');
  if (input.kind === 'FILE' && input.fileId)
    await validateMaterialFile(BigInt(input.fileId), uploaderId);
  const material = await prisma.roundMaterial.update({
    where: { id: materialId },
    data: {
      title: input.title,
      fileId:
        input.kind === undefined ? undefined : input.kind === 'FILE' ? BigInt(input.fileId!) : null,
      externalUrl:
        input.kind === undefined ? undefined : input.kind === 'LINK' ? input.externalUrl : null,
    },
    include: { file: true },
  });
  return { material, replacedFileId: existing.fileId !== material.fileId ? existing.fileId : null };
}

export async function deleteMaterial(roundId: bigint, materialId: bigint) {
  const material = await prisma.roundMaterial.findFirst({ where: { id: materialId, roundId } });
  if (!material) throw new AppError(404, 'Material was not found.', 'MATERIAL_NOT_FOUND');
  await prisma.roundMaterial.delete({ where: { id: material.id } });
  return material;
}

export async function deleteFileIfOrphaned(fileId: bigint | null): Promise<File | null> {
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
