import { calculateAvailableSeats } from '../../common/business/bookings.js';
import { publicFile } from '../files/presenter.js';
import type { MaterialWithFile, RoundWithDetails } from './service.js';

const weekdayOrder = new Map(
  ['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map(
    (weekday, index) => [weekday, index],
  ),
);

function publicSchedule(schedule: { id: bigint; weekday: string; startTime: Date }) {
  return {
    id: schedule.id.toString(),
    weekday: schedule.weekday,
    startTime: schedule.startTime.toISOString().slice(11, 16),
  };
}

export function publicRound(round: RoundWithDetails) {
  const confirmedBooked = round._count.bookings;
  const emptySeats = calculateAvailableSeats(round.capacity, confirmedBooked);
  return {
    id: round.id.toString(),
    course: { id: round.course.id.toString(), title: round.course.title },
    startDate: round.startDate.toISOString().slice(0, 10),
    endDate: round.endDate.toISOString().slice(0, 10),
    capacity: round.capacity,
    confirmedBooked,
    emptySeats,
    availability: emptySeats > 0 ? ('AVAILABLE' as const) : ('FULL' as const),
    schedules: round.schedules
      .sort(
        (left, right) =>
          (weekdayOrder.get(left.weekday) ?? 0) - (weekdayOrder.get(right.weekday) ?? 0),
      )
      .map(publicSchedule),
    createdAt: round.createdAt.toISOString(),
    updatedAt: round.updatedAt.toISOString(),
  };
}

export function publicMaterial(material: MaterialWithFile) {
  return {
    id: material.id.toString(),
    title: material.title,
    kind: material.file ? ('FILE' as const) : ('LINK' as const),
    file: material.file ? publicFile(material.file) : null,
    externalUrl: material.externalUrl,
    createdAt: material.createdAt.toISOString(),
  };
}
