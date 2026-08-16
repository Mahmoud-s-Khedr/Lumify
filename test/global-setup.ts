import { spawn, type ChildProcess } from 'node:child_process';

const host = '127.0.0.1';
const port = process.env.TEST_API_PORT ?? '3101';
const baseUrl = `http://${host}:${port}`;

function waitForExit(process: ChildProcess): Promise<void> {
  return new Promise((resolve) => process.once('exit', () => resolve()));
}

async function waitForHealth(process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null)
      throw new Error(`Test API exited with code ${process.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  process.kill('SIGTERM');
  throw new Error(`Test API did not become healthy at ${baseUrl}.`);
}

export default async function setup(): Promise<() => Promise<void>> {
  const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/app/server.ts'], {
    env: { ...process.env, NODE_ENV: 'test', HOST: host, PORT: port, LOG_LEVEL: 'silent' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth(server);

  return async () => {
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await waitForExit(server);
    }
  };
}
