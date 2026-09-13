import type { AuthTokenType, User, UserRole } from '@prisma/client';

import { prisma } from '../../infrastructure/database/prisma.js';

export async function replaceOtp(input: {
  userId: bigint;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId: input.userId, type: input.type } }),
    prisma.authToken.create({ data: input }),
  ]);
}

export function findStoredValidOtp(input: {
  userId: bigint;
  type: AuthTokenType;
  tokenHash: string;
  now: Date;
}) {
  return prisma.authToken.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      tokenHash: input.tokenHash,
      expiresAt: { gt: input.now },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteOtps(userId: bigint, type: AuthTokenType): Promise<void> {
  await prisma.authToken.deleteMany({ where: { userId, type } });
}

export async function createRefreshSession(input: {
  userId: bigint;
  expiresAt: Date;
}): Promise<bigint> {
  const session = await prisma.authSession.create({
    data: { ...input, tokenHash: 'pending' },
  });
  return session.id;
}

export async function saveRefreshToken(sessionId: bigint, tokenHash: string): Promise<void> {
  await prisma.authSession.update({ where: { id: sessionId }, data: { tokenHash } });
}

export function findRefreshSession(sessionId: bigint) {
  return prisma.authSession.findUnique({ where: { id: sessionId }, include: { user: true } });
}

export async function revokeRefreshSession(sessionId: bigint): Promise<void> {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllRefreshSessions(userId: bigint): Promise<void> {
  await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export function findUserById(userId: bigint) {
  return prisma.user.findUnique({ where: { id: userId } });
}

export function createStudent(input: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<User> {
  return prisma.user.create({ data: input });
}

export function verifyUserEmail(userId: bigint): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
}

export async function updateUserPassword(userId: bigint, passwordHash: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

export async function updateUserRole(userId: bigint, role: UserRole): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role } });
}

export async function createAdmin(input: {
  name: string;
  email: string;
  passwordHash: string;
}): Promise<void> {
  await prisma.user.create({ data: { ...input, role: 'ADMIN', emailVerified: true } });
}
