import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { requireAdmin, requireUser } from '../../common/authorization/auth.js';
import { zodSchema } from '../../common/documentation/zod-schema.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { env } from '../../config/env.js';
import { objectStorage } from '../../infrastructure/r2/storage.js';
import { publicCertificate, publicVerification } from './presenter.js';
import {
  activateCertificateTemplate,
  findCertificateForDownload,
  getCertificateTemplate,
  inspectCertificateTemplate,
  issueCertificates,
  listCertificates,
  verifyCertificate,
} from './service.js';
import {
  certificateIdSchema,
  certificatePublicIdSchema,
  certificateTemplateSchema,
} from './schemas.js';

function validJobSecret(value: unknown): boolean {
  if (typeof value !== 'string' || !env.CERTIFICATE_JOB_SECRET) return false;
  const given = Buffer.from(value);
  const expected = Buffer.from(env.CERTIFICATE_JOB_SECRET);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function certificateRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/admin/certificate-template/inspect',
    {
      schema: {
        tags: ['Certificates'],
        summary: 'Inspect a fillable certificate PDF',
        body: zodSchema(certificateTemplateSchema),
      },
    },
    async (request) => {
      await requireAdmin(request);
      const body = parseRequest(certificateTemplateSchema, request.body);
      return { fieldReport: await inspectCertificateTemplate(BigInt(body.fileId)) };
    },
  );

  app.put(
    '/admin/certificate-template',
    {
      schema: {
        tags: ['Certificates'],
        summary: 'Activate an inspected certificate template',
        body: zodSchema(certificateTemplateSchema),
      },
    },
    async (request) => {
      await requireAdmin(request);
      const body = parseRequest(certificateTemplateSchema, request.body);
      return { template: await activateCertificateTemplate(BigInt(body.fileId)) };
    },
  );

  app.get(
    '/admin/certificate-template',
    { schema: { tags: ['Certificates'], summary: 'Get the active certificate template' } },
    async (request) => {
      await requireAdmin(request);
      return { template: await getCertificateTemplate() };
    },
  );

  app.get(
    '/certificates',
    { schema: { tags: ['Certificates'], summary: "List the current student's certificates" } },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can list certificates.', 'FORBIDDEN');
      return {
        certificates: (await listCertificates(BigInt(identity.sub))).map(publicCertificate),
      };
    },
  );

  app.get(
    '/certificates/:id/download',
    {
      schema: {
        tags: ['Certificates'],
        summary: 'Download an issued certificate',
        params: zodSchema(certificateIdSchema),
      },
    },
    async (request, reply) => {
      const identity = await requireUser(request);
      const params = parseRequest(certificateIdSchema, request.params);
      const certificate = await findCertificateForDownload(BigInt(params.id));
      if (identity.role !== 'ADMIN' && certificate.booking.studentId !== BigInt(identity.sub))
        throw new AppError(
          403,
          'You do not have access to this certificate.',
          'CERTIFICATE_ACCESS_FORBIDDEN',
        );
      return reply.redirect(await objectStorage().createDownloadUrl(certificate.file.storageKey));
    },
  );

  app.get(
    '/certificates/:publicId/verify',
    {
      schema: {
        tags: ['Certificates'],
        summary: 'Publicly verify a certificate',
        params: zodSchema(certificatePublicIdSchema),
      },
    },
    async (request) => {
      const params = parseRequest(certificatePublicIdSchema, request.params);
      return publicVerification(await verifyCertificate(params.publicId));
    },
  );

  app.post(
    '/internal/jobs/certificates/issue',
    { schema: { tags: ['Internal'], summary: 'Issue eligible certificates and retry delivery' } },
    async (request) => {
      if (!validJobSecret(request.headers['x-certificate-job-secret']))
        throw new AppError(401, 'A valid certificate job secret is required.', 'UNAUTHENTICATED');
      return issueCertificates();
    },
  );
}
