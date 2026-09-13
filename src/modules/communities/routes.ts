import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../../common/authorization/auth.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import {
  communityMessageInclude,
  publicCommunityMessage,
  requireCommunityCourse,
} from './service.js';

const idSchema = z.string().regex(/^\d+$/);
const courseParamsSchema = z.object({ courseId: idSchema });
const messageQuerySchema = z.object({
  before: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function communityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/communities',
    {
      schema: { tags: ['Communities'], summary: 'List communities available to the current user' },
    },
    async (request) => {
      const identity = await requireUser(request);
      const courses = await prisma.course.findMany({
        where:
          identity.role === 'ADMIN'
            ? undefined
            : {
                rounds: {
                  some: {
                    bookings: { some: { studentId: BigInt(identity.sub), status: 'CONFIRMED' } },
                  },
                },
              },
        select: {
          id: true,
          title: true,
          description: true,
          archived: true,
          communityMessages: {
            where: { deletedAt: null },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            include: communityMessageInclude,
          },
        },
        orderBy: { title: 'asc' },
      });
      return {
        communities: courses.map((course) => ({
          course: {
            id: course.id.toString(),
            title: course.title,
            description: course.description,
            archived: course.archived,
          },
          readOnly: course.archived,
          latestMessage: course.communityMessages[0]
            ? publicCommunityMessage(course.communityMessages[0])
            : null,
        })),
      };
    },
  );

  app.get(
    '/communities/:courseId/messages',
    {
      schema: { tags: ['Communities'], summary: 'Get cursor-paginated community message history' },
    },
    async (request) => {
      const identity = await requireUser(request);
      const params = parseRequest(courseParamsSchema, request.params);
      const query = parseRequest(messageQuerySchema, request.query);
      const courseId = BigInt(params.courseId);
      await requireCommunityCourse(courseId, identity);

      let before: { createdAt: Date; id: bigint } | undefined;
      if (query.before) {
        const cursor = await prisma.communityMessage.findFirst({
          where: { id: BigInt(query.before), courseId },
          select: { createdAt: true, id: true },
        });
        if (!cursor) throw new AppError(400, 'The message cursor is invalid.', 'INVALID_CURSOR');
        before = cursor;
      }
      const messages = await prisma.communityMessage.findMany({
        where: {
          courseId,
          deletedAt: null,
          ...(before
            ? {
                OR: [
                  { createdAt: { lt: before.createdAt } },
                  { createdAt: before.createdAt, id: { lt: before.id } },
                ],
              }
            : {}),
        },
        include: communityMessageInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: (query.limit ?? 50) + 1,
      });
      const limit = query.limit ?? 50;
      const hasMore = messages.length > limit;
      const page = hasMore ? messages.slice(0, limit) : messages;
      return {
        messages: page.map(publicCommunityMessage),
        nextBefore: hasMore ? (page.at(-1)?.id.toString() ?? null) : null,
      };
    },
  );
}
