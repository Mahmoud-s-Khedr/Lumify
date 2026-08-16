import type { UserRole } from '@prisma/client';
import type { FastifyRequest } from 'fastify';

import { AppError } from '../errors/app-error.js';

export type AccessTokenPayload = { sub: string; role: UserRole; email: string };

export async function requireUser(request: FastifyRequest): Promise<AccessTokenPayload> {
  try {
    await request.jwtVerify();
    return request.user as AccessTokenPayload;
  } catch {
    throw new AppError(401, 'Authentication is required.', 'UNAUTHENTICATED');
  }
}

export async function requireAdmin(request: FastifyRequest): Promise<AccessTokenPayload> {
  const user = await requireUser(request);
  if (user.role !== 'ADMIN') {
    throw new AppError(403, 'Administrator access is required.', 'FORBIDDEN');
  }
  return user;
}
