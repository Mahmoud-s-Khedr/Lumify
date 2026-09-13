import { z } from 'zod';

const idSchema = z.string().regex(/^\d+$/);

export const roundParamsSchema = z.object({ id: idSchema });
export const sessionParamsSchema = z.object({ id: idSchema });
export const adminSessionQuerySchema = z.object({ roundId: idSchema.optional() });

const nullableUrlSchema = z.string().trim().url().max(2_000).nullable();
const nullableInstructionsSchema = z.string().trim().max(5_000).nullable();

export const updateJoinSchema = z
  .object({
    liveJoinUrl: nullableUrlSchema.optional(),
    whatsappUrl: nullableUrlSchema.optional(),
    joiningInstructions: nullableInstructionsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one join field is required.');

const sessionValuesSchema = z.object({
  title: z.string().trim().min(1).max(255),
  sessionDate: z.string().datetime({ offset: true }),
  recordingUrl: nullableUrlSchema.optional(),
});

export const createSessionSchema = sessionValuesSchema;
export const updateSessionSchema = sessionValuesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one session field is required.');

export type UpdateJoinInput = z.infer<typeof updateJoinSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
