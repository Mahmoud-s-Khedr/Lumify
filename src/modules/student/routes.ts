import type { FastifyInstance } from 'fastify';

import { requireUser } from '../../common/authorization/auth.js';
import { calculateRoundState } from '../../common/business/bookings.js';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { publicFile } from '../files/routes.js';

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
