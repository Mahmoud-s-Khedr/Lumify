import { env } from '../../config/env.js';

export function publicFile(file: {
  id: bigint;
  originalName: string;
  mimeType: string | null;
  sizeBytes: bigint | null;
}) {
  return {
    id: file.id.toString(),
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes?.toString() ?? null,
    downloadUrl: `${(env.PUBLIC_BACKEND_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, '')}/files/${file.id.toString()}/download`,
  };
}
