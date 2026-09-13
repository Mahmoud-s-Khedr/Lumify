import { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type {
  AdminReviewListInput,
  ModerationInput,
  PaginationInput,
  ReviewValuesInput,
} from './schemas.js';

export const reviewInclude = {
  student: { select: { id: true, name: true, email: true } },
  course: { select: { id: true, title: true, archived: true } },
} satisfies Prisma.CourseReviewInclude;

export type ReviewWithDetails = Prisma.CourseReviewGetPayload<{ include: typeof reviewInclude }>;

export async function findReviewCourse(courseId: bigint): Promise<{ archived: boolean }> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { archived: true },
  });
  if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
  return course;
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

export async function listPublishedReviews(courseId: bigint, pagination: PaginationInput) {
  const where = { courseId, status: 'APPROVED' as const };
  const [reviews, total] = await Promise.all([
    prisma.courseReview.findMany({
      where,
      include: reviewInclude,
      orderBy: { createdAt: 'desc' },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
    prisma.courseReview.count({ where }),
  ]);
  return { reviews, total };
}

export async function findStudentReview(
  courseId: bigint,
  studentId: bigint,
): Promise<ReviewWithDetails> {
  await findReviewCourse(courseId);
  const review = await prisma.courseReview.findUnique({
    where: { courseId_studentId: { courseId, studentId } },
    include: reviewInclude,
  });
  if (!review) throw new AppError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
  return review;
}

export async function createReview(
  courseId: bigint,
  studentId: bigint,
  input: ReviewValuesInput,
): Promise<ReviewWithDetails> {
  await findReviewCourse(courseId);
  await requireEligibleStudent(courseId, studentId);
  try {
    return await prisma.courseReview.create({
      data: { courseId, studentId, ...input },
      include: reviewInclude,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new AppError(409, 'You have already reviewed this course.', 'DUPLICATE_REVIEW');
    throw error;
  }
}

export async function resubmitReview(
  courseId: bigint,
  studentId: bigint,
  input: ReviewValuesInput,
): Promise<ReviewWithDetails> {
  await findReviewCourse(courseId);
  await requireEligibleStudent(courseId, studentId);
  const updated = await prisma.courseReview.updateMany({
    where: { courseId, studentId },
    data: { ...input, status: 'PENDING', adminNote: null, reviewedAt: null },
  });
  if (updated.count === 0) throw new AppError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
  return prisma.courseReview.findUniqueOrThrow({
    where: { courseId_studentId: { courseId, studentId } },
    include: reviewInclude,
  });
}

export async function listAdminReviews(query: AdminReviewListInput) {
  const where = {
    courseId: query.courseId ? BigInt(query.courseId) : undefined,
    status: query.status,
  };
  const [reviews, total] = await Promise.all([
    prisma.courseReview.findMany({
      where,
      include: reviewInclude,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.courseReview.count({ where }),
  ]);
  return { reviews, total };
}

export async function moderateReview(
  reviewId: bigint,
  decision: 'APPROVED' | 'REJECTED',
  input: ModerationInput,
): Promise<ReviewWithDetails> {
  const result = await prisma.courseReview.updateMany({
    where: { id: reviewId, status: 'PENDING' },
    data: { status: decision, adminNote: input.adminNote ?? null, reviewedAt: new Date() },
  });
  if (result.count === 0) {
    const exists = await prisma.courseReview.count({ where: { id: reviewId } });
    if (exists === 0) throw new AppError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
    throw new AppError(409, 'Only pending reviews can be moderated.', 'INVALID_REVIEW_TRANSITION');
  }
  return prisma.courseReview.findUniqueOrThrow({ where: { id: reviewId }, include: reviewInclude });
}
