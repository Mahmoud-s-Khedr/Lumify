import { describe, expect, it } from 'vitest';

import {
  calculateAvailableSeats,
  calculateRoundState,
  canTransitionBooking,
  hasCourseAccess,
} from '../src/common/business/bookings.js';

describe('booking and course-delivery business rules', () => {
  it('calculates available capacity without returning negative seats', () => {
    expect(calculateAvailableSeats(40, 15)).toBe(25);
    expect(calculateAvailableSeats(40, 40)).toBe(0);
    expect(calculateAvailableSeats(40, 41)).toBe(0);
  });

  it('calculates round state at date boundaries', () => {
    const today = new Date('2026-08-22T00:00:00.000Z');
    expect(
      calculateRoundState(
        {
          startDate: new Date('2026-08-23T00:00:00.000Z'),
          endDate: new Date('2026-08-30T00:00:00.000Z'),
        },
        today,
      ),
    ).toBe('UPCOMING');
    expect(
      calculateRoundState(
        {
          startDate: new Date('2026-08-22T00:00:00.000Z'),
          endDate: new Date('2026-08-22T00:00:00.000Z'),
        },
        today,
      ),
    ).toBe('IN_PROGRESS');
    expect(
      calculateRoundState(
        {
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          endDate: new Date('2026-08-21T00:00:00.000Z'),
        },
        today,
      ),
    ).toBe('FINISHED');
  });

  it('allows only the supported booking transitions', () => {
    expect(canTransitionBooking('PENDING_PAYMENT', 'PENDING_REVIEW')).toBe(true);
    expect(canTransitionBooking('PENDING_REVIEW', 'CONFIRMED')).toBe(true);
    expect(canTransitionBooking('PENDING_REVIEW', 'PAYMENT_REJECTED')).toBe(true);
    expect(canTransitionBooking('PAYMENT_REJECTED', 'PENDING_REVIEW')).toBe(true);
    expect(canTransitionBooking('CONFIRMED', 'CANCELLATION_REQUESTED')).toBe(true);
    expect(canTransitionBooking('CANCELLATION_REQUESTED', 'CANCELLED')).toBe(true);
    expect(canTransitionBooking('CANCELLED', 'CONFIRMED')).toBe(false);
    expect(canTransitionBooking('PENDING_PAYMENT', 'CONFIRMED')).toBe(false);
  });

  it('retains course access until cancellation is completed', () => {
    expect(hasCourseAccess('CONFIRMED')).toBe(true);
    expect(hasCourseAccess('CANCELLATION_REQUESTED')).toBe(true);
    expect(hasCourseAccess('CANCELLED')).toBe(false);
    expect(hasCourseAccess('PENDING_REVIEW')).toBe(false);
  });
});
