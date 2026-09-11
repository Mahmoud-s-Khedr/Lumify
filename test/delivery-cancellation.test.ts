import type { User } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/security/passwords.js';
import { prisma } from '../src/infrastructure/database/prisma.js';
import { api } from './http.js';

type Headers = { authorization: string };

describe('Phase 6 and 7 course-delivery and cancellation journeys', () => {
  const password = 'delivery-test-password';

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.courseReview.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.session.deleteMany();
    await prisma.roundMaterial.deleteMany();
    await prisma.roundSchedule.deleteMany();
    await prisma.courseRound.deleteMany();
    await prisma.courseImage.deleteMany();
    await prisma.course.deleteMany();
    await prisma.paymentMethod.deleteMany();
    await prisma.file.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.authToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function dateOffset(days: number): Date {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
  }

  async function createUser(email: string, role: 'ADMIN' | 'STUDENT' = 'STUDENT') {
    return prisma.user.create({
      data: {
        name: email.split('@')[0] ?? 'User',
        email,
        phone: '01000000000',
        passwordHash: await hashPassword(password),
        emailVerified: true,
        role,
      },
    });
  }

  async function login(user: User): Promise<Headers> {
    const response = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: user.email, password }),
    });
    expect(response.status).toBe(200);
    return { authorization: `Bearer ${response.body.accessToken}` };
  }

  async function fixture() {
    const [admin, student, outsider] = await Promise.all([
      createUser('admin@example.com', 'ADMIN'),
      createUser('student@example.com'),
      createUser('outsider@example.com'),
    ]);
    const [adminHeaders, studentHeaders, outsiderHeaders] = await Promise.all([
      login(admin),
      login(student),
      login(outsider),
    ]);
    const course = await prisma.course.create({
      data: { title: 'Course delivery', price: 800 },
    });
    return { admin, student, outsider, adminHeaders, studentHeaders, outsiderHeaders, course };
  }

  it('protects join details and refuses to add join URLs before the round starts', async () => {
    const { student, course, adminHeaders, studentHeaders, outsiderHeaders } = await fixture();
    const upcoming = await prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate: dateOffset(2),
        endDate: dateOffset(20),
        capacity: 10,
      },
    });

    const earlyUrl = await api(`/admin/rounds/${upcoming.id.toString()}/join`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ liveJoinUrl: 'https://meet.example.com/round' }),
    });
    expect(earlyUrl.status).toBe(409);
    expect(earlyUrl.body).toMatchObject({ error: 'ROUND_NOT_STARTED' });

    const instructions = await api(`/admin/rounds/${upcoming.id.toString()}/join`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ joiningInstructions: 'Use your registered name.' }),
    });
    expect(instructions.status).toBe(200);

    const publicRound = await api<Record<string, unknown>>(`/rounds/${upcoming.id.toString()}`);
    expect(JSON.stringify(publicRound.body)).not.toContain('joiningInstructions');
    expect(JSON.stringify(publicRound.body)).not.toContain('liveJoinUrl');

    await prisma.courseRound.update({
      where: { id: upcoming.id },
      data: { startDate: dateOffset(0) },
    });
    await prisma.booking.create({
      data: { studentId: student.id, roundId: upcoming.id, price: 800, status: 'CONFIRMED' },
    });
    const configured = await api<{
      join: {
        joiningInstructions: string;
        actions: { live: { url: string }; whatsapp: { url: string } };
      };
    }>(`/admin/rounds/${upcoming.id.toString()}/join`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({
        liveJoinUrl: 'https://meet.example.com/round',
        whatsappUrl: 'https://chat.whatsapp.com/example',
      }),
    });
    expect(configured.status).toBe(200);

    const joined = await api<typeof configured.body>(`/rounds/${upcoming.id.toString()}/join`, {
      headers: studentHeaders,
    });
    expect(joined.status).toBe(200);
    expect(joined.body.join).toMatchObject({
      joiningInstructions: 'Use your registered name.',
      actions: {
        live: { url: 'https://meet.example.com/round' },
        whatsapp: { url: 'https://chat.whatsapp.com/example' },
      },
    });
    const forbidden = await api(`/rounds/${upcoming.id.toString()}/join`, {
      headers: outsiderHeaders,
    });
    expect(forbidden.status).toBe(403);
  });

  it('manages sessions and preserves confirmed historical access after a round ends', async () => {
    const { student, course, adminHeaders, studentHeaders, outsiderHeaders } = await fixture();
    const finishedRound = await prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate: dateOffset(-20),
        endDate: dateOffset(-2),
        capacity: 10,
      },
    });
    await prisma.booking.create({
      data: { studentId: student.id, roundId: finishedRound.id, price: 800, status: 'CONFIRMED' },
    });

    const forbiddenCreate = await api(`/rounds/${finishedRound.id.toString()}/sessions`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ title: 'Session 1', sessionDate: '2026-08-01T18:00:00.000Z' }),
    });
    expect(forbiddenCreate.status).toBe(403);

    const created = await api<{ session: { id: string; recordingUrl: string } }>(
      `/rounds/${finishedRound.id.toString()}/sessions`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'Session 1',
          sessionDate: '2026-08-01T18:00:00.000Z',
          recordingUrl: 'https://video.example.com/one',
        }),
      },
    );
    expect(created.status).toBe(201);

    const updated = await api<{ session: { title: string; recordingUrl: string } }>(
      `/sessions/${created.body.session.id}`,
      {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ title: 'Session 1 recording', recordingUrl: 'https://vimeo.com/1' }),
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.session).toMatchObject({
      title: 'Session 1 recording',
      recordingUrl: 'https://vimeo.com/1',
    });

    const history = await api<{ sessions: Array<{ id: string }> }>(
      `/rounds/${finishedRound.id.toString()}/sessions`,
      { headers: studentHeaders },
    );
    expect(history.status).toBe(200);
    expect(history.body.sessions.map((session) => session.id)).toEqual([created.body.session.id]);
    const outsider = await api(`/rounds/${finishedRound.id.toString()}/sessions`, {
      headers: outsiderHeaders,
    });
    expect(outsider.status).toBe(403);

    const allSessions = await api<{ sessions: Array<{ id: string }> }>('/admin/sessions', {
      headers: adminHeaders,
    });
    expect(allSessions.body.sessions.map((session) => session.id)).toEqual([
      created.body.session.id,
    ]);
    const deleted = await api(`/sessions/${created.body.session.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(deleted.status).toBe(204);
  });

  it('retains access during cancellation review and removes it after completion', async () => {
    const { student, course, adminHeaders, studentHeaders } = await fixture();
    const round = await prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate: dateOffset(-1),
        endDate: dateOffset(20),
        capacity: 1,
        joiningInstructions: 'Welcome',
        liveJoinUrl: 'https://meet.example.com/live',
      },
    });
    const booking = await prisma.booking.create({
      data: { studentId: student.id, roundId: round.id, price: 800, status: 'CONFIRMED' },
    });
    await prisma.session.create({
      data: { roundId: round.id, title: 'Recording', sessionDate: new Date() },
    });

    const requested = await api<{
      booking: {
        status: string;
        cancellationReason: string;
        round: { confirmedBooked: number; emptySeats: number };
      };
    }>(`/bookings/${booking.id.toString()}/cancellation`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ reason: 'My schedule changed.' }),
    });
    expect(requested.status).toBe(200);
    expect(requested.body.booking).toMatchObject({
      status: 'CANCELLATION_REQUESTED',
      cancellationReason: 'My schedule changed.',
      round: { confirmedBooked: 0, emptySeats: 1 },
    });

    const stillHasJoinAccess = await api(`/rounds/${round.id.toString()}/join`, {
      headers: studentHeaders,
    });
    expect(stillHasJoinAccess.status).toBe(200);
    const stillHasSessionAccess = await api(`/rounds/${round.id.toString()}/sessions`, {
      headers: studentHeaders,
    });
    expect(stillHasSessionAccess.status).toBe(200);

    const queue = await api<{ bookings: Array<{ id: string; cancellationReason: string }> }>(
      '/admin/cancellations',
      { headers: adminHeaders },
    );
    expect(queue.status).toBe(200);
    expect(queue.body.bookings).toHaveLength(1);
    expect(queue.body.bookings[0]).toMatchObject({
      id: booking.id.toString(),
      cancellationReason: 'My schedule changed.',
    });

    const completed = await api<{
      booking: { status: string; adminNote: string; cancelledAt: string };
    }>(`/admin/bookings/${booking.id.toString()}/cancellation/complete`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ adminNote: 'Refunded by Instapay.' }),
    });
    expect(completed.status).toBe(200);
    expect(completed.body.booking).toMatchObject({
      status: 'CANCELLED',
      adminNote: 'Refunded by Instapay.',
    });
    expect(completed.body.booking.cancelledAt).toEqual(expect.any(String));

    const noJoinAccess = await api(`/rounds/${round.id.toString()}/join`, {
      headers: studentHeaders,
    });
    expect(noJoinAccess.status).toBe(403);
    const duplicateCompletion = await api(
      `/admin/bookings/${booking.id.toString()}/cancellation/complete`,
      { method: 'POST', headers: adminHeaders, body: JSON.stringify({}) },
    );
    expect(duplicateCompletion.status).toBe(409);
  });

  it('enforces cancellation eligibility from booking state, round state, and session count', async () => {
    const { student, outsider, course, studentHeaders, outsiderHeaders } = await fixture();
    const [upcoming, pending, inProgress, finished] = await Promise.all([
      prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: dateOffset(2),
          endDate: dateOffset(20),
          capacity: 10,
        },
      }),
      prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: dateOffset(-10),
          endDate: dateOffset(-2),
          capacity: 10,
        },
      }),
      prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: dateOffset(-1),
          endDate: dateOffset(20),
          capacity: 10,
        },
      }),
      prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: dateOffset(-20),
          endDate: dateOffset(-2),
          capacity: 10,
        },
      }),
    ]);
    const [upcomingBooking, pendingBooking, inProgressBooking, finishedBooking] = await Promise.all(
      [
        prisma.booking.create({
          data: { studentId: student.id, roundId: upcoming.id, price: 800, status: 'CONFIRMED' },
        }),
        prisma.booking.create({
          data: {
            studentId: student.id,
            roundId: pending.id,
            price: 800,
            status: 'PENDING_PAYMENT',
          },
        }),
        prisma.booking.create({
          data: {
            studentId: outsider.id,
            roundId: inProgress.id,
            price: 800,
            status: 'CONFIRMED',
          },
        }),
        prisma.booking.create({
          data: { studentId: student.id, roundId: finished.id, price: 800, status: 'CONFIRMED' },
        }),
      ],
    );
    await prisma.session.createMany({
      data: [
        { roundId: inProgress.id, title: 'Session 1', sessionDate: dateOffset(-1) },
        { roundId: inProgress.id, title: 'Session 2', sessionDate: dateOffset(0) },
      ],
    });

    const upcomingCancellation = await api<{ booking: { status: string } }>(
      `/bookings/${upcomingBooking.id.toString()}/cancellation`,
      {
        method: 'POST',
        headers: studentHeaders,
        body: JSON.stringify({ reason: 'Cannot attend.' }),
      },
    );
    expect(upcomingCancellation.status).toBe(200);
    expect(upcomingCancellation.body.booking.status).toBe('CANCELLATION_REQUESTED');

    const pendingCancellation = await api<{ booking: { status: string; cancelledAt: string } }>(
      `/bookings/${pendingBooking.id.toString()}/cancellation`,
      {
        method: 'POST',
        headers: studentHeaders,
        body: JSON.stringify({ reason: 'No longer needed.' }),
      },
    );
    expect(pendingCancellation.status).toBe(200);
    expect(pendingCancellation.body.booking).toMatchObject({ status: 'CANCELLED' });
    expect(pendingCancellation.body.booking.cancelledAt).toEqual(expect.any(String));

    const lateInProgressCancellation = await api(
      `/bookings/${inProgressBooking.id.toString()}/cancellation`,
      {
        method: 'POST',
        headers: outsiderHeaders,
        body: JSON.stringify({ reason: 'Cannot attend.' }),
      },
    );
    expect(lateInProgressCancellation.status).toBe(409);
    expect(lateInProgressCancellation.body).toMatchObject({ error: 'CANCELLATION_NOT_ALLOWED' });

    const finishedCancellation = await api(
      `/bookings/${finishedBooking.id.toString()}/cancellation`,
      {
        method: 'POST',
        headers: studentHeaders,
        body: JSON.stringify({ reason: 'Too late.' }),
      },
    );
    expect(finishedCancellation.status).toBe(409);
    expect(finishedCancellation.body).toMatchObject({ error: 'CANCELLATION_NOT_ALLOWED' });
  });
});
