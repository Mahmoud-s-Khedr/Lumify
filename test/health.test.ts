import { describe, expect, it } from 'vitest';

import { api } from './http.js';

type OpenApiOperation = {
  requestBody?: unknown;
  description?: string;
  parameters?: Array<{ name?: string; schema?: unknown }>;
  security?: Array<Record<string, string[]>>;
};
type OpenApiPath = { get?: OpenApiOperation; post?: OpenApiOperation; patch?: OpenApiOperation };

describe('running backend health and docs', () => {
  it('returns service health', async () => {
    const [health, readiness] = await Promise.all([
      api<{ status: string }>('/health'),
      api<{ status: string }>('/ready'),
    ]);

    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: 'ok' });
    expect(readiness.status).toBe(200);
    expect(readiness.body).toMatchObject({ status: 'ok' });
  });

  it('serves Swagger UI and generated OpenAPI documentation', async () => {
    const [docs, openapi] = await Promise.all([
      api('/docs/'),
      api<{ openapi: string; paths: Record<string, OpenApiPath> }>('/docs/json'),
    ]);

    expect(docs.status).toBe(200);
    expect(openapi.status).toBe(200);
    expect(openapi.body).toMatchObject({ openapi: '3.0.3' });
    expect(Object.keys(openapi.body.paths)).toEqual(
      expect.arrayContaining([
        '/auth/login',
        '/rounds/{id}/sessions',
        '/rounds/{id}/join',
        '/bookings/{id}/cancellation',
        '/admin/cancellations',
      ]),
    );
    expect(openapi.body.paths['/auth/login']?.post?.requestBody).toMatchObject({
      required: true,
      content: {
        'application/json': {
          schema: {
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string', minLength: 8, maxLength: 200 },
            },
            additionalProperties: false,
          },
        },
      },
    });
    expect(openapi.body.paths['/courses/{courseId}/rounds']?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            anyOf: [
              {
                required: ['startDate', 'endDate', 'capacity'],
                properties: { schedules: { type: 'array' } },
              },
              {
                required: ['startDate', 'endDate', 'capacity', 'scheduleMode'],
                properties: { occurrences: { type: 'array' } },
              },
            ],
          },
        },
      },
    });
    expect(openapi.body.paths['/courses/{courseId}/rounds']?.get).toMatchObject({
      description: expect.stringContaining('includeUnavailable=true'),
      parameters: expect.arrayContaining([
        { name: 'includeUnavailable', schema: { type: 'string', enum: ['true'] } },
      ]),
      security: [{ bearerAuth: [] }, {}],
    });
  });
});
