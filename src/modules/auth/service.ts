import { createHash, randomInt } from 'node:crypto';

import { AuthTokenType, Prisma, type User } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import { hashPassword, verifyPassword } from '../../common/security/passwords.js';
import { env } from '../../config/env.js';
import { sendOtpEmail } from '../../infrastructure/resend/mailer.js';
import {
  createAdmin,
  createRefreshSession as createRefreshSessionRecord,
  createVerifiedStudentFromPendingRegistration,
  deleteOtps,
  findRefreshSession,
  findUserByEmail,
  findUserById,
  findStoredValidOtp,
  replaceOtp,
  replacePendingRegistrationOtp,
  revokeAllRefreshSessions as revokeAllRefreshSessionRecords,
  revokeRefreshSession as revokeRefreshSessionRecord,
  saveRefreshToken as saveRefreshTokenRecord,
  incrementAuthRateLimit,
  savePendingRegistrationOtp,
  updateUserPassword,
  updateUserRole,
  verifyUserEmail,
} from './repository.js';
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

const registrationRateLimits = {
  ip: {
    action: 'REGISTER_IP',
    limit: env.AUTH_REGISTER_IP_LIMIT,
    windowSeconds: env.AUTH_REGISTER_IP_WINDOW_SECONDS,
  },
  email: {
    action: 'REGISTER_EMAIL',
    limit: env.AUTH_REGISTER_EMAIL_LIMIT,
    windowSeconds: env.AUTH_REGISTER_EMAIL_WINDOW_SECONDS,
  },
} as const;

const resendRateLimits = {
  ip: {
    action: 'RESEND_IP',
    limit: env.AUTH_RESEND_IP_LIMIT,
    windowSeconds: env.AUTH_RESEND_IP_WINDOW_SECONDS,
  },
  email: {
    action: 'RESEND_EMAIL',
    limit: env.AUTH_RESEND_EMAIL_LIMIT,
    windowSeconds: env.AUTH_RESEND_EMAIL_WINDOW_SECONDS,
  },
} as const;

const verificationRateLimits = {
  ip: {
    action: 'VERIFY_IP',
    limit: env.AUTH_VERIFY_IP_LIMIT,
    windowSeconds: env.AUTH_VERIFY_IP_WINDOW_SECONDS,
  },
  email: {
    action: 'VERIFY_EMAIL',
    limit: env.AUTH_VERIFY_EMAIL_LIMIT,
    windowSeconds: env.AUTH_VERIFY_EMAIL_WINDOW_SECONDS,
  },
} as const;

type RateLimit = { action: string; limit: number; windowSeconds: number };

export class OtpDeliveryError extends Error {
  public constructor(public readonly cause: unknown) {
    super('Unable to deliver OTP email');
  }
}

async function enforceRateLimit(subject: string, rateLimit: RateLimit): Promise<void> {
  const keyHash = hashToken(`auth-rate-limit:${rateLimit.action}:${subject}`);
  const count = await incrementAuthRateLimit({ ...rateLimit, keyHash });
  if (count > rateLimit.limit) {
    throw new AppError(429, 'Too many requests. Please try again later.', 'RATE_LIMITED');
  }
}

export async function enforceRegistrationRateLimits(input: {
  ip: string;
  email: string;
}): Promise<void> {
  await enforceRateLimit(input.ip, registrationRateLimits.ip);
  await enforceRateLimit(input.email.toLowerCase(), registrationRateLimits.email);
}

export async function enforceResendRateLimits(input: { ip: string; email: string }): Promise<void> {
  await enforceRateLimit(input.ip, resendRateLimits.ip);
  await enforceRateLimit(input.email.toLowerCase(), resendRateLimits.email);
}

export async function enforceVerificationRateLimits(input: {
  ip: string;
  email: string;
}): Promise<void> {
  await enforceRateLimit(input.ip, verificationRateLimits.ip);
  await enforceRateLimit(input.email.toLowerCase(), verificationRateLimits.email);
}

export function createOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function otpForResponse(code: string): { otp?: string } {
  return env.NODE_ENV === 'production' && !env.EXPOSE_OTP_IN_RESPONSE ? {} : { otp: code };
}

export async function issueOtp(
  user: Pick<User, 'id' | 'email'>,
  type: AuthTokenType,
): Promise<{ otp?: string }> {
  const code = createOtpCode();
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);

  await replaceOtp({ userId: user.id, type, tokenHash: hashToken(code), expiresAt });
  try {
    await sendOtpEmail({ email: user.email, code, purpose: type });
  } catch (error) {
    throw new OtpDeliveryError(error);
  }
  return otpForResponse(code);
}

async function issuePendingRegistrationOtp(input: RegistrationInput): Promise<{ otp?: string }> {
  const code = createOtpCode();
  const saved = await savePendingRegistrationOtp({
    email: input.email.toLowerCase(),
    name: input.name,
    phone: input.phone,
    passwordHash: await hashPassword(input.password),
    tokenHash: hashToken(code),
    expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
  });
  if (!saved)
    throw new AppError(
      409,
      'Email verification has already been completed. Finish onboarding before starting again.',
      'ONBOARDING_IN_PROGRESS',
    );
  try {
    await sendOtpEmail({ email: input.email, code, purpose: AuthTokenType.EMAIL_VERIFICATION });
  } catch (error) {
    throw new OtpDeliveryError(error);
  }
  return otpForResponse(code);
}

async function resendPendingRegistrationOtp(email: string): Promise<{ otp?: string }> {
  const code = createOtpCode();
  const replaced = await replacePendingRegistrationOtp({
    email,
    tokenHash: hashToken(code),
    expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
  });
  if (!replaced) return {};
  try {
    await sendOtpEmail({ email, code, purpose: AuthTokenType.EMAIL_VERIFICATION });
  } catch (error) {
    throw new OtpDeliveryError(error);
  }
  return otpForResponse(code);
}

export async function consumeOtp(input: {
  userId: bigint;
  type: AuthTokenType;
  code: string;
}): Promise<boolean> {
  const token = await findValidOtp(input);
  if (!token) return false;
  await deleteOtps(input.userId, input.type);
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
  return findStoredValidOtp({ ...input, tokenHash: hashToken(input.code), now: new Date() });
}

export async function createRefreshSession(userId: bigint): Promise<bigint> {
  return createRefreshSessionRecord({
    userId,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
}

export async function saveRefreshToken(sessionId: bigint, refreshToken: string): Promise<void> {
  await saveRefreshTokenRecord(sessionId, hashToken(refreshToken));
}

export async function rotateRefreshSession(input: {
  sessionId: bigint;
  refreshToken: string;
}): Promise<User | null> {
  const session = await findRefreshSession(input.sessionId);
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.tokenHash !== hashToken(input.refreshToken)
  ) {
    return null;
  }
  await revokeRefreshSessionRecord(session.id);
  return session.user;
}

export async function revokeRefreshSession(sessionId: bigint): Promise<void> {
  await revokeRefreshSessionRecord(sessionId);
}

export async function revokeAllRefreshSessions(userId: bigint): Promise<void> {
  await revokeAllRefreshSessionRecords(userId);
}

export async function startRegistration(input: RegistrationInput): Promise<{
  otp: { otp?: string };
  verificationDelivery: 'sent' | 'pending';
  deliveryError?: unknown;
}> {
  const email = input.email.toLowerCase();
  const existing = await findUserByEmail(email);
  if (existing)
    throw new AppError(
      409,
      'An account with this email already exists.',
      'EMAIL_ALREADY_REGISTERED',
    );

  try {
    return {
      otp: await issuePendingRegistrationOtp(input),
      verificationDelivery: 'sent',
    };
  } catch (error) {
    if (error instanceof OtpDeliveryError) {
      return {
        otp: {},
        verificationDelivery: 'pending',
        deliveryError: error.cause,
      };
    }
    throw error;
  }
}

export async function verifyEmail(input: OtpInput): Promise<User> {
  const user = await findUserByEmail(input.email.toLowerCase());
  if (user) {
    if (
      !(await consumeOtp({
        userId: user.id,
        type: AuthTokenType.EMAIL_VERIFICATION,
        code: input.code,
      }))
    ) {
      throw new AppError(400, 'The verification code is invalid or expired.', 'INVALID_OTP');
    }
    return verifyUserEmail(user.id);
  }

  try {
    const user = await createVerifiedStudentFromPendingRegistration({
      email: input.email.toLowerCase(),
      otpHash: hashToken(input.code),
    });
    if (!user)
      throw new AppError(400, 'The verification code is invalid or expired.', 'INVALID_OTP');
    return user;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(
        409,
        'An account with this email already exists.',
        'EMAIL_ALREADY_REGISTERED',
      );
    }
    throw error;
  }
}

export async function resendEmailVerification(input: EmailInput): Promise<{ otp?: string }> {
  const user = await findUserByEmail(input.email.toLowerCase());
  if (user) return !user.emailVerified ? issueOtp(user, AuthTokenType.EMAIL_VERIFICATION) : {};
  try {
    return await resendPendingRegistrationOtp(input.email.toLowerCase());
  } catch (error) {
    if (
      error instanceof OtpDeliveryError ||
      (error instanceof AppError && error.code === 'ONBOARDING_IN_PROGRESS')
    )
      return {};
    throw error;
  }
}

export async function authenticate(input: CredentialsInput): Promise<User> {
  const user = await findUserByEmail(input.email.toLowerCase());
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
  }
  if (!user.emailVerified)
    throw new AppError(403, 'Verify your email before logging in.', 'EMAIL_NOT_VERIFIED');
  return user;
}

export async function requestPasswordReset(input: EmailInput): Promise<{ otp?: string }> {
  const user = await findUserByEmail(input.email.toLowerCase());
  return user ? issueOtp(user, AuthTokenType.PASSWORD_RESET) : {};
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const user = await findUserByEmail(input.email.toLowerCase());
  if (
    !user ||
    !(await consumeOtp({ userId: user.id, type: AuthTokenType.PASSWORD_RESET, code: input.code }))
  ) {
    throw new AppError(400, 'The reset code is invalid or expired.', 'INVALID_OTP');
  }
  await updateUserPassword(user.id, await hashPassword(input.newPassword));
  await revokeAllRefreshSessions(user.id);
}

export async function verifyPasswordResetCode(input: OtpInput): Promise<void> {
  const user = await findUserByEmail(input.email.toLowerCase());
  if (
    !user ||
    !(await verifyOtp({ userId: user.id, type: AuthTokenType.PASSWORD_RESET, code: input.code }))
  ) {
    throw new AppError(400, 'The reset code is invalid or expired.', 'INVALID_OTP');
  }
}

export async function changePassword(userId: bigint, input: ChangePasswordInput): Promise<void> {
  const user = await findUserById(userId);
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError(400, 'The current password is incorrect.', 'INVALID_CURRENT_PASSWORD');
  }
  await updateUserPassword(user.id, await hashPassword(input.newPassword));
  await revokeAllRefreshSessions(user.id);
}

export async function bootstrapAdmin(): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return;
  const email = env.ADMIN_EMAIL.toLowerCase();
  const existing = await findUserByEmail(email);
  if (existing) {
    if (existing.role !== 'ADMIN') {
      await updateUserRole(existing.id, 'ADMIN');
    }
    return;
  }
  await createAdmin({
    name: env.ADMIN_NAME,
    email,
    passwordHash: await hashPassword(env.ADMIN_PASSWORD),
  });
}
