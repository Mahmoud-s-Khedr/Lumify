import { calculateAvailableSeats, calculateRoundState } from '../../common/business/bookings.js';
import { utcCalendarToday } from '../../common/dates/calendar.js';
import { publicFile } from '../files/presenter.js';
import type { BookingWithDetails } from './service.js';

function srsBookingState(status: BookingWithDetails['status']) {
  if (status === 'PENDING_PAYMENT' || status === 'PENDING_REVIEW') return 'PENDING' as const;
  if (status === 'PAYMENT_REJECTED') return 'REJECTED' as const;
  if (status === 'CANCELLED') return 'CANCELLED' as const;
  return status;
}

function publicSchedule(schedule: { id: bigint; weekday: string; startTime: Date }) {
  return {
    id: schedule.id.toString(),
    weekday: schedule.weekday,
    startTime: schedule.startTime.toISOString().slice(11, 16),
  };
}

export function publicBooking(booking: BookingWithDetails, confirmedBooked: number) {
  const emptySeats = calculateAvailableSeats(booking.round.capacity, confirmedBooked);
  const paymentMethod =
    booking.paymentMethodSnapshot &&
    typeof booking.paymentMethodSnapshot === 'object' &&
    !Array.isArray(booking.paymentMethodSnapshot)
      ? booking.paymentMethodSnapshot
      : booking.paymentMethod;
  return {
    id: booking.id.toString(),
    student: {
      id: booking.student.id.toString(),
      name: booking.student.name,
      email: booking.student.email,
      phone: booking.student.phone,
      contactInfo: booking.student.contactInfo,
    },
    round: {
      id: booking.round.id.toString(),
      course: {
        id: booking.round.course.id.toString(),
        title: booking.round.course.title,
      },
      startDate: booking.round.startDate.toISOString().slice(0, 10),
      endDate: booking.round.endDate.toISOString().slice(0, 10),
      state: calculateRoundState(booking.round, utcCalendarToday()),
      capacity: booking.round.capacity,
      confirmedBooked,
      emptySeats,
      schedules: booking.round.schedules.map(publicSchedule),
    },
    price: booking.price.toFixed(2),
    status: booking.status,
    bookingState: srsBookingState(booking.status),
    paymentMethod,
    transactionReference: booking.transactionReference,
    receipt: booking.receiptFile ? publicFile(booking.receiptFile) : null,
    adminNote: booking.adminNote,
    reviewedAt: booking.reviewedAt?.toISOString() ?? null,
    cancellationReason: booking.cancellationReason,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}
