import type { File, Prisma } from '@prisma/client';

import { courseAccessStatuses } from '../../common/business/bookings.js';
import { utcCalendarToday } from '../../common/dates/calendar.js';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type {
  CreateMaterialInput,
  CreateRoundInput,
  OccurrenceInput,
  ReplaceScheduleModeInput,
  ScheduleInput,
  UpdateMaterialInput,
  UpdateOccurrenceInput,
  UpdateRoundInput,
  UpdateScheduleInput,
} from './schemas.js';

export const roundInclude = {
  course: { select: { id: true, title: true, archived: true } },
  schedules: { orderBy: { weekday: 'asc' as const } },
  occurrences: { orderBy: { startAt: 'asc' as const } },
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

function timeOnly(value: Date): string {
  return value.toISOString().slice(11, 16);
}

function requireDistinctScheduleTimes(startTime: Date, endTime: Date): void {
  if (timeOnly(startTime) === timeOnly(endTime))
    throw new AppError(
      400,
      'The end time must differ from the start time.',
      'INVALID_SCHEDULE_TIME_RANGE',
    );
}

const weekdayOffsets = new Map(
  ['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map(
    (weekday, index) => [weekday, index],
  ),
);
const minutesInDay = 24 * 60;
const minutesInWeek = 7 * minutesInDay;

type WeeklySchedulePeriod = { weekday: string; startTime: Date; endTime: Date };

function weeklyInterval(schedule: WeeklySchedulePeriod) {
  const weekday = weekdayOffsets.get(schedule.weekday);
  if (weekday === undefined) throw new AppError(400, 'Invalid weekday.', 'INVALID_WEEKDAY');
  const [startHour, startMinute] = timeOnly(schedule.startTime).split(':').map(Number);
  const [endHour, endMinute] = timeOnly(schedule.endTime).split(':').map(Number);
  const start = weekday * minutesInDay + startHour! * 60 + startMinute!;
  let end = weekday * minutesInDay + endHour! * 60 + endMinute!;
  if (end <= start) end += minutesInDay;
  return { start, end };
}

function intervalsOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start < right.end && right.start < left.end;
}

function requireNoWeeklyOverlap(schedules: WeeklySchedulePeriod[]): void {
  const intervals = schedules.map(weeklyInterval);
  for (let leftIndex = 0; leftIndex < intervals.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < intervals.length; rightIndex += 1) {
      const left = intervals[leftIndex]!;
      const right = intervals[rightIndex]!;
      if (
        [-minutesInWeek, 0, minutesInWeek].some((shift) =>
          intervalsOverlap(left, { start: right.start + shift, end: right.end + shift }),
        )
      )
        throw new AppError(
          409,
          'Weekly schedule entries cannot overlap.',
          'OVERLAPPING_SCHEDULE',
        );
    }
  }
}

type OccurrencePeriod = { startAt: Date; endAt: Date };

function requireValidOccurrences(
  occurrences: OccurrencePeriod[],
  roundStartDate: Date,
  roundEndDate: Date,
): void {
  const roundStart = roundStartDate.toISOString().slice(0, 10);
  const roundEnd = roundEndDate.toISOString().slice(0, 10);
  const dayAfterRoundEnd = new Date(`${roundEnd}T00:00:00.000Z`);
  dayAfterRoundEnd.setUTCDate(dayAfterRoundEnd.getUTCDate() + 1);
  const overnightEnd = dayAfterRoundEnd.toISOString().slice(0, 10);
  for (const occurrence of occurrences) {
    if (occurrence.startAt >= occurrence.endAt)
      throw new AppError(
        400,
        'The end timestamp must be after the start timestamp.',
        'INVALID_OCCURRENCE_TIME_RANGE',
      );
    const startDay = occurrence.startAt.toISOString().slice(0, 10);
    if (startDay < roundStart || startDay > roundEnd)
      throw new AppError(
        400,
        'An occurrence start timestamp must fall within the round dates.',
        'OCCURRENCE_OUTSIDE_ROUND_DATES',
      );
    const endDay = occurrence.endAt.toISOString().slice(0, 10);
    if (endDay > roundEnd && !(startDay === roundEnd && endDay === overnightEnd))
      throw new AppError(
        400,
        'An occurrence can end after the round only when it runs overnight from the final date.',
        'OCCURRENCE_OUTSIDE_ROUND_DATES',
      );
  }
  for (let leftIndex = 0; leftIndex < occurrences.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < occurrences.length; rightIndex += 1) {
      const left = occurrences[leftIndex]!;
      const right = occurrences[rightIndex]!;
      if (left.startAt < right.endAt && right.startAt < left.endAt)
        throw new AppError(409, 'Custom occurrences cannot overlap.', 'OVERLAPPING_OCCURRENCE');
    }
  }
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
      'A round with bookings cannot have its dates changed or be deleted.',
      'ROUND_HAS_BOOKINGS',
    );
}

async function lockEditableRound(tx: Prisma.TransactionClient, roundId: bigint): Promise<void> {
  await lockRound(tx, roundId);
  await requireRoundWithoutBookings(tx, roundId);
}

async function requireScheduleMode(
  tx: Prisma.TransactionClient,
  roundId: bigint,
  scheduleMode: 'WEEKLY' | 'CUSTOM',
) {
  const round = await tx.courseRound.findUniqueOrThrow({ where: { id: roundId } });
  if (round.scheduleMode !== scheduleMode)
    throw new AppError(
      409,
      `This round uses ${round.scheduleMode.toLowerCase()} scheduling.`,
      'SCHEDULE_MODE_MISMATCH',
    );
  return round;
}

async function refreshedRound(tx: Prisma.TransactionClient, roundId: bigint): Promise<RoundWithDetails> {
  await tx.courseRound.update({ where: { id: roundId }, data: {} });
  return tx.courseRound.findUniqueOrThrow({ where: { id: roundId }, include: roundInclude });
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
  const startDate = inputDate(input.startDate);
  const endDate = inputDate(input.endDate);
  if (input.scheduleMode !== 'CUSTOM') {
    const schedules = (input.schedules ?? []).map((schedule) => ({
      weekday: schedule.weekday,
      startTime: inputTime(schedule.startTime),
      endTime: inputTime(schedule.endTime),
    }));
    requireNoWeeklyOverlap(schedules);
    return prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate,
        endDate,
        capacity: input.capacity,
        scheduleMode: 'WEEKLY',
        schedules: { create: schedules },
      },
      include: roundInclude,
    });
  }
  const occurrences = (input.occurrences ?? []).map((occurrence) => ({
    startAt: new Date(occurrence.startAt),
    endAt: new Date(occurrence.endAt),
  }));
  requireValidOccurrences(occurrences, startDate, endDate);
  return prisma.courseRound.create({
    data: {
      courseId: course.id,
      startDate,
      endDate,
      capacity: input.capacity,
      scheduleMode: 'CUSTOM',
      occurrences: { create: occurrences },
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
    if (
      (input.startDate !== undefined || input.endDate !== undefined) &&
      current.scheduleMode === 'CUSTOM'
    ) {
      const occurrences = await tx.roundOccurrence.findMany({ where: { roundId } });
      requireValidOccurrences(occurrences, startDate, endDate);
    }
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
    await tx.roundOccurrence.deleteMany({ where: { roundId } });
    await tx.courseRound.delete({ where: { id: roundId } });
    return materials.flatMap((material) => (material.fileId === null ? [] : [material.fileId]));
  });
}

export async function createSchedule(
  roundId: bigint,
  input: ScheduleInput,
): Promise<RoundWithDetails> {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    await requireScheduleMode(tx, roundId, 'WEEKLY');
    const schedules = await tx.roundSchedule.findMany({ where: { roundId } });
    const candidate = {
      weekday: input.weekday,
      startTime: inputTime(input.startTime),
      endTime: inputTime(input.endTime),
    };
    requireNoWeeklyOverlap([...schedules, candidate]);
    await tx.roundSchedule.create({
      data: {
        roundId,
        ...candidate,
      },
    });
    return refreshedRound(tx, roundId);
  });
}

export async function updateSchedule(
  roundId: bigint,
  scheduleId: bigint,
  input: UpdateScheduleInput,
): Promise<RoundWithDetails> {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    await requireScheduleMode(tx, roundId, 'WEEKLY');
    const schedule = await tx.roundSchedule.findFirst({ where: { id: scheduleId, roundId } });
    if (!schedule) throw new AppError(404, 'Schedule entry was not found.', 'SCHEDULE_NOT_FOUND');
    const startTime = input.startTime ? inputTime(input.startTime) : schedule.startTime;
    const endTime = input.endTime ? inputTime(input.endTime) : schedule.endTime;
    requireDistinctScheduleTimes(startTime, endTime);
    const weekday = input.weekday ?? schedule.weekday;
    const otherSchedules = await tx.roundSchedule.findMany({ where: { roundId, id: { not: scheduleId } } });
    requireNoWeeklyOverlap([...otherSchedules, { weekday, startTime, endTime }]);
    await tx.roundSchedule.update({
      where: { id: scheduleId },
      data: {
        weekday,
        startTime,
        endTime,
      },
    });
    return refreshedRound(tx, roundId);
  });
}

export async function deleteSchedule(roundId: bigint, scheduleId: bigint): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    await requireScheduleMode(tx, roundId, 'WEEKLY');
    const deleted = await tx.roundSchedule.deleteMany({ where: { id: scheduleId, roundId } });
    if (deleted.count === 0)
      throw new AppError(404, 'Schedule entry was not found.', 'SCHEDULE_NOT_FOUND');
  });
}

export async function createOccurrence(
  roundId: bigint,
  input: OccurrenceInput,
): Promise<RoundWithDetails> {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    const round = await requireScheduleMode(tx, roundId, 'CUSTOM');
    const candidate = { startAt: new Date(input.startAt), endAt: new Date(input.endAt) };
    const occurrences = await tx.roundOccurrence.findMany({ where: { roundId } });
    requireValidOccurrences([...occurrences, candidate], round.startDate, round.endDate);
    await tx.roundOccurrence.create({ data: { roundId, ...candidate } });
    return refreshedRound(tx, roundId);
  });
}

export async function updateOccurrence(
  roundId: bigint,
  occurrenceId: bigint,
  input: UpdateOccurrenceInput,
): Promise<RoundWithDetails> {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    const round = await requireScheduleMode(tx, roundId, 'CUSTOM');
    const occurrence = await tx.roundOccurrence.findFirst({ where: { id: occurrenceId, roundId } });
    if (!occurrence) throw new AppError(404, 'Occurrence was not found.', 'OCCURRENCE_NOT_FOUND');
    const candidate = {
      startAt: input.startAt ? new Date(input.startAt) : occurrence.startAt,
      endAt: input.endAt ? new Date(input.endAt) : occurrence.endAt,
    };
    const others = await tx.roundOccurrence.findMany({ where: { roundId, id: { not: occurrenceId } } });
    requireValidOccurrences([...others, candidate], round.startDate, round.endDate);
    await tx.roundOccurrence.update({ where: { id: occurrenceId }, data: candidate });
    return refreshedRound(tx, roundId);
  });
}

export async function deleteOccurrence(roundId: bigint, occurrenceId: bigint): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    await requireScheduleMode(tx, roundId, 'CUSTOM');
    const deleted = await tx.roundOccurrence.deleteMany({ where: { id: occurrenceId, roundId } });
    if (deleted.count === 0)
      throw new AppError(404, 'Occurrence was not found.', 'OCCURRENCE_NOT_FOUND');
    await tx.courseRound.update({ where: { id: roundId }, data: {} });
  });
}

export async function replaceScheduleMode(
  roundId: bigint,
  input: ReplaceScheduleModeInput,
): Promise<RoundWithDetails> {
  return prisma.$transaction(async (tx) => {
    await lockRound(tx, roundId);
    const round = await tx.courseRound.findUniqueOrThrow({ where: { id: roundId } });
    if (input.scheduleMode === 'WEEKLY') {
      const schedules = input.schedules.map((schedule) => ({
        weekday: schedule.weekday,
        startTime: inputTime(schedule.startTime),
        endTime: inputTime(schedule.endTime),
      }));
      requireNoWeeklyOverlap(schedules);
      await tx.roundOccurrence.deleteMany({ where: { roundId } });
      await tx.roundSchedule.deleteMany({ where: { roundId } });
      await tx.courseRound.update({
        where: { id: roundId },
        data: { scheduleMode: 'WEEKLY', schedules: { create: schedules } },
      });
    } else {
      const occurrences = input.occurrences.map((occurrence) => ({
        startAt: new Date(occurrence.startAt),
        endAt: new Date(occurrence.endAt),
      }));
      requireValidOccurrences(occurrences, round.startDate, round.endDate);
      await tx.roundSchedule.deleteMany({ where: { roundId } });
      await tx.roundOccurrence.deleteMany({ where: { roundId } });
      await tx.courseRound.update({
        where: { id: roundId },
        data: { scheduleMode: 'CUSTOM', occurrences: { create: occurrences } },
      });
    }
    return tx.courseRound.findUniqueOrThrow({ where: { id: roundId }, include: roundInclude });
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
