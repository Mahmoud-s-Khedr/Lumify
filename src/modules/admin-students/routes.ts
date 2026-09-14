import type { FastifyInstance } from 'fastify';

import { requireAdmin } from '../../common/authorization/auth.js';
import { zodSchema } from '../../common/documentation/zod-schema.js';
import { parseRequest } from '../../common/validation/request.js';
import { publicBooking } from '../bookings/presenter.js';
import { publicAdminStudent } from './presenter.js';
import {
  courseParamsSchema,
  listRosterQuerySchema,
  listStudentsQuerySchema,
  roundParamsSchema,
  studentParamsSchema,
} from './schemas.js';
import {
  findAdminStudent,
  listAdminStudents,
  listCourseRoster,
  listRoundRoster,
} from './service.js';

export async function adminStudentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/admin/students',
    {
      schema: {
        tags: ['Admin students'],
        summary: 'List student accounts with enrollment summaries',
        querystring: zodSchema(listStudentsQuerySchema),
      },
    },
    async (request) => {
      await requireAdmin(request);
      const query = parseRequest(listStudentsQuerySchema, request.query);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const result = await listAdminStudents({ ...query, page, pageSize });
      return {
        students: result.students.map((student) =>
          publicAdminStudent(
            student,
            result.enrollmentCounts.get(student.id) ?? 0,
            result.confirmedEnrollmentCounts.get(student.id) ?? 0,
          ),
        ),
        pagination: { page, pageSize, total: result.total },
      };
    },
  );

  app.get(
    '/admin/students/:id',
    {
      schema: {
        tags: ['Admin students'],
        summary: 'Get a student profile and booking history',
        params: zodSchema(studentParamsSchema),
      },
    },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(studentParamsSchema, request.params);
      const result = await findAdminStudent(BigInt(params.id));
      return {
        student: publicAdminStudent(
          result.student,
          result.enrollmentCount,
          result.confirmedEnrollmentCount,
        ),
        bookings: result.bookings.map((booking) =>
          publicBooking(booking, result.confirmedCounts.get(booking.roundId) ?? 0),
        ),
      };
    },
  );

  app.get(
    '/admin/courses/:courseId/students',
    {
      schema: {
        tags: ['Admin students'],
        summary: 'List a course roster by enrollment',
        params: zodSchema(courseParamsSchema),
        querystring: zodSchema(listRosterQuerySchema),
      },
    },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(courseParamsSchema, request.params);
      const query = parseRequest(listRosterQuerySchema, request.query);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const result = await listCourseRoster(BigInt(params.courseId), { ...query, page, pageSize });
      return {
        bookings: result.bookings.map((booking) =>
          publicBooking(booking, result.confirmedCounts.get(booking.roundId) ?? 0),
        ),
        pagination: { page, pageSize, total: result.total },
      };
    },
  );

  app.get(
    '/admin/rounds/:roundId/students',
    {
      schema: {
        tags: ['Admin students'],
        summary: 'List a round roster by enrollment',
        params: zodSchema(roundParamsSchema),
        querystring: zodSchema(listRosterQuerySchema),
      },
    },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(roundParamsSchema, request.params);
      const query = parseRequest(listRosterQuerySchema, request.query);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const result = await listRoundRoster(BigInt(params.roundId), { ...query, page, pageSize });
      return {
        bookings: result.bookings.map((booking) =>
          publicBooking(booking, result.confirmedCounts.get(booking.roundId) ?? 0),
        ),
        pagination: { page, pageSize, total: result.total },
      };
    },
  );
}
