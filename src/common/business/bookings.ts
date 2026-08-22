import type { BookingStatus } from '@prisma/client';

export type RoundState = 'UPCOMING' | 'IN_PROGRESS' | 'FINISHED';
export const courseAccessStatuses: BookingStatus[] = ['CONFIRMED', 'CANCELLATION_REQUESTED'];

const allowedTransitions: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING_PAYMENT: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['CONFIRMED', 'PAYMENT_REJECTED'],
  CONFIRMED: ['CANCELLATION_REQUESTED'],
  PAYMENT_REJECTED: ['PENDING_REVIEW'],
  CANCELLATION_REQUESTED: ['CANCELLED'],
  CANCELLED: [],
};

export function calculateAvailableSeats(capacity: number, confirmedBookings: number): number {
  return Math.max(capacity - confirmedBookings, 0);
}

export function calculateRoundState(
  round: { startDate: Date; endDate: Date },
  today: Date,
): RoundState {
  if (round.startDate > today) return 'UPCOMING';
  if (round.endDate < today) return 'FINISHED';
  return 'IN_PROGRESS';
}

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function hasCourseAccess(status: BookingStatus): boolean {
  return courseAccessStatuses.includes(status);
}
