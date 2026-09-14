import type { FastifyInstance } from 'fastify';

import { requireUser } from '../../common/authorization/auth.js';
import { zodSchema } from '../../common/documentation/zod-schema.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { publicStudentCourse, publicStudentDashboard, publicStudentRound } from './presenter.js';
import { studentCoursesQuerySchema, studentRoundParamsSchema } from './schemas.js';
import { findStudentRound, getStudentDashboard, listStudentCourses } from './service.js';

const fileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'originalName', 'mimeType', 'sizeBytes', 'downloadUrl'],
  properties: {
    id: { type: 'string' },
    originalName: { type: 'string' },
    mimeType: { type: 'string', nullable: true },
    sizeBytes: { type: 'string', nullable: true },
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
    file: { allOf: [fileSchema], nullable: true },
    externalUrl: { type: 'string', nullable: true },
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
          image: { allOf: [fileSchema], nullable: true },
          roundId: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          state: { type: 'string', enum: ['UPCOMING', 'IN_PROGRESS', 'FINISHED'] },
          nextSession: { allOf: [nextSessionSchema], nullable: true },
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
        description: { type: 'string', nullable: true },
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
          recordingUrl: { type: 'string', nullable: true },
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
          nextSession: { allOf: [nextSessionSchema], nullable: true },
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

export async function studentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/student/courses',
    {
      schema: {
        tags: ['Student'],
        summary: "List the authenticated student's accessible course rounds",
        description:
          'Returns confirmed and cancellation-requested enrollments only. AVAILABLE recordings means at least one session has a recording URL, including future sessions.',
        querystring: zodSchema(studentCoursesQuerySchema),
        response: { 200: studentCoursesResponseSchema },
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can access student course pages.', 'FORBIDDEN');
      const query = parseRequest(studentCoursesQuerySchema, request.query);
      const result = await listStudentCourses(BigInt(identity.sub), {
        ...query,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      });
      return {
        courses: result.courses.map(({ booking, state }) => publicStudentCourse(booking, state)),
        pagination: { page: result.page, pageSize: result.pageSize, total: result.total },
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
        params: zodSchema(studentRoundParamsSchema),
        response: { 200: studentRoundResponseSchema },
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can access student course pages.', 'FORBIDDEN');
      const params = parseRequest(studentRoundParamsSchema, request.params);
      const round = await findStudentRound(BigInt(params.id), BigInt(identity.sub));
      return publicStudentRound(round);
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

      return publicStudentDashboard(await getStudentDashboard(BigInt(identity.sub)));
    },
  );
}
