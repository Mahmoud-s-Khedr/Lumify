import type { User } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/security/passwords.js';
import { prisma } from '../src/infrastructure/database/prisma.js';
import { api } from './http.js';

type Headers = { authorization: string };

describe('student course pages', () => {
  const password = 'student-course-pages-password';

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

  async function createRound(courseId: bigint, startOffset: number, endOffset: number) {
    return prisma.courseRound.create({
      data: {
        courseId,
        startDate: dateOffset(startOffset),
        endDate: dateOffset(endOffset),
        capacity: 10,
      },
    });
  }

  it('lists only accessible enrollments with filters, card metadata, and pagination', async () => {
    const [student, admin] = await Promise.all([
      createUser('Student'),
      createUser('Admin', 'ADMIN'),
    ]);
    const [inProgressCourse, upcomingCourse, finishedCourse, pendingCourse] = await Promise.all(
      ['In Progress', 'Upcoming Data', 'Finished Data', 'Pending Data'].map((title) =>
        prisma.course.create({ data: { title, price: 75 } }),
      ),
    );
    const [inProgress, upcoming, finished, pending] = await Promise.all([
      createRound(inProgressCourse.id, -2, 4),
      createRound(upcomingCourse.id, 2, 5),
      createRound(finishedCourse.id, -8, -2),
      createRound(pendingCourse.id, 1, 3),
    ]);
    await prisma.booking.createMany({
      data: [
        { studentId: student.id, roundId: inProgress.id, price: 75, status: 'CONFIRMED' },
        {
          studentId: student.id,
          roundId: upcoming.id,
          price: 75,
          status: 'CANCELLATION_REQUESTED',
        },
        { studentId: student.id, roundId: finished.id, price: 75, status: 'CONFIRMED' },
        { studentId: student.id, roundId: pending.id, price: 75, status: 'PENDING_REVIEW' },
      ],
    });
    const image = await prisma.file.create({
      data: {
        storageKey: 'course-images/student-course-page-image',
        originalName: 'course.png',
        mimeType: 'image/png',
        sizeBytes: 42,
      },
    });
    await prisma.courseImage.create({
      data: { courseId: upcomingCourse.id, fileId: image.id, sortOrder: 0 },
    });
    const next = await prisma.session.create({
      data: { roundId: inProgress.id, title: 'Next session', sessionDate: dateOffset(1) },
    });
    await prisma.session.createMany({
      data: [
        {
          roundId: upcoming.id,
          title: 'Future recording one',
          sessionDate: dateOffset(3),
          recordingUrl: 'https://video.example.com/future-one',
        },
        {
          roundId: upcoming.id,
          title: 'Future recording two',
          sessionDate: dateOffset(4),
          recordingUrl: 'https://video.example.com/future-two',
        },
        {
          roundId: finished.id,
          title: 'Finished recording',
          sessionDate: dateOffset(-4),
          recordingUrl: 'https://video.example.com/finished',
        },
      ],
    });

    expect((await api('/student/courses')).status).toBe(401);
    expect((await api('/student/courses', { headers: await login(admin) })).status).toBe(403);

    const headers = await login(student);
    const listed = await api<{
      courses: Array<{
        courseId: string;
        title: string;
        image: { id: string; downloadUrl: string } | null;
        roundId: string;
        state: string;
        nextSession: { id: string } | null;
        recordingCount: number;
      }>;
      pagination: { page: number; pageSize: number; total: number };
    }>('/student/courses', { headers });

    expect(listed.status).toBe(200);
    expect(listed.body.courses.map((course) => course.roundId)).toEqual([
      inProgress.id.toString(),
      upcoming.id.toString(),
      finished.id.toString(),
    ]);
    expect(listed.body.courses[0]).toMatchObject({
      courseId: inProgressCourse.id.toString(),
      image: null,
      state: 'IN_PROGRESS',
      nextSession: { id: next.id.toString() },
      recordingCount: 0,
    });
    expect(listed.body.courses[1]).toMatchObject({
      image: { id: image.id.toString(), downloadUrl: `/files/${image.id.toString()}/download` },
      state: 'UPCOMING',
      recordingCount: 2,
    });
    expect(listed.body.pagination).toEqual({ page: 1, pageSize: 20, total: 3 });

    const available = await api<{ courses: Array<{ roundId: string }> }>(
      '/student/courses?q=data&recordings=AVAILABLE&roundState=UPCOMING',
      { headers },
    );
    expect(available.body.courses.map((course) => course.roundId)).toEqual([
      upcoming.id.toString(),
    ]);

    const page = await api<{ courses: Array<{ roundId: string }>; pagination: { total: number } }>(
      '/student/courses?page=2&pageSize=1',
      { headers },
    );
    expect(page.body).toMatchObject({
      courses: [{ roundId: upcoming.id.toString() }],
      pagination: { total: 3 },
    });
  });

  it('returns an enrolled round page without protected delivery fields', async () => {
    const [student, otherStudent] = await Promise.all([createUser('Student'), createUser('Other')]);
    const course = await prisma.course.create({
      data: { title: 'Course detail', description: 'A complete description', price: 75 },
    });
    const round = await prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate: dateOffset(-2),
        endDate: dateOffset(3),
        capacity: 10,
        liveJoinUrl: 'https://meet.example.com/private',
        whatsappUrl: 'https://chat.whatsapp.com/private',
        joiningInstructions: 'Private instructions',
        schedules: { create: { weekday: 'MONDAY', startTime: new Date('1970-01-01T18:30:00Z') } },
      },
    });
    await prisma.booking.create({
      data: {
        studentId: student.id,
        roundId: round.id,
        price: 75,
        status: 'CANCELLATION_REQUESTED',
      },
    });
    const file = await prisma.file.create({
      data: {
        storageKey: 'round-materials/student-course-page-material',
        originalName: 'guide.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      },
    });
    await prisma.roundMaterial.createMany({
      data: [
        { roundId: round.id, title: 'Guide', fileId: file.id },
        {
          roundId: round.id,
          title: 'External reference',
          externalUrl: 'https://example.com/reference',
        },
      ],
    });
    const [later, earlier] = await Promise.all([
      prisma.session.create({
        data: { roundId: round.id, title: 'Later', sessionDate: dateOffset(2) },
      }),
      prisma.session.create({
        data: {
          roundId: round.id,
          title: 'Earlier',
          sessionDate: dateOffset(-1),
          recordingUrl: 'https://video.example.com/recording',
        },
      }),
    ]);

    const headers = await login(student);
    const response = await api<{
      course: { id: string; title: string; description: string | null };
      round: {
        id: string;
        state: string;
        schedules: Array<{ weekday: string; startTime: string }>;
      };
      sessions: Array<{ id: string; title: string; recordingUrl: string | null }>;
      materials: Array<{
        title: string;
        kind: string;
        file: { downloadUrl: string } | null;
        externalUrl: string | null;
      }>;
    }>(`/student/rounds/${round.id.toString()}`, { headers });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      course: {
        id: course.id.toString(),
        title: 'Course detail',
        description: 'A complete description',
      },
      round: { id: round.id.toString(), state: 'IN_PROGRESS' },
      sessions: [
        { id: earlier.id.toString(), title: 'Earlier' },
        { id: later.id.toString(), title: 'Later' },
      ],
      materials: [
        {
          title: 'Guide',
          kind: 'FILE',
          file: { downloadUrl: `/files/${file.id.toString()}/download` },
        },
        { title: 'External reference', kind: 'LINK', externalUrl: 'https://example.com/reference' },
      ],
    });
    expect(response.body.round.schedules).toMatchObject([
      { weekday: 'MONDAY', startTime: '18:30' },
    ]);
    expect(JSON.stringify(response.body)).not.toContain('meet.example.com');
    expect(JSON.stringify(response.body)).not.toContain('whatsapp.com');
    expect(JSON.stringify(response.body)).not.toContain('Private instructions');

    expect(
      (await api(`/student/rounds/${round.id.toString()}`, { headers: await login(otherStudent) }))
        .status,
    ).toBe(403);
    expect((await api('/student/rounds/999999999', { headers })).status).toBe(404);
  });
});
