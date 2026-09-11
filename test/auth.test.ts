import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/security/passwords.js';
import { prisma } from '../src/infrastructure/database/prisma.js';
import { api } from './http.js';

describe('Phase 2 authentication and configuration journeys', () => {
  const password = 'student-password';

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.authSession.deleteMany();
    await prisma.authToken.deleteMany();
    await prisma.paymentMethod.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registers, exposes the test OTP, verifies, and logs in', async () => {
    const registration = await api<{ otp?: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Student', email: 'student@example.com', password }),
    });
    expect(registration.status).toBe(201);
    const registered = registration.body;
    expect(registered.otp).toMatch(/^\d{6}$/);

    const verification = await api('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email: 'student@example.com', code: registered.otp }),
    });
    expect(verification.status).toBe(200);

    const login = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'student@example.com', password }),
    });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ accessToken: expect.any(String) });
    const cookie = login.headers.get('set-cookie');
    expect(cookie).toContain('lumify_refresh_token=');

    const refresh = await api<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      headers: { cookie: cookie ?? '' },
    });
    expect(refresh.status).toBe(200);
    expect(refresh.body).toMatchObject({ accessToken: expect.any(String) });
  });

  it('resets the password and invalidates the old password', async () => {
    await prisma.user.create({
      data: {
        name: 'Student',
        email: 'student@example.com',
        passwordHash: await hashPassword(password),
        emailVerified: true,
      },
    });
    const forgot = await api<{ otp?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'student@example.com' }),
    });
    const { otp } = forgot.body;
    expect(otp).toMatch(/^\d{6}$/);
    const verification = await api('/auth/verify-reset-code', {
      method: 'POST',
      body: JSON.stringify({ email: 'student@example.com', code: otp }),
    });
    expect(verification.status).toBe(204);
    const reset = await api('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: 'student@example.com',
        code: otp,
        newPassword: 'new-student-password',
      }),
    });
    expect(reset.status).toBe(204);

    const consumedCode = await api('/auth/verify-reset-code', {
      method: 'POST',
      body: JSON.stringify({ email: 'student@example.com', code: otp }),
    });
    expect(consumedCode.status).toBe(400);

    const oldLogin = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'student@example.com', password }),
    });
    expect(oldLogin.status).toBe(401);
    const newLogin = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'student@example.com', password: 'new-student-password' }),
    });
    expect(newLogin.status).toBe(200);
  });

  it('enforces roles and lets an admin manage publicly visible payment methods', async () => {
    const [student, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Student',
          email: 'student@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Admin',
          email: 'admin@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
    ]);
    const studentLogin = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: student.email, password }),
    });
    const adminLogin = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: admin.email, password }),
    });
    const studentToken = studentLogin.body.accessToken;
    const adminToken = adminLogin.body.accessToken;

    const updatedProfile = await api('/users/me', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ phone: '01000000000', contactInfo: { telegram: '@student' } }),
    });
    expect(updatedProfile.status).toBe(200);
    expect(updatedProfile.body).toMatchObject({
      user: { phone: '01000000000', contactInfo: { telegram: '@student' } },
    });

    const forbidden = await api('/payment-methods', {
      method: 'POST',
      headers: { authorization: `Bearer ${studentToken}` },
      body: JSON.stringify({ key: 'INSTAPAY', value: '0123456789' }),
    });
    expect(forbidden.status).toBe(403);

    const created = await api('/payment-methods', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ key: 'INSTAPAY', value: '0123456789' }),
    });
    expect(created.status).toBe(201);
    const listed = await api('/payment-methods', {
      method: 'GET',
    });
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({
      paymentMethods: [{ key: 'INSTAPAY', value: '0123456789' }],
    });
  });
});
