import { z } from 'zod';

const idSchema = z.string().regex(/^\d+$/);
const stringListSchema = z.array(z.string().trim().min(1).max(255)).max(100);
const courseValuesSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).nullable().optional(),
  price: z.coerce.number().finite().min(0).max(99_999_999.99),
  outcomes: stringListSchema.nullable().optional(),
  skills: stringListSchema.nullable().optional(),
  prerequisiteSkills: stringListSchema.nullable().optional(),
  prerequisiteCourseId: idSchema.nullable().optional(),
  demoVideoUrl: z.string().url().max(2_000).nullable().optional(),
  imageFileIds: z.array(idSchema).max(20).optional(),
});

export const createCourseSchema = courseValuesSchema;
export const updateCourseSchema = courseValuesSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'At least one course field is required.');
export const courseParamsSchema = z.object({ id: idSchema });
export const listCoursesSchema = z.object({
  q: z.string().trim().min(1).max(255).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  archived: z.enum(['true', 'false']).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  sort: z.enum(['rating_desc', 'rating_asc']).optional(),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type ListCoursesQuery = z.infer<typeof listCoursesSchema>;
