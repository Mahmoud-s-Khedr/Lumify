import { describe, expect, it } from 'vitest';

import { api } from './http.js';

describe('running backend health and docs', () => {
  it('returns service health', async () => {
    const response = await api<{ status: string }>('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
  });

  it('serves Swagger UI and generated OpenAPI documentation', async () => {
    const [docs, openapi] = await Promise.all([
      api('/docs/'),
      api<{ openapi: string }>('/docs/json'),
    ]);

    expect(docs.status).toBe(200);
    expect(openapi.status).toBe(200);
    expect(openapi.body).toMatchObject({ openapi: '3.0.3' });
  });
});
