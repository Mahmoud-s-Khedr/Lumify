import type { Prisma } from '@prisma/client';

import { prisma } from '../../infrastructure/database/prisma.js';

export const reviewInclude = {
  student: { select: { id: true, name: true, email: true } },
  course: { select: { id: true, title: true, archived: true } },
} satisfies Prisma.CourseReviewInclude;

export function findCourseForReview(courseId: bigint) {
  return prisma.course.findUnique({ where: { id: courseId }, select: { archived: true } });
}

export function countConfirmedCourseBookings(courseId: bigint, studentId: bigint) {
  return prisma.booking.count({ where: { studentId, status: 'CONFIRMED', round: { courseId } } });
}

export function findPublishedReviews(courseId: bigint, skip: number, take: number) {
  const where = { courseId, status: 'APPROVED' as const };
  return Promise.all([
    prisma.courseReview.findMany({
      where,
      include: reviewInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.courseReview.count({ where }),
  ]);
}

export function findReviewByStudent(courseId: bigint, studentId: bigint) {
  return prisma.courseReview.findUnique({
    where: { courseId_studentId: { courseId, studentId } },
    include: reviewInclude,
  });
}

export function createReviewRecord(
  courseId: bigint,
  studentId: bigint,
  data: { rating: number; comment: string },
) {
  return prisma.courseReview.create({
    data: { courseId, studentId, ...data },
    include: reviewInclude,
  });
}

export function resubmitReviewRecord(
  courseId: bigint,
  studentId: bigint,
  data: { rating: number; comment: string },
) {
  return prisma.courseReview.updateMany({
    where: { courseId, studentId },
    data: { ...data, status: 'PENDING', adminNote: null, reviewedAt: null },
  });
}

export function findReviewByStudentOrThrow(courseId: bigint, studentId: bigint) {
  return prisma.courseReview.findUniqueOrThrow({
    where: { courseId_studentId: { courseId, studentId } },
    include: reviewInclude,
  });
}

export function findAdminReviews(input: {
  courseId?: bigint;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  skip: number;
  take: number;
}) {
  const where = { courseId: input.courseId, status: input.status };
  return Promise.all([
    prisma.courseReview.findMany({
      where,
      include: reviewInclude,
      orderBy: { createdAt: 'desc' },
      skip: input.skip,
      take: input.take,
    }),
    prisma.courseReview.count({ where }),
  ]);
}

export function moderateReviewRecord(
  reviewId: bigint,
  decision: 'APPROVED' | 'REJECTED',
  adminNote: string | null,
) {
  return prisma.courseReview.updateMany({
    where: { id: reviewId, status: 'PENDING' },
    data: { status: decision, adminNote, reviewedAt: new Date() },
  });
}

export function countReviewsById(reviewId: bigint) {
  return prisma.courseReview.count({ where: { id: reviewId } });
}

export function findReviewOrThrow(reviewId: bigint) {
  return prisma.courseReview.findUniqueOrThrow({ where: { id: reviewId }, include: reviewInclude });
}
