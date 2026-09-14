import type { FastifyInstance } from 'fastify';

import { requireAdmin, requireUser } from '../../common/authorization/auth.js';
import { zodSchema } from '../../common/documentation/zod-schema.js';
import { AppError } from '../../common/errors/app-error.js';
import { parseRequest } from '../../common/validation/request.js';
import { publicBooking } from './presenter.js';
import {
  adminListQuerySchema,
  bookingParamsSchema,
  cancellationSchema,
  reviewSchema,
  roundParamsSchema,
  studentListQuerySchema,
  submitPaymentSchema,
} from './schemas.js';
import {
  completeBookingCancellation,
  createBooking,
  listAdminBookings,
  listCancellationRequests,
  listStudentBookings,
  requestBookingCancellation,
  reviewBooking,
  submitBookingPayment,
} from './service.js';

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/rounds/:id/bookings',
    {
      schema: {
        tags: ['Bookings'],
        summary: 'Book an available course round',
        params: zodSchema(roundParamsSchema),
      },
    },
    async (request, reply) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can book rounds.', 'FORBIDDEN');
      const params = parseRequest(roundParamsSchema, request.params);
      const result = await createBooking({
        roundId: BigInt(params.id),
        studentId: BigInt(identity.sub),
      });
      return reply
        .code(201)
        .send({ booking: publicBooking(result.booking, result.confirmedBooked) });
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
        params: zodSchema(bookingParamsSchema),
        body: zodSchema(submitPaymentSchema),
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can submit booking payments.', 'FORBIDDEN');
      const params = parseRequest(bookingParamsSchema, request.params);
      const body = parseRequest(submitPaymentSchema, request.body);
      const result = await submitBookingPayment({
        bookingId: BigInt(params.id),
        studentId: BigInt(identity.sub),
        paymentMethodKey: body.paymentMethodKey,
        receiptFileId: BigInt(body.receiptFileId),
        transactionReference: body.transactionReference,
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
        querystring: zodSchema(studentListQuerySchema),
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can list their bookings.', 'FORBIDDEN');
      const query = parseRequest(studentListQuerySchema, request.query);
      const result = await listStudentBookings({ studentId: BigInt(identity.sub), ...query });
      return {
        bookings: result.bookings.map((booking) =>
          publicBooking(booking, result.confirmedCounts.get(booking.roundId) ?? 0),
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
        querystring: zodSchema(adminListQuerySchema),
      },
    },
    async (request) => {
      await requireAdmin(request);
      const query = parseRequest(adminListQuerySchema, request.query);
      const result = await listAdminBookings(query.bookingState);
      return {
        bookings: result.bookings.map((booking) =>
          publicBooking(booking, result.confirmedCounts.get(booking.roundId) ?? 0),
        ),
      };
    },
  );

  app.post(
    '/admin/bookings/:id/approve',
    {
      schema: {
        tags: ['Bookings'],
        summary: 'Approve a manually verified booking payment',
        params: zodSchema(bookingParamsSchema),
        body: zodSchema(reviewSchema),
      },
    },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(bookingParamsSchema, request.params);
      const body = parseRequest(reviewSchema, request.body ?? {});
      const result = await reviewBooking(BigInt(params.id), 'APPROVE', body.adminNote);
      return { booking: publicBooking(result.booking, result.confirmedBooked) };
    },
  );

  app.post(
    '/admin/bookings/:id/reject',
    {
      schema: {
        tags: ['Bookings'],
        summary: 'Reject a manually verified booking payment',
        params: zodSchema(bookingParamsSchema),
        body: zodSchema(reviewSchema),
      },
    },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(bookingParamsSchema, request.params);
      const body = parseRequest(reviewSchema, request.body ?? {});
      const result = await reviewBooking(BigInt(params.id), 'REJECT', body.adminNote);
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
        params: zodSchema(bookingParamsSchema),
        body: zodSchema(cancellationSchema),
      },
    },
    async (request) => {
      const identity = await requireUser(request);
      if (identity.role !== 'STUDENT')
        throw new AppError(403, 'Only students can request cancellation.', 'FORBIDDEN');
      const params = parseRequest(bookingParamsSchema, request.params);
      const body = parseRequest(cancellationSchema, request.body);
      const result = await requestBookingCancellation({
        bookingId: BigInt(params.id),
        studentId: BigInt(identity.sub),
        reason: body.reason,
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
      const result = await listCancellationRequests();
      return {
        bookings: result.bookings.map((booking) =>
          publicBooking(booking, result.confirmedCounts.get(booking.roundId) ?? 0),
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
        params: zodSchema(bookingParamsSchema),
        body: zodSchema(reviewSchema),
      },
    },
    async (request) => {
      await requireAdmin(request);
      const params = parseRequest(bookingParamsSchema, request.params);
      const body = parseRequest(reviewSchema, request.body ?? {});
      const result = await completeBookingCancellation(BigInt(params.id), body.adminNote);
      return { booking: publicBooking(result.booking, result.confirmedBooked) };
    },
  );
}
