import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type { CreatePaymentMethodInput, UpdatePaymentMethodInput } from './schemas.js';

export async function listPaymentMethods() {
  return prisma.paymentMethod.findMany({ orderBy: { key: 'asc' } });
}

export async function createPaymentMethod(input: CreatePaymentMethodInput) {
  try {
    return await prisma.paymentMethod.create({ data: input });
  } catch {
    throw new AppError(
      409,
      'A payment method with this key already exists.',
      'PAYMENT_METHOD_EXISTS',
    );
  }
}

export async function updatePaymentMethod(key: string, input: UpdatePaymentMethodInput) {
  const result = await prisma.paymentMethod.updateMany({ where: { key }, data: input });
  if (result.count === 0)
    throw new AppError(404, 'Payment method was not found.', 'PAYMENT_METHOD_NOT_FOUND');
  return prisma.paymentMethod.findUniqueOrThrow({ where: { key } });
}

export async function deletePaymentMethod(key: string): Promise<void> {
  const result = await prisma.paymentMethod.deleteMany({ where: { key } });
  if (result.count === 0)
    throw new AppError(404, 'Payment method was not found.', 'PAYMENT_METHOD_NOT_FOUND');
}
