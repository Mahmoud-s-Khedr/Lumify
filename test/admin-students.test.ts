import type { User } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/security/passwords.js';
import { prisma } from '../src/infrastructure/database/prisma.js';
import { api } from './http.js';

type Headers = { authorization: string };

describe('admin student management', () => {
  const password = 'admin-student-test-password';

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

  async function createUser(
    name: string,
    email: string,
    role: 'ADMIN' | 'STUDENT' = 'STUDENT',
    phone = '01000000000',
  ): Promise<User> {
    return prisma.user.create({
      data: {
        name,
        email,
        phone,
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

  it('provides a safe searchable directory, student history, and filtered operational rosters', async () => {
    const [admin, alice, bob, unenrolled] = await Promise.all([
      createUser('Admin', 'admin@example.com', 'ADMIN'),
      createUser('Alice Ahmed', 'alice@example.com', 'STUDENT', '01012345678'),
      createUser('Bob Ibrahim', 'bob@example.com', 'STUDENT', '01112345678'),
      createUser('No Enrollments', 'new@example.com'),
    ]);
    const adminHeaders = await login(admin);
    const studentHeaders = await login(alice);
    const course = await prisma.course.create({ data: { title: 'Node.js', price: 1000 } });
    const otherCourse = await prisma.course.create({ data: { title: 'React', price: 800 } });
    const [firstRound, secondRound, otherRound] = await Promise.all([
      prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: new Date('2026-10-01'),
          endDate: new Date('2026-11-01'),
          capacity: 10,
        },
      }),
      prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: new Date('2026-12-01'),
          endDate: new Date('2027-01-01'),
          capacity: 10,
        },
      }),
      prisma.courseRound.create({
        data: {
          courseId: otherCourse.id,
          startDate: new Date('2026-10-01'),
          endDate: new Date('2026-11-01'),
          capacity: 10,
        },
      }),
    ]);
    await prisma.booking.createMany({
      data: [
        { studentId: alice.id, roundId: firstRound.id, price: 1000, status: 'CONFIRMED' },
        { studentId: alice.id, roundId: secondRound.id, price: 1000, status: 'PENDING_REVIEW' },
        { studentId: bob.id, roundId: firstRound.id, price: 1000, status: 'CANCELLED' },
        { studentId: bob.id, roundId: otherRound.id, price: 800, status: 'CONFIRMED' },
      ],
    });

    const unauthenticated = await api('/admin/students');
    expect(unauthenticated.status).toBe(401);
    const forbidden = await api('/admin/students', { headers: studentHeaders });
    expect(forbidden.status).toBe(403);

    const directory = await api<{
      students: Array<{
        id: string;
        name: string;
        enrollmentCount: number;
        confirmedEnrollmentCount: number;
        passwordHash?: string;
      }>;
      pagination: { total: number };
    }>('/admin/students?q=010123', { headers: adminHeaders });
    expect(directory.status).toBe(200);
    expect(directory.body.pagination.total).toBe(1);
    expect(directory.body.students).toHaveLength(1);
    expect(directory.body.students[0]).toMatchObject({
      id: alice.id.toString(),
      name: 'Alice Ahmed',
      enrollmentCount: 2,
      confirmedEnrollmentCount: 1,
    });
    expect(directory.body.students[0]).not.toHaveProperty('passwordHash');

    const paginated = await api<{ students: Array<{ id: string }>; pagination: { total: number } }>(
      '/admin/students?page=1&pageSize=1',
      { headers: adminHeaders },
    );
    expect(paginated.status).toBe(200);
    expect(paginated.body.students).toHaveLength(1);
    expect(paginated.body.pagination.total).toBe(3);

    const detail = await api<{
      student: { id: string; enrollmentCount: number; confirmedEnrollmentCount: number };
      bookings: Array<{ round: { id: string }; status: string }>;
    }>(`/admin/students/${alice.id.toString()}`, { headers: adminHeaders });
    expect(detail.status).toBe(200);
    expect(detail.body.student).toMatchObject({
      id: alice.id.toString(),
      enrollmentCount: 2,
      confirmedEnrollmentCount: 1,
    });
    expect(detail.body.bookings).toHaveLength(2);

    const notAStudent = await api<{ error: string }>(`/admin/students/${admin.id.toString()}`, {
      headers: adminHeaders,
    });
    expect(notAStudent.status).toBe(404);
    expect(notAStudent.body.error).toBe('STUDENT_NOT_FOUND');

    const courseRoster = await api<{
      bookings: Array<{ student: { id: string }; round: { id: string }; status: string }>;
      pagination: { total: number };
    }>(`/admin/courses/${course.id.toString()}/students`, { headers: adminHeaders });
    expect(courseRoster.status).toBe(200);
    expect(courseRoster.body.pagination.total).toBe(3);
    expect(courseRoster.body.bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          student: expect.objectContaining({ id: alice.id.toString() }),
          round: expect.objectContaining({ id: firstRound.id.toString() }),
        }),
        expect.objectContaining({
          student: expect.objectContaining({ id: alice.id.toString() }),
          round: expect.objectContaining({ id: secondRound.id.toString() }),
        }),
      ]),
    );

    const confirmedRoundRoster = await api<{
      bookings: Array<{ student: { id: string }; status: string }>;
      pagination: { total: number };
    }>(`/admin/rounds/${firstRound.id.toString()}/students?status=CONFIRMED&q=alice`, {
      headers: adminHeaders,
    });
    expect(confirmedRoundRoster.status).toBe(200);
    expect(confirmedRoundRoster.body.pagination.total).toBe(1);
    expect(confirmedRoundRoster.body.bookings).toEqual([
      expect.objectContaining({
        student: expect.objectContaining({ id: alice.id.toString() }),
        status: 'CONFIRMED',
      }),
    ]);

    const missingCourse = await api<{ error: string }>('/admin/courses/999999/students', {
      headers: adminHeaders,
    });
    expect(missingCourse.status).toBe(404);
    expect(missingCourse.body.error).toBe('COURSE_NOT_FOUND');
    expect(unenrolled.role).toBe('STUDENT');
  });
});
