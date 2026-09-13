import { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import {
  countConfirmedCourseBookings,
  countReviewsById,
  createReviewRecord,
  findAdminReviews,
  findCourseForReview,
  findPublishedReviews,
  findReviewByStudent,
  findReviewByStudentOrThrow,
  findReviewOrThrow,
  moderateReviewRecord,
  resubmitReviewRecord,
} from './repository.js';
import type { reviewInclude } from './repository.js';
import type {
  AdminReviewListInput,
  ModerationInput,
  PaginationInput,
  ReviewValuesInput,
} from './schemas.js';

export type ReviewWithDetails = Prisma.CourseReviewGetPayload<{ include: typeof reviewInclude }>;

export async function findReviewCourse(courseId: bigint): Promise<{ archived: boolean }> {
  const course = await findCourseForReview(courseId);
  if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
  return course;
}

async function requireEligibleStudent(courseId: bigint, studentId: bigint): Promise<void> {
  const confirmed = await countConfirmedCourseBookings(courseId, studentId);
  if (confirmed === 0)
    throw new AppError(
      403,
      'Only students confirmed in a course round can submit a review.',
      'REVIEW_NOT_ELIGIBLE',
    );
}

export async function listPublishedReviews(courseId: bigint, pagination: PaginationInput) {
  const [reviews, total] = await findPublishedReviews(
    courseId,
    (pagination.page - 1) * pagination.pageSize,
    pagination.pageSize,
  );
  return { reviews, total };
}

export async function findStudentReview(
  courseId: bigint,
  studentId: bigint,
): Promise<ReviewWithDetails> {
  await findReviewCourse(courseId);
  const review = await findReviewByStudent(courseId, studentId);
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
    return await createReviewRecord(courseId, studentId, input);
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
  const updated = await resubmitReviewRecord(courseId, studentId, input);
  if (updated.count === 0) throw new AppError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
  return findReviewByStudentOrThrow(courseId, studentId);
}

export async function listAdminReviews(query: AdminReviewListInput) {
  const [reviews, total] = await findAdminReviews({
    courseId: query.courseId ? BigInt(query.courseId) : undefined,
    status: query.status,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return { reviews, total };
}

export async function moderateReview(
  reviewId: bigint,
  decision: 'APPROVED' | 'REJECTED',
  input: ModerationInput,
): Promise<ReviewWithDetails> {
  const result = await moderateReviewRecord(reviewId, decision, input.adminNote ?? null);
  if (result.count === 0) {
    const exists = await countReviewsById(reviewId);
    if (exists === 0) throw new AppError(404, 'Review was not found.', 'REVIEW_NOT_FOUND');
    throw new AppError(409, 'Only pending reviews can be moderated.', 'INVALID_REVIEW_TRANSITION');
  }
  return findReviewOrThrow(reviewId);
}
