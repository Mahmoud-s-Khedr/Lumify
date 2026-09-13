import { createHash, randomInt } from 'node:crypto';

import { AuthTokenType, type User } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import { hashPassword, verifyPassword } from '../../common/security/passwords.js';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { sendOtpEmail } from '../../infrastructure/resend/mailer.js';
import type {
  ChangePasswordInput,
  CredentialsInput,
  EmailInput,
  OtpInput,
  RegistrationInput,
  ResetPasswordInput,
} from './schemas.js';

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
  const token = await findValidOtp(input);
  if (!token) return false;
  await prisma.authToken.deleteMany({ where: { userId: input.userId, type: input.type } });
  return true;
}

/**
 * Checks an OTP without consuming it. Use this when the client must complete a
 * later action with the same code, such as the password-reset confirmation step.
 */
export async function verifyOtp(input: {
  userId: bigint;
  type: AuthTokenType;
  code: string;
}): Promise<boolean> {
  return Boolean(await findValidOtp(input));
}

async function findValidOtp(input: { userId: bigint; type: AuthTokenType; code: string }) {
  const token = await prisma.authToken.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      tokenHash: hashToken(input.code),
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  return token;
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

export async function registerStudent(input: RegistrationInput): Promise<{
  user: User;
  otp: { otp?: string };
}> {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing)
    throw new AppError(409, 'An account with this email already exists.', 'EMAIL_ALREADY_REGISTERED');

  const user = await prisma.user.create({
    data: { name: input.name, email, passwordHash: await hashPassword(input.password) },
  });
  return { user, otp: await issueOtp(user, AuthTokenType.EMAIL_VERIFICATION) };
}

export async function verifyEmail(input: OtpInput): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (
    !user ||
    !(await consumeOtp({
      userId: user.id,
      type: AuthTokenType.EMAIL_VERIFICATION,
      code: input.code,
    }))
  ) {
    throw new AppError(400, 'The verification code is invalid or expired.', 'INVALID_OTP');
  }
  return prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
}

export async function resendEmailVerification(input: EmailInput): Promise<{ otp?: string }> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  return user && !user.emailVerified ? issueOtp(user, AuthTokenType.EMAIL_VERIFICATION) : {};
}

export async function authenticate(input: CredentialsInput): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
  }
  if (!user.emailVerified)
    throw new AppError(403, 'Verify your email before logging in.', 'EMAIL_NOT_VERIFIED');
  return user;
}

export async function requestPasswordReset(input: EmailInput): Promise<{ otp?: string }> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  return user ? issueOtp(user, AuthTokenType.PASSWORD_RESET) : {};
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (
    !user ||
    !(await consumeOtp({ userId: user.id, type: AuthTokenType.PASSWORD_RESET, code: input.code }))
  ) {
    throw new AppError(400, 'The reset code is invalid or expired.', 'INVALID_OTP');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });
  await revokeAllRefreshSessions(user.id);
}

export async function verifyPasswordResetCode(input: OtpInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (
    !user ||
    !(await verifyOtp({ userId: user.id, type: AuthTokenType.PASSWORD_RESET, code: input.code }))
  ) {
    throw new AppError(400, 'The reset code is invalid or expired.', 'INVALID_OTP');
  }
}

export async function changePassword(userId: bigint, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError(400, 'The current password is incorrect.', 'INVALID_CURRENT_PASSWORD');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });
  await revokeAllRefreshSessions(user.id);
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
