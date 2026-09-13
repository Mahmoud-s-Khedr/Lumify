import type { Prisma } from '@prisma/client';

import { courseAccessStatuses } from '../../common/business/bookings.js';
import { prisma } from '../../infrastructure/database/prisma.js';

export const sessionInclude = {
  round: { include: { course: { select: { id: true, title: true } } } },
} satisfies Prisma.SessionInclude;

export function findRound(roundId: bigint) {
  return prisma.courseRound.findUnique({ where: { id: roundId } });
}

export function countRoundAccess(roundId: bigint, studentId: bigint) {
  return prisma.booking.count({
    where: { roundId, studentId, status: { in: courseAccessStatuses } },
  });
}

export function updateRoundJoinDetails(
  roundId: bigint,
  data: Pick<Prisma.CourseRoundUpdateInput, 'liveJoinUrl' | 'whatsappUrl' | 'joiningInstructions'>,
) {
  return prisma.courseRound.update({ where: { id: roundId }, data });
}

export function findRoundSessions(roundId: bigint | undefined, order: 'asc' | 'desc') {
  return prisma.session.findMany({
    where: { roundId },
    include: sessionInclude,
    orderBy: { sessionDate: order },
  });
}

export function createSessionRecord(input: {
  roundId: bigint;
  title: string;
  sessionDate: Date;
  recordingUrl: string | null;
}) {
  return prisma.session.create({ data: input, include: sessionInclude });
}

export function findSession(sessionId: bigint) {
  return prisma.session.findUnique({ where: { id: sessionId } });
}

export function updateSessionRecord(sessionId: bigint, data: Prisma.SessionUpdateInput) {
  return prisma.session.update({ where: { id: sessionId }, data, include: sessionInclude });
}

export function deleteSessionRecord(sessionId: bigint) {
  return prisma.session.deleteMany({ where: { id: sessionId } });
}
