import { calculateRoundState } from '../../common/business/bookings.js';
import { utcCalendarToday } from '../../common/dates/calendar.js';
import { publicFile } from '../files/presenter.js';
import type { StudentCourseBooking, StudentDashboard, StudentRound } from './service.js';

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function publicSchedule(schedule: { id: bigint; weekday: string; startTime: Date }) {
  return {
    id: schedule.id.toString(),
    weekday: schedule.weekday,
    startTime: schedule.startTime.toISOString().slice(11, 16),
  };
}

function publicMaterial(material: StudentRound['materials'][number]) {
  return {
    id: material.id.toString(),
    title: material.title,
    kind: material.file ? ('FILE' as const) : ('LINK' as const),
    file: material.file ? publicFile(material.file) : null,
    externalUrl: material.externalUrl,
    createdAt: material.createdAt.toISOString(),
  };
}

function publicNextSession(session: { id: bigint; title: string; sessionDate: Date } | null) {
  return session
    ? {
        id: session.id.toString(),
        title: session.title,
        sessionDate: session.sessionDate.toISOString(),
      }
    : null;
}

export function publicStudentCourse(booking: StudentCourseBooking, state: string) {
  const nextSession = booking.round.sessions[0] ?? null;
  const image = booking.round.course.images[0]?.file ?? null;
  return {
    courseId: booking.round.course.id.toString(),
    title: booking.round.course.title,
    image: image ? publicFile(image) : null,
    roundId: booking.round.id.toString(),
    startDate: dateOnly(booking.round.startDate),
    endDate: dateOnly(booking.round.endDate),
    state,
    nextSession: publicNextSession(nextSession),
    recordingCount: booking.round._count.sessions,
  };
}

export function publicStudentRound(round: StudentRound) {
  return {
    course: {
      id: round.course.id.toString(),
      title: round.course.title,
      description: round.course.description,
    },
    round: {
      id: round.id.toString(),
      startDate: dateOnly(round.startDate),
      endDate: dateOnly(round.endDate),
      state: calculateRoundState(round, utcCalendarToday()),
      schedules: round.schedules.map(publicSchedule),
    },
    sessions: round.sessions.map((session) => ({
      id: session.id.toString(),
      title: session.title,
      sessionDate: session.sessionDate.toISOString(),
      recordingUrl: session.recordingUrl,
    })),
    materials: round.materials.map(publicMaterial),
  };
}

export function publicStudentDashboard(dashboard: StudentDashboard) {
  return {
    user: dashboard.user,
    myRounds: dashboard.bookings.map((booking) => ({
      roundId: booking.round.id.toString(),
      courseId: booking.round.course.id.toString(),
      courseTitle: booking.round.course.title,
      startDate: dateOnly(booking.round.startDate),
      endDate: dateOnly(booking.round.endDate),
      state: calculateRoundState(booking.round, dashboard.today),
      nextSession: publicNextSession(booking.round.sessions[0] ?? null),
    })),
    recommendedCourses: dashboard.courses.map((course) => ({
      id: course.id.toString(),
      title: course.title,
      price: course.price.toFixed(2),
      images: course.images.map((image) => publicFile(image.file)),
    })),
    recentRecordings: dashboard.recordings.map((recording) => ({
      id: recording.id.toString(),
      title: recording.title,
      sessionDate: recording.sessionDate.toISOString(),
      recordingUrl: recording.recordingUrl!,
      round: {
        id: recording.round.id.toString(),
        course: {
          id: recording.round.course.id.toString(),
          title: recording.round.course.title,
        },
      },
    })),
  };
}
