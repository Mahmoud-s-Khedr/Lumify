import type { CourseRound } from '@prisma/client';

import type { SessionWithRound } from './service.js';

export function publicSession(session: SessionWithRound) {
  return {
    id: session.id.toString(),
    round: {
      id: session.round.id.toString(),
      course: {
        id: session.round.course.id.toString(),
        title: session.round.course.title,
      },
    },
    title: session.title,
    sessionDate: session.sessionDate.toISOString(),
    recordingUrl: session.recordingUrl,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

export function publicJoinDetails(
  round: Pick<CourseRound, 'id' | 'joiningInstructions' | 'liveJoinUrl' | 'whatsappUrl'>,
) {
  return {
    roundId: round.id.toString(),
    joiningInstructions: round.joiningInstructions,
    actions: {
      live: round.liveJoinUrl ? { url: round.liveJoinUrl } : null,
      whatsapp: round.whatsappUrl ? { url: round.whatsappUrl } : null,
    },
  };
}
