import type { Prisma, UserRole } from '@prisma/client';

import { courseAccessStatuses } from '../../common/business/bookings.js';
import { utcCalendarToday } from '../../common/dates/calendar.js';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type { CreateSessionInput, UpdateJoinInput, UpdateSessionInput } from './schemas.js';

export type CourseDeliveryIdentity = { sub: string; role: UserRole };

export const sessionInclude = {
  round: { include: { course: { select: { id: true, title: true } } } },
} satisfies Prisma.SessionInclude;

export type SessionWithRound = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;

export async function findRoundForDelivery(roundId: bigint) {
  const round = await prisma.courseRound.findUnique({ where: { id: roundId } });
  if (!round) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
  return round;
}

export async function requireRoundAccess(
  roundId: bigint,
  identity: CourseDeliveryIdentity,
): Promise<void> {
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

export async function updateJoinDetails(roundId: bigint, input: UpdateJoinInput) {
  const round = await findRoundForDelivery(roundId);
  const addsJoinUrl =
    (input.liveJoinUrl !== undefined && input.liveJoinUrl !== null) ||
    (input.whatsappUrl !== undefined && input.whatsappUrl !== null);
  if (addsJoinUrl && round.startDate > utcCalendarToday())
    throw new AppError(
      409,
      'Join URLs cannot be added before the round start date.',
      'ROUND_NOT_STARTED',
    );
  return prisma.courseRound.update({
    where: { id: round.id },
    data: {
      liveJoinUrl: input.liveJoinUrl,
      whatsappUrl: input.whatsappUrl,
      joiningInstructions: input.joiningInstructions,
    },
  });
}

export async function listRoundSessions(roundId: bigint): Promise<SessionWithRound[]> {
  return prisma.session.findMany({
    where: { roundId },
    include: sessionInclude,
    orderBy: { sessionDate: 'asc' },
  });
}

export async function listAdminSessions(roundId?: bigint): Promise<SessionWithRound[]> {
  return prisma.session.findMany({
    where: { roundId },
    include: sessionInclude,
    orderBy: { sessionDate: 'desc' },
  });
}

export async function createSession(
  roundId: bigint,
  input: CreateSessionInput,
): Promise<SessionWithRound> {
  const round = await findRoundForDelivery(roundId);
  return prisma.session.create({
    data: {
      roundId: round.id,
      title: input.title,
      sessionDate: new Date(input.sessionDate),
      recordingUrl: input.recordingUrl ?? null,
    },
    include: sessionInclude,
  });
}

export async function updateSession(
  sessionId: bigint,
  input: UpdateSessionInput,
): Promise<SessionWithRound> {
  const exists = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!exists) throw new AppError(404, 'Session was not found.', 'SESSION_NOT_FOUND');
  return prisma.session.update({
    where: { id: sessionId },
    data: {
      title: input.title,
      sessionDate: input.sessionDate ? new Date(input.sessionDate) : undefined,
      recordingUrl: input.recordingUrl,
    },
    include: sessionInclude,
  });
}

export async function deleteSession(sessionId: bigint): Promise<void> {
  const deleted = await prisma.session.deleteMany({ where: { id: sessionId } });
  if (deleted.count === 0) throw new AppError(404, 'Session was not found.', 'SESSION_NOT_FOUND');
}
