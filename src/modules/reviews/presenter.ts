import type { ReviewWithDetails } from './service.js';

export function publicReview(review: ReviewWithDetails) {
  return {
    id: review.id.toString(),
    rating: review.rating,
    comment: review.comment,
    student: { id: review.student.id.toString(), name: review.student.name },
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

export function ownerReview(review: ReviewWithDetails) {
  return {
    ...publicReview(review),
    status: review.status,
    adminNote: review.adminNote,
    reviewedAt: review.reviewedAt?.toISOString() ?? null,
  };
}

export function adminReview(review: ReviewWithDetails) {
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
