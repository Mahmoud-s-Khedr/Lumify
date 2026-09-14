import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

import { AppError } from '../common/errors/app-error.js';
import { documentRoute, openapiComponents } from '../common/documentation/openapi.js';
import { closeZodObjectsForDocumentation } from '../common/documentation/zod-schema.js';
import { corsOrigin, env } from '../config/env.js';
import { prisma } from '../infrastructure/database/prisma.js';
import { authRoutes } from '../modules/auth/routes.js';
import { adminStudentRoutes } from '../modules/admin-students/routes.js';
import { bookingRoutes } from '../modules/bookings/routes.js';
import { paymentMethodRoutes } from '../modules/payment-methods/routes.js';
import { courseRoutes } from '../modules/courses/routes.js';
import { fileRoutes } from '../modules/files/routes.js';
import { roundRoutes } from '../modules/rounds/routes.js';
import { reviewRoutes } from '../modules/reviews/routes.js';
import { sessionRoutes } from '../modules/sessions/routes.js';
import { studentRoutes } from '../modules/student/routes.js';
import { userRoutes } from '../modules/users/routes.js';
import { communityRoutes } from '../modules/communities/routes.js';
import { registerCommunitySocket } from '../modules/communities/socket.js';

const healthResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'timestamp'],
  properties: {
    status: { type: 'string', enum: ['ok'] },
    timestamp: { type: 'string', format: 'date-time' },
  },
} as const;

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
  });

  await app.register(sensible);
  await app.register(cookie);
  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });
  await app.register(cors, {
    origin: corsOrigin,
    credentials: true,
  });
  await app.register(helmet);
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Lumify API',
        description: 'Backend API for the Lumify course platform.',
        version: '0.1.0',
      },
      servers: [{ url: '/' }],
      components: openapiComponents as never,
    },
    transform: ({ schema, url, route }) => ({
      schema: documentRoute(closeZodObjectsForDocumentation(schema), url, route),
      url,
    }),
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
  });

  app.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Application health check',
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({ status: 'ok', timestamp: new Date().toISOString() }),
  );

  app.get(
    '/ready',
    {
      schema: {
        tags: ['System'],
        summary: 'Application readiness check',
        response: {
          200: healthResponseSchema,
          503: {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'timestamp'],
            properties: {
              status: { type: 'string', enum: ['unavailable'] },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { status: 'ok', timestamp: new Date().toISOString() };
      } catch {
        return reply.code(503).send({ status: 'unavailable', timestamp: new Date().toISOString() });
      }
    },
  );

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} was not found`,
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    }

    request.log.error(error);
    const isValidationError =
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      error instanceof Error;
    if (isValidationError) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: error.message });
    }

    return reply.code(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    });
  });

  await app.register(authRoutes);
  await app.register(adminStudentRoutes);
  await app.register(userRoutes);
  await app.register(paymentMethodRoutes);
  await app.register(fileRoutes);
  await app.register(courseRoutes);
  await app.register(reviewRoutes);
  await app.register(roundRoutes);
  await app.register(bookingRoutes);
  await app.register(sessionRoutes);
  await app.register(studentRoutes);
  await app.register(communityRoutes);
  registerCommunitySocket(app);

  return app;
}
