import { z } from 'zod';

const idSchema = z.string().regex(/^\d+$/);

export const courseParamsSchema = z.object({ courseId: idSchema });
export const reviewParamsSchema = z.object({ id: idSchema });
export const reviewValuesSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(5_000),
});
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const adminListSchema = paginationSchema.extend({
  courseId: idSchema.optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});
export const moderationSchema = z.object({
  adminNote: z.string().trim().max(2_000).nullable().optional(),
});

export type ReviewValuesInput = z.infer<typeof reviewValuesSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type AdminReviewListInput = z.infer<typeof adminListSchema>;
export type ModerationInput = z.infer<typeof moderationSchema>;
