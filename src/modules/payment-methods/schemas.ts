import { z } from 'zod';

const paymentMethodKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Z][A-Z0-9_]*$/);

export const paymentMethodSchema = z.object({
  key: paymentMethodKeySchema,
  value: z.string().trim().min(1),
  description: z.string().trim().min(1).max(2_000),
});
export const paymentMethodParamsSchema = z.object({ key: paymentMethodKeySchema });
export const updatePaymentMethodSchema = z
  .object({
    value: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).max(2_000).optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    'At least one payment method field is required.',
  );

export type CreatePaymentMethodInput = z.infer<typeof paymentMethodSchema>;
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
