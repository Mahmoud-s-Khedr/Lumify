import { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireUser } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { prisma } from '../../infrastructure/database/prisma.js';

const idSchema = z.string().regex(/^\d+$/);
const courseParamsSchema = z.object({ courseId: idSchema });
const reviewParamsSchema = z.object({ id: idSchema });
const reviewValuesSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(5_000),
});
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const adminListSchema = paginationSchema.extend({
  courseId: idSchema.optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});
const moderationSchema = z.object({
  adminNote: z.string().trim().max(2_000).nullable().optional(),
});

const reviewInclude = {
  student: { select: { id: true, name: true, email: true } },
  course: { select: { id: true, title: true, archived: true } },
} satisfies Prisma.CourseReviewInclude;

type ReviewWithDetails = Prisma.CourseReviewGetPayload<{ include: typeof reviewInclude }>;

function publicReview(review: ReviewWithDetails) {
  return {
    id: review.id.toString(),
    rating: review.rating,
    comment: review.comment,
    student: { id: review.student.id.toString(), name: review.student.name },
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

function ownerReview(review: ReviewWithDetails) {
  return {
    ...publicReview(review),
    status: review.status,
    adminNote: review.adminNote,
    reviewedAt: review.reviewedAt?.toISOString() ?? null,
  };
}

function adminReview(review: ReviewWithDetails) {
  return {
    ...ownerReview(review),
    student: {
      id: review.student.id.toString(),
      name: review.student.name,
      email: review.student.email,
    },
    course: { id: review.course.id.toString(), title: review.course.title },
  };
}

async function requireCourse(courseId: bigint, request?: FastifyRequest): Promise<void> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { archived: true },
  });
  if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
  if (course.archived && request) await requireAdmin(request);
}

async function requireEligibleStudent(courseId: bigint, studentId: bigint): Promise<void> {
  const confirmed = await prisma.booking.count({
    where: { studentId, status: 'CONFIRMED', round: { courseId } },
  });
  if (confirmed === 0)
    throw new AppError(
      403,
      'Only students confirmed in a course round can submit a review.',
      'REVIEW_NOT_ELIGIBLE',
    );
}

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
      await requireCourse(courseId, request);
      const where = { courseId, status: 'APPROVED' as const };
      const [reviews, total] = await Promise.all([
        prisma.courseReview.findMany({
          where,
          include: reviewInclude,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.courseReview.count({ where }),
      ]);
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
      const courseId = BigInt(params.courseId);
      await requireCourse(courseId);
      const review = await prisma.courseReview.findUnique({
        where: { courseId_studentId: { courseId, studentId: BigInt(identity.sub) } },
        include: reviewInclude,
      });
      if (!review) throw new AppError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
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
      const courseId = BigInt(params.courseId);
      const studentId = BigInt(identity.sub);
      await requireCourse(courseId);
      await requireEligibleStudent(courseId, studentId);
      try {
        const review = await prisma.courseReview.create({
          data: { courseId, studentId, ...body },
          include: reviewInclude,
        });
        return reply.code(201).send({ review: ownerReview(review) });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new AppError(409, 'You have already reviewed this course.', 'DUPLICATE_REVIEW');
        throw error;
      }
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
      const courseId = BigInt(params.courseId);
      const studentId = BigInt(identity.sub);
      await requireCourse(courseId);
      await requireEligibleStudent(courseId, studentId);
      const updated = await prisma.courseReview.updateMany({
        where: { courseId, studentId },
        data: { ...body, status: 'PENDING', adminNote: null, reviewedAt: null },
      });
      if (updated.count === 0) throw new AppError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
      const review = await prisma.courseReview.findUniqueOrThrow({
        where: { courseId_studentId: { courseId, studentId } },
        include: reviewInclude,
      });
      return { review: ownerReview(review) };
    },
  );

  app.get(
    '/admin/reviews',
    {
      schema: {
        tags: ['Course reviews'],
        summary: 'List reviews for moderation',
      },
    },
    async (request) => {
      await requireAdmin(request);
      const query = parseRequest(adminListSchema, request.query);
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const where = {
        courseId: query.courseId ? BigInt(query.courseId) : undefined,
        status: query.status,
      };
      const [reviews, total] = await Promise.all([
        prisma.courseReview.findMany({
          where,
          include: reviewInclude,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.courseReview.count({ where }),
      ]);
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
        const result = await prisma.courseReview.updateMany({
          where: { id: BigInt(params.id), status: 'PENDING' },
          data: { status, adminNote: body.adminNote ?? null, reviewedAt: new Date() },
        });
        if (result.count === 0) {
          const exists = await prisma.courseReview.count({ where: { id: BigInt(params.id) } });
          if (exists === 0) throw new AppError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
          throw new AppError(
            409,
            'Only pending reviews can be moderated.',
            'INVALID_REVIEW_TRANSITION',
          );
        }
        const review = await prisma.courseReview.findUniqueOrThrow({
          where: { id: BigInt(params.id) },
          include: reviewInclude,
        });
        return { review: adminReview(review) };
      },
    );
  }
}
