import { z } from 'zod';

export const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const registrationSchema = credentialsSchema.extend({ name: z.string().min(1).max(255) });

export const emailSchema = z.object({ email: z.string().email() });

export const otpSchema = emailSchema.extend({ code: z.string().regex(/^\d{6}$/) });

export const resetSchema = otpSchema.extend({ newPassword: z.string().min(8).max(200) });

export const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(200),
});

export type CredentialsInput = z.infer<typeof credentialsSchema>;
export type RegistrationInput = z.infer<typeof registrationSchema>;
export type EmailInput = z.infer<typeof emailSchema>;
export type OtpInput = z.infer<typeof otpSchema>;
export type ResetPasswordInput = z.infer<typeof resetSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
