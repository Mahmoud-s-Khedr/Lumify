import type { Prisma } from '@prisma/client';

import { calculateRoundState, courseAccessStatuses } from '../../common/business/bookings.js';
import { utcCalendarToday } from '../../common/dates/calendar.js';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type { StudentCoursesQuery } from './schemas.js';

const studentCourseInclude = {
  round: {
    include: {
      course: {
        select: {
          id: true,
          title: true,
          images: {
            include: { file: true },
            orderBy: { sortOrder: 'asc' as const },
            take: 1,
          },
        },
      },
      sessions: {
        select: { id: true, title: true, sessionDate: true },
        orderBy: { sessionDate: 'asc' as const },
        take: 1,
      },
      _count: { select: { sessions: { where: { recordingUrl: { not: null } } } } },
    },
  },
} satisfies Prisma.BookingInclude;

const studentRoundInclude = {
  course: { select: { id: true, title: true, description: true } },
  schedules: { orderBy: { weekday: 'asc' as const } },
  sessions: {
    select: { id: true, title: true, sessionDate: true, recordingUrl: true },
    orderBy: { sessionDate: 'asc' as const },
  },
  materials: { include: { file: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.CourseRoundInclude;

export type StudentCourseBooking = Prisma.BookingGetPayload<{
  include: typeof studentCourseInclude;
}>;
export type StudentRound = Prisma.CourseRoundGetPayload<{ include: typeof studentRoundInclude }>;

type DashboardBooking = {
  round: {
    id: bigint;
    startDate: Date;
    endDate: Date;
    course: { id: bigint; title: string };
    sessions: Array<{ id: bigint; title: string; sessionDate: Date }>;
  };
};

export type StudentDashboard = {
  user: { name: string };
  bookings: DashboardBooking[];
  courses: Prisma.CourseGetPayload<{
    include: { images: { include: { file: true } } };
  }>[];
  recordings: Prisma.SessionGetPayload<{
    include: { round: { include: { course: { select: { id: true; title: true } } } } };
  }>[];
  today: Date;
};

function sortBookingsByNextSession(left: DashboardBooking, right: DashboardBooking): number {
  const leftDate = left.round.sessions[0]?.sessionDate;
  const rightDate = right.round.sessions[0]?.sessionDate;
  if (leftDate && rightDate && leftDate.getTime() !== rightDate.getTime())
    return leftDate.getTime() - rightDate.getTime();
  if (leftDate) return -1;
  if (rightDate) return 1;
  if (left.round.startDate.getTime() !== right.round.startDate.getTime())
    return left.round.startDate.getTime() - right.round.startDate.getTime();
  return left.round.id < right.round.id ? -1 : left.round.id > right.round.id ? 1 : 0;
}

export async function listStudentCourses(studentId: bigint, query: StudentCoursesQuery) {
  const now = new Date();
  const today = utcCalendarToday();
  const recordingsWhere =
    query.recordings === undefined
      ? undefined
      : query.recordings === 'AVAILABLE'
        ? { some: { recordingUrl: { not: null } } }
        : { none: { recordingUrl: { not: null } } };
  const bookings = await prisma.booking.findMany({
    where: {
      studentId,
      status: { in: courseAccessStatuses },
      round: {
        course: query.q ? { title: { contains: query.q, mode: 'insensitive' } } : undefined,
        sessions: recordingsWhere,
      },
    },
    include: {
      ...studentCourseInclude,
      round: {
        ...studentCourseInclude.round,
        include: {
          ...studentCourseInclude.round.include,
          sessions: {
            ...studentCourseInclude.round.include.sessions,
            where: { sessionDate: { gt: now } },
          },
        },
      },
    },
  });
  const matched = bookings
    .map((booking) => ({ booking, state: calculateRoundState(booking.round, today) }))
    .filter(({ state }) => query.roundState === undefined || state === query.roundState)
    .sort((left, right) => {
      const stateOrder = { IN_PROGRESS: 0, UPCOMING: 1, FINISHED: 2 } as const;
      const stateDifference = stateOrder[left.state] - stateOrder[right.state];
      if (stateDifference !== 0) return stateDifference;
      const leftRound = left.booking.round;
      const rightRound = right.booking.round;
      const dateDifference =
        left.state === 'FINISHED'
          ? rightRound.endDate.getTime() - leftRound.endDate.getTime()
          : leftRound.startDate.getTime() - rightRound.startDate.getTime();
      if (dateDifference !== 0) return dateDifference;
      return leftRound.id < rightRound.id ? -1 : leftRound.id > rightRound.id ? 1 : 0;
    });
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  return {
    courses: matched.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: matched.length,
  };
}

export async function findStudentRound(roundId: bigint, studentId: bigint): Promise<StudentRound> {
  const round = await prisma.courseRound.findUnique({
    where: { id: roundId },
    include: {
      ...studentRoundInclude,
      bookings: {
        where: { studentId, status: { in: courseAccessStatuses } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!round) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
  if (round.bookings.length === 0)
    throw new AppError(
      403,
      'Only enrolled students can access this course round.',
      'COURSE_ACCESS_FORBIDDEN',
    );
  return round;
}

export async function getStudentDashboard(studentId: bigint): Promise<StudentDashboard> {
  const now = new Date();
  const today = utcCalendarToday();
  const [user, bookings, courses, recordings] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { name: true } }),
    prisma.booking.findMany({
      where: { studentId, status: 'CONFIRMED' },
      include: {
        round: {
          include: {
            course: { select: { id: true, title: true } },
            sessions: {
              where: { sessionDate: { gt: now } },
              orderBy: { sessionDate: 'asc' },
              take: 1,
            },
          },
        },
      },
    }),
    prisma.course.findMany({
      where: {
        archived: false,
        rounds: { none: { bookings: { some: { studentId, status: 'CONFIRMED' } } } },
      },
      include: { images: { include: { file: true }, orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 4,
    }),
    prisma.session.findMany({
      where: {
        recordingUrl: { not: null },
        sessionDate: { lt: now },
        round: { bookings: { some: { studentId, status: 'CONFIRMED' } } },
      },
      include: { round: { include: { course: { select: { id: true, title: true } } } } },
      orderBy: { sessionDate: 'desc' },
      take: 3,
    }),
  ]);
  return {
    user,
    bookings: bookings.sort(sortBookingsByNextSession),
    courses,
    recordings,
    today,
  };
}
