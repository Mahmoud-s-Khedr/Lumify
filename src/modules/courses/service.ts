import { type File, Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { courseMediaMimeTypes } from '../files/schemas.js';
import type { CreateCourseInput, ListCoursesQuery, UpdateCourseInput } from './schemas.js';

const courseMediaMimeTypeSet = new Set<string>(courseMediaMimeTypes);

export const courseInclude = {
  images: { include: { file: true }, orderBy: { sortOrder: 'asc' as const } },
  prerequisites: {
    select: { prerequisiteCourseId: true },
    orderBy: { prerequisiteCourseId: 'asc' as const },
  },
} satisfies Prisma.CourseInclude;

export type CourseWithImages = Prisma.CourseGetPayload<{ include: typeof courseInclude }>;
export type CourseRating = { averageRating: number | null; reviewCount: number };
type CourseQueryClient = Pick<Prisma.TransactionClient, 'course'>;

async function withSerializableTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const serializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
      if (!serializationFailure || attempt === 2) throw error;
    }
  }
}

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

async function ensureValidPrerequisites(
  database: CourseQueryClient,
  courseId: bigint | undefined,
  prerequisiteIds: bigint[] | undefined,
): Promise<void> {
  if (prerequisiteIds === undefined) return;
  if (new Set(prerequisiteIds).size !== prerequisiteIds.length)
    throw new AppError(
      400,
      'Course prerequisites cannot contain duplicates.',
      'DUPLICATE_PREREQUISITE',
    );
  if (courseId !== undefined && prerequisiteIds.includes(courseId))
    throw new AppError(400, 'A course cannot be its own prerequisite.', 'INVALID_PREREQUISITE');

  const courses = await database.course.findMany({
    select: { id: true, prerequisites: { select: { prerequisiteCourseId: true } } },
  });
  const courseIds = new Set(courses.map((course) => course.id));
  if (prerequisiteIds.some((id) => !courseIds.has(id)))
    throw new AppError(400, 'The prerequisite course does not exist.', 'INVALID_PREREQUISITE');
  if (courseId === undefined) return;

  const graph = new Map(
    courses.map((course) => [
      course.id,
      course.id === courseId
        ? prerequisiteIds
        : course.prerequisites.map((prerequisite) => prerequisite.prerequisiteCourseId),
    ]),
  );
  const reachesCourse = (id: bigint, seen = new Set<bigint>()): boolean => {
    if (id === courseId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (graph.get(id) ?? []).some((prerequisiteId) => reachesCourse(prerequisiteId, seen));
  };
  if (prerequisiteIds.some((id) => reachesCourse(id)))
    throw new AppError(400, 'Course prerequisites cannot contain a cycle.', 'INVALID_PREREQUISITE');
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
  if (files.some((file) => !file.mimeType || !courseMediaMimeTypeSet.has(file.mimeType)))
    throw new AppError(
      400,
      'Each course image must be a supported image or video file.',
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
  const prerequisiteCourseIds = input.prerequisiteCourseIds?.map(BigInt);
  await validateImageFiles(input.imageFileIds, uploaderId);
  return withSerializableTransaction(async (tx) => {
    await ensureValidPrerequisites(tx, undefined, prerequisiteCourseIds);
    return tx.course.create({
      data: {
        title: input.title,
        description: input.description,
        price: input.price,
        outcomes: jsonList(input.outcomes),
        skills: jsonList(input.skills),
        prerequisiteSkills: jsonList(input.prerequisiteSkills),
        prerequisites: prerequisiteCourseIds
          ? {
              create: prerequisiteCourseIds.map((prerequisiteCourseId) => ({
                prerequisiteCourseId,
              })),
            }
          : undefined,
        demoVideoUrl: input.demoVideoUrl,
        images: input.imageFileIds ? { create: imageCreateData(input.imageFileIds) } : undefined,
      },
      include: courseInclude,
    });
  });
}

export async function updateCourse(
  courseId: bigint,
  input: UpdateCourseInput,
  uploaderId: bigint,
): Promise<CourseWithImages> {
  const prerequisiteCourseIds = input.prerequisiteCourseIds?.map(BigInt);
  await validateImageFiles(input.imageFileIds, uploaderId);
  return withSerializableTransaction(async (tx) => {
    const exists = await tx.course.findUnique({ where: { id: courseId }, select: { id: true } });
    if (!exists) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
    await ensureValidPrerequisites(tx, courseId, prerequisiteCourseIds);
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
        prerequisites:
          prerequisiteCourseIds === undefined
            ? undefined
            : {
                deleteMany: {},
                create: prerequisiteCourseIds.map((prerequisiteCourseId) => ({
                  prerequisiteCourseId,
                })),
              },
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
