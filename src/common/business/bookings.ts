import type { BookingStatus } from '@prisma/client';

export type RoundState = 'UPCOMING' | 'IN_PROGRESS' | 'FINISHED';
export const courseAccessStatuses: BookingStatus[] = ['CONFIRMED', 'CANCELLATION_REQUESTED'];
const pendingBookingStatuses: BookingStatus[] = ['PENDING_PAYMENT', 'PENDING_REVIEW'];

const allowedTransitions: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING_PAYMENT: ['PENDING_REVIEW', 'CANCELLED'],
  PENDING_REVIEW: ['CONFIRMED', 'PAYMENT_REJECTED', 'CANCELLED'],
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

/**
 * Pending bookings can be cancelled immediately. Confirmed bookings require a refund request,
 * which is available before a round starts or before its second session during the round.
 */
export function canCancelBooking(
  status: BookingStatus,
  round: { startDate: Date; endDate: Date },
  sessionCount: number,
  today: Date,
): boolean {
  if (pendingBookingStatuses.includes(status)) return true;
  if (status !== 'CONFIRMED') return false;

  const roundState = calculateRoundState(round, today);
  return roundState === 'UPCOMING' || (roundState === 'IN_PROGRESS' && sessionCount < 2);
}

export function isPendingBooking(status: BookingStatus): boolean {
  return pendingBookingStatuses.includes(status);
}

export function hasCourseAccess(status: BookingStatus): boolean {
  return courseAccessStatuses.includes(status);
}
