import type { File, User } from '@prisma/client';

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

export function publicUser(user: UserWithAvatar) {
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
