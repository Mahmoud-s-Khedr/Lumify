import { Prisma, type AuthTokenType, type User, type UserRole } from '@prisma/client';

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

export async function incrementAuthRateLimit(input: {
  action: string;
  keyHash: string;
  windowSeconds: number;
}): Promise<number> {
  await prisma.authRateLimit.deleteMany({
    where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1_000) } },
  });
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    INSERT INTO auth_rate_limits (action, key_hash, count, window_started_at, updated_at)
    VALUES (${input.action}, ${input.keyHash}, 1, NOW(), NOW())
    ON CONFLICT (action, key_hash) DO UPDATE
    SET
      count = CASE
        WHEN auth_rate_limits.window_started_at <= NOW() - (${input.windowSeconds}::double precision * INTERVAL '1 second')
          THEN 1
        ELSE auth_rate_limits.count + 1
      END,
      window_started_at = CASE
        WHEN auth_rate_limits.window_started_at <= NOW() - (${input.windowSeconds}::double precision * INTERVAL '1 second')
          THEN NOW()
        ELSE auth_rate_limits.window_started_at
      END,
      updated_at = NOW()
    RETURNING count
  `);
  return rows[0]!.count;
}

export async function savePendingRegistrationOtp(input: {
  email: string;
  name: string;
  phone: string;
  passwordHash: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<boolean> {
  await prisma.pendingRegistration.deleteMany({
    where: { updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1_000) } },
  });
  const rows = await prisma.$queryRaw<Array<{ email: string }>>(Prisma.sql`
    INSERT INTO pending_registrations
      (email, name, phone, password_hash, otp_hash, otp_expires_at, created_at, updated_at)
    VALUES
      (${input.email}, ${input.name}, ${input.phone}, ${input.passwordHash}, ${input.tokenHash}, ${input.expiresAt}, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE
    SET
      name = EXCLUDED.name,
      phone = EXCLUDED.phone,
      password_hash = EXCLUDED.password_hash,
      otp_hash = EXCLUDED.otp_hash,
      otp_expires_at = EXCLUDED.otp_expires_at,
      completed_at = NULL,
      updated_at = NOW()
    WHERE pending_registrations.completed_at IS NULL
    RETURNING email
  `);
  return rows.length === 1;
}

export async function replacePendingRegistrationOtp(input: {
  email: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<boolean> {
  const updated = await prisma.pendingRegistration.updateMany({
    where: { email: input.email, completedAt: null },
    data: { otpHash: input.tokenHash, otpExpiresAt: input.expiresAt },
  });
  return updated.count === 1;
}

export async function createVerifiedStudentFromPendingRegistration(input: {
  email: string;
  otpHash: string;
}): Promise<User | null> {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.pendingRegistration.findFirst({
      where: {
        email: input.email,
        otpHash: input.otpHash,
        otpExpiresAt: { gt: new Date() },
        completedAt: null,
      },
    });
    if (!pending) return null;

    const claimed = await tx.pendingRegistration.updateMany({
      where: {
        email: input.email,
        otpHash: input.otpHash,
        otpExpiresAt: { gt: new Date() },
        completedAt: null,
      },
      data: { completedAt: new Date() },
    });
    if (claimed.count !== 1) return null;

    return tx.user.create({
      data: {
        email: input.email,
        name: pending.name,
        phone: pending.phone,
        passwordHash: pending.passwordHash,
        emailVerified: true,
      },
    });
  });
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
  phone: string;
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
