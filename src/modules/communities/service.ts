import { Prisma, type UserRole } from '@prisma/client';

import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { publicFile } from '../files/routes.js';

export type CommunityIdentity = { sub: string; role: UserRole };

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

export function communityRoom(courseId: bigint | string): string {
  return `community:${courseId.toString()}`;
}

export function publicCommunityMessage(message: CommunityMessageWithDetails) {
  return {
    id: message.id.toString(),
    courseId: message.courseId.toString(),
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    sender: {
      id: message.sender.id.toString(),
      name: message.sender.name,
      avatar: message.sender.avatarFile ? publicFile(message.sender.avatarFile) : null,
    },
    attachments: message.attachments.map((attachment) => publicFile(attachment.file)),
  };
}

/** Communities intentionally use only currently confirmed bookings. */
export async function requireCommunityCourse(
  courseId: bigint,
  identity: CommunityIdentity,
): Promise<{ id: bigint; title: string; archived: boolean }> {
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

export async function createCommunityMessage(input: {
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
