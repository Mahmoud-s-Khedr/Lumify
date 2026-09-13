import { publicFile } from '../files/presenter.js';
import type { CourseRating, CourseWithImages } from './service.js';

export function publicCourse(
  course: CourseWithImages,
  rating: CourseRating = { averageRating: null, reviewCount: 0 },
) {
  return {
    id: course.id.toString(),
    title: course.title,
    description: course.description,
    price: course.price.toString(),
    outcomes: course.outcomes,
    skills: course.skills,
    prerequisiteSkills: course.prerequisiteSkills,
    prerequisiteCourseId: course.prerequisiteCourseId?.toString() ?? null,
    demoVideoUrl: course.demoVideoUrl,
    archived: course.archived,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
    averageRating: rating.averageRating,
    reviewCount: rating.reviewCount,
    images: course.images
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
      .map((image) => publicFile(image.file)),
  };
}
