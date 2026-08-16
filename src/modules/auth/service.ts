import { createHash, randomInt } from 'node:crypto';

import type { AuthTokenType, User } from '@prisma/client';

import { hashPassword } from '../../common/security/passwords.js';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { sendOtpEmail } from '../../infrastructure/resend/mailer.js';

export function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function otpForResponse(code: string): { otp?: string } {
  return env.NODE_ENV === 'production' ? {} : { otp: code };
}

export async function issueOtp(
  user: Pick<User, 'id' | 'email'>,
  type: AuthTokenType,
): Promise<{ otp?: string }> {
  const code = createOtpCode();
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);

  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId: user.id, type } }),
    prisma.authToken.create({
      data: { userId: user.id, type, tokenHash: hashToken(code), expiresAt },
    }),
  ]);
  await sendOtpEmail({ email: user.email, code, purpose: type });
  return otpForResponse(code);
}

export async function consumeOtp(input: {
  userId: bigint;
  type: AuthTokenType;
  code: string;
}): Promise<boolean> {
  const token = await prisma.authToken.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      tokenHash: hashToken(input.code),
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!token) return false;
  await prisma.authToken.deleteMany({ where: { userId: input.userId, type: input.type } });
  return true;
}

export async function createRefreshSession(userId: bigint): Promise<bigint> {
  const session = await prisma.authSession.create({
    data: {
      userId,
      tokenHash: 'pending',
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  return session.id;
}

export async function saveRefreshToken(sessionId: bigint, refreshToken: string): Promise<void> {
  await prisma.authSession.update({
    where: { id: sessionId },
    data: { tokenHash: hashToken(refreshToken) },
  });
}

export async function rotateRefreshSession(input: {
  sessionId: bigint;
  refreshToken: string;
}): Promise<User | null> {
  const session = await prisma.authSession.findUnique({
    where: { id: input.sessionId },
    include: { user: true },
  });
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.tokenHash !== hashToken(input.refreshToken)
  ) {
    return null;
  }
  await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  return session.user;
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

export async function bootstrapAdmin(): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return;
  const email = env.ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'ADMIN') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } });
    }
    return;
  }
  await prisma.user.create({
    data: {
      name: env.ADMIN_NAME,
      email,
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      role: 'ADMIN',
      emailVerified: true,
    },
  });
}
