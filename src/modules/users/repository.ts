import type { Prisma } from '@prisma/client';

import { prisma } from '../../infrastructure/database/prisma.js';

export const userInclude = { avatarFile: true } satisfies Prisma.UserInclude;

export function findUserWithAvatar(userId: bigint) {
  return prisma.user.findUnique({ where: { id: userId }, include: userInclude });
}

export function findOwnedProfileAvatar(fileId: bigint, userId: bigint) {
  return prisma.file.findFirst({
    where: {
      id: fileId,
      uploadedById: userId,
      storageKey: { startsWith: 'profile-avatars/' },
      mimeType: { in: ['image/jpeg', 'image/png', 'image/gif'] },
      sizeBytes: { lte: BigInt(2 * 1024 * 1024) },
    },
  });
}

export function updateUserProfile(userId: bigint, data: Prisma.UserUpdateInput) {
  return prisma.user.update({ where: { id: userId }, data, include: userInclude });
}
