import { z } from 'zod';

const idSchema = z.string().regex(/^\d+$/);

export const bookingParamsSchema = z.object({ id: idSchema });
export const roundParamsSchema = z.object({ id: idSchema });
export const bookingStateSchema = z.enum(['PENDING', 'REJECTED', 'CANCELLED']);
export const roundStateSchema = z.enum(['UPCOMING', 'IN_PROGRESS', 'FINISHED']);
export const studentListQuerySchema = z.object({
  bookingState: bookingStateSchema.optional(),
  roundState: roundStateSchema.optional(),
});
export const adminListQuerySchema = z.object({ bookingState: bookingStateSchema.optional() });
export const submitPaymentSchema = z.object({
  paymentMethodKey: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  receiptFileId: idSchema,
  transactionReference: z.string().trim().min(1).max(500).nullable().optional(),
});
export const reviewSchema = z.object({ adminNote: z.string().trim().max(2_000).optional() });
export const cancellationSchema = z.object({
  reason: z.string().trim().min(1).max(2_000),
});

export type BookingFilterState = z.infer<typeof bookingStateSchema>;
export type RoundFilterState = z.infer<typeof roundStateSchema>;
