import { z } from 'zod';

const idSchema = z.string().regex(/^\d+$/);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, {
    message: 'Invalid calendar date.',
  });
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const weekdaySchema = z.enum([
  'SATURDAY',
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
]);

export const scheduleValuesSchema = z.object({ weekday: weekdaySchema, startTime: timeSchema });
const roundValuesSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  capacity: z.coerce.number().int().min(1).max(100_000),
});
export const createRoundSchema = roundValuesSchema
  .extend({ schedules: z.array(scheduleValuesSchema).max(7).default([]) })
  .refine((value) => value.endDate >= value.startDate, {
    message: 'The end date must be on or after the start date.',
    path: ['endDate'],
  })
  .refine(
    (value) =>
      new Set(value.schedules.map((schedule) => schedule.weekday)).size === value.schedules.length,
    { message: 'A weekday can appear only once in a round schedule.', path: ['schedules'] },
  );
export const updateRoundSchema = roundValuesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one round field is required.');
export const courseParamsSchema = z.object({ courseId: idSchema });
export const listRoundsQuerySchema = z.object({ includeUnavailable: z.enum(['true']).optional() });
export const roundParamsSchema = z.object({ id: idSchema });
export const scheduleParamsSchema = z.object({ id: idSchema, scheduleId: idSchema });
export const updateScheduleSchema = scheduleValuesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one schedule field is required.');
export const materialParamsSchema = z.object({ id: idSchema, materialId: idSchema });
const materialTitleSchema = z.string().trim().min(1).max(255);
export const createMaterialSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FILE'), title: materialTitleSchema, fileId: idSchema }),
  z.object({
    kind: z.literal('LINK'),
    title: materialTitleSchema,
    externalUrl: z.string().url().max(2_000),
  }),
]);
export const updateMaterialSchema = z
  .object({
    title: materialTitleSchema.optional(),
    kind: z.enum(['FILE', 'LINK']).optional(),
    fileId: idSchema.optional(),
    externalUrl: z.string().url().max(2_000).optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one material field is required.',
      });
    if (value.kind === 'FILE' && !value.fileId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fileId is required for a file material.',
      });
    if (value.kind === 'LINK' && !value.externalUrl)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'externalUrl is required for a link material.',
      });
    if (value.kind === undefined && (value.fileId !== undefined || value.externalUrl !== undefined))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'kind is required when changing the material source.',
      });
    if (value.kind === 'FILE' && value.externalUrl !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A file material cannot have an external URL.',
      });
    if (value.kind === 'LINK' && value.fileId !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A link material cannot have a file.',
      });
  });

export type CreateRoundInput = z.input<typeof createRoundSchema>;
export type UpdateRoundInput = z.infer<typeof updateRoundSchema>;
export type ScheduleInput = z.infer<typeof scheduleValuesSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
