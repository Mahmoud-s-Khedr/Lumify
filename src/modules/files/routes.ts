import type { FastifyInstance } from 'fastify';

import { requireUser } from '../../common/authorization/auth.js';
import { zodSchema } from '../../common/documentation/zod-schema.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { publicFile } from './presenter.js';
import { completeSchema, fileIdSchema, uploadSchema } from './schemas.js';
import {
  assertFileDownloadAccess,
  completeUpload,
  createFileDownloadUrl,
  createUpload,
  findFileForDownload,
  isPublicDownload,
  requiresAdminUpload,
} from './service.js';

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/files/uploads',
    {
      schema: {
        tags: ['Files'],
        summary: 'Create a signed file upload URL',
        body: zodSchema(uploadSchema),
      },
    },
    async (request, reply) => {
      const identity = await requireUser(request);
      const body = parseRequest(uploadSchema, request.body);
      if (requiresAdminUpload(body.kind) && identity.role !== 'ADMIN')
        throw new AppError(403, 'Administrator access is required.', 'FORBIDDEN');
      return reply.code(201).send(await createUpload(body));
    },
  );

  app.post(
    '/files/uploads/complete',
    {
      schema: {
        tags: ['Files'],
        summary: 'Persist a completed file upload',
        body: zodSchema(completeSchema),
      },
    },
    async (request, reply) => {
      const identity = await requireUser(request);
      const body = parseRequest(completeSchema, request.body);
      if (requiresAdminUpload(body.kind) && identity.role !== 'ADMIN')
        throw new AppError(403, 'Administrator access is required.', 'FORBIDDEN');
      return reply
        .code(201)
        .send({ file: publicFile(await completeUpload(body, BigInt(identity.sub))) });
    },
  );

  app.get(
    '/files/:id/download',
    {
      schema: {
        tags: ['Files'],
        summary: 'Redirect to an authorized private file download',
        params: zodSchema(fileIdSchema),
      },
    },
    async (request, reply) => {
      const params = parseRequest(fileIdSchema, request.params);
      const file = await findFileForDownload(BigInt(params.id));
      if (!isPublicDownload(file)) await assertFileDownloadAccess(file, await requireUser(request));
      return reply.redirect(await createFileDownloadUrl(file.storageKey));
    },
  );
}
