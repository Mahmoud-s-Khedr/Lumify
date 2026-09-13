import type { User } from '@prisma/client';

export function publicAuthUser(user: User) {
  return {
    id: user.id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    contactInfo: user.contactInfo,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
