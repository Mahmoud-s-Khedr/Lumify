import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../../common/authorization/auth.js';
import { calculateRoundState, courseAccessStatuses } from '../../common/business/bookings.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { publicFile } from '../files/routes.js';

const idSchema = z.string().regex(/^\d+$/);
const studentRoundParamsSchema = z.object({ id: idSchema });
const studentCoursesQuerySchema = z.object({
  q: z.string().trim().min(1).max(255).optional(),
  roundState: z.enum(['UPCOMING', 'IN_PROGRESS', 'FINISHED']).optional(),
  recordings: z.enum(['AVAILABLE', 'NONE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const fileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'originalName', 'mimeType', 'sizeBytes', 'downloadUrl'],
  properties: {
    id: { type: 'string' },
    originalName: { type: 'string' },
    mimeType: { type: ['string', 'null'] },
    sizeBytes: { type: ['string', 'null'] },
    downloadUrl: { type: 'string' },
  },
} as const;

const nextSessionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'sessionDate'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    sessionDate: { type: 'string', format: 'date-time' },
  },
} as const;

const scheduleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'weekday', 'startTime'],
  properties: {
    id: { type: 'string' },
    weekday: {
      type: 'string',
      enum: ['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    },
    startTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
  },
} as const;

const materialSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'kind', 'file', 'externalUrl', 'createdAt'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    kind: { type: 'string', enum: ['FILE', 'LINK'] },
    file: { anyOf: [{ type: 'null' }, fileSchema] },
    externalUrl: { type: ['string', 'null'] },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

const studentCoursesResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['courses', 'pagination'],
  properties: {
    courses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'courseId',
          'title',
          'image',
          'roundId',
          'startDate',
          'endDate',
          'state',
          'nextSession',
          'recordingCount',
        ],
        properties: {
          courseId: { type: 'string' },
          title: { type: 'string' },
          image: { anyOf: [{ type: 'null' }, fileSchema] },
          roundId: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          state: { type: 'string', enum: ['UPCOMING', 'IN_PROGRESS', 'FINISHED'] },
          nextSession: { anyOf: [{ type: 'null' }, nextSessionSchema] },
          recordingCount: { type: 'integer', minimum: 0 },
        },
      },
    },
    pagination: {
      type: 'object',
      additionalProperties: false,
      required: ['page', 'pageSize', 'total'],
      properties: {
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        total: { type: 'integer', minimum: 0 },
      },
    },
  },
} as const;

const studentRoundResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['course', 'round', 'sessions', 'materials'],
  properties: {
    course: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'title', 'description'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: ['string', 'null'] },
      },
    },
    round: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'startDate', 'endDate', 'state', 'schedules'],
      properties: {
        id: { type: 'string' },
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
        state: { type: 'string', enum: ['UPCOMING', 'IN_PROGRESS', 'FINISHED'] },
        schedules: { type: 'array', items: scheduleSchema },
      },
    },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'sessionDate', 'recordingUrl'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          sessionDate: { type: 'string', format: 'date-time' },
          recordingUrl: { type: ['string', 'null'] },
        },
      },
    },
    materials: { type: 'array', items: materialSchema },
  },
} as const;

const dashboardResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['user', 'myRounds', 'recommendedCourses', 'recentRecordings'],
  properties: {
    user: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: { name: { type: 'string' } },
    },
    myRounds: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'roundId',
          'courseId',
          'courseTitle',
          'startDate',
          'endDate',
          'state',
          'nextSession',
        ],
        properties: {
          roundId: { type: 'string' },
          courseId: { type: 'string' },
          courseTitle: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          state: { type: 'string', enum: ['UPCOMING', 'IN_PROGRESS', 'FINISHED'] },
          nextSession: { anyOf: [{ type: 'null' }, nextSessionSchema] },
        },
      },
    },
    recommendedCourses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'price', 'images'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          price: { type: 'string' },
          images: { type: 'array', items: fileSchema },
        },
      },
    },
    recentRecordings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'sessionDate', 'recordingUrl', 'round'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          sessionDate: { type: 'string', format: 'date-time' },
          recordingUrl: { type: 'string' },
          round: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'course'],
            properties: {
              id: { type: 'string' },
              course: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'title'],
                properties: { id: { type: 'string' }, title: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
} as const;

type DashboardBooking = {
  round: {
    id: bigint;
    startDate: Date;
    endDate: Date;
    course: { id: bigint; title: string };
    sessions: Array<{ id: bigint; title: string; sessionDate: Date }>;
  };
};

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function calendarToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

function publicSchedule(schedule: { id: bigint; weekday: string; startTime: Date }) {
  return {
    id: schedule.id.toString(),
    weekday: schedule.weekday,
    startTime: schedule.startTime.toISOString().slice(11, 16),
  };
}

function publicMaterial(material: {
  id: bigint;
  title: string;
  externalUrl: string | null;
  createdAt: Date;
  file: {
    id: bigint;
    originalName: string;
    mimeType: string | null;
    sizeBytes: bigint | null;
  } | null;
}) {
  return {
    id: material.id.toString(),
    title: material.title,
    kind: material.file ? ('FILE' as const) : ('LINK' as const),
    file: material.file ? publicFile(material.file) : null,
    externalUrl: material.externalUrl,
    createdAt: material.createdAt.toISOString(),
  };
}

function studentOnly(identity: { role: string }): void {
  if (identity.role !== 'STUDENT')
    throw new AppError(403, 'Only students can access student course pages.', 'FORBIDDEN');
}

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

export async function studentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/student/courses',
    {
      schema: {
        tags: ['Student'],
        summary: "List the authenticated student's accessible course rounds",
        description:
          'Returns confirmed and cancellation-requested enrollments only. AVAILABLE recordings means at least one session has a recording URL, including future sessions.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string' },
            roundState: { type: 'string', enum: ['UPCOMING', 'IN_PROGRESS', 'FINISHED'] },
            recordings: { type: 'string', enum: ['AVAILABLE', 'NONE'] },
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
        response: { 200: studentCoursesResponseSchema },
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      studentOnly(identity);
      const query = parseRequest(studentCoursesQuerySchema, request.query);
      const studentId = BigInt(identity.sub);
      const now = new Date();
      const today = calendarToday();
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
          round: {
            include: {
              course: {
                select: {
                  id: true,
                  title: true,
                  images: {
                    include: { file: true },
                    orderBy: { sortOrder: 'asc' },
                    take: 1,
                  },
                },
              },
              sessions: {
                where: { sessionDate: { gt: now } },
                select: { id: true, title: true, sessionDate: true },
                orderBy: { sessionDate: 'asc' },
                take: 1,
              },
              _count: { select: { sessions: { where: { recordingUrl: { not: null } } } } },
            },
          },
        },
      });

      const matched = bookings
        .map((booking) => ({
          booking,
          state: calculateRoundState(booking.round, today),
        }))
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
        courses: matched.slice(offset, offset + pageSize).map(({ booking, state }) => {
          const nextSession = booking.round.sessions[0] ?? null;
          const image = booking.round.course.images[0]?.file ?? null;
          return {
            courseId: booking.round.course.id.toString(),
            title: booking.round.course.title,
            image: image ? publicFile(image) : null,
            roundId: booking.round.id.toString(),
            startDate: dateOnly(booking.round.startDate),
            endDate: dateOnly(booking.round.endDate),
            state,
            nextSession: nextSession
              ? {
                  id: nextSession.id.toString(),
                  title: nextSession.title,
                  sessionDate: nextSession.sessionDate.toISOString(),
                }
              : null,
            recordingCount: booking.round._count.sessions,
          };
        }),
        pagination: { page, pageSize, total: matched.length },
      };
    },
  );

  app.get(
    '/student/rounds/:id',
    {
      schema: {
        tags: ['Student'],
        summary: 'Get an accessible round for the student course pages',
        description:
          'Returns course, round, session, and material data for confirmed and cancellation-requested enrollments. Join and WhatsApp URLs are intentionally excluded.',
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'string', pattern: '^\\d+$' } },
        },
        response: { 200: studentRoundResponseSchema },
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      studentOnly(identity);
      const params = parseRequest(studentRoundParamsSchema, request.params);
      const roundId = BigInt(params.id);
      const round = await prisma.courseRound.findUnique({
        where: { id: roundId },
        include: {
          course: { select: { id: true, title: true, description: true } },
          schedules: { orderBy: { weekday: 'asc' } },
          sessions: {
            select: { id: true, title: true, sessionDate: true, recordingUrl: true },
            orderBy: { sessionDate: 'asc' },
          },
          materials: { include: { file: true }, orderBy: { createdAt: 'asc' } },
          bookings: {
            where: {
              studentId: BigInt(identity.sub),
              status: { in: courseAccessStatuses },
            },
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

      return {
        course: {
          id: round.course.id.toString(),
          title: round.course.title,
          description: round.course.description,
        },
        round: {
          id: round.id.toString(),
          startDate: dateOnly(round.startDate),
          endDate: dateOnly(round.endDate),
          state: calculateRoundState(round, calendarToday()),
          schedules: round.schedules.map(publicSchedule),
        },
        sessions: round.sessions.map((session) => ({
          id: session.id.toString(),
          title: session.title,
          sessionDate: session.sessionDate.toISOString(),
          recordingUrl: session.recordingUrl,
        })),
        materials: round.materials.map(publicMaterial),
      };
    },
  );

  app.get(
    '/student/dashboard',
    {
      schema: {
        tags: ['Student'],
        summary: 'Get the authenticated student dashboard',
        description:
          'Returns confirmed enrollments, active course recommendations, and recent recordings without booking, payment, or live-join details.',
        response: { 200: dashboardResponseSchema },
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can access the student dashboard.', 'FORBIDDEN');

      const studentId = BigInt(identity.sub);
      const now = new Date();
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
            rounds: {
              none: { bookings: { some: { studentId, status: 'CONFIRMED' } } },
            },
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
        myRounds: bookings.sort(sortBookingsByNextSession).map((booking) => {
          const nextSession = booking.round.sessions[0] ?? null;
          return {
            roundId: booking.round.id.toString(),
            courseId: booking.round.course.id.toString(),
            courseTitle: booking.round.course.title,
            startDate: dateOnly(booking.round.startDate),
            endDate: dateOnly(booking.round.endDate),
            state: calculateRoundState(
              booking.round,
              new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
            ),
            nextSession: nextSession
              ? {
                  id: nextSession.id.toString(),
                  title: nextSession.title,
                  sessionDate: nextSession.sessionDate.toISOString(),
                }
              : null,
          };
        }),
        recommendedCourses: courses.map((course) => ({
          id: course.id.toString(),
          title: course.title,
          price: course.price.toFixed(2),
          images: course.images.map((image) => publicFile(image.file)),
        })),
        recentRecordings: recordings.map((recording) => ({
          id: recording.id.toString(),
          title: recording.title,
          sessionDate: recording.sessionDate.toISOString(),
          recordingUrl: recording.recordingUrl!,
          round: {
            id: recording.round.id.toString(),
            course: {
              id: recording.round.course.id.toString(),
              title: recording.round.course.title,
            },
          },
        })),
      };
    },
  );
}
