import { Resend } from 'resend';

import { env } from '../../config/env.js';

export async function sendOtpEmail(input: {
  email: string;
  code: string;
  purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
}): Promise<void> {
  if (
    env.NODE_ENV === 'test' ||
    !env.EMAIL_DELIVERY_ENABLED ||
    !env.RESEND_API_KEY ||
    !env.RESEND_FROM_EMAIL
  )
    return;

  const subject =
    input.purpose === 'EMAIL_VERIFICATION'
      ? 'Verify your Lumify email'
      : 'Reset your Lumify password';
  const action =
    input.purpose === 'EMAIL_VERIFICATION' ? 'verify your email' : 'reset your password';
  const resend = new Resend(env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: input.email,
    subject,
    text: `Your Lumify code to ${action} is ${input.code}. It expires in ${env.OTP_TTL_MINUTES} minutes.`,
  });
  if (result.error) throw new Error(`Unable to send email: ${result.error.message}`);
}

export async function sendCertificateEmail(input: {
  email: string;
  studentName: string;
  courseName: string;
  attachment: Uint8Array;
  filename: string;
}): Promise<void> {
  if (
    env.NODE_ENV === 'test' ||
    !env.EMAIL_DELIVERY_ENABLED ||
    !env.RESEND_API_KEY ||
    !env.RESEND_FROM_EMAIL
  )
    return;
  const resend = new Resend(env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: input.email,
    subject: `Your Lumify certificate for ${input.courseName}`,
    text: `Hello ${input.studentName}, your certificate for ${input.courseName} is attached.`,
    attachments: [{ filename: input.filename, content: Buffer.from(input.attachment) }],
  });
  if (result.error) throw new Error(`Unable to send certificate email: ${result.error.message}`);
}
