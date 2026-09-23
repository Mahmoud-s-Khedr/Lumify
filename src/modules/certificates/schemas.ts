import { z } from 'zod';

export const certificateTemplateSchema = z.object({ fileId: z.string().regex(/^\d+$/) });
export const certificateIdSchema = z.object({ id: z.string().regex(/^\d+$/) });
export const certificatePublicIdSchema = z.object({ publicId: z.string().min(20).max(64) });

export type CertificateTemplateInput = z.infer<typeof certificateTemplateSchema>;
