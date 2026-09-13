import { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import { findOwnedProfileAvatar, findUserWithAvatar, updateUserProfile } from './repository.js';
import type { userInclude } from './repository.js';
import type { UpdateProfileInput } from './schemas.js';

export type UserWithAvatar = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export async function findCurrentUser(userId: bigint): Promise<UserWithAvatar> {
  const user = await findUserWithAvatar(userId);
  if (!user) throw new AppError(401, 'Authentication is required.', 'UNAUTHENTICATED');
  return user;
}

export async function updateCurrentUser(
  userId: bigint,
  input: UpdateProfileInput,
): Promise<UserWithAvatar> {
  const data: Prisma.UserUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.contactInfo !== undefined) {
    data.contactInfo =
      input.contactInfo === null ? Prisma.JsonNull : (input.contactInfo as Prisma.InputJsonObject);
  }
  if (input.avatarFileId !== undefined) {
    if (input.avatarFileId === null) {
      data.avatarFile = { disconnect: true };
    } else {
      const avatar = await findOwnedProfileAvatar(BigInt(input.avatarFileId), userId);
      if (!avatar)
        throw new AppError(
          400,
          'Avatar must be an uploaded profile image you own.',
          'INVALID_AVATAR',
        );
      data.avatarFile = { connect: { id: avatar.id } };
    }
  }
  return updateUserProfile(userId, data);
}
