import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../../common/authorization/auth.js';
import { courseAccessStatuses } from '../../common/business/bookings.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { objectStorage } from '../../infrastructure/r2/storage.js';

const maxCourseImageBytes = 50 * 1024 * 1024;
const maxRoundMaterialBytes = 100 * 1024 * 1024;
const maxPaymentReceiptBytes = 10 * 1024 * 1024;
const imageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
const originalNameSchema = z.string().trim().min(1).max(255);
const materialMimeTypeSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i);
const uploadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('COURSE_IMAGE'),
    originalName: originalNameSchema,
    mimeType: z.enum(imageMimeTypes),
  }),
  z.object({
    kind: z.literal('ROUND_MATERIAL'),
    originalName: originalNameSchema,
    mimeType: materialMimeTypeSchema,
  }),
  z.object({
    kind: z.literal('PAYMENT_RECEIPT'),
    originalName: originalNameSchema,
    mimeType: materialMimeTypeSchema,
  }),
]);
const completeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('COURSE_IMAGE'),
    originalName: originalNameSchema,
    mimeType: z.enum(imageMimeTypes),
    storageKey: z.string().regex(/^course-images\/[0-9a-f-]{36}$/),
  }),
  z.object({
    kind: z.literal('ROUND_MATERIAL'),
    originalName: originalNameSchema,
    mimeType: materialMimeTypeSchema,
    storageKey: z.string().regex(/^round-materials\/[0-9a-f-]{36}$/),
  }),
  z.object({
    kind: z.literal('PAYMENT_RECEIPT'),
    originalName: originalNameSchema,
    mimeType: materialMimeTypeSchema,
    storageKey: z.string().regex(/^payment-receipts\/[0-9a-f-]{36}$/),
  }),
]);
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
    { schema: { tags: ['Files'], summary: 'Create a signed file upload URL' } },
    async (request, reply) => {
      const identity = await requireUser(request);
      const body = parseRequest(uploadSchema, request.body);
      if (body.kind !== 'PAYMENT_RECEIPT' && identity.role !== 'ADMIN')
        throw new AppError(403, 'Administrator access is required.', 'FORBIDDEN');
      const directory =
        body.kind === 'COURSE_IMAGE'
          ? 'course-images'
          : body.kind === 'ROUND_MATERIAL'
            ? 'round-materials'
            : 'payment-receipts';
      const storageKey = `${directory}/${randomUUID()}`;
      const uploadUrl = await objectStorage().createUploadUrl(storageKey, body.mimeType);
      return reply.code(201).send({
        storageKey,
        uploadUrl,
        expiresInSeconds: env.R2_PRESIGNED_URL_TTL_SECONDS,
        maxSizeBytes:
          body.kind === 'COURSE_IMAGE'
            ? maxCourseImageBytes
            : body.kind === 'ROUND_MATERIAL'
              ? maxRoundMaterialBytes
              : maxPaymentReceiptBytes,
      });
    },
  );

  app.post(
    '/files/uploads/complete',
    { schema: { tags: ['Files'], summary: 'Persist a completed file upload' } },
    async (request, reply) => {
      const identity = await requireUser(request);
      const body = parseRequest(completeSchema, request.body);
      if (body.kind !== 'PAYMENT_RECEIPT' && identity.role !== 'ADMIN')
        throw new AppError(403, 'Administrator access is required.', 'FORBIDDEN');
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
      const maxSizeBytes =
        body.kind === 'COURSE_IMAGE'
          ? maxCourseImageBytes
          : body.kind === 'ROUND_MATERIAL'
            ? maxRoundMaterialBytes
            : maxPaymentReceiptBytes;
      if (object.sizeBytes > BigInt(maxSizeBytes)) {
        await storage.delete(body.storageKey);
        throw new AppError(
          400,
          `The uploaded file exceeds the ${maxSizeBytes / (1024 * 1024)} MB size limit.`,
          'FILE_TOO_LARGE',
        );
      }
      if (object.sizeBytes === 0n)
        throw new AppError(400, 'The uploaded file is empty.', 'EMPTY_FILE');
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
        include: {
          courseImages: { include: { course: { select: { archived: true } } } },
          materials: { select: { roundId: true } },
          receipts: { select: { studentId: true } },
        },
      });
      if (!file) throw new AppError(404, 'File was not found.', 'FILE_NOT_FOUND');

      const hasPublicCourseImage = file.courseImages.some((image) => !image.course.archived);
      if (!hasPublicCourseImage) {
        const identity = await requireUser(request);
        const ownsFile = file.uploadedById === BigInt(identity.sub);
        const ownsReceipt = file.receipts.some(
          (booking) => booking.studentId === BigInt(identity.sub),
        );
        const materialRoundIds = file.materials.map((material) => material.roundId);
        const hasConfirmedMaterialAccess =
          identity.role === 'STUDENT' && materialRoundIds.length > 0
            ? (await prisma.booking.count({
                where: {
                  studentId: BigInt(identity.sub),
                  roundId: { in: materialRoundIds },
                  status: { in: courseAccessStatuses },
                },
              })) > 0
            : false;
        if (identity.role !== 'ADMIN' && !ownsFile && !ownsReceipt && !hasConfirmedMaterialAccess)
          throw new AppError(403, 'You do not have access to this file.', 'FILE_ACCESS_FORBIDDEN');
      }
      return reply.redirect(await objectStorage().createDownloadUrl(file.storageKey));
    },
  );
}
