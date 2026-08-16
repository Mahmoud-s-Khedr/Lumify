import type { ZodType } from 'zod';

import { AppError } from '../errors/app-error.js';

export function parseRequest<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError(
      400,
      result.error.issues.map((issue) => issue.message).join('; '),
      'VALIDATION_ERROR',
    );
  }
  return result.data;
}
