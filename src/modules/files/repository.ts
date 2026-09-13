import type { Prisma } from '@prisma/client';

import { courseAccessStatuses } from '../../common/business/bookings.js';
import { prisma } from '../../infrastructure/database/prisma.js';

export const fileDownloadInclude = {
  courseImages: { include: { course: { select: { archived: true } } } },
  materials: { select: { roundId: true } },
  receipts: { select: { studentId: true } },
  profileAvatarFor: { select: { id: true } },
  communityMessageAttachments: {
    select: { message: { select: { courseId: true, deletedAt: true } } },
  },
} satisfies Prisma.FileInclude;

export function createFileRecord(input: {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: bigint;
  uploadedById: bigint;
}) {
  return prisma.file.create({ data: input });
}

export function findFileWithDownloadAccess(fileId: bigint) {
  return prisma.file.findUnique({ where: { id: fileId }, include: fileDownloadInclude });
}

export function countMaterialAccess(studentId: bigint, roundIds: bigint[]) {
  return prisma.booking.count({
    where: { studentId, roundId: { in: roundIds }, status: { in: courseAccessStatuses } },
  });
}

export function countCommunityAccess(studentId: bigint, courseIds: bigint[]) {
  return prisma.booking.count({
    where: { studentId, status: 'CONFIRMED', round: { courseId: { in: courseIds } } },
  });
}
