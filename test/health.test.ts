import { describe, expect, it } from 'vitest';

import { api } from './http.js';

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
      api<{ openapi: string; paths: Record<string, unknown> }>('/docs/json'),
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
  });
});
