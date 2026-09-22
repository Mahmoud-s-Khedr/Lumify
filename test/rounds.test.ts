import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/security/passwords.js';
import { prisma } from '../src/infrastructure/database/prisma.js';
import { api } from './http.js';

describe('Phase 4 round, schedule, and material journeys', () => {
  const password = 'round-test-password';

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.courseReview.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.session.deleteMany();
    await prisma.roundMaterial.deleteMany();
    await prisma.roundSchedule.deleteMany();
    await prisma.roundOccurrence.deleteMany();
    await prisma.courseRound.deleteMany();
    await prisma.courseImage.deleteMany();
    await prisma.course.deleteMany();
    await prisma.file.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fixture() {
    const [admin, student, outsider] = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Admin',
          email: 'admin@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          name: 'Student',
          email: 'student@example.com',
          phone: '01000000000',
          passwordHash: await hashPassword(password),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Outsider',
          email: 'outsider@example.com',
          phone: '01111111111',
          passwordHash: await hashPassword(password),
          emailVerified: true,
        },
      }),
    ]);
    const course = await prisma.course.create({
      data: { title: 'Backend Engineering', price: 1500 },
    });
    const [adminLogin, studentLogin, outsiderLogin] = await Promise.all([
      api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: admin.email, password }),
      }),
      api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: student.email, password }),
      }),
      api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: outsider.email, password }),
      }),
    ]);
    return {
      admin,
      student,
      outsider,
      course,
      adminHeaders: { authorization: `Bearer ${adminLogin.body.accessToken}` },
      studentHeaders: { authorization: `Bearer ${studentLogin.body.accessToken}` },
      outsiderHeaders: { authorization: `Bearer ${outsiderLogin.body.accessToken}` },
    };
  }

  it('creates a round and supports different times for each weekday', async () => {
    const { course, adminHeaders, studentHeaders } = await fixture();
    const forbidden = await api(`/courses/${course.id.toString()}/rounds`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ startDate: '2026-09-01', endDate: '2026-10-01', capacity: 40 }),
    });
    expect(forbidden.status).toBe(403);

    const created = await api<{
      round: {
        id: string;
        capacity: number;
        schedules: Array<{
          id: string;
          weekday: string;
          startTime: string;
          endTime: string;
          endsNextDay: boolean;
        }>;
      };
    }>(`/courses/${course.id.toString()}/rounds`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        startDate: '2026-09-01',
        endDate: '2026-10-01',
        capacity: 40,
        schedules: [
          { weekday: 'SATURDAY', startTime: '14:00', endTime: '17:00' },
          { weekday: 'MONDAY', startTime: '16:00', endTime: '16:30' },
          { weekday: 'THURSDAY', startTime: '20:30', endTime: '00:00' },
        ],
      }),
    });
    expect(created.status).toBe(201);
    expect(
      created.body.round.schedules.map(({ weekday, startTime, endTime, endsNextDay }) => ({
        weekday,
        startTime,
        endTime,
        endsNextDay,
      })),
    ).toEqual([
      { weekday: 'SATURDAY', startTime: '14:00', endTime: '17:00', endsNextDay: false },
      { weekday: 'MONDAY', startTime: '16:00', endTime: '16:30', endsNextDay: false },
      { weekday: 'THURSDAY', startTime: '20:30', endTime: '00:00', endsNextDay: true },
    ]);

    const saturday = created.body.round.schedules[0]!;
    const modified = await api<{
      round: { schedules: Array<{ weekday: string; startTime: string; endTime: string }> };
    }>(`/rounds/${created.body.round.id}/schedules/${saturday.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ startTime: '15:30' }),
    });
    expect(modified.status).toBe(200);
    expect(modified.body.round.schedules[0]).toMatchObject({
      weekday: 'SATURDAY',
      startTime: '15:30',
      endTime: '17:00',
    });

    const capacity = await api<{ round: { capacity: number } }>(
      `/rounds/${created.body.round.id}`,
      {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ capacity: 50 }),
      },
    );
    expect(capacity.status).toBe(200);
    expect(capacity.body.round.capacity).toBe(50);

    const publicList = await api<{ rounds: Array<{ id: string }> }>(
      `/courses/${course.id.toString()}/rounds`,
    );
    expect(publicList.status).toBe(200);
    expect(publicList.body.rounds).toEqual([]);

    const adminList = await api<{ rounds: Array<{ id: string }> }>(
      `/courses/${course.id.toString()}/rounds?includeUnavailable=true`,
      { headers: adminHeaders },
    );
    expect(adminList.body.rounds.map((round) => round.id)).toEqual([created.body.round.id]);
  });

  it('uploads private material, adds a link, and permits material edits after enrollment', async () => {
    const { student, course, adminHeaders, studentHeaders, outsiderHeaders } = await fixture();
    const createdRound = await api<{ round: { id: string } }>(
      `/courses/${course.id.toString()}/rounds`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          startDate: '2026-09-01',
          endDate: '2026-10-01',
          capacity: 40,
          schedules: [{ weekday: 'SATURDAY', startTime: '14:00', endTime: '17:00' }],
        }),
      },
    );
    const roundId = createdRound.body.round.id;
    const permission = await api<{ storageKey: string; maxSizeBytes: number }>('/files/uploads', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        kind: 'ROUND_MATERIAL',
        originalName: 'lesson.pdf',
        mimeType: 'application/pdf',
      }),
    });
    expect(permission.status).toBe(201);
    expect(permission.body.maxSizeBytes).toBe(100 * 1024 * 1024);
    const completed = await api<{ file: { id: string } }>('/files/uploads/complete', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        kind: 'ROUND_MATERIAL',
        storageKey: permission.body.storageKey,
        originalName: 'lesson.pdf',
        mimeType: 'application/pdf',
      }),
    });
    expect(completed.status).toBe(201);

    const fileMaterial = await api<{ material: { id: string; file: { id: string } } }>(
      `/rounds/${roundId}/materials`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          kind: 'FILE',
          title: 'Lesson notes',
          fileId: completed.body.file.id,
        }),
      },
    );
    expect(fileMaterial.status).toBe(201);
    const linkMaterial = await api<{ material: { id: string } }>(`/rounds/${roundId}/materials`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        kind: 'LINK',
        title: 'Extra reading',
        externalUrl: 'https://example.com/reading',
      }),
    });
    expect(linkMaterial.status).toBe(201);

    const booking = await prisma.booking.create({
      data: {
        roundId: BigInt(roundId),
        studentId: student.id,
        price: 1500,
      },
    });
    const capacityUpdate = await api(`/rounds/${roundId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ capacity: 50 }),
    });
    expect(capacityUpdate.status).toBe(200);
    expect(capacityUpdate.body).toMatchObject({ round: { capacity: 50 } });
    const blockedDateUpdate = await api(`/rounds/${roundId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ endDate: '2026-11-01' }),
    });
    expect(blockedDateUpdate.status).toBe(409);
    expect(blockedDateUpdate.body).toMatchObject({ error: 'ROUND_HAS_BOOKINGS' });
    const scheduleUpdate = await api(`/rounds/${roundId}/schedules`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ weekday: 'TUESDAY', startTime: '18:00', endTime: '19:00' }),
    });
    expect(scheduleUpdate.status).toBe(201);
    const blockedDelete = await api(`/rounds/${roundId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(blockedDelete.status).toBe(409);

    const editedMaterial = await api(
      `/rounds/${roundId}/materials/${linkMaterial.body.material.id}`,
      {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({
          kind: 'LINK',
          title: 'Updated reading',
          externalUrl: 'https://example.com/updated',
        }),
      },
    );
    expect(editedMaterial.status).toBe(200);

    const pendingAccess = await api(`/rounds/${roundId}/materials`, {
      headers: studentHeaders,
    });
    expect(pendingAccess.status).toBe(403);
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } });
    const studentMaterials = await api<{ materials: unknown[] }>(`/rounds/${roundId}/materials`, {
      headers: studentHeaders,
    });
    expect(studentMaterials.status).toBe(200);
    expect(studentMaterials.body.materials).toHaveLength(2);
    const outsiderMaterials = await api(`/rounds/${roundId}/materials`, {
      headers: outsiderHeaders,
    });
    expect(outsiderMaterials.status).toBe(403);
    const studentDownload = await api(`/files/${completed.body.file.id}/download`, {
      headers: studentHeaders,
      redirect: 'manual',
    });
    expect(studentDownload.status).toBe(302);
    const outsiderDownload = await api(`/files/${completed.body.file.id}/download`, {
      headers: outsiderHeaders,
      redirect: 'manual',
    });
    expect(outsiderDownload.status).toBe(403);

    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
    const cancelledAccess = await api(`/rounds/${roundId}/materials`, { headers: studentHeaders });
    expect(cancelledAccess.status).toBe(403);
  });

  it('deletes an empty round and rejects invalid or overlapping schedules', async () => {
    const { course, adminHeaders } = await fixture();
    const invalidDates = await api(`/courses/${course.id.toString()}/rounds`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ startDate: '2026-10-02', endDate: '2026-10-01', capacity: 10 }),
    });
    expect(invalidDates.status).toBe(400);
    const zeroLengthSchedule = await api(`/courses/${course.id.toString()}/rounds`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        startDate: '2026-09-01',
        endDate: '2026-10-01',
        capacity: 10,
        schedules: [{ weekday: 'MONDAY', startTime: '10:00', endTime: '10:00' }],
      }),
    });
    expect(zeroLengthSchedule.status).toBe(400);
    const adjacentSchedules = await api(`/courses/${course.id.toString()}/rounds`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        startDate: '2026-09-01',
        endDate: '2026-10-01',
        capacity: 10,
        schedules: [
          { weekday: 'MONDAY', startTime: '10:00', endTime: '11:00' },
          { weekday: 'MONDAY', startTime: '12:00', endTime: '13:00' },
        ],
      }),
    });
    expect(adjacentSchedules.status).toBe(201);
    const overlappingSchedule = await api(`/courses/${course.id.toString()}/rounds`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        startDate: '2026-09-01',
        endDate: '2026-10-01',
        capacity: 10,
        schedules: [
          { weekday: 'MONDAY', startTime: '10:00', endTime: '11:00' },
          { weekday: 'MONDAY', startTime: '10:30', endTime: '12:00' },
        ],
      }),
    });
    expect(overlappingSchedule.status).toBe(409);

    const created = await api<{ round: { id: string } }>(
      `/courses/${course.id.toString()}/rounds`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          startDate: '2026-09-01',
          endDate: '2026-10-01',
          capacity: 10,
        }),
      },
    );
    const deleted = await api(`/rounds/${created.body.round.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(deleted.status).toBe(204);
    const missing = await api(`/rounds/${created.body.round.id}`);
    expect(missing.status).toBe(404);
  });

  it('manages custom UTC occurrences and atomically switches timetables after booking', async () => {
    const { course, student, adminHeaders } = await fixture();
    const created = await api<{
      round: {
        id: string;
        scheduleMode: string;
        schedules: unknown[];
        occurrences: Array<{ id: string; startAt: string; endAt: string }>;
      };
    }>(`/courses/${course.id.toString()}/rounds`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        startDate: '2027-10-01',
        endDate: '2027-10-02',
        capacity: 10,
        scheduleMode: 'CUSTOM',
        occurrences: [{ startAt: '2027-10-02T22:00:00Z', endAt: '2027-10-03T00:00:00Z' }],
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body.round).toMatchObject({
      scheduleMode: 'CUSTOM',
      schedules: [],
      occurrences: [{ startAt: '2027-10-02T22:00:00.000Z', endAt: '2027-10-03T00:00:00.000Z' }],
    });

    const occurrence = created.body.round.occurrences[0]!;
    const overlap = await api(`/rounds/${created.body.round.id}/occurrences`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ startAt: '2027-10-02T23:00:00Z', endAt: '2027-10-03T01:00:00Z' }),
    });
    expect(overlap.status).toBe(409);
    const nonUtc = await api(`/rounds/${created.body.round.id}/occurrences`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ startAt: '2027-10-02T10:00:00+02:00', endAt: '2027-10-02T11:00:00+02:00' }),
    });
    expect(nonUtc.status).toBe(400);
    const outsideRound = await api(`/rounds/${created.body.round.id}/occurrences`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ startAt: '2027-10-03T10:00:00Z', endAt: '2027-10-03T11:00:00Z' }),
    });
    expect(outsideRound.status).toBe(400);
    const edited = await api<{ round: { occurrences: Array<{ startAt: string }> } }>(
      `/rounds/${created.body.round.id}/occurrences/${occurrence.id}`,
      {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ startAt: '2027-10-02T21:30:00Z' }),
      },
    );
    expect(edited.status).toBe(200);
    expect(edited.body.round.occurrences[0]?.startAt).toBe('2027-10-02T21:30:00.000Z');
    const extra = await api<{ round: { occurrences: Array<{ id: string; startAt: string }> } }>(
      `/rounds/${created.body.round.id}/occurrences`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ startAt: '2027-10-01T10:00:00Z', endAt: '2027-10-01T11:00:00Z' }),
      },
    );
    expect(extra.status).toBe(201);
    const extraOccurrence = extra.body.round.occurrences.find(
      (item) => item.startAt === '2027-10-01T10:00:00.000Z',
    );
    const deletedOccurrence = await api(
      `/rounds/${created.body.round.id}/occurrences/${extraOccurrence?.id}`,
      { method: 'DELETE', headers: adminHeaders },
    );
    expect(deletedOccurrence.status).toBe(204);

    await prisma.booking.create({
      data: { roundId: BigInt(created.body.round.id), studentId: student.id, price: 1500 },
    });
    const switched = await api<{
      round: { scheduleMode: string; schedules: Array<{ weekday: string }>; occurrences: unknown[] };
    }>(`/rounds/${created.body.round.id}/schedule-mode`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({
        scheduleMode: 'WEEKLY',
        schedules: [
          { weekday: 'THURSDAY', startTime: '20:30', endTime: '00:00' },
          { weekday: 'FRIDAY', startTime: '00:00', endTime: '01:00' },
        ],
      }),
    });
    expect(switched.status).toBe(200);
    expect(switched.body.round).toMatchObject({
      scheduleMode: 'WEEKLY',
      occurrences: [],
      schedules: [{ weekday: 'THURSDAY' }, { weekday: 'FRIDAY' }],
    });

    const rejectedOverlap = await api(`/rounds/${created.body.round.id}/schedules`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ weekday: 'FRIDAY', startTime: '00:30', endTime: '02:00' }),
    });
    expect(rejectedOverlap.status).toBe(409);
    const adjacent = await api(`/rounds/${created.body.round.id}/schedules`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ weekday: 'FRIDAY', startTime: '01:00', endTime: '02:00' }),
    });
    expect(adjacent.status).toBe(201);
  });
});
