import type { FastifyInstance } from 'fastify';

import { requireAdmin, requireUser } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { adminReview, ownerReview, publicReview } from './presenter.js';
import {
  adminListSchema,
  courseParamsSchema,
  moderationSchema,
  paginationSchema,
  reviewParamsSchema,
  reviewValuesSchema,
} from './schemas.js';
import {
  createReview,
  findReviewCourse,
  findStudentReview,
  listAdminReviews,
  listPublishedReviews,
  moderateReview,
  resubmitReview,
} from './service.js';

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/courses/:courseId/reviews',
    {
      schema: {
        tags: ['Course reviews'],
        summary: 'List approved course reviews',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request) => {
      const params = parseRequest(courseParamsSchema, request.params);
      const query = parseRequest(paginationSchema, request.query);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const courseId = BigInt(params.courseId);
      const course = await findReviewCourse(courseId);
      if (course.archived) await requireAdmin(request);
      const { reviews, total } = await listPublishedReviews(courseId, { page, pageSize });
      return {
        reviews: reviews.map(publicReview),
        pagination: { page, pageSize, total },
      };
    },
  );

  app.get(
    '/courses/:courseId/reviews/me',
    { schema: { tags: ['Course reviews'], summary: "Get the current student's course review" } },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students have course reviews.', 'FORBIDDEN');
      const params = parseRequest(courseParamsSchema, request.params);
      const review = await findStudentReview(BigInt(params.courseId), BigInt(identity.sub));
      return { review: ownerReview(review) };
    },
  );

  app.post(
    '/courses/:courseId/reviews',
    { schema: { tags: ['Course reviews'], summary: 'Submit a course review for moderation' } },
    async (request, reply) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can submit course reviews.', 'FORBIDDEN');
      const params = parseRequest(courseParamsSchema, request.params);
      const body = parseRequest(reviewValuesSchema, request.body);
      const review = await createReview(BigInt(params.courseId), BigInt(identity.sub), body);
      return reply.code(201).send({ review: ownerReview(review) });
    },
  );

  app.patch(
    '/courses/:courseId/reviews/me',
    { schema: { tags: ['Course reviews'], summary: 'Revise and resubmit the current review' } },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can revise course reviews.', 'FORBIDDEN');
      const params = parseRequest(courseParamsSchema, request.params);
      const body = parseRequest(reviewValuesSchema, request.body);
      const review = await resubmitReview(BigInt(params.courseId), BigInt(identity.sub), body);
      return { review: ownerReview(review) };
    },
  );

  app.get(
    '/admin/reviews',
    { schema: { tags: ['Course reviews'], summary: 'List reviews for moderation' } },
    async (request) => {
      await requireAdmin(request);
      const query = parseRequest(adminListSchema, request.query);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const { reviews, total } = await listAdminReviews({ ...query, page, pageSize });
      return {
        reviews: reviews.map(adminReview),
        pagination: { page, pageSize, total },
      };
    },
  );

  for (const [decision, status] of [
    ['approve', 'APPROVED'],
    ['reject', 'REJECTED'],
  ] as const) {
    app.post(
      `/admin/reviews/:id/${decision}`,
      {
        schema: {
          tags: ['Course reviews'],
          summary: `${decision === 'approve' ? 'Approve' : 'Reject'} a pending course review`,
        },
      },
      async (request) => {
        await requireAdmin(request);
        const params = parseRequest(reviewParamsSchema, request.params);
        const body = parseRequest(moderationSchema, request.body ?? {});
        const review = await moderateReview(BigInt(params.id), status, body);
        return { review: adminReview(review) };
      },
    );
  }
}
