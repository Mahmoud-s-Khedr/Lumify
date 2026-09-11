import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireUser } from '../../common/authorization/auth.js';
import {
  canCancelBooking,
  calculateAvailableSeats,
  calculateRoundState,
  canTransitionBooking,
  isPendingBooking,
} from '../../common/business/bookings.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { publicFile } from '../files/routes.js';

const idSchema = z.string().regex(/^\d+$/);
const bookingParamsSchema = z.object({ id: idSchema });
const roundParamsSchema = z.object({ id: idSchema });
const bookingStateSchema = z.enum(['PENDING', 'REJECTED', 'CANCELLED']);
const roundStateSchema = z.enum(['UPCOMING', 'IN_PROGRESS', 'FINISHED']);
const studentListQuerySchema = z.object({
  bookingState: bookingStateSchema.optional(),
  roundState: roundStateSchema.optional(),
});
const adminListQuerySchema = z.object({ bookingState: bookingStateSchema.optional() });
const submitPaymentSchema = z.object({
  paymentMethodKey: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  receiptFileId: idSchema,
  transactionReference: z.string().trim().min(1).max(500).nullable().optional(),
});
const reviewSchema = z.object({ adminNote: z.string().trim().max(2_000).optional() });
const cancellationSchema = z.object({
  reason: z.string().trim().min(1).max(2_000),
});

const bookingInclude = {
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

type BookingWithDetails = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;
type BookingFilterState = z.infer<typeof bookingStateSchema>;
type RoundFilterState = z.infer<typeof roundStateSchema>;

const bookingStatuses: Record<BookingFilterState, Prisma.EnumBookingStatusFilter['in']> = {
  PENDING: ['PENDING_PAYMENT', 'PENDING_REVIEW'],
  REJECTED: ['PAYMENT_REJECTED'],
  CANCELLED: ['CANCELLED'],
};

function calendarToday(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

function srsBookingState(status: BookingWithDetails['status']) {
  if (status === 'PENDING_PAYMENT' || status === 'PENDING_REVIEW') return 'PENDING' as const;
  if (status === 'PAYMENT_REJECTED') return 'REJECTED' as const;
  if (status === 'CANCELLED') return 'CANCELLED' as const;
  return status;
}

function publicSchedule(schedule: { id: bigint; weekday: string; startTime: Date }) {
  return {
    id: schedule.id.toString(),
    weekday: schedule.weekday,
    startTime: schedule.startTime.toISOString().slice(11, 16),
  };
}

function publicBooking(booking: BookingWithDetails, confirmedBooked: number) {
  const emptySeats = calculateAvailableSeats(booking.round.capacity, confirmedBooked);
  const paymentMethod =
    booking.paymentMethodSnapshot &&
    typeof booking.paymentMethodSnapshot === 'object' &&
    !Array.isArray(booking.paymentMethodSnapshot)
      ? booking.paymentMethodSnapshot
      : booking.paymentMethod;
  return {
    id: booking.id.toString(),
    student: {
      id: booking.student.id.toString(),
      name: booking.student.name,
      email: booking.student.email,
      phone: booking.student.phone,
      contactInfo: booking.student.contactInfo,
    },
    round: {
      id: booking.round.id.toString(),
      course: {
        id: booking.round.course.id.toString(),
        title: booking.round.course.title,
      },
      startDate: booking.round.startDate.toISOString().slice(0, 10),
      endDate: booking.round.endDate.toISOString().slice(0, 10),
      state: calculateRoundState(booking.round, calendarToday()),
      capacity: booking.round.capacity,
      confirmedBooked,
      emptySeats,
      schedules: booking.round.schedules.map(publicSchedule),
    },
    price: booking.price.toFixed(2),
    status: booking.status,
    bookingState: srsBookingState(booking.status),
    paymentMethod,
    transactionReference: booking.transactionReference,
    receipt: booking.receiptFile ? publicFile(booking.receiptFile) : null,
    adminNote: booking.adminNote,
    reviewedAt: booking.reviewedAt?.toISOString() ?? null,
    cancellationReason: booking.cancellationReason,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
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

async function reviewedBooking(
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
      data: {
        status: nextStatus,
        adminNote: adminNote || null,
        reviewedAt: new Date(),
      },
      include: bookingInclude,
    });
    return { booking, confirmedBooked };
  });
}

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/rounds/:id/bookings',
    { schema: { tags: ['Bookings'], summary: 'Book an available course round' } },
    async (request, reply) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can book rounds.', 'FORBIDDEN');
      const params = parseRequest(roundParamsSchema, request.params);
      const roundId = BigInt(params.id);
      const studentId = BigInt(identity.sub);

      try {
        const result = await prisma.$transaction(async (tx) => {
          await lockRound(tx, roundId);
          const [student, round, confirmedBooked] = await Promise.all([
            tx.user.findUnique({ where: { id: studentId }, select: { phone: true } }),
            tx.courseRound.findUnique({
              where: { id: roundId },
              include: { course: { select: { price: true, archived: true } } },
            }),
            tx.booking.count({ where: { roundId, status: 'CONFIRMED' } }),
          ]);
          if (!student?.phone?.trim())
            throw new AppError(400, 'A phone number is required before booking.', 'PHONE_REQUIRED');
          if (!round) throw new AppError(404, 'Round was not found.', 'ROUND_NOT_FOUND');
          if (round.course.archived)
            throw new AppError(409, 'Archived courses cannot be booked.', 'COURSE_ARCHIVED');
          if (round.startDate <= calendarToday())
            throw new AppError(
              409,
              'A round cannot be booked after its start date is reached.',
              'ROUND_ALREADY_STARTED',
            );
          if (confirmedBooked >= round.capacity)
            throw new AppError(409, 'The round has no empty seats.', 'ROUND_FULL');

          const booking = await tx.booking.create({
            data: { studentId, roundId, price: round.course.price },
            include: bookingInclude,
          });
          return { booking, confirmedBooked };
        });
        return reply
          .code(201)
          .send({ booking: publicBooking(result.booking, result.confirmedBooked) });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new AppError(409, 'You have already booked this round.', 'DUPLICATE_BOOKING');
        throw error;
      }
    },
  );

  app.post(
    '/bookings/:id/payment',
    {
      schema: {
        tags: ['Bookings'],
        summary: 'Submit or resubmit manual-payment evidence',
        description:
          'Attaches a configured manual payment method and an owned private receipt image. No automatic payment verification is performed.',
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can submit booking payments.', 'FORBIDDEN');
      const params = parseRequest(bookingParamsSchema, request.params);
      const body = parseRequest(submitPaymentSchema, request.body);
      const bookingId = BigInt(params.id);
      const studentId = BigInt(identity.sub);

      const result = await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findFirst({ where: { id: bookingId, studentId } });
        if (!booking) throw new AppError(404, 'Booking was not found.', 'BOOKING_NOT_FOUND');
        if (!canTransitionBooking(booking.status, 'PENDING_REVIEW'))
          throw new AppError(
            409,
            'Payment evidence can be submitted only before review or after rejection.',
            'INVALID_BOOKING_TRANSITION',
          );
        const [paymentMethod, receipt] = await Promise.all([
          tx.paymentMethod.findUnique({ where: { key: body.paymentMethodKey } }),
          tx.file.findFirst({
            where: { id: BigInt(body.receiptFileId), uploadedById: studentId },
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
        if (receipt.receipts.some((linked) => linked.id !== bookingId))
          throw new AppError(
            409,
            'This receipt is already attached to another booking.',
            'RECEIPT_ALREADY_USED',
          );

        const updated = await tx.booking.update({
          where: { id: bookingId },
          data: {
            paymentMethodKey: paymentMethod.key,
            paymentMethodSnapshot: {
              key: paymentMethod.key,
              value: paymentMethod.value,
              description: paymentMethod.description,
            },
            transactionReference: body.transactionReference ?? null,
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
      return { booking: publicBooking(result.booking, result.confirmedBooked) };
    },
  );

  app.get(
    '/bookings',
    {
      schema: {
        tags: ['Bookings'],
        summary: "List the current student's booked rounds",
        description:
          'bookingState maps PENDING to PENDING_PAYMENT/PENDING_REVIEW, REJECTED to PAYMENT_REJECTED, and CANCELLED to CANCELLED. bookingState and roundState are combined with AND when both are supplied.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            bookingState: { type: 'string', enum: ['PENDING', 'REJECTED', 'CANCELLED'] },
            roundState: {
              type: 'string',
              enum: ['UPCOMING', 'IN_PROGRESS', 'FINISHED'],
            },
          },
        },
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can list their bookings.', 'FORBIDDEN');
      const query = parseRequest(studentListQuerySchema, request.query);
      const today = calendarToday();
      const bookings = await prisma.booking.findMany({
        where: {
          studentId: BigInt(identity.sub),
          status: query.bookingState ? { in: bookingStatuses[query.bookingState] } : undefined,
          round: query.roundState ? roundStateWhere(query.roundState, today) : undefined,
        },
        include: bookingInclude,
        orderBy: { createdAt: 'desc' },
      });
      const counts = await confirmedCounts(bookings.map((booking) => booking.roundId));
      return {
        bookings: bookings.map((booking) =>
          publicBooking(booking, counts.get(booking.roundId) ?? 0),
        ),
      };
    },
  );

  app.get(
    '/admin/bookings',
    {
      schema: {
        tags: ['Bookings'],
        summary: 'List bookings for manual admin review',
        description:
          'bookingState maps PENDING to PENDING_PAYMENT/PENDING_REVIEW, REJECTED to PAYMENT_REJECTED, and CANCELLED to CANCELLED.',
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            bookingState: { type: 'string', enum: ['PENDING', 'REJECTED', 'CANCELLED'] },
          },
        },
      },
    },
    async (request) => {
      await requireAdmin(request);
      const query = parseRequest(adminListQuerySchema, request.query);
      const bookings = await prisma.booking.findMany({
        where: {
          status: query.bookingState ? { in: bookingStatuses[query.bookingState] } : undefined,
        },
        include: bookingInclude,
        orderBy: { createdAt: 'desc' },
      });
      const counts = await confirmedCounts(bookings.map((booking) => booking.roundId));
      return {
        bookings: bookings.map((booking) =>
          publicBooking(booking, counts.get(booking.roundId) ?? 0),
        ),
      };
    },
  );

  app.post(
    '/admin/bookings/:id/approve',
    { schema: { tags: ['Bookings'], summary: 'Approve a manually verified booking payment' } },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(bookingParamsSchema, request.params);
      const body = parseRequest(reviewSchema, request.body ?? {});
      const result = await reviewedBooking(BigInt(params.id), 'APPROVE', body.adminNote);
      return { booking: publicBooking(result.booking, result.confirmedBooked) };
    },
  );

  app.post(
    '/admin/bookings/:id/reject',
    { schema: { tags: ['Bookings'], summary: 'Reject a manually verified booking payment' } },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(bookingParamsSchema, request.params);
      const body = parseRequest(reviewSchema, request.body ?? {});
      const result = await reviewedBooking(BigInt(params.id), 'REJECT', body.adminNote);
      return { booking: publicBooking(result.booking, result.confirmedBooked) };
    },
  );

  app.post(
    '/bookings/:id/cancellation',
    {
      schema: {
        tags: ['Cancellations'],
        summary: 'Cancel an eligible booking',
        description:
          'Pending bookings are cancelled immediately. Confirmed bookings can request cancellation before a round starts, or during a round with fewer than two sessions; access remains available until an administrator completes the external refund and cancellation.',
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can request cancellation.', 'FORBIDDEN');
      const params = parseRequest(bookingParamsSchema, request.params);
      const body = parseRequest(cancellationSchema, request.body);
      const bookingId = BigInt(params.id);
      const studentId = BigInt(identity.sub);

      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE
        `;
        const current = await tx.booking.findFirst({
          where: { id: bookingId, studentId },
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
        const nextStatus = isPendingBooking(current.status)
          ? 'CANCELLED'
          : 'CANCELLATION_REQUESTED';
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
            calendarToday(),
          )
        )
          throw new AppError(
            409,
            'A confirmed booking can be cancelled only before the round starts or before its second session.',
            'CANCELLATION_NOT_ALLOWED',
          );
        const booking = await tx.booking.update({
          where: { id: bookingId },
          data: {
            status: nextStatus,
            cancellationReason: body.reason,
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
      return { booking: publicBooking(result.booking, result.confirmedBooked) };
    },
  );

  app.get(
    '/admin/cancellations',
    {
      schema: {
        tags: ['Cancellations'],
        summary: 'List cancellation requests awaiting an external refund',
      },
    },
    async (request) => {
      await requireAdmin(request);
      const bookings = await prisma.booking.findMany({
        where: { status: 'CANCELLATION_REQUESTED' },
        include: bookingInclude,
        orderBy: { updatedAt: 'asc' },
      });
      const counts = await confirmedCounts(bookings.map((booking) => booking.roundId));
      return {
        bookings: bookings.map((booking) =>
          publicBooking(booking, counts.get(booking.roundId) ?? 0),
        ),
      };
    },
  );

  app.post(
    '/admin/bookings/:id/cancellation/complete',
    {
      schema: {
        tags: ['Cancellations'],
        summary: 'Record an externally refunded cancellation as complete',
        description:
          'Lumify records the outcome only; the administrator must complete the refund outside the platform first.',
      },
    },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(bookingParamsSchema, request.params);
      const body = parseRequest(reviewSchema, request.body ?? {});
      const bookingId = BigInt(params.id);

      const result = await prisma.$transaction(async (tx) => {
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
          data: {
            status: 'CANCELLED',
            adminNote: body.adminNote || null,
            cancelledAt: new Date(),
          },
          include: bookingInclude,
        });
        const confirmedBooked = await tx.booking.count({
          where: { roundId: current.roundId, status: 'CONFIRMED' },
        });
        return { booking, confirmedBooked };
      });
      return { booking: publicBooking(result.booking, result.confirmedBooked) };
    },
  );
}
