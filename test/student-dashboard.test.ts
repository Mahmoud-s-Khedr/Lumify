import type { User } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/security/passwords.js';
import { prisma } from '../src/infrastructure/database/prisma.js';
import { api } from './http.js';

type Headers = { authorization: string };

describe('student dashboard', () => {
  const password = 'student-dashboard-password';

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
    date.setUTCDate(date.getUTCDate() + days);
    return date;
  }

  async function createUser(name: string, role: 'ADMIN' | 'STUDENT' = 'STUDENT'): Promise<User> {
    return prisma.user.create({
      data: {
        name,
        email: `${name.toLowerCase().replaceAll(' ', '-')}@example.com`,
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

  async function createCourse(title: string, price = 75, createdAt?: Date) {
    return prisma.course.create({ data: { title, price, createdAt } });
  }

  async function createRound(courseId: bigint, startOffset = -2, endOffset = 8) {
    return prisma.courseRound.create({
      data: {
        courseId,
        startDate: dateOffset(startOffset),
        endDate: dateOffset(endOffset),
        capacity: 10,
        liveJoinUrl: 'https://meet.example.com/private',
        whatsappUrl: 'https://chat.whatsapp.com/private',
      },
    });
  }

  it('returns a narrow dashboard response for an authenticated student', async () => {
    const student = await createUser('Sarah');
    const headers = await login(student);
    const enrolledCourse = await createCourse('Data Analysis Fundamentals', 100);
    const round = await createRound(enrolledCourse.id);
    await prisma.booking.create({
      data: { studentId: student.id, roundId: round.id, price: 100, status: 'CONFIRMED' },
    });
    const [past, next] = await Promise.all([
      prisma.session.create({
        data: {
          roundId: round.id,
          title: 'Session 03 — Data Cleaning Basics',
          sessionDate: dateOffset(-1),
          recordingUrl: 'https://video.example.com/recording',
        },
      }),
      prisma.session.create({
        data: {
          roundId: round.id,
          title: 'Session 04 — Data Cleaning',
          sessionDate: dateOffset(1),
        },
      }),
    ]);
    const recommendation = await createCourse('Excel for Data Analysis');

    const unauthenticated = await api('/student/dashboard');
    expect(unauthenticated.status).toBe(401);

    const response = await api<{
      user: { name: string };
      myRounds: Array<{
        roundId: string;
        courseId: string;
        courseTitle: string;
        nextSession: { id: string; title: string } | null;
      }>;
      recommendedCourses: Array<{ id: string; title: string; price: string; images: unknown[] }>;
      recentRecordings: Array<{ id: string; recordingUrl: string; round: { id: string } }>;
    }>('/student/dashboard', { headers });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      user: { name: 'Sarah' },
      myRounds: [
        {
          roundId: round.id.toString(),
          courseId: enrolledCourse.id.toString(),
          courseTitle: 'Data Analysis Fundamentals',
          state: 'IN_PROGRESS',
          nextSession: { id: next.id.toString(), title: 'Session 04 — Data Cleaning' },
        },
      ],
      recommendedCourses: [
        {
          id: recommendation.id.toString(),
          title: 'Excel for Data Analysis',
          price: '75.00',
          images: [],
        },
      ],
      recentRecordings: [
        {
          id: past.id.toString(),
          recordingUrl: 'https://video.example.com/recording',
          round: { id: round.id.toString() },
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain('meet.example.com');
    expect(JSON.stringify(response.body)).not.toContain('whatsapp.com');
  });

  it('excludes unconfirmed bookings from the student rounds', async () => {
    const student = await createUser('Student');
    const headers = await login(student);
    const [confirmedCourse, pendingCourse] = await Promise.all([
      createCourse('Confirmed course'),
      createCourse('Pending course'),
    ]);
    const [confirmedRound, pendingRound] = await Promise.all([
      createRound(confirmedCourse.id),
      createRound(pendingCourse.id),
    ]);
    await prisma.booking.createMany({
      data: [
        { studentId: student.id, roundId: confirmedRound.id, price: 75, status: 'CONFIRMED' },
        { studentId: student.id, roundId: pendingRound.id, price: 75, status: 'PENDING_REVIEW' },
      ],
    });

    const response = await api<{ myRounds: Array<{ roundId: string }> }>('/student/dashboard', {
      headers,
    });

    expect(response.status).toBe(200);
    expect(response.body.myRounds.map((round) => round.roundId)).toEqual([
      confirmedRound.id.toString(),
    ]);
  });

  it('does not recommend active courses in which the student is confirmed-enrolled', async () => {
    const student = await createUser('Student');
    const headers = await login(student);
    const enrolledCourse = await createCourse('Already enrolled');
    const enrolledRound = await createRound(enrolledCourse.id);
    await prisma.booking.create({
      data: { studentId: student.id, roundId: enrolledRound.id, price: 75, status: 'CONFIRMED' },
    });
    const oldDate = dateOffset(-10);
    const recommendations = await Promise.all(
      ['Old', 'One', 'Two', 'Three', 'Four'].map((title, index) =>
        createCourse(title, 75, new Date(oldDate.getTime() + index * 60_000)),
      ),
    );
    const archived = await createCourse('Archived');
    await prisma.course.update({ where: { id: archived.id }, data: { archived: true } });

    const response = await api<{ recommendedCourses: Array<{ id: string }> }>(
      '/student/dashboard',
      {
        headers,
      },
    );

    expect(response.status).toBe(200);
    expect(response.body.recommendedCourses.map((course) => course.id)).toEqual(
      recommendations
        .slice(1)
        .reverse()
        .map((course) => course.id.toString()),
    );
    expect(response.body.recommendedCourses.map((course) => course.id)).not.toContain(
      enrolledCourse.id.toString(),
    );
  });

  it('filters recent recordings to confirmed rounds and returns the newest three', async () => {
    const student = await createUser('Student');
    const headers = await login(student);
    const [confirmedCourse, pendingCourse] = await Promise.all([
      createCourse('Confirmed course'),
      createCourse('Pending course'),
    ]);
    const [confirmedRound, pendingRound] = await Promise.all([
      createRound(confirmedCourse.id),
      createRound(pendingCourse.id),
    ]);
    await prisma.booking.createMany({
      data: [
        { studentId: student.id, roundId: confirmedRound.id, price: 75, status: 'CONFIRMED' },
        { studentId: student.id, roundId: pendingRound.id, price: 75, status: 'PENDING_PAYMENT' },
      ],
    });
    const eligible = await Promise.all(
      [1, 2, 3, 4].map((daysAgo) =>
        prisma.session.create({
          data: {
            roundId: confirmedRound.id,
            title: `Eligible ${daysAgo}`,
            sessionDate: dateOffset(-daysAgo),
            recordingUrl: `https://video.example.com/${daysAgo}`,
          },
        }),
      ),
    );
    const [withoutRecording, futureRecording, pendingRecording] = await Promise.all([
      prisma.session.create({
        data: {
          roundId: confirmedRound.id,
          title: 'No recording',
          sessionDate: dateOffset(-1),
        },
      }),
      prisma.session.create({
        data: {
          roundId: confirmedRound.id,
          title: 'Future recording',
          sessionDate: dateOffset(1),
          recordingUrl: 'https://video.example.com/future',
        },
      }),
      prisma.session.create({
        data: {
          roundId: pendingRound.id,
          title: 'Pending recording',
          sessionDate: dateOffset(-1),
          recordingUrl: 'https://video.example.com/pending',
        },
      }),
    ]);

    const response = await api<{ recentRecordings: Array<{ id: string }> }>('/student/dashboard', {
      headers,
    });

    expect(response.status).toBe(200);
    expect(response.body.recentRecordings.map((recording) => recording.id)).toEqual(
      eligible.slice(0, 3).map((recording) => recording.id.toString()),
    );
    expect(response.body.recentRecordings.map((recording) => recording.id)).not.toContain(
      withoutRecording.id.toString(),
    );
    expect(response.body.recentRecordings.map((recording) => recording.id)).not.toContain(
      futureRecording.id.toString(),
    );
    expect(response.body.recentRecordings.map((recording) => recording.id)).not.toContain(
      pendingRecording.id.toString(),
    );
  });

  it('rejects administrators', async () => {
    const admin = await createUser('Admin', 'ADMIN');
    const response = await api('/student/dashboard', { headers: await login(admin) });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: 'FORBIDDEN' });
  });
});
