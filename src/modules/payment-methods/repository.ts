import { prisma } from '../../infrastructure/database/prisma.js';
import type { CreatePaymentMethodInput, UpdatePaymentMethodInput } from './schemas.js';

export function findPaymentMethods() {
  return prisma.paymentMethod.findMany({ orderBy: { key: 'asc' } });
}

export function createPaymentMethodRecord(input: CreatePaymentMethodInput) {
  return prisma.paymentMethod.create({ data: input });
}

export function updatePaymentMethodRecord(key: string, input: UpdatePaymentMethodInput) {
  return prisma.paymentMethod.updateMany({ where: { key }, data: input });
}

export function findPaymentMethod(key: string) {
  return prisma.paymentMethod.findUniqueOrThrow({ where: { key } });
}

export function deletePaymentMethodRecord(key: string) {
  return prisma.paymentMethod.deleteMany({ where: { key } });
}
