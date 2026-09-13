import { z } from 'zod';

const idSchema = z.string().regex(/^\d+$/);

export const courseParamsSchema = z.object({ courseId: idSchema });
export const messageQuerySchema = z.object({
  before: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type MessageHistoryQuery = z.infer<typeof messageQuerySchema>;
