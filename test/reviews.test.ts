import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/security/passwords.js';
import { prisma } from '../src/infrastructure/database/prisma.js';
import { api } from './http.js';

describe('Course reviews and rating discovery', () => {
  const password = 'review-test-password';

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.courseReview.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.roundSchedule.deleteMany();
    await prisma.courseRound.deleteMany();
    await prisma.course.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createUser(email: string, role: 'ADMIN' | 'STUDENT' = 'STUDENT') {
    return prisma.user.create({
      data: {
        name: email.split('@')[0] ?? 'User',
        email,
        phone: role === 'STUDENT' ? '01000000000' : null,
        passwordHash: await hashPassword(password),
        emailVerified: true,
        role,
      },
    });
  }

  async function headersFor(email: string) {
    const login = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return { authorization: `Bearer ${login.body.accessToken}` };
  }

  async function confirmedEnrollment(studentId: bigint, courseId: bigint) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() + 7);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 14);
    const round = await prisma.courseRound.create({
      data: { courseId, startDate: start, endDate: end, capacity: 10 },
    });
    await prisma.booking.create({
      data: { studentId, roundId: round.id, price: 100, status: 'CONFIRMED' },
    });
  }

  it('moderates confirmed-student reviews and exposes approved ratings only', async () => {
    const [admin, student, outsider] = await Promise.all([
      createUser('admin@example.com', 'ADMIN'),
      createUser('student@example.com'),
      createUser('outsider@example.com'),
    ]);
    const course = await prisma.course.create({ data: { title: 'Reviews', price: 100 } });
    await confirmedEnrollment(student.id, course.id);
    const [adminHeaders, studentHeaders, outsiderHeaders] = await Promise.all([
      headersFor(admin.email),
      headersFor(student.email),
      headersFor(outsider.email),
    ]);

    const ineligible = await api(`/courses/${course.id.toString()}/reviews`, {
      method: 'POST',
      headers: outsiderHeaders,
      body: JSON.stringify({ rating: 5, comment: 'Great course.' }),
    });
    expect(ineligible.body).toMatchObject({ error: 'REVIEW_NOT_ELIGIBLE' });

    const submitted = await api<{ review: { id: string; status: string } }>(
      `/courses/${course.id.toString()}/reviews`,
      {
        method: 'POST',
        headers: studentHeaders,
        body: JSON.stringify({ rating: 5, comment: 'Great course.' }),
      },
    );
    expect(submitted.status).toBe(201);
    expect(submitted.body.review.status).toBe('PENDING');

    const duplicate = await api(`/courses/${course.id.toString()}/reviews`, {
      method: 'POST',
      headers: studentHeaders,
      body: JSON.stringify({ rating: 5, comment: 'Duplicate.' }),
    });
    expect(duplicate.body).toMatchObject({ error: 'DUPLICATE_REVIEW' });

    const hidden = await api<{ reviews: unknown[] }>(`/courses/${course.id.toString()}/reviews`);
    expect(hidden.body.reviews).toEqual([]);

    const approved = await api<{ review: { status: string; adminNote: string | null } }>(
      `/admin/reviews/${submitted.body.review.id}/approve`,
      { method: 'POST', headers: adminHeaders, body: JSON.stringify({ adminNote: 'Verified.' }) },
    );
    expect(approved.body.review).toMatchObject({ status: 'APPROVED', adminNote: 'Verified.' });

    const published = await api<{ reviews: Array<{ rating: number }> }>(
      `/courses/${course.id.toString()}/reviews?page=1&pageSize=1`,
    );
    expect(published.body.reviews).toEqual([expect.objectContaining({ rating: 5 })]);
    expect(published.body.pagination).toMatchObject({ total: 1 });

    const detail = await api<{ course: { averageRating: number | null; reviewCount: number } }>(
      `/courses/${course.id.toString()}`,
    );
    expect(detail.body.course).toMatchObject({ averageRating: 5, reviewCount: 1 });

    const rejected = await api<{ review: { status: string; adminNote: string | null } }>(
      `/courses/${course.id.toString()}/reviews/me`,
      {
        method: 'PATCH',
        headers: studentHeaders,
        body: JSON.stringify({ rating: 3, comment: 'Updated review.' }),
      },
    );
    expect(rejected.body.review.status).toBe('PENDING');
    const rejection = await api<{ review: { status: string; adminNote: string | null } }>(
      `/admin/reviews/${submitted.body.review.id}/reject`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ adminNote: 'Please clarify.' }),
      },
    );
    expect(rejection.body.review).toMatchObject({
      status: 'REJECTED',
      adminNote: 'Please clarify.',
    });

    const resubmitted = await api<{ review: { status: string; adminNote: string | null } }>(
      `/courses/${course.id.toString()}/reviews/me`,
      {
        method: 'PATCH',
        headers: studentHeaders,
        body: JSON.stringify({ rating: 4, comment: 'Clarified review.' }),
      },
    );
    expect(resubmitted.body.review).toMatchObject({ status: 'PENDING', adminNote: null });
  });

  it('filters and sorts catalogue courses by approved ratings with unrated courses last', async () => {
    const student = await createUser('student@example.com');
    const [high, low, unrated] = await Promise.all([
      prisma.course.create({ data: { title: 'High', price: 100 } }),
      prisma.course.create({ data: { title: 'Low', price: 100 } }),
      prisma.course.create({ data: { title: 'Unrated', price: 100 } }),
    ]);
    await prisma.courseReview.createMany({
      data: [
        {
          courseId: high.id,
          studentId: student.id,
          rating: 5,
          comment: 'Five',
          status: 'APPROVED',
        },
        { courseId: low.id, studentId: student.id, rating: 2, comment: 'Two', status: 'APPROVED' },
      ],
    });

    const descending = await api<{ courses: Array<{ id: string }> }>('/courses?sort=rating_desc');
    expect(descending.body.courses.map((course) => course.id)).toEqual([
      high.id.toString(),
      low.id.toString(),
      unrated.id.toString(),
    ]);
    const ascending = await api<{ courses: Array<{ id: string }> }>('/courses?sort=rating_asc');
    expect(ascending.body.courses.map((course) => course.id)).toEqual([
      low.id.toString(),
      high.id.toString(),
      unrated.id.toString(),
    ]);
    const filtered = await api<{ courses: Array<{ id: string }> }>('/courses?minRating=4');
    expect(filtered.body.courses.map((course) => course.id)).toEqual([high.id.toString()]);
  });
});
