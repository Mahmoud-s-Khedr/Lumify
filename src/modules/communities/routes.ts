import type { FastifyInstance } from 'fastify';

import { requireUser } from '../../common/authorization/auth.js';
import { zodSchema } from '../../common/documentation/zod-schema.js';
import { parseRequest } from '../../common/validation/request.js';
import { publicCommunity, publicCommunityMessage } from './presenter.js';
import { courseParamsSchema, markCommunityReadSchema, messageQuerySchema } from './schemas.js';
import {
  listCommunities,
  listCommunityMessages,
  markCommunityRead,
  requireCommunityCourse,
} from './service.js';

export async function communityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/communities',
    {
      schema: { tags: ['Communities'], summary: 'List communities available to the current user' },
    },
    async (request) => {
      const identity = await requireUser(request);
      return { communities: (await listCommunities(identity)).map(publicCommunity) };
    },
  );

  app.get(
    '/communities/:courseId/messages',
    {
      schema: {
        tags: ['Communities'],
        summary: 'Get cursor-paginated community message history',
        params: zodSchema(courseParamsSchema),
        querystring: zodSchema(messageQuerySchema),
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      const params = parseRequest(courseParamsSchema, request.params);
      const query = parseRequest(messageQuerySchema, request.query);
      const courseId = BigInt(params.courseId);
      await requireCommunityCourse(courseId, identity);
      const limit = query.limit ?? 50;
      const { messages, hasMore } = await listCommunityMessages(courseId, { ...query, limit });
      return {
        messages: messages.map(publicCommunityMessage),
        nextBefore: hasMore ? (messages.at(-1)?.id.toString() ?? null) : null,
      };
    },
  );

  app.post(
    '/communities/:courseId/read',
    {
      schema: {
        tags: ['Communities'],
        summary: 'Mark received community messages as read',
        params: zodSchema(courseParamsSchema),
        body: zodSchema(markCommunityReadSchema.omit({ courseId: true })),
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      const params = parseRequest(courseParamsSchema, request.params);
      const body = parseRequest(
        markCommunityReadSchema.omit({ courseId: true }),
        request.body ?? {},
      );
      const result = await markCommunityRead({
        courseId: BigInt(params.courseId),
        identity,
        messageId: body.messageId ? BigInt(body.messageId) : undefined,
      });
      return {
        courseId: result.courseId.toString(),
        messageId: result.messageId?.toString() ?? null,
        readCount: result.readCount,
        unreadCount: result.unreadCount,
      };
    },
  );
}
