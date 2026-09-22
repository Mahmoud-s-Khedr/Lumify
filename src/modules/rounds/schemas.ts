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
const scheduleFieldsSchema = z.object({
  weekday: weekdaySchema,
  startTime: timeSchema,
  endTime: timeSchema,
});
export const scheduleValuesSchema = scheduleFieldsSchema
  .refine((value) => value.startTime !== value.endTime, {
    message: 'The end time must differ from the start time.',
    path: ['endTime'],
  });
const utcTimestampSchema = z
  .string()
  .datetime({ offset: false })
  .regex(/Z$/, 'Timestamp must be a UTC ISO-8601 timestamp ending in Z.');
const occurrenceFieldsSchema = z.object({
  startAt: utcTimestampSchema,
  endAt: utcTimestampSchema,
});
export const occurrenceValuesSchema = occurrenceFieldsSchema.refine(
  (value) => new Date(value.startAt) < new Date(value.endAt),
  {
    message: 'The end timestamp must be after the start timestamp.',
    path: ['endAt'],
  },
);
const roundValuesSchema = z.object({
  startDate: dateSchema,
  endDate: dateSchema,
  capacity: z.coerce.number().int().min(1).max(100_000),
});
const datesInOrder = <T extends { startDate: string; endDate: string }>(value: T) =>
  value.endDate >= value.startDate;

export const createRoundSchema = z.union([
  roundValuesSchema
    .extend({
      scheduleMode: z.literal('WEEKLY').optional(),
      schedules: z.array(scheduleValuesSchema).max(50).optional(),
    })
    .refine(datesInOrder, {
      message: 'The end date must be on or after the start date.',
      path: ['endDate'],
    }),
  roundValuesSchema
    .extend({
      scheduleMode: z.literal('CUSTOM'),
      occurrences: z.array(occurrenceValuesSchema).max(500).optional(),
    })
    .refine(datesInOrder, {
      message: 'The end date must be on or after the start date.',
      path: ['endDate'],
    }),
]);
export const updateRoundSchema = roundValuesSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one round field is required.');
export const courseParamsSchema = z.object({ courseId: idSchema });
export const listRoundsQuerySchema = z.object({ includeUnavailable: z.enum(['true']).optional() });
export const roundParamsSchema = z.object({ id: idSchema });
export const scheduleParamsSchema = z.object({ id: idSchema, scheduleId: idSchema });
export const updateScheduleSchema = scheduleFieldsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one schedule field is required.');
export const occurrenceParamsSchema = z.object({ id: idSchema, occurrenceId: idSchema });
export const updateOccurrenceSchema = occurrenceFieldsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one occurrence field is required.');
export const replaceScheduleModeSchema = z.union([
  z.object({
    scheduleMode: z.literal('WEEKLY'),
    schedules: z.array(scheduleValuesSchema).max(50),
  }),
  z.object({
    scheduleMode: z.literal('CUSTOM'),
    occurrences: z.array(occurrenceValuesSchema).max(500),
  }),
]);
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
export type OccurrenceInput = z.infer<typeof occurrenceValuesSchema>;
export type UpdateOccurrenceInput = z.infer<typeof updateOccurrenceSchema>;
export type ReplaceScheduleModeInput = z.infer<typeof replaceScheduleModeSchema>;
export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;
export type UpdateMaterialInput = z.infer<typeof updateMaterialSchema>;
