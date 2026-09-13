import { z } from 'zod';

const idSchema = z.string().regex(/^\d+$/);
const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const studentParamsSchema = z.object({ id: idSchema });
export const courseParamsSchema = z.object({ courseId: idSchema });
export const roundParamsSchema = z.object({ roundId: idSchema });
export const bookingStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'PENDING_REVIEW',
  'CONFIRMED',
  'PAYMENT_REJECTED',
  'CANCELLATION_REQUESTED',
  'CANCELLED',
]);

export const listStudentsQuerySchema = z.object({
  q: z.string().trim().min(1).max(255).optional(),
  ...paginationSchema,
});

export const listRosterQuerySchema = z.object({
  q: z.string().trim().min(1).max(255).optional(),
  status: bookingStatusSchema.optional(),
  ...paginationSchema,
});

export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;
export type ListRosterQuery = z.infer<typeof listRosterQuerySchema>;
