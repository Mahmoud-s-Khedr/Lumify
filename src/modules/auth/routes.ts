import { AuthTokenType, type User } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { AppError } from '../../common/errors/app-error.js';
import { verifyPassword, hashPassword } from '../../common/security/passwords.js';
import { parseRequest } from '../../common/validation/request.js';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  consumeOtp,
  createRefreshSession,
  issueOtp,
  revokeAllRefreshSessions,
  revokeRefreshSession,
  rotateRefreshSession,
  saveRefreshToken,
  verifyOtp,
} from './service.js';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
const otpSchema = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) });
const resetSchema = otpSchema.extend({ newPassword: z.string().min(8).max(200) });
const refreshCookieName = 'lumify_refresh_token';

function publicUser(user: User) {
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

async function issueSession(
  app: FastifyInstance,
  user: User,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = app.jwt.sign(
    { sub: user.id.toString(), role: user.role, email: user.email },
    { expiresIn: env.ACCESS_TOKEN_TTL },
  );
  const sessionId = await createRefreshSession(user.id);
  const refreshToken = app.jwt.sign(
    { sub: user.id.toString(), sid: sessionId.toString() },
    { expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`, key: env.JWT_REFRESH_SECRET },
  );
  await saveRefreshToken(sessionId, refreshToken);
  return { accessToken, refreshToken };
}

function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(refreshCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
  });
}

function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(refreshCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/auth',
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/register',
    { schema: { tags: ['Authentication'], summary: 'Register a student account' } },
    async (request, reply) => {
      const body = parseRequest(
        credentialsSchema.extend({ name: z.string().min(1).max(255) }),
        request.body,
      );
      const email = body.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing)
        throw new AppError(
          409,
          'An account with this email already exists.',
          'EMAIL_ALREADY_REGISTERED',
        );
      const user = await prisma.user.create({
        data: { name: body.name, email, passwordHash: await hashPassword(body.password) },
      });
      const otp = await issueOtp(user, AuthTokenType.EMAIL_VERIFICATION);
      return reply.code(201).send({ user: publicUser(user), ...otp });
    },
  );

  app.post(
    '/auth/verify-email',
    { schema: { tags: ['Authentication'], summary: 'Verify an email OTP' } },
    async (request) => {
      const body = parseRequest(otpSchema, request.body);
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (
        !user ||
        !(await consumeOtp({
          userId: user.id,
          type: AuthTokenType.EMAIL_VERIFICATION,
          code: body.code,
        }))
      ) {
        throw new AppError(400, 'The verification code is invalid or expired.', 'INVALID_OTP');
      }
      const verified = await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
      return { user: publicUser(verified) };
    },
  );

  app.post(
    '/auth/resend-verification',
    { schema: { tags: ['Authentication'], summary: 'Resend email verification OTP' } },
    async (request, reply) => {
      const body = parseRequest(z.object({ email: z.string().email() }), request.body);
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      const otp =
        user && !user.emailVerified ? await issueOtp(user, AuthTokenType.EMAIL_VERIFICATION) : {};
      return reply.code(202).send(otp);
    },
  );

  app.post(
    '/auth/login',
    { schema: { tags: ['Authentication'], summary: 'Log in and create a session' } },
    async (request, reply) => {
      const body = parseRequest(credentialsSchema, request.body);
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
        throw new AppError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
      }
      if (!user.emailVerified)
        throw new AppError(403, 'Verify your email before logging in.', 'EMAIL_NOT_VERIFIED');
      const tokens = await issueSession(app, user);
      setRefreshCookie(reply, tokens.refreshToken);
      return { accessToken: tokens.accessToken, user: publicUser(user) };
    },
  );

  app.post(
    '/auth/refresh',
    { schema: { tags: ['Authentication'], summary: 'Rotate the refresh session' } },
    async (request, reply) => {
      const token = request.cookies[refreshCookieName];
      if (!token) throw new AppError(401, 'Authentication is required.', 'UNAUTHENTICATED');
      let payload: { sid: string };
      try {
        payload = app.jwt.verify(token, { key: env.JWT_REFRESH_SECRET }) as { sid: string };
      } catch {
        clearRefreshCookie(reply);
        throw new AppError(401, 'Authentication is required.', 'UNAUTHENTICATED');
      }
      const user = await rotateRefreshSession({
        sessionId: BigInt(payload.sid),
        refreshToken: token,
      });
      if (!user) {
        clearRefreshCookie(reply);
        throw new AppError(401, 'Authentication is required.', 'UNAUTHENTICATED');
      }
      const tokens = await issueSession(app, user);
      setRefreshCookie(reply, tokens.refreshToken);
      return { accessToken: tokens.accessToken };
    },
  );

  app.post(
    '/auth/logout',
    { schema: { tags: ['Authentication'], summary: 'Log out the current session' } },
    async (request, reply) => {
      const token = request.cookies[refreshCookieName];
      if (token) {
        try {
          const payload = app.jwt.verify(token, { key: env.JWT_REFRESH_SECRET }) as { sid: string };
          await revokeRefreshSession(BigInt(payload.sid));
        } catch {
          // Clear invalid or expired client cookies as well.
        }
      }
      clearRefreshCookie(reply);
      return reply.code(204).send();
    },
  );

  app.post(
    '/auth/forgot-password',
    { schema: { tags: ['Authentication'], summary: 'Request a password reset OTP' } },
    async (request, reply) => {
      const body = parseRequest(z.object({ email: z.string().email() }), request.body);
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      const otp = user ? await issueOtp(user, AuthTokenType.PASSWORD_RESET) : {};
      return reply.code(202).send(otp);
    },
  );

  app.post(
    '/auth/reset-password',
    { schema: { tags: ['Authentication'], summary: 'Reset a password using an OTP' } },
    async (request, reply) => {
      const body = parseRequest(resetSchema, request.body);
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (
        !user ||
        !(await consumeOtp({
          userId: user.id,
          type: AuthTokenType.PASSWORD_RESET,
          code: body.code,
        }))
      ) {
        throw new AppError(400, 'The reset code is invalid or expired.', 'INVALID_OTP');
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword) },
      });
      await revokeAllRefreshSessions(user.id);
      return reply.code(204).send();
    },
  );

  app.post(
    '/auth/verify-reset-code',
    { schema: { tags: ['Authentication'], summary: 'Verify a password reset OTP' } },
    async (request, reply) => {
      const body = parseRequest(otpSchema, request.body);
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (
        !user ||
        !(await verifyOtp({
          userId: user.id,
          type: AuthTokenType.PASSWORD_RESET,
          code: body.code,
        }))
      ) {
        throw new AppError(400, 'The reset code is invalid or expired.', 'INVALID_OTP');
      }
      return reply.code(204).send();
    },
  );

  app.post(
    '/auth/change-password',
    { schema: { tags: ['Authentication'], summary: 'Change the current password' } },
    async (request, reply) => {
      await request.jwtVerify().catch(() => {
        throw new AppError(401, 'Authentication is required.', 'UNAUTHENTICATED');
      });
      const body = parseRequest(
        z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(200) }),
        request.body,
      );
      const userId = BigInt((request.user as { sub: string }).sub);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
        throw new AppError(400, 'The current password is incorrect.', 'INVALID_CURRENT_PASSWORD');
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword) },
      });
      await revokeAllRefreshSessions(user.id);
      clearRefreshCookie(reply);
      return reply.code(204).send();
    },
  );
}
