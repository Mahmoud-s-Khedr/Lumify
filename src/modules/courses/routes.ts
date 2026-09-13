import type { FastifyInstance } from 'fastify';

import { requireAdmin } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { objectStorage } from '../../infrastructure/r2/storage.js';
import { publicCourse } from './presenter.js';
import {
  courseParamsSchema,
  createCourseSchema,
  listCoursesSchema,
  updateCourseSchema,
} from './schemas.js';
import {
  createCourse,
  deleteCourse,
  findCourse,
  findCourseRatings,
  listCourses,
  updateCourse,
} from './service.js';

export async function courseRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/courses',
    {
      schema: {
        tags: ['Courses'],
        summary: 'List courses in the catalogue',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string' },
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
            archived: { type: 'string', enum: ['true', 'false'] },
            minRating: { type: 'number', minimum: 1, maximum: 5 },
            sort: { type: 'string', enum: ['rating_desc', 'rating_asc'] },
          },
        },
      },
    },
    async (request) => {
      const query = parseRequest(listCoursesSchema, request.query);
      if (query.archived !== undefined) await requireAdmin(request);
      const result = await listCourses({
        ...query,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      });
      return {
        courses: result.courses.map((course) =>
          publicCourse(course, result.ratings.get(course.id)),
        ),
        pagination: { page: result.page, pageSize: result.pageSize, total: result.total },
      };
    },
  );

  app.get(
    '/courses/:id',
    { schema: { tags: ['Courses'], summary: 'Get course details' } },
    async (request) => {
      const params = parseRequest(courseParamsSchema, request.params);
      const course = await findCourse(BigInt(params.id));
      if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
      if (course.archived) await requireAdmin(request);
      const ratings = await findCourseRatings([course.id]);
      return { course: publicCourse(course, ratings.get(course.id)) };
    },
  );

  app.post(
    '/courses',
    { schema: { tags: ['Courses'], summary: 'Create a course' } },
    async (request, reply) => {
      const identity = await requireAdmin(request);
      const body = parseRequest(createCourseSchema, request.body);
      const course = await createCourse(body, BigInt(identity.sub));
      return reply.code(201).send({ course: publicCourse(course) });
    },
  );

  app.patch(
    '/courses/:id',
    { schema: { tags: ['Courses'], summary: 'Update or archive a course' } },
    async (request) => {
      const identity = await requireAdmin(request);
      const params = parseRequest(courseParamsSchema, request.params);
      const body = parseRequest(updateCourseSchema, request.body);
      const course = await updateCourse(BigInt(params.id), body, BigInt(identity.sub));
      return { course: publicCourse(course) };
    },
  );

  app.delete(
    '/courses/:id',
    {
      schema: {
        tags: ['Courses'],
        summary: 'Delete a course with no rounds or retained community history',
      },
    },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(courseParamsSchema, request.params);
      const orphanedFiles = await deleteCourse(BigInt(params.id));
      await Promise.all(orphanedFiles.map((file) => objectStorage().delete(file.storageKey)));
      return reply.code(204).send();
    },
  );
}
