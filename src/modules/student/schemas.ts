import { z } from 'zod';

const idSchema = z.string().regex(/^\d+$/);

export const studentRoundParamsSchema = z.object({ id: idSchema });
export const studentCoursesQuerySchema = z.object({
  q: z.string().trim().min(1).max(255).optional(),
  roundState: z.enum(['UPCOMING', 'IN_PROGRESS', 'FINISHED']).optional(),
  recordings: z.enum(['AVAILABLE', 'NONE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type StudentCoursesQuery = z.infer<typeof studentCoursesQuerySchema>;
