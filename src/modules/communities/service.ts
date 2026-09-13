import { Prisma, type UserRole } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type { MessageHistoryQuery } from './schemas.js';

export type CommunityIdentity = { sub: string; role: UserRole };
type CommunityCourse = { id: bigint; title: string; archived: boolean };

export const communityMessageInclude = {
  sender: {
    select: {
      id: true,
      name: true,
      avatarFile: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
    },
  },
  attachments: {
    include: {
      file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.CommunityMessageInclude;

export type CommunityMessageWithDetails = Prisma.CommunityMessageGetPayload<{
  include: typeof communityMessageInclude;
}>;

const communityWithLatestMessage = {
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
} satisfies Prisma.CourseSelect;

export type CommunityWithLatestMessage = Prisma.CourseGetPayload<{
  select: typeof communityWithLatestMessage;
}>;

export function communityRoom(courseId: bigint | string): string {
  return `community:${courseId.toString()}`;
}

/** Communities intentionally use only currently confirmed bookings. */
export async function requireCommunityCourse(
  courseId: bigint,
  identity: CommunityIdentity,
): Promise<CommunityCourse> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, title: true, archived: true },
  });
  if (!course) throw new AppError(404, 'Course was not found.', 'COURSE_NOT_FOUND');
  if (identity.role === 'ADMIN') return course;

  const booking = await prisma.booking.findFirst({
    where: { studentId: BigInt(identity.sub), status: 'CONFIRMED', round: { courseId } },
    select: { id: true },
  });
  if (!booking)
    throw new AppError(
      403,
      'You must have a confirmed booking in this course to use its community.',
      'COMMUNITY_ACCESS_FORBIDDEN',
    );
  return course;
}

export async function listCommunities(
  identity: CommunityIdentity,
): Promise<CommunityWithLatestMessage[]> {
  return prisma.course.findMany({
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
    select: communityWithLatestMessage,
    orderBy: { title: 'asc' },
  });
}

export async function listCommunityMessages(
  courseId: bigint,
  query: MessageHistoryQuery,
): Promise<{ messages: CommunityMessageWithDetails[]; hasMore: boolean }> {
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
    take: query.limit + 1,
  });
  const hasMore = messages.length > query.limit;
  return { messages: hasMore ? messages.slice(0, query.limit) : messages, hasMore };
}

async function createCommunityMessage(input: {
  courseId: bigint;
  senderId: bigint;
  content: string | null;
  attachmentIds: bigint[];
}): Promise<CommunityMessageWithDetails> {
  if (input.attachmentIds.length > 0) {
    const files = await prisma.file.findMany({
      where: { id: { in: input.attachmentIds } },
      select: { id: true, uploadedById: true, storageKey: true },
    });
    if (files.length !== input.attachmentIds.length)
      throw new AppError(400, 'One or more attachments were not found.', 'INVALID_ATTACHMENT');
    if (
      files.some(
        (file) =>
          file.uploadedById !== input.senderId ||
          !file.storageKey.startsWith('community-attachments/'),
      )
    )
      throw new AppError(
        403,
        'Attachments must be community files uploaded by you.',
        'ATTACHMENT_FORBIDDEN',
      );
    const alreadyAttached = await prisma.communityMessageAttachment.count({
      where: { fileId: { in: input.attachmentIds } },
    });
    if (alreadyAttached > 0)
      throw new AppError(400, 'An attachment can only be used once.', 'ATTACHMENT_ALREADY_USED');
  }

  try {
    return await prisma.communityMessage.create({
      data: {
        courseId: input.courseId,
        senderId: input.senderId,
        content: input.content,
        attachments: { create: input.attachmentIds.map((fileId) => ({ fileId })) },
      },
      include: communityMessageInclude,
    });
  } catch (error) {
    // A competing send can claim a file between the ownership check and insert.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new AppError(400, 'An attachment can only be used once.', 'ATTACHMENT_ALREADY_USED');
    throw error;
  }
}

export async function sendCommunityMessage(input: {
  courseId: bigint;
  identity: CommunityIdentity;
  content?: string;
  attachmentIds: bigint[];
}): Promise<{ course: CommunityCourse; message: CommunityMessageWithDetails }> {
  const content = input.content?.trim() ?? null;
  if (!content && input.attachmentIds.length === 0)
    throw new AppError(400, 'A message needs text or an attachment.', 'VALIDATION_ERROR');
  if (new Set(input.attachmentIds).size !== input.attachmentIds.length)
    throw new AppError(400, 'An attachment can only be included once.', 'VALIDATION_ERROR');

  const course = await requireCommunityCourse(input.courseId, input.identity);
  if (course.archived)
    throw new AppError(403, 'Archived course communities are read-only.', 'COMMUNITY_READ_ONLY');

  const message = await createCommunityMessage({
    courseId: course.id,
    senderId: BigInt(input.identity.sub),
    content,
    attachmentIds: input.attachmentIds,
  });
  return { course, message };
}

export async function deleteCommunityMessage(input: {
  messageId: bigint;
  identity: CommunityIdentity;
}): Promise<{ id: bigint; courseId: bigint }> {
  const message = await prisma.communityMessage.findUnique({
    where: { id: input.messageId },
    select: { id: true, courseId: true, senderId: true, deletedAt: true },
  });
  if (!message) throw new AppError(404, 'Message was not found.', 'MESSAGE_NOT_FOUND');

  const course = await requireCommunityCourse(message.courseId, input.identity);
  if (course.archived)
    throw new AppError(403, 'Archived course communities are read-only.', 'COMMUNITY_READ_ONLY');
  if (input.identity.role !== 'ADMIN' && message.senderId !== BigInt(input.identity.sub))
    throw new AppError(403, 'You can only delete your own messages.', 'MESSAGE_DELETE_FORBIDDEN');
  if (message.deletedAt)
    throw new AppError(400, 'Message was already deleted.', 'MESSAGE_ALREADY_DELETED');

  const deleted = await prisma.communityMessage.updateMany({
    where: { id: message.id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (deleted.count === 0)
    throw new AppError(400, 'Message was already deleted.', 'MESSAGE_ALREADY_DELETED');
  return { id: message.id, courseId: message.courseId };
}
