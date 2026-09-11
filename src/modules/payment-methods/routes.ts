import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { prisma } from '../../infrastructure/database/prisma.js';

const paymentMethodSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  value: z.string().trim().min(1),
  description: z.string().trim().min(1).max(2_000),
});
const updatePaymentMethodSchema = z
  .object({
    value: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).max(2_000).optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one payment method field is required.',
  );

export async function paymentMethodRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/payment-methods',
    { schema: { tags: ['Payment methods'], summary: 'List configured payment methods' } },
    async () => {
      return { paymentMethods: await prisma.paymentMethod.findMany({ orderBy: { key: 'asc' } }) };
    },
  );

  app.post(
    '/payment-methods',
    { schema: { tags: ['Payment methods'], summary: 'Create a payment method' } },
    async (request, reply) => {
      await requireAdmin(request);
      const body = parseRequest(paymentMethodSchema, request.body);
      try {
        const paymentMethod = await prisma.paymentMethod.create({ data: body });
        return reply.code(201).send({ paymentMethod });
      } catch {
        throw new AppError(
          409,
          'A payment method with this key already exists.',
          'PAYMENT_METHOD_EXISTS',
        );
      }
    },
  );

  app.patch(
    '/payment-methods/:key',
    { schema: { tags: ['Payment methods'], summary: 'Update a payment method' } },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(z.object({ key: paymentMethodSchema.shape.key }), request.params);
      const body = parseRequest(updatePaymentMethodSchema, request.body);
      const result = await prisma.paymentMethod.updateMany({
        where: { key: params.key },
        data: body,
      });
      if (result.count === 0)
        throw new AppError(404, 'Payment method was not found.', 'PAYMENT_METHOD_NOT_FOUND');
      return {
        paymentMethod: await prisma.paymentMethod.findUniqueOrThrow({ where: { key: params.key } }),
      };
    },
  );

  app.delete(
    '/payment-methods/:key',
    { schema: { tags: ['Payment methods'], summary: 'Delete a payment method' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(z.object({ key: paymentMethodSchema.shape.key }), request.params);
      const result = await prisma.paymentMethod.deleteMany({ where: { key: params.key } });
      if (result.count === 0)
        throw new AppError(404, 'Payment method was not found.', 'PAYMENT_METHOD_NOT_FOUND');
      return reply.code(204).send();
    },
  );
}
