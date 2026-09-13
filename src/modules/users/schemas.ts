import { z } from 'zod';

export const profileSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    phone: z.string().min(1).max(50).nullable().optional(),
    contactInfo: z.record(z.unknown()).nullable().optional(),
    avatarFileId: z.string().regex(/^\d+$/).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one profile field is required.');

export type UpdateProfileInput = z.infer<typeof profileSchema>;
