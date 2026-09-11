import type { BookingStatus, User } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/security/passwords.js';
import { prisma } from '../src/infrastructure/database/prisma.js';
import { api } from './http.js';

type Headers = { authorization: string };

type PublicBooking = {
  id: string;
  price: string;
  status: BookingStatus;
  bookingState: string;
  paymentMethod: { key: string; value: string; description?: string } | null;
  transactionReference: string | null;
  receipt: { id: string; mimeType: string; downloadUrl: string } | null;
  adminNote: string | null;
  round: {
    id: string;
    state: 'UPCOMING' | 'IN_PROGRESS' | 'FINISHED';
    capacity: number;
    confirmedBooked: number;
    emptySeats: number;
  };
};

describe('Phase 5 booking and manual-payment journeys', () => {
  const password = 'booking-test-password';

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

  async function createUser(
    email: string,
    options: { role?: 'ADMIN' | 'STUDENT'; phone?: string | null } = {},
  ): Promise<User> {
    return prisma.user.create({
      data: {
        name: email.split('@')[0] ?? 'User',
        email,
        phone: options.phone === undefined ? '01000000000' : options.phone,
        passwordHash: await hashPassword(password),
        emailVerified: true,
        role: options.role ?? 'STUDENT',
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

  async function createCourseAndRound(capacity = 1) {
    const course = await prisma.course.create({
      data: { title: 'Manual Payments', price: 1000 },
    });
    const round = await prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate: dateOffset(10),
        endDate: dateOffset(40),
        capacity,
      },
    });
    return { course, round };
  }

  async function uploadReceipt(
    headers: Headers,
    originalName: string,
    mimeType = 'image/png',
  ): Promise<string> {
    const permission = await api<{ storageKey: string; maxSizeBytes: number }>('/files/uploads', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        kind: 'PAYMENT_RECEIPT',
        originalName,
        mimeType,
      }),
    });
    expect(permission.status).toBe(201);
    expect(permission.body.maxSizeBytes).toBe(10 * 1024 * 1024);

    const completed = await api<{ file: { id: string } }>('/files/uploads/complete', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        kind: 'PAYMENT_RECEIPT',
        storageKey: permission.body.storageKey,
        originalName,
        mimeType,
      }),
    });
    expect(completed.status).toBe(201);
    return completed.body.file.id;
  }

  it('enforces booking rules while pending requests do not consume capacity', async () => {
    const [admin, studentA, studentB, studentC, studentWithoutPhone] = await Promise.all([
      createUser('admin@example.com', { role: 'ADMIN' }),
      createUser('student-a@example.com'),
      createUser('student-b@example.com'),
      createUser('student-c@example.com'),
      createUser('no-phone@example.com', { phone: null }),
    ]);
    const [adminHeaders, studentAHeaders, studentBHeaders, studentCHeaders, noPhoneHeaders] =
      await Promise.all([
        login(admin),
        login(studentA),
        login(studentB),
        login(studentC),
        login(studentWithoutPhone),
      ]);
    const { course, round } = await createCourseAndRound(2);

    const startedRound = await prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate: dateOffset(0),
        endDate: dateOffset(5),
        capacity: 5,
      },
    });
    const startedBooking = await api(`/rounds/${startedRound.id.toString()}/bookings`, {
      method: 'POST',
      headers: studentAHeaders,
    });
    expect(startedBooking.status).toBe(409);
    expect(startedBooking.body).toMatchObject({ error: 'ROUND_ALREADY_STARTED' });

    const capacityBeforeEnrollment = await api<{ round: { capacity: number } }>(
      `/rounds/${round.id.toString()}`,
      {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ capacity: 1 }),
      },
    );
    expect(capacityBeforeEnrollment.status).toBe(200);
    expect(capacityBeforeEnrollment.body.round.capacity).toBe(1);

    const missingPhone = await api(`/rounds/${round.id.toString()}/bookings`, {
      method: 'POST',
      headers: noPhoneHeaders,
    });
    expect(missingPhone.status).toBe(400);
    expect(missingPhone.body).toMatchObject({ error: 'PHONE_REQUIRED' });

    const bookedA = await api<{ booking: PublicBooking }>(
      `/rounds/${round.id.toString()}/bookings`,
      { method: 'POST', headers: studentAHeaders },
    );
    expect(bookedA.status).toBe(201);
    expect(bookedA.body.booking).toMatchObject({
      price: '1000.00',
      status: 'PENDING_PAYMENT',
      round: { confirmedBooked: 0, emptySeats: 1 },
    });

    await prisma.course.update({ where: { id: course.id }, data: { price: 1500 } });
    const bookedB = await api<{ booking: PublicBooking }>(
      `/rounds/${round.id.toString()}/bookings`,
      { method: 'POST', headers: studentBHeaders },
    );
    expect(bookedB.status).toBe(201);
    expect(bookedB.body.booking.price).toBe('1500.00');

    const studentAList = await api<{ bookings: PublicBooking[] }>('/bookings', {
      headers: studentAHeaders,
    });
    expect(studentAList.body.bookings[0]?.price).toBe('1000.00');

    const duplicate = await api(`/rounds/${round.id.toString()}/bookings`, {
      method: 'POST',
      headers: studentAHeaders,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ error: 'DUPLICATE_BOOKING' });

    const capacityAfterEnrollment = await api(`/rounds/${round.id.toString()}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ capacity: 2 }),
    });
    expect(capacityAfterEnrollment.status).toBe(200);
    expect(capacityAfterEnrollment.body).toMatchObject({ round: { capacity: 2 } });

    await prisma.booking.updateMany({
      where: {
        id: { in: [BigInt(bookedA.body.booking.id), BigInt(bookedB.body.booking.id)] },
      },
      data: { status: 'CONFIRMED' },
    });
    const lowerCapacity = await api(`/rounds/${round.id.toString()}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ capacity: 1 }),
    });
    expect(lowerCapacity.status).toBe(200);
    expect(lowerCapacity.body).toMatchObject({ round: { capacity: 1 } });
    expect(await prisma.booking.count({ where: { roundId: round.id, status: 'CONFIRMED' } })).toBe(
      2,
    );
    const full = await api(`/rounds/${round.id.toString()}/bookings`, {
      method: 'POST',
      headers: studentCHeaders,
    });
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ error: 'ROUND_FULL' });
  });

  it('submits private receipt evidence, preserves payment details, and supports rejection and resubmission', async () => {
    const [admin, student, outsider] = await Promise.all([
      createUser('admin@example.com', { role: 'ADMIN' }),
      createUser('student@example.com'),
      createUser('outsider@example.com'),
    ]);
    const [adminHeaders, studentHeaders, outsiderHeaders] = await Promise.all([
      login(admin),
      login(student),
      login(outsider),
    ]);
    const { round } = await createCourseAndRound(3);
    await prisma.paymentMethod.create({
      data: {
        key: 'INSTAPAY',
        value: 'instapay-old@example.com',
        description: 'Send the payment to this Instapay account.',
      },
    });

    const booked = await api<{ booking: PublicBooking }>(
      `/rounds/${round.id.toString()}/bookings`,
      { method: 'POST', headers: studentHeaders },
    );
    const firstReceiptId = await uploadReceipt(
      studentHeaders,
      'first-receipt.pdf',
      'application/pdf',
    );
    const submitted = await api<{ booking: PublicBooking }>(
      `/bookings/${booked.body.booking.id}/payment`,
      {
        method: 'POST',
        headers: studentHeaders,
        body: JSON.stringify({
          paymentMethodKey: 'INSTAPAY',
          receiptFileId: firstReceiptId,
          transactionReference: 'TX-OLD-001',
        }),
      },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.booking).toMatchObject({
      status: 'PENDING_REVIEW',
      paymentMethod: {
        key: 'INSTAPAY',
        value: 'instapay-old@example.com',
        description: 'Send the payment to this Instapay account.',
      },
      transactionReference: 'TX-OLD-001',
      receipt: { id: firstReceiptId, mimeType: 'application/pdf' },
    });

    await prisma.paymentMethod.update({
      where: { key: 'INSTAPAY' },
      data: {
        value: 'instapay-new@example.com',
        description: 'Use the updated Instapay account.',
      },
    });
    const adminPending = await api<{ bookings: PublicBooking[] }>(
      '/admin/bookings?bookingState=PENDING',
      { headers: adminHeaders },
    );
    expect(adminPending.status).toBe(200);
    expect(adminPending.body.bookings).toHaveLength(1);
    expect(adminPending.body.bookings[0]).toMatchObject({
      paymentMethod: {
        key: 'INSTAPAY',
        value: 'instapay-old@example.com',
        description: 'Send the payment to this Instapay account.',
      },
      transactionReference: 'TX-OLD-001',
      round: { capacity: 3, confirmedBooked: 0, emptySeats: 3 },
    });

    const ownerDownload = await api(submitted.body.booking.receipt!.downloadUrl, {
      headers: studentHeaders,
      redirect: 'manual',
    });
    expect(ownerDownload.status).toBe(302);
    const adminDownload = await api(submitted.body.booking.receipt!.downloadUrl, {
      headers: adminHeaders,
      redirect: 'manual',
    });
    expect(adminDownload.status).toBe(302);
    const forbiddenDownload = await api(submitted.body.booking.receipt!.downloadUrl, {
      headers: outsiderHeaders,
      redirect: 'manual',
    });
    expect(forbiddenDownload.status).toBe(403);

    const rejected = await api<{ booking: PublicBooking }>(
      `/admin/bookings/${booked.body.booking.id}/reject`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ adminNote: 'Transaction was not found.' }),
      },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.booking).toMatchObject({
      status: 'PAYMENT_REJECTED',
      bookingState: 'REJECTED',
      adminNote: 'Transaction was not found.',
    });

    const rejectedList = await api<{ bookings: PublicBooking[] }>(
      '/admin/bookings?bookingState=REJECTED',
      { headers: adminHeaders },
    );
    expect(rejectedList.body.bookings.map((item) => item.id)).toEqual([booked.body.booking.id]);

    const secondReceiptId = await uploadReceipt(studentHeaders, 'second-receipt.png');
    const resubmitted = await api<{ booking: PublicBooking }>(
      `/bookings/${booked.body.booking.id}/payment`,
      {
        method: 'POST',
        headers: studentHeaders,
        body: JSON.stringify({
          paymentMethodKey: 'INSTAPAY',
          receiptFileId: secondReceiptId,
          transactionReference: null,
        }),
      },
    );
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.booking).toMatchObject({
      status: 'PENDING_REVIEW',
      paymentMethod: {
        key: 'INSTAPAY',
        value: 'instapay-new@example.com',
        description: 'Use the updated Instapay account.',
      },
      transactionReference: null,
      receipt: { id: secondReceiptId },
      adminNote: null,
    });

    const approved = await api<{ booking: PublicBooking }>(
      `/admin/bookings/${booked.body.booking.id}/approve`,
      { method: 'POST', headers: adminHeaders, body: JSON.stringify({}) },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.booking).toMatchObject({
      status: 'CONFIRMED',
      round: { confirmedBooked: 1, emptySeats: 2 },
    });
  });

  it('filters student and admin lists by mapped booking state and calculated round state', async () => {
    const [admin, student] = await Promise.all([
      createUser('admin@example.com', { role: 'ADMIN' }),
      createUser('student@example.com'),
    ]);
    const [adminHeaders, studentHeaders] = await Promise.all([login(admin), login(student)]);
    const course = await prisma.course.create({ data: { title: 'Filtering', price: 500 } });
    const rounds = await Promise.all([
      prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: dateOffset(10),
          endDate: dateOffset(20),
          capacity: 5,
        },
      }),
      prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: dateOffset(30),
          endDate: dateOffset(40),
          capacity: 5,
        },
      }),
      prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: dateOffset(-2),
          endDate: dateOffset(2),
          capacity: 5,
        },
      }),
      prisma.courseRound.create({
        data: {
          courseId: course.id,
          startDate: dateOffset(-20),
          endDate: dateOffset(-10),
          capacity: 5,
        },
      }),
    ]);
    await prisma.booking.createMany({
      data: [
        { studentId: student.id, roundId: rounds[0]!.id, price: 500 },
        {
          studentId: student.id,
          roundId: rounds[1]!.id,
          price: 500,
          status: 'PAYMENT_REJECTED',
        },
        {
          studentId: student.id,
          roundId: rounds[2]!.id,
          price: 500,
          status: 'PENDING_REVIEW',
        },
        {
          studentId: student.id,
          roundId: rounds[3]!.id,
          price: 500,
          status: 'CANCELLED',
        },
      ],
    });

    const pending = await api<{ bookings: PublicBooking[] }>('/bookings?bookingState=PENDING', {
      headers: studentHeaders,
    });
    expect(pending.body.bookings.map((booking) => booking.status).sort()).toEqual([
      'PENDING_PAYMENT',
      'PENDING_REVIEW',
    ]);

    const rejected = await api<{ bookings: PublicBooking[] }>('/bookings?bookingState=REJECTED', {
      headers: studentHeaders,
    });
    expect(rejected.body.bookings).toHaveLength(1);
    expect(rejected.body.bookings[0]?.status).toBe('PAYMENT_REJECTED');

    const upcoming = await api<{ bookings: PublicBooking[] }>('/bookings?roundState=UPCOMING', {
      headers: studentHeaders,
    });
    expect(upcoming.body.bookings).toHaveLength(2);
    expect(upcoming.body.bookings.every((booking) => booking.round.state === 'UPCOMING')).toBe(
      true,
    );

    const combined = await api<{ bookings: PublicBooking[] }>(
      '/bookings?bookingState=PENDING&roundState=UPCOMING',
      { headers: studentHeaders },
    );
    expect(combined.body.bookings).toHaveLength(1);
    expect(combined.body.bookings[0]).toMatchObject({
      status: 'PENDING_PAYMENT',
      round: { state: 'UPCOMING' },
    });

    const finishedCancelled = await api<{ bookings: PublicBooking[] }>(
      '/bookings?bookingState=CANCELLED&roundState=FINISHED',
      { headers: studentHeaders },
    );
    expect(finishedCancelled.body.bookings).toHaveLength(1);
    expect(finishedCancelled.body.bookings[0]).toMatchObject({
      status: 'CANCELLED',
      round: { state: 'FINISHED' },
    });

    const adminRejected = await api<{ bookings: PublicBooking[] }>(
      '/admin/bookings?bookingState=REJECTED',
      { headers: adminHeaders },
    );
    expect(adminRejected.body.bookings).toHaveLength(1);
    expect(adminRejected.body.bookings[0]?.status).toBe('PAYMENT_REJECTED');

    const adminCancelled = await api<{ bookings: PublicBooking[] }>(
      '/admin/bookings?bookingState=CANCELLED',
      { headers: adminHeaders },
    );
    expect(adminCancelled.body.bookings).toHaveLength(1);
    expect(adminCancelled.body.bookings[0]?.status).toBe('CANCELLED');
  });

  it('protects the final seat in sequential and simultaneous approvals', async () => {
    const [admin, studentA, studentB, studentC, studentD] = await Promise.all([
      createUser('admin@example.com', { role: 'ADMIN' }),
      createUser('student-a@example.com'),
      createUser('student-b@example.com'),
      createUser('student-c@example.com'),
      createUser('student-d@example.com'),
    ]);
    const adminHeaders = await login(admin);
    const { course, round: sequentialRound } = await createCourseAndRound(1);
    const simultaneousRound = await prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate: dateOffset(10),
        endDate: dateOffset(40),
        capacity: 1,
      },
    });
    const bookings = await Promise.all([
      prisma.booking.create({
        data: {
          studentId: studentA.id,
          roundId: sequentialRound.id,
          price: 1000,
          status: 'PENDING_REVIEW',
        },
      }),
      prisma.booking.create({
        data: {
          studentId: studentB.id,
          roundId: sequentialRound.id,
          price: 1000,
          status: 'PENDING_REVIEW',
        },
      }),
      prisma.booking.create({
        data: {
          studentId: studentC.id,
          roundId: simultaneousRound.id,
          price: 1000,
          status: 'PENDING_REVIEW',
        },
      }),
      prisma.booking.create({
        data: {
          studentId: studentD.id,
          roundId: simultaneousRound.id,
          price: 1000,
          status: 'PENDING_REVIEW',
        },
      }),
    ]);

    const first = await api(`/admin/bookings/${bookings[0]!.id.toString()}/approve`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    const second = await api(`/admin/bookings/${bookings[1]!.id.toString()}/approve`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: 'ROUND_FULL' });

    const simultaneous = await Promise.all(
      bookings.slice(2).map((booking) =>
        api(`/admin/bookings/${booking.id.toString()}/approve`, {
          method: 'POST',
          headers: adminHeaders,
          body: JSON.stringify({}),
        }),
      ),
    );
    expect(simultaneous.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.booking.count({
        where: { roundId: simultaneousRound.id, status: 'CONFIRMED' },
      }),
    ).toBe(1);
  });
});
