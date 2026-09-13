import type { User } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { env } from '../../config/env.js';
import { publicAuthUser } from './presenter.js';
import {
  changePasswordSchema,
  credentialsSchema,
  emailSchema,
  otpSchema,
  registrationSchema,
  resetSchema,
} from './schemas.js';
import {
  authenticate,
  changePassword,
  createRefreshSession,
  revokeRefreshSession,
  registerStudent,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  rotateRefreshSession,
  saveRefreshToken,
  verifyEmail,
  verifyPasswordResetCode,
} from './service.js';

const refreshCookieName = 'lumify_refresh_token';

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
      const body = parseRequest(registrationSchema, request.body);
      const { user, otp } = await registerStudent(body);
      return reply.code(201).send({ user: publicAuthUser(user), ...otp });
    },
  );

  app.post(
    '/auth/verify-email',
    { schema: { tags: ['Authentication'], summary: 'Verify an email OTP' } },
    async (request) => {
      const body = parseRequest(otpSchema, request.body);
      return { user: publicAuthUser(await verifyEmail(body)) };
    },
  );

  app.post(
    '/auth/resend-verification',
    { schema: { tags: ['Authentication'], summary: 'Resend email verification OTP' } },
    async (request, reply) => {
      const body = parseRequest(emailSchema, request.body);
      const otp = await resendEmailVerification(body);
      return reply.code(202).send(otp);
    },
  );

  app.post(
    '/auth/login',
    { schema: { tags: ['Authentication'], summary: 'Log in and create a session' } },
    async (request, reply) => {
      const body = parseRequest(credentialsSchema, request.body);
      const user = await authenticate(body);
      const tokens = await issueSession(app, user);
      setRefreshCookie(reply, tokens.refreshToken);
      return { accessToken: tokens.accessToken, user: publicAuthUser(user) };
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
      const body = parseRequest(emailSchema, request.body);
      const otp = await requestPasswordReset(body);
      return reply.code(202).send(otp);
    },
  );

  app.post(
    '/auth/reset-password',
    { schema: { tags: ['Authentication'], summary: 'Reset a password using an OTP' } },
    async (request, reply) => {
      const body = parseRequest(resetSchema, request.body);
      await resetPassword(body);
      return reply.code(204).send();
    },
  );

  app.post(
    '/auth/verify-reset-code',
    { schema: { tags: ['Authentication'], summary: 'Verify a password reset OTP' } },
    async (request, reply) => {
      const body = parseRequest(otpSchema, request.body);
      await verifyPasswordResetCode(body);
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
      const body = parseRequest(changePasswordSchema, request.body);
      const userId = BigInt((request.user as { sub: string }).sub);
      await changePassword(userId, body);
      clearRefreshCookie(reply);
      return reply.code(204).send();
    },
  );
}
