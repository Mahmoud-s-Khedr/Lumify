import { Prisma } from '@prisma/client';

import {
  canCancelBooking,
  canTransitionBooking,
  isPendingBooking,
} from '../../common/business/bookings.js';
import { utcCalendarToday } from '../../common/dates/calendar.js';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type { BookingFilterState, RoundFilterState } from './schemas.js';

export const bookingInclude = {
  student: { select: { id: true, name: true, email: true, phone: true, contactInfo: true } },
  paymentMethod: true,
  receiptFile: true,
  round: {
    include: {
      course: { select: { id: true, title: true } },
      schedules: { orderBy: { weekday: 'asc' as const } },
    },
  },
} satisfies Prisma.BookingInclude;

export type BookingWithDetails = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

const bookingStatuses: Record<BookingFilterState, Prisma.EnumBookingStatusFilter['in']> = {
  PENDING: ['PENDING_PAYMENT', 'PENDING_REVIEW'],
  REJECTED: ['PAYMENT_REJECTED'],
  CANCELLED: ['CANCELLED'],
};

function roundStateWhere(state: RoundFilterState, today: Date): Prisma.CourseRoundWhereInput {
  if (state === 'UPCOMING') return { startDate: { gt: today } };
  if (state === 'FINISHED') return { endDate: { lt: today } };
  return { startDate: { lte: today }, endDate: { gte: today } };
}

async function lockRound(tx: Prisma.TransactionClient, roundId: bigint): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM course_rounds WHERE id = ${roundId} FOR UPDATE
  `;
  if (rows.length === 0) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
}

async function confirmedCounts(roundIds: bigint[]): Promise<Map<bigint, number>> {
  if (roundIds.length === 0) return new Map();
  const counts = await prisma.booking.groupBy({
    by: ['roundId'],
    where: { roundId: { in: [...new Set(roundIds)] }, status: 'CONFIRMED' },
    _count: { _all: true },
  });
  return new Map(counts.map((count) => [count.roundId, count._count._all]));
}

async function bookingsWithConfirmedCounts(bookings: BookingWithDetails[]) {
  return {
    bookings,
    confirmedCounts: await confirmedCounts(bookings.map((booking) => booking.roundId)),
  };
}

export async function createBooking(input: {
  roundId: bigint;
  studentId: bigint;
}): Promise<{ booking: BookingWithDetails; confirmedBooked: number }> {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockRound(tx, input.roundId);
      const [student, round, confirmedBooked] = await Promise.all([
        tx.user.findUnique({ where: { id: input.studentId }, select: { phone: true } }),
        tx.courseRound.findUnique({
          where: { id: input.roundId },
          include: { course: { select: { price: true, archived: true } } },
        }),
        tx.booking.count({ where: { roundId: input.roundId, status: 'CONFIRMED' } }),
      ]);
      if (!student?.phone?.trim())
        throw new AppError(400, 'A phone number is required before booking.', 'PHONE_REQUIRED');
      if (!round) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
      if (round.course.archived)
        throw new AppError(409, 'Archived courses cannot be booked.', 'COURSE_ARCHIVED');
      if (round.startDate <= utcCalendarToday())
        throw new AppError(
          409,
          'A round cannot be booked after its start date is reached.',
          'ROUND_ALREADY_STARTED',
        );
      if (confirmedBooked >= round.capacity)
        throw new AppError(409, 'The round has no empty seats.', 'ROUND_FULL');

      const booking = await tx.booking.create({
        data: { studentId: input.studentId, roundId: input.roundId, price: round.course.price },
        include: bookingInclude,
      });
      return { booking, confirmedBooked };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new AppError(409, 'You have already booked this round.', 'DUPLICATE_BOOKING');
    throw error;
  }
}

export async function submitBookingPayment(input: {
  bookingId: bigint;
  studentId: bigint;
  paymentMethodKey: string;
  receiptFileId: bigint;
  transactionReference?: string | null;
}): Promise<{ booking: BookingWithDetails; confirmedBooked: number }> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: input.bookingId, studentId: input.studentId },
    });
    if (!booking) throw new AppError(404, 'Booking was not found.', 'BOOKING_NOT_FOUND');
    if (!canTransitionBooking(booking.status, 'PENDING_REVIEW'))
      throw new AppError(
        409,
        'Payment evidence can be submitted only before review or after rejection.',
        'INVALID_BOOKING_TRANSITION',
      );
    const [paymentMethod, receipt] = await Promise.all([
      tx.paymentMethod.findUnique({ where: { key: input.paymentMethodKey } }),
      tx.file.findFirst({
        where: { id: input.receiptFileId, uploadedById: input.studentId },
        include: { receipts: { select: { id: true } } },
      }),
    ]);
    if (!paymentMethod)
      throw new AppError(404, 'Payment method was not found.', 'PAYMENT_METHOD_NOT_FOUND');
    if (!receipt || !receipt.storageKey.startsWith('payment-receipts/'))
      throw new AppError(
        400,
        'The receipt must be a completed payment-receipt upload owned by the student.',
        'INVALID_RECEIPT_FILE',
      );
    if (receipt.receipts.some((linked) => linked.id !== input.bookingId))
      throw new AppError(
        409,
        'This receipt is already attached to another booking.',
        'RECEIPT_ALREADY_USED',
      );

    const updated = await tx.booking.update({
      where: { id: input.bookingId },
      data: {
        paymentMethodKey: paymentMethod.key,
        paymentMethodSnapshot: {
          key: paymentMethod.key,
          value: paymentMethod.value,
          description: paymentMethod.description,
        },
        transactionReference: input.transactionReference ?? null,
        receiptFileId: receipt.id,
        status: 'PENDING_REVIEW',
        adminNote: null,
        reviewedAt: null,
      },
      include: bookingInclude,
    });
    const confirmedBooked = await tx.booking.count({
      where: { roundId: booking.roundId, status: 'CONFIRMED' },
    });
    return { booking: updated, confirmedBooked };
  });
}

export async function listStudentBookings(input: {
  studentId: bigint;
  bookingState?: BookingFilterState;
  roundState?: RoundFilterState;
}) {
  const today = utcCalendarToday();
  const bookings = await prisma.booking.findMany({
    where: {
      studentId: input.studentId,
      status: input.bookingState ? { in: bookingStatuses[input.bookingState] } : undefined,
      round: input.roundState ? roundStateWhere(input.roundState, today) : undefined,
    },
    include: bookingInclude,
    orderBy: { createdAt: 'desc' },
  });
  return bookingsWithConfirmedCounts(bookings);
}

export async function listAdminBookings(bookingState?: BookingFilterState) {
  const bookings = await prisma.booking.findMany({
    where: { status: bookingState ? { in: bookingStatuses[bookingState] } : undefined },
    include: bookingInclude,
    orderBy: { createdAt: 'desc' },
  });
  return bookingsWithConfirmedCounts(bookings);
}

export async function reviewBooking(
  bookingId: bigint,
  decision: 'APPROVE' | 'REJECT',
  adminNote?: string,
): Promise<{ booking: BookingWithDetails; confirmedBooked: number }> {
  const reference = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { roundId: true },
  });
  if (!reference) throw new AppError(404, 'Booking was not found.', 'BOOKING_NOT_FOUND');

  return prisma.$transaction(async (tx) => {
    await lockRound(tx, reference.roundId);
    await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE
    `;
    const current = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!current) throw new AppError(404, 'Booking was not found.', 'BOOKING_NOT_FOUND');
    const nextStatus = decision === 'APPROVE' ? 'CONFIRMED' : 'PAYMENT_REJECTED';
    if (!canTransitionBooking(current.status, nextStatus))
      throw new AppError(
        409,
        'Only a booking pending review can be approved or rejected.',
        'INVALID_BOOKING_TRANSITION',
      );

    let confirmedBooked = await tx.booking.count({
      where: { roundId: current.roundId, status: 'CONFIRMED' },
    });
    if (decision === 'APPROVE') {
      const round = await tx.courseRound.findUniqueOrThrow({ where: { id: current.roundId } });
      if (confirmedBooked >= round.capacity)
        throw new AppError(409, 'The round has no empty seats.', 'ROUND_FULL');
      confirmedBooked += 1;
    }

    const booking = await tx.booking.update({
      where: { id: bookingId },
      data: { status: nextStatus, adminNote: adminNote || null, reviewedAt: new Date() },
      include: bookingInclude,
    });
    return { booking, confirmedBooked };
  });
}

export async function requestBookingCancellation(input: {
  bookingId: bigint;
  studentId: bigint;
  reason: string;
}): Promise<{ booking: BookingWithDetails; confirmedBooked: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM bookings WHERE id = ${input.bookingId} FOR UPDATE
    `;
    const current = await tx.booking.findFirst({
      where: { id: input.bookingId, studentId: input.studentId },
      include: {
        round: {
          select: {
            startDate: true,
            endDate: true,
            _count: { select: { sessions: true } },
          },
        },
      },
    });
    if (!current) throw new AppError(404, 'Booking was not found.', 'BOOKING_NOT_FOUND');
    const nextStatus = isPendingBooking(current.status) ? 'CANCELLED' : 'CANCELLATION_REQUESTED';
    if (!canTransitionBooking(current.status, nextStatus))
      throw new AppError(
        409,
        'Only a pending or confirmed booking can be cancelled.',
        'INVALID_BOOKING_TRANSITION',
      );
    if (
      !canCancelBooking(
        current.status,
        current.round,
        current.round._count.sessions,
        utcCalendarToday(),
      )
    )
      throw new AppError(
        409,
        'A confirmed booking can be cancelled only before the round starts or before its second session.',
        'CANCELLATION_NOT_ALLOWED',
      );
    const booking = await tx.booking.update({
      where: { id: input.bookingId },
      data: {
        status: nextStatus,
        cancellationReason: input.reason,
        adminNote: null,
        cancelledAt: nextStatus === 'CANCELLED' ? new Date() : null,
      },
      include: bookingInclude,
    });
    const confirmedBooked = await tx.booking.count({
      where: { roundId: current.roundId, status: 'CONFIRMED' },
    });
    return { booking, confirmedBooked };
  });
}

export async function listCancellationRequests() {
  const bookings = await prisma.booking.findMany({
    where: { status: 'CANCELLATION_REQUESTED' },
    include: bookingInclude,
    orderBy: { updatedAt: 'asc' },
  });
  return bookingsWithConfirmedCounts(bookings);
}

export async function completeBookingCancellation(
  bookingId: bigint,
  adminNote?: string,
): Promise<{ booking: BookingWithDetails; confirmedBooked: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE
    `;
    const current = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!current) throw new AppError(404, 'Booking was not found.', 'BOOKING_NOT_FOUND');
    if (!canTransitionBooking(current.status, 'CANCELLED'))
      throw new AppError(
        409,
        'Only a pending cancellation request can be completed.',
        'INVALID_BOOKING_TRANSITION',
      );
    const booking = await tx.booking.update({
      where: { id: bookingId },
      data: { status: 'CANCELLED', adminNote: adminNote || null, cancelledAt: new Date() },
      include: bookingInclude,
    });
    const confirmedBooked = await tx.booking.count({
      where: { roundId: current.roundId, status: 'CONFIRMED' },
    });
    return { booking, confirmedBooked };
  });
}
