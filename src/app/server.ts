import { buildApp } from './app.js';
import { env } from '../config/env.js';
import { prisma } from '../infrastructure/database/prisma.js';

const app = await buildApp();

async function start(): Promise<void> {
  try {
    await prisma.$connect();
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (error) {
    app.log.fatal(error, 'Unable to start Lumify API');
    await prisma.$disconnect();
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => prisma.$disconnect());
  });
}

void start();
