import { Prisma, type Course, type File } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { objectStorage } from '../../infrastructure/r2/storage.js';
import { publicFile } from '../files/routes.js';

const idSchema = z.string().regex(/^\d+$/);
const stringListSchema = z.array(z.string().trim().min(1).max(255)).max(100);
const courseValuesSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).nullable().optional(),
  price: z.coerce.number().finite().min(0).max(99_999_999.99),
  outcomes: stringListSchema.nullable().optional(),
  skills: stringListSchema.nullable().optional(),
  prerequisiteSkills: stringListSchema.nullable().optional(),
  prerequisiteCourseId: idSchema.nullable().optional(),
  demoVideoUrl: z.string().url().max(2_000).nullable().optional(),
  imageFileIds: z.array(idSchema).max(20).optional(),
});
const createCourseSchema = courseValuesSchema;
const updateCourseSchema = courseValuesSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'At least one course field is required.');
const paramsSchema = z.object({ id: idSchema });
const listSchema = z.object({
  q: z.string().trim().min(1).max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  archived: z.enum(['true', 'false']).optional(),
});

type CourseWithImages = Course & { images: Array<{ sortOrder: number | null; file: File }> };

function jsonList(
  value: string[] | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  return value === null ? Prisma.JsonNull : value;
}

function publicCourse(course: CourseWithImages) {
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
    images: course.images
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
      .map((image) => publicFile(image.file)),
  };
}

async function ensureValidPrerequisite(
  courseId: bigint | undefined,
  prerequisiteId: bigint | null | undefined,
) {
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
): Promise<File[]> {
  if (imageFileIds === undefined) return [];
  if (new Set(imageFileIds).size !== imageFileIds.length)
    throw new AppError(400, 'Course images cannot contain duplicates.', 'DUPLICATE_COURSE_IMAGE');
  if (imageFileIds.length === 0) return [];
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
  return files;
}

function imageCreateData(imageFileIds: string[]) {
  return imageFileIds.map((fileId, index) => ({ fileId: BigInt(fileId), sortOrder: index }));
}

async function findCourse(id: bigint): Promise<CourseWithImages | null> {
  return prisma.course.findUnique({
    where: { id },
    include: { images: { include: { file: true }, orderBy: { sortOrder: 'asc' } } },
  });
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

export async function courseRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/courses',
    { schema: { tags: ['Courses'], summary: 'List courses in the catalogue' } },
    async (request) => {
      const query = parseRequest(listSchema, request.query);
      const wantsArchived = query.archived === 'true';
      if (query.archived !== undefined) await requireAdmin(request);
      const courses = await prisma.course.findMany({
        where: { archived: wantsArchived },
        include: { images: { include: { file: true }, orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      });
      const matched = query.q
        ? courses.filter((course) => matchesSearch(course, query.q ?? ''))
        : courses;
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const offset = (page - 1) * pageSize;
      return {
        courses: matched.slice(offset, offset + pageSize).map(publicCourse),
        pagination: { page, pageSize, total: matched.length },
      };
    },
  );

  app.get(
    '/courses/:id',
    { schema: { tags: ['Courses'], summary: 'Get course details' } },
    async (request) => {
      const params = parseRequest(paramsSchema, request.params);
      const course = await findCourse(BigInt(params.id));
      if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
      if (course.archived) await requireAdmin(request);
      return { course: publicCourse(course) };
    },
  );

  app.post(
    '/courses',
    { schema: { tags: ['Courses'], summary: 'Create a course' } },
    async (request, reply) => {
      const identity = await requireAdmin(request);
      const body = parseRequest(createCourseSchema, request.body);
      await ensureValidPrerequisite(
        undefined,
        body.prerequisiteCourseId === undefined
          ? undefined
          : body.prerequisiteCourseId === null
            ? null
            : BigInt(body.prerequisiteCourseId),
      );
      await validateImageFiles(body.imageFileIds, BigInt(identity.sub));
      const course = await prisma.course.create({
        data: {
          title: body.title,
          description: body.description,
          price: body.price,
          outcomes: jsonList(body.outcomes),
          skills: jsonList(body.skills),
          prerequisiteSkills: jsonList(body.prerequisiteSkills),
          prerequisiteCourseId:
            body.prerequisiteCourseId === undefined || body.prerequisiteCourseId === null
              ? undefined
              : BigInt(body.prerequisiteCourseId),
          demoVideoUrl: body.demoVideoUrl,
          images: body.imageFileIds ? { create: imageCreateData(body.imageFileIds) } : undefined,
        },
        include: { images: { include: { file: true }, orderBy: { sortOrder: 'asc' } } },
      });
      return reply.code(201).send({ course: publicCourse(course) });
    },
  );

  app.patch(
    '/courses/:id',
    { schema: { tags: ['Courses'], summary: 'Update or archive a course' } },
    async (request) => {
      const identity = await requireAdmin(request);
      const params = parseRequest(paramsSchema, request.params);
      const body = parseRequest(updateCourseSchema, request.body);
      const courseId = BigInt(params.id);
      const exists = await prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true },
      });
      if (!exists) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
      await ensureValidPrerequisite(
        courseId,
        body.prerequisiteCourseId === undefined
          ? undefined
          : body.prerequisiteCourseId === null
            ? null
            : BigInt(body.prerequisiteCourseId),
      );
      await validateImageFiles(body.imageFileIds, BigInt(identity.sub));
      const course = await prisma.$transaction(async (tx) => {
        if (body.imageFileIds !== undefined)
          await tx.courseImage.deleteMany({ where: { courseId } });
        return tx.course.update({
          where: { id: courseId },
          data: {
            title: body.title,
            description: body.description,
            price: body.price,
            outcomes: jsonList(body.outcomes),
            skills: jsonList(body.skills),
            prerequisiteSkills: jsonList(body.prerequisiteSkills),
            prerequisiteCourseId:
              body.prerequisiteCourseId === undefined
                ? undefined
                : body.prerequisiteCourseId === null
                  ? null
                  : BigInt(body.prerequisiteCourseId),
            demoVideoUrl: body.demoVideoUrl,
            archived: body.archived,
            images: body.imageFileIds ? { create: imageCreateData(body.imageFileIds) } : undefined,
          },
          include: { images: { include: { file: true }, orderBy: { sortOrder: 'asc' } } },
        });
      });
      return { course: publicCourse(course) };
    },
  );

  app.delete(
    '/courses/:id',
    { schema: { tags: ['Courses'], summary: 'Delete a course that has no rounds' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(paramsSchema, request.params);
      const courseId = BigInt(params.id);
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: { images: { include: { file: true } }, _count: { select: { rounds: true } } },
      });
      if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
      if (course._count.rounds > 0)
        throw new AppError(
          409,
          'Courses with rounds must be archived instead.',
          'COURSE_HAS_ROUNDS',
        );
      const orphanedFiles = await prisma.$transaction(async (tx) => {
        await tx.courseImage.deleteMany({ where: { courseId } });
        await tx.course.delete({ where: { id: courseId } });
        const deletable: File[] = [];
        for (const image of course.images) {
          const references = await tx.file.findUnique({
            where: { id: image.fileId },
            include: {
              _count: { select: { courseImages: true, materials: true, receipts: true } },
            },
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
      await Promise.all(orphanedFiles.map((file) => objectStorage().delete(file.storageKey)));
      return reply.code(204).send();
    },
  );
}
