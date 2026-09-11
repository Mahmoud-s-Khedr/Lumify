import { Prisma, type File, type User } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppError } from '../../common/errors/app-error.js';
import { requireUser } from '../../common/authorization/auth.js';
import { parseRequest } from '../../common/validation/request.js';
import { prisma } from '../../infrastructure/database/prisma.js';

type UserWithAvatar = User & { avatarFile?: File | null };

function publicAvatar(file: File) {
  return {
    id: file.id.toString(),
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes?.toString() ?? null,
    downloadUrl: `/files/${file.id.toString()}/download`,
  };
}

function publicUser(user: UserWithAvatar) {
  return {
    id: user.id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    contactInfo: user.contactInfo,
    avatar: user.avatarFile ? publicAvatar(user.avatarFile) : null,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

const profileSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    phone: z.string().min(1).max(50).nullable().optional(),
    contactInfo: z.record(z.unknown()).nullable().optional(),
    avatarFileId: z.string().regex(/^\d+$/).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one profile field is required.');

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/users/me',
    { schema: { tags: ['Users'], summary: 'Get the current profile' } },
    async (request) => {
      const identity = await requireUser(request);
      const user = await prisma.user.findUnique({
        where: { id: BigInt(identity.sub) },
        include: { avatarFile: true },
      });
      if (!user) throw new AppError(401, 'Authentication is required.', 'UNAUTHENTICATED');
      return { user: publicUser(user) };
    },
  );

  app.patch(
    '/users/me',
    { schema: { tags: ['Users'], summary: 'Update the current profile' } },
    async (request) => {
      const identity = await requireUser(request);
      const body = parseRequest(profileSchema, request.body);
      const data: Prisma.UserUpdateInput = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.phone !== undefined) data.phone = body.phone;
      if (body.contactInfo !== undefined) {
        data.contactInfo =
          body.contactInfo === null
            ? Prisma.JsonNull
            : (body.contactInfo as Prisma.InputJsonObject);
      }
      if (body.avatarFileId !== undefined) {
        if (body.avatarFileId === null) {
          data.avatarFile = { disconnect: true };
        } else {
          const avatar = await prisma.file.findFirst({
            where: {
              id: BigInt(body.avatarFileId),
              uploadedById: BigInt(identity.sub),
              storageKey: { startsWith: 'profile-avatars/' },
              mimeType: { in: ['image/jpeg', 'image/png', 'image/gif'] },
              sizeBytes: { lte: BigInt(2 * 1024 * 1024) },
            },
          });
          if (!avatar)
            throw new AppError(
              400,
              'Avatar must be an uploaded profile image you own.',
              'INVALID_AVATAR',
            );
          data.avatarFile = { connect: { id: avatar.id } };
        }
      }
      const user = await prisma.user.update({
        where: { id: BigInt(identity.sub) },
        data,
        include: { avatarFile: true },
      });
      return { user: publicUser(user) };
    },
  );
}
