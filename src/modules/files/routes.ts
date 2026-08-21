import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { objectStorage } from '../../infrastructure/r2/storage.js';

const maxCourseImageBytes = 50 * 1024 * 1024;
const imageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
const uploadSchema = z.object({
  kind: z.literal('COURSE_IMAGE'),
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.enum(imageMimeTypes),
});
const completeSchema = uploadSchema.extend({
  storageKey: z.string().regex(/^course-images\/[0-9a-f-]{36}$/),
});
const fileIdSchema = z.object({ id: z.string().regex(/^\d+$/) });

function downloadUrl(fileId: bigint): string {
  return `/files/${fileId.toString()}/download`;
}

export function publicFile(file: {
  id: bigint;
  originalName: string;
  mimeType: string | null;
  sizeBytes: bigint | null;
}) {
  return {
    id: file.id.toString(),
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes?.toString() ?? null,
    downloadUrl: downloadUrl(file.id),
  };
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/files/uploads',
    { schema: { tags: ['Files'], summary: 'Create a signed course-image upload URL' } },
    async (request, reply) => {
      await requireAdmin(request);
      const body = parseRequest(uploadSchema, request.body);
      const storageKey = `course-images/${randomUUID()}`;
      const uploadUrl = await objectStorage().createUploadUrl(storageKey, body.mimeType);
      return reply.code(201).send({
        storageKey,
        uploadUrl,
        expiresInSeconds: env.R2_PRESIGNED_URL_TTL_SECONDS,
        maxSizeBytes: maxCourseImageBytes,
      });
    },
  );

  app.post(
    '/files/uploads/complete',
    { schema: { tags: ['Files'], summary: 'Persist a completed course-image upload' } },
    async (request, reply) => {
      const identity = await requireAdmin(request);
      const body = parseRequest(completeSchema, request.body);
      const storage = objectStorage();
      const object = await storage.head(body.storageKey);
      if (!object)
        throw new AppError(400, 'The uploaded object was not found.', 'UPLOAD_NOT_FOUND');
      if (object.mimeType !== body.mimeType)
        throw new AppError(
          400,
          'The uploaded object has an invalid content type.',
          'INVALID_FILE_TYPE',
        );
      if (object.sizeBytes > BigInt(maxCourseImageBytes)) {
        await storage.delete(body.storageKey);
        throw new AppError(
          400,
          'The uploaded image exceeds the 50 MB size limit.',
          'FILE_TOO_LARGE',
        );
      }
      if (object.sizeBytes === 0n)
        throw new AppError(400, 'The uploaded image is empty.', 'EMPTY_FILE');
      const file = await prisma.file.create({
        data: {
          storageKey: body.storageKey,
          originalName: body.originalName,
          mimeType: body.mimeType,
          sizeBytes: object.sizeBytes,
          uploadedById: BigInt(identity.sub),
        },
      });
      return reply.code(201).send({ file: publicFile(file) });
    },
  );

  app.get(
    '/files/:id/download',
    { schema: { tags: ['Files'], summary: 'Redirect to an authorized private file download' } },
    async (request, reply) => {
      const params = parseRequest(fileIdSchema, request.params);
      const file = await prisma.file.findUnique({
        where: { id: BigInt(params.id) },
        include: { courseImages: { include: { course: { select: { archived: true } } } } },
      });
      if (!file) throw new AppError(404, 'File was not found.', 'FILE_NOT_FOUND');

      const hasPublicCourseImage = file.courseImages.some((image) => !image.course.archived);
      if (!hasPublicCourseImage) {
        try {
          const identity = await requireAdmin(request);
          if (!identity) throw new Error('unreachable');
        } catch {
          throw new AppError(403, 'You do not have access to this file.', 'FILE_ACCESS_FORBIDDEN');
        }
      }
      return reply.redirect(await objectStorage().createDownloadUrl(file.storageKey));
    },
  );
}
