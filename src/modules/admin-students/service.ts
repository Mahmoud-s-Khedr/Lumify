import type { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { bookingInclude, type BookingWithDetails } from '../bookings/service.js';
import type { ListRosterQuery, ListStudentsQuery } from './schemas.js';

const studentInclude = { avatarFile: true } satisfies Prisma.UserInclude;

export type AdminStudent = Prisma.UserGetPayload<{ include: typeof studentInclude }>;

function studentSearchWhere(q: string | undefined): Prisma.UserWhereInput | undefined {
  if (!q) return undefined;
  return {
    OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q, mode: 'insensitive' } },
    ],
  };
}

function rosterWhere(
  query: ListRosterQuery,
  scope: Prisma.BookingWhereInput,
): Prisma.BookingWhereInput {
  const studentSearch = studentSearchWhere(query.q);
  return {
    ...scope,
    status: query.status,
    student: studentSearch,
  };
}

async function confirmedCounts(roundIds: bigint[]): Promise<Map<bigint, number>> {
  if (roundIds.length === 0) return new Map();
  const counts = await prisma.booking.groupBy({
    by: ['roundId'],
    where: { roundId: { in: [...new Set(roundIds)] }, status: 'CONFIRMED' },
    _count: { _all: true },
  });
  return new Map(counts.map((count) => [count.roundId, count._count._all]));
}

async function listRoster(query: ListRosterQuery, scope: Prisma.BookingWhereInput) {
  const where = rosterWhere(query, scope);
  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.booking.count({ where }),
  ]);
  return {
    bookings,
    total,
    confirmedCounts: await confirmedCounts(bookings.map((booking) => booking.roundId)),
  };
}

export async function listAdminStudents(query: ListStudentsQuery) {
  const where: Prisma.UserWhereInput = { role: 'STUDENT', ...studentSearchWhere(query.q) };
  const [students, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: studentInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  const ids = students.map((student) => student.id);
  const [enrollments, confirmedEnrollments] = await Promise.all([
    prisma.booking.groupBy({
      by: ['studentId'],
      where: { studentId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.booking.groupBy({
      by: ['studentId'],
      where: { studentId: { in: ids }, status: 'CONFIRMED' },
      _count: { _all: true },
    }),
  ]);
  return {
    students,
    total,
    enrollmentCounts: new Map(enrollments.map((item) => [item.studentId, item._count._all])),
    confirmedEnrollmentCounts: new Map(
      confirmedEnrollments.map((item) => [item.studentId, item._count._all]),
    ),
  };
}

export async function findAdminStudent(studentId: bigint): Promise<{
  student: AdminStudent;
  bookings: BookingWithDetails[];
  confirmedCounts: Map<bigint, number>;
  enrollmentCount: number;
  confirmedEnrollmentCount: number;
}> {
  const student = await prisma.user.findFirst({
    where: { id: studentId, role: 'STUDENT' },
    include: studentInclude,
  });
  if (!student) throw new AppError(404, 'Student was not found.', 'STUDENT_NOT_FOUND');
  const bookings = await prisma.booking.findMany({
    where: { studentId },
    include: bookingInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return {
    student,
    bookings,
    confirmedCounts: await confirmedCounts(bookings.map((booking) => booking.roundId)),
    enrollmentCount: bookings.length,
    confirmedEnrollmentCount: bookings.filter((booking) => booking.status === 'CONFIRMED').length,
  };
}

export async function listCourseRoster(courseId: bigint, query: ListRosterQuery) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
  return listRoster(query, { round: { courseId } });
}

export async function listRoundRoster(roundId: bigint, query: ListRosterQuery) {
  const round = await prisma.courseRound.findUnique({
    where: { id: roundId },
    select: { id: true },
  });
  if (!round) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
  return listRoster(query, { roundId });
}
