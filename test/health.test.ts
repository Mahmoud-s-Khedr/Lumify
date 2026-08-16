import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app/app.js';

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  afterEach(async () => {
    await app?.close();
  });

  it('returns service health', async () => {
    app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('serves Swagger UI and generated OpenAPI documentation', async () => {
    app = await buildApp();

    const [docs, openapi] = await Promise.all([
      app.inject({ method: 'GET', url: '/docs/' }),
      app.inject({ method: 'GET', url: '/docs/json' }),
    ]);

    expect(docs.statusCode).toBe(200);
    expect(openapi.statusCode).toBe(200);
    expect(openapi.json()).toMatchObject({ openapi: '3.0.3' });
  });
});
