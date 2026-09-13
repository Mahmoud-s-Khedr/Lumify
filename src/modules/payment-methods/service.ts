import { AppError } from '../../common/errors/app-error.js';
import {
  createPaymentMethodRecord,
  deletePaymentMethodRecord,
  findPaymentMethod,
  findPaymentMethods,
  updatePaymentMethodRecord,
} from './repository.js';
import type { CreatePaymentMethodInput, UpdatePaymentMethodInput } from './schemas.js';

export async function listPaymentMethods() {
  return findPaymentMethods();
}

export async function createPaymentMethod(input: CreatePaymentMethodInput) {
  try {
    return await createPaymentMethodRecord(input);
  } catch {
    throw new AppError(
      409,
      'A payment method with this key already exists.',
      'PAYMENT_METHOD_EXISTS',
    );
  }
}

export async function updatePaymentMethod(key: string, input: UpdatePaymentMethodInput) {
  const result = await updatePaymentMethodRecord(key, input);
  if (result.count === 0)
    throw new AppError(404, 'Payment method was not found.', 'PAYMENT_METHOD_NOT_FOUND');
  return findPaymentMethod(key);
}

export async function deletePaymentMethod(key: string): Promise<void> {
  const result = await deletePaymentMethodRecord(key);
  if (result.count === 0)
    throw new AppError(404, 'Payment method was not found.', 'PAYMENT_METHOD_NOT_FOUND');
}
