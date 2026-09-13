import type { FastifyInstance } from 'fastify';

import { requireAdmin } from '../../common/authorization/auth.js';
import { parseRequest } from '../../common/validation/request.js';
import {
  paymentMethodParamsSchema,
  paymentMethodSchema,
  updatePaymentMethodSchema,
} from './schemas.js';
import {
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  updatePaymentMethod,
} from './service.js';

export async function paymentMethodRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/payment-methods',
    { schema: { tags: ['Payment methods'], summary: 'List configured payment methods' } },
    async () => ({ paymentMethods: await listPaymentMethods() }),
  );

  app.post(
    '/payment-methods',
    { schema: { tags: ['Payment methods'], summary: 'Create a payment method' } },
    async (request, reply) => {
      await requireAdmin(request);
      const body = parseRequest(paymentMethodSchema, request.body);
      return reply.code(201).send({ paymentMethod: await createPaymentMethod(body) });
    },
  );

  app.patch(
    '/payment-methods/:key',
    { schema: { tags: ['Payment methods'], summary: 'Update a payment method' } },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(paymentMethodParamsSchema, request.params);
      const body = parseRequest(updatePaymentMethodSchema, request.body);
      return { paymentMethod: await updatePaymentMethod(params.key, body) };
    },
  );

  app.delete(
    '/payment-methods/:key',
    { schema: { tags: ['Payment methods'], summary: 'Delete a payment method' } },
    async (request, reply) => {
      await requireAdmin(request);
      const params = parseRequest(paymentMethodParamsSchema, request.params);
      await deletePaymentMethod(params.key);
      return reply.code(204).send();
    },
  );
}
