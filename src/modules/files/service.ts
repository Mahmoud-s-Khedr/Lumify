import { randomUUID } from 'node:crypto';

import type { Prisma, UserRole } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import { env } from '../../config/env.js';
import { objectStorage } from '../../infrastructure/r2/storage.js';
import {
  countCommunityAccess,
  countMaterialAccess,
  createFileRecord,
  findFileWithDownloadAccess,
} from './repository.js';
import type { fileDownloadInclude as fileDownloadIncludeType } from './repository.js';
import type { CompleteUploadInput, FileKind, UploadInput } from './schemas.js';

const maxCourseImageBytes = 50 * 1024 * 1024;
const maxRoundMaterialBytes = 100 * 1024 * 1024;
const maxPaymentReceiptBytes = 10 * 1024 * 1024;
const maxProfileAvatarBytes = 2 * 1024 * 1024;
const maxCommunityAttachmentBytes = 20 * 1024 * 1024;

export type FileAccessIdentity = { sub: string; role: UserRole };

export type FileWithDownloadAccess = Prisma.FileGetPayload<{
  include: typeof fileDownloadIncludeType;
}>;

export function requiresAdminUpload(kind: FileKind): boolean {
  return kind === 'COURSE_IMAGE' || kind === 'ROUND_MATERIAL';
}

function directoryFor(kind: FileKind): string {
  if (kind === 'COURSE_IMAGE') return 'course-images';
  if (kind === 'ROUND_MATERIAL') return 'round-materials';
  if (kind === 'PAYMENT_RECEIPT') return 'payment-receipts';
  if (kind === 'PROFILE_AVATAR') return 'profile-avatars';
  return 'community-attachments';
}

function maxSizeFor(kind: FileKind): number {
  if (kind === 'COURSE_IMAGE') return maxCourseImageBytes;
  if (kind === 'ROUND_MATERIAL') return maxRoundMaterialBytes;
  if (kind === 'PAYMENT_RECEIPT') return maxPaymentReceiptBytes;
  if (kind === 'COMMUNITY_ATTACHMENT') return maxCommunityAttachmentBytes;
  return maxProfileAvatarBytes;
}

export async function createUpload(input: UploadInput) {
  const storageKey = `${directoryFor(input.kind)}/${randomUUID()}`;
  return {
    storageKey,
    uploadUrl: await objectStorage().createUploadUrl(storageKey, input.mimeType),
    expiresInSeconds: env.R2_PRESIGNED_URL_TTL_SECONDS,
    maxSizeBytes: maxSizeFor(input.kind),
  };
}

export async function completeUpload(input: CompleteUploadInput, uploaderId: bigint) {
  const storage = objectStorage();
  const object = await storage.head(input.storageKey);
  if (!object) throw new AppError(400, 'The uploaded object was not found.', 'UPLOAD_NOT_FOUND');
  if (object.mimeType !== input.mimeType)
    throw new AppError(
      400,
      'The uploaded object has an invalid content type.',
      'INVALID_FILE_TYPE',
    );
  const maxSizeBytes = maxSizeFor(input.kind);
  if (object.sizeBytes > BigInt(maxSizeBytes)) {
    await storage.delete(input.storageKey);
    throw new AppError(
      400,
      `The uploaded file exceeds the ${maxSizeBytes / (1024 * 1024)} MB size limit.`,
      'FILE_TOO_LARGE',
    );
  }
  if (object.sizeBytes === 0n) throw new AppError(400, 'The uploaded file is empty.', 'EMPTY_FILE');
  return createFileRecord({
    storageKey: input.storageKey,
    originalName: input.originalName,
    mimeType: input.mimeType,
    sizeBytes: object.sizeBytes,
    uploadedById: uploaderId,
  });
}

export async function findFileForDownload(fileId: bigint): Promise<FileWithDownloadAccess> {
  const file = await findFileWithDownloadAccess(fileId);
  if (!file) throw new AppError(404, 'File was not found.', 'FILE_NOT_FOUND');
  return file;
}

export function isPublicDownload(file: FileWithDownloadAccess): boolean {
  return (
    file.courseImages.some((image) => !image.course.archived) || file.profileAvatarFor !== null
  );
}

export async function assertFileDownloadAccess(
  file: FileWithDownloadAccess,
  identity: FileAccessIdentity,
): Promise<void> {
  const userId = BigInt(identity.sub);
  const ownsFile = file.uploadedById === userId;
  const ownsReceipt = file.receipts.some((booking) => booking.studentId === userId);
  const materialRoundIds = file.materials.map((material) => material.roundId);
  const hasConfirmedMaterialAccess =
    identity.role === 'STUDENT' && materialRoundIds.length > 0
      ? (await countMaterialAccess(userId, materialRoundIds)) > 0
      : false;
  const activeCommunityCourseIds = file.communityMessageAttachments
    .filter((attachment) => attachment.message.deletedAt === null)
    .map((attachment) => attachment.message.courseId);
  const hasCommunityAccess =
    identity.role === 'STUDENT' && activeCommunityCourseIds.length > 0
      ? (await countCommunityAccess(userId, activeCommunityCourseIds)) > 0
      : false;
  if (
    identity.role !== 'ADMIN' &&
    !ownsFile &&
    !ownsReceipt &&
    !hasConfirmedMaterialAccess &&
    !hasCommunityAccess
  )
    throw new AppError(403, 'You do not have access to this file.', 'FILE_ACCESS_FORBIDDEN');
}

export async function createFileDownloadUrl(storageKey: string): Promise<string> {
  return objectStorage().createDownloadUrl(storageKey);
}
