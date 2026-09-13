import { type File, Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type { CreateCourseInput, ListCoursesQuery, UpdateCourseInput } from './schemas.js';

export const courseInclude = {
  images: { include: { file: true }, orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.CourseInclude;

export type CourseWithImages = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;
export type CourseRating = { averageRating: number | null; reviewCount: number };

function jsonList(
  value: string[] | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : value;
}

async function courseRatings(courseIds: bigint[]): Promise<Map<bigint, CourseRating>> {
  if (courseIds.length === 0) return new Map();
  const ratings = await prisma.courseReview.groupBy({
    by: ['courseId'],
    where: { courseId: { in: [...new Set(courseIds)] }, status: 'APPROVED' },
    _count: { _all: true },
    _avg: { rating: true },
  });
  return new Map(
    ratings.map((rating) => [
      rating.courseId,
      { averageRating: rating._avg.rating ?? null, reviewCount: rating._count._all },
    ]),
  );
}

async function ensureValidPrerequisite(
  courseId: bigint | undefined,
  prerequisiteId: bigint | null | undefined,
): Promise<void> {
  if (prerequisiteId === undefined || prerequisiteId === null) return;
  if (courseId === prerequisiteId)
    throw new AppError(400, 'A course cannot be its own prerequisite.', 'INVALID_PREREQUISITE');

  const seen = new Set<bigint>();
  let currentId: bigint | null = prerequisiteId;
  while (currentId !== null) {
    if (seen.has(currentId))
      throw new AppError(
        400,
        'Course prerequisites cannot contain a cycle.',
        'INVALID_PREREQUISITE',
      );
    seen.add(currentId);
    if (currentId === courseId)
      throw new AppError(
        400,
        'Course prerequisites cannot contain a cycle.',
        'INVALID_PREREQUISITE',
      );
    const current: { prerequisiteCourseId: bigint | null } | null = await prisma.course.findUnique({
      where: { id: currentId },
      select: { prerequisiteCourseId: true },
    });
    if (!current)
      throw new AppError(400, 'The prerequisite course does not exist.', 'INVALID_PREREQUISITE');
    currentId = current.prerequisiteCourseId;
  }
}

async function validateImageFiles(
  imageFileIds: string[] | undefined,
  userId: bigint,
): Promise<void> {
  if (imageFileIds === undefined) return;
  if (new Set(imageFileIds).size !== imageFileIds.length)
    throw new AppError(400, 'Course images cannot contain duplicates.', 'DUPLICATE_COURSE_IMAGE');
  if (imageFileIds.length === 0) return;
  const ids = imageFileIds.map(BigInt);
  const files = await prisma.file.findMany({ where: { id: { in: ids }, uploadedById: userId } });
  if (files.length !== ids.length)
    throw new AppError(
      400,
      'Each image must be an uploaded file owned by the administrator.',
      'INVALID_COURSE_IMAGE',
    );
  if (
    files.some(
      (file) =>
        !file.mimeType || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType),
    )
  )
    throw new AppError(
      400,
      'Each course image must be a supported image file.',
      'INVALID_COURSE_IMAGE',
    );
}

function imageCreateData(imageFileIds: string[]) {
  return imageFileIds.map((fileId, index) => ({ fileId: BigInt(fileId), sortOrder: index }));
}

function matchesSearch(course: CourseWithImages, query: string): boolean {
  const needle = query.toLocaleLowerCase();
  const text = [
    course.title,
    course.description ?? '',
    ...((course.skills as string[] | null) ?? []),
  ].join(' ');
  return text.toLocaleLowerCase().includes(needle);
}

export async function listCourses(query: ListCoursesQuery) {
  const wantsArchived = query.archived === 'true';
  const courses = await prisma.course.findMany({
    where: { archived: wantsArchived },
    include: courseInclude,
    orderBy: { createdAt: 'desc' },
  });
  let matched = query.q
    ? courses.filter((course) => matchesSearch(course, query.q ?? ''))
    : courses;
  const ratings = await courseRatings(matched.map((course) => course.id));
  if (query.minRating !== undefined)
    matched = matched.filter(
      (course) => (ratings.get(course.id)?.averageRating ?? 0) >= query.minRating!,
    );
  if (query.sort) {
    const direction = query.sort === 'rating_desc' ? -1 : 1;
    matched.sort((left, right) => {
      const leftRating = ratings.get(left.id)?.averageRating ?? null;
      const rightRating = ratings.get(right.id)?.averageRating ?? null;
      if (leftRating === null) return rightRating === null ? 0 : 1;
      if (rightRating === null) return -1;
      return (leftRating - rightRating) * direction;
    });
  }
  const page = query.page;
  const pageSize = query.pageSize;
  const offset = (page - 1) * pageSize;
  return {
    courses: matched.slice(offset, offset + pageSize),
    ratings,
    page,
    pageSize,
    total: matched.length,
  };
}

export async function findCourse(id: bigint): Promise<CourseWithImages | null> {
  return prisma.course.findUnique({ where: { id }, include: courseInclude });
}

export async function findCourseRatings(courseIds: bigint[]): Promise<Map<bigint, CourseRating>> {
  return courseRatings(courseIds);
}

export async function createCourse(
  input: CreateCourseInput,
  uploaderId: bigint,
): Promise<CourseWithImages> {
  const prerequisiteCourseId =
    input.prerequisiteCourseId === undefined
      ? undefined
      : input.prerequisiteCourseId === null
        ? null
        : BigInt(input.prerequisiteCourseId);
  await ensureValidPrerequisite(undefined, prerequisiteCourseId);
  await validateImageFiles(input.imageFileIds, uploaderId);
  return prisma.course.create({
    data: {
      title: input.title,
      description: input.description,
      price: input.price,
      outcomes: jsonList(input.outcomes),
      skills: jsonList(input.skills),
      prerequisiteSkills: jsonList(input.prerequisiteSkills),
      prerequisiteCourseId: prerequisiteCourseId ?? undefined,
      demoVideoUrl: input.demoVideoUrl,
      images: input.imageFileIds ? { create: imageCreateData(input.imageFileIds) } : undefined,
    },
    include: courseInclude,
  });
}

export async function updateCourse(
  courseId: bigint,
  input: UpdateCourseInput,
  uploaderId: bigint,
): Promise<CourseWithImages> {
  const exists = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!exists) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
  const prerequisiteCourseId =
    input.prerequisiteCourseId === undefined
      ? undefined
      : input.prerequisiteCourseId === null
        ? null
        : BigInt(input.prerequisiteCourseId);
  await ensureValidPrerequisite(courseId, prerequisiteCourseId);
  await validateImageFiles(input.imageFileIds, uploaderId);
  return prisma.$transaction(async (tx) => {
    if (input.imageFileIds !== undefined) await tx.courseImage.deleteMany({ where: { courseId } });
    return tx.course.update({
      where: { id: courseId },
      data: {
        title: input.title,
        description: input.description,
        price: input.price,
        outcomes: jsonList(input.outcomes),
        skills: jsonList(input.skills),
        prerequisiteSkills: jsonList(input.prerequisiteSkills),
        prerequisiteCourseId,
        demoVideoUrl: input.demoVideoUrl,
        archived: input.archived,
        images: input.imageFileIds ? { create: imageCreateData(input.imageFileIds) } : undefined,
      },
      include: courseInclude,
    });
  });
}

export async function deleteCourse(courseId: bigint): Promise<File[]> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      images: { include: { file: true } },
      _count: { select: { rounds: true, communityMessages: true } },
    },
  });
  if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
  if (course._count.rounds > 0)
    throw new AppError(409, 'Courses with rounds must be archived instead.', 'COURSE_HAS_ROUNDS');
  if (course._count.communityMessages > 0)
    throw new AppError(
      409,
      'Courses with community history must be archived instead.',
      'COURSE_HAS_COMMUNITY_HISTORY',
    );
  return prisma.$transaction(async (tx) => {
    await tx.courseImage.deleteMany({ where: { courseId } });
    await tx.course.delete({ where: { id: courseId } });
    const deletable: File[] = [];
    for (const image of course.images) {
      const references = await tx.file.findUnique({
        where: { id: image.fileId },
        include: { _count: { select: { courseImages: true, materials: true, receipts: true } } },
      });
      if (
        references &&
        references._count.courseImages +
          references._count.materials +
          references._count.receipts ===
          0
      ) {
        deletable.push(image.file);
        await tx.file.delete({ where: { id: image.fileId } });
      }
    }
    return deletable;
  });
}
