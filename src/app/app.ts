import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

import { AppError } from '../common/errors/app-error.js';
import { corsOrigins, env } from '../config/env.js';

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
  await app.register(cors, {
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
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
    },
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

  return app;
}
