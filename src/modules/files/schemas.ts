import { z } from 'zod';

export const imageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const avatarMimeTypes = ['image/jpeg', 'image/png', 'image/gif'] as const;
export const communityAttachmentMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

const originalNameSchema = z.string().trim().min(1).max(255);
const materialMimeTypeSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i);

export const uploadSchema = z.discriminatedUnion('kind', [
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
  z.object({
    kind: z.literal('PROFILE_AVATAR'),
    originalName: originalNameSchema,
    mimeType: z.enum(avatarMimeTypes),
  }),
  z.object({
    kind: z.literal('COMMUNITY_ATTACHMENT'),
    originalName: originalNameSchema,
    mimeType: z.enum(communityAttachmentMimeTypes),
  }),
]);

export const completeSchema = z.discriminatedUnion('kind', [
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
  z.object({
    kind: z.literal('PROFILE_AVATAR'),
    originalName: originalNameSchema,
    mimeType: z.enum(avatarMimeTypes),
    storageKey: z.string().regex(/^profile-avatars\/[0-9a-f-]{36}$/),
  }),
  z.object({
    kind: z.literal('COMMUNITY_ATTACHMENT'),
    originalName: originalNameSchema,
    mimeType: z.enum(communityAttachmentMimeTypes),
    storageKey: z.string().regex(/^community-attachments\/[0-9a-f-]{36}$/),
  }),
]);

export const fileIdSchema = z.object({ id: z.string().regex(/^\d+$/) });

export type UploadInput = z.infer<typeof uploadSchema>;
export type CompleteUploadInput = z.infer<typeof completeSchema>;
export type FileKind = UploadInput['kind'];
