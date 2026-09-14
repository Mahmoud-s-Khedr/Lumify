import type { FastifyInstance } from 'fastify';

import { requireUser } from '../../common/authorization/auth.js';
import { zodSchema } from '../../common/documentation/zod-schema.js';
import { parseRequest } from '../../common/validation/request.js';
import { publicUser } from './presenter.js';
import { profileSchema } from './schemas.js';
import { findCurrentUser, updateCurrentUser } from './service.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/users/me',
    { schema: { tags: ['Users'], summary: 'Get the current profile' } },
    async (request) => {
      const identity = await requireUser(request);
      return { user: publicUser(await findCurrentUser(BigInt(identity.sub))) };
    },
  );

  app.patch(
    '/users/me',
    {
      schema: {
        tags: ['Users'],
        summary: 'Update the current profile',
        body: zodSchema(profileSchema),
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      const body = parseRequest(profileSchema, request.body);
      return { user: publicUser(await updateCurrentUser(BigInt(identity.sub), body)) };
    },
  );
}
