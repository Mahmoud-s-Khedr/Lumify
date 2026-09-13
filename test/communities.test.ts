import { createHmac } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';

import { hashPassword } from '../src/common/security/passwords.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/infrastructure/database/prisma.js';
import { api } from './http.js';

const baseUrl = `http://127.0.0.1:${process.env.TEST_API_PORT ?? '3101'}`;
const password = 'community-password';

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, { auth: { token }, transports: ['websocket'] });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function acknowledge(
  socket: Socket,
  event: string,
  payload: object,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function signShortLivedAccessToken(user: { id: bigint; role: string; email: string }): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: user.id.toString(),
    role: user.role,
    email: user.email,
    exp: Math.floor(Date.now() / 1_000) + 2,
  });
  const signature = createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function expectNoEvent(socket: Socket, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEvent = () => {
      clearTimeout(timeout);
      reject(new Error(`Unexpected ${event} event`));
    };
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, 100);
    socket.once(event, onEvent);
  });
}

describe('Course community journeys', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.communityMessageAttachment.deleteMany();
    await prisma.communityMessage.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.courseRound.deleteMany();
    await prisma.course.deleteMany();
    await prisma.file.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('limits a community to confirmed students and delivers a socket message to its room', async () => {
    const [student, pendingStudent, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Confirmed student',
          email: 'confirmed@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Pending student',
          email: 'pending@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Instructor',
          email: 'instructor@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
    ]);
    const course = await prisma.course.create({
      data: { title: 'Community course', price: 100 },
    });
    const round = await prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-30'),
        capacity: 10,
      },
    });
    await prisma.booking.createMany({
      data: [
        { studentId: student.id, roundId: round.id, price: 100, status: 'CONFIRMED' },
        { studentId: pendingStudent.id, roundId: round.id, price: 100, status: 'PENDING_REVIEW' },
      ],
    });
    const [studentLogin, pendingLogin, adminLogin] = await Promise.all(
      [student, pendingStudent, admin].map((user) =>
        api<{ accessToken: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: user.email, password }),
        }),
      ),
    );
    const headers = { authorization: `Bearer ${studentLogin.body.accessToken}` };

    const communities = await api<{ communities: Array<{ course: { id: string } }> }>(
      '/communities',
      {
        headers,
      },
    );
    expect(communities.body.communities.map((community) => community.course.id)).toEqual([
      course.id.toString(),
    ]);
    const denied = await api(`/communities/${course.id}/messages`, {
      headers: { authorization: `Bearer ${pendingLogin.body.accessToken}` },
    });
    expect(denied.status).toBe(403);
    const adminCommunities = await api<{ communities: unknown[] }>('/communities', {
      headers: { authorization: `Bearer ${adminLogin.body.accessToken}` },
    });
    expect(adminCommunities.body.communities).toHaveLength(1);

    const [studentSocket, adminSocket] = await Promise.all([
      connect(studentLogin.body.accessToken),
      connect(adminLogin.body.accessToken),
    ]);
    try {
      // Event arguments are untrusted: a non-function acknowledgement must not crash the server.
      studentSocket.emit('community:join', { courseId: course.id.toString() }, { malformed: true });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(
        await acknowledge(studentSocket, 'community:join', { courseId: course.id.toString() }),
      ).toMatchObject({
        ok: true,
      });
      expect((await api('/health')).status).toBe(200);
      expect(
        await acknowledge(adminSocket, 'community:join', { courseId: course.id.toString() }),
      ).toMatchObject({
        ok: true,
      });
      const delivered = new Promise<Record<string, unknown>>((resolve) =>
        adminSocket.once('community:messageCreated', resolve),
      );
      const sent = await acknowledge(studentSocket, 'community:sendMessage', {
        courseId: course.id.toString(),
        content: 'Hello course',
      });
      expect(sent).toMatchObject({ ok: true, message: { content: 'Hello course' } });
      expect(await delivered).toMatchObject({
        courseId: course.id.toString(),
        content: 'Hello course',
      });
    } finally {
      studentSocket.disconnect();
      adminSocket.disconnect();
    }

    const history = await api<{ messages: Array<{ content: string }> }>(
      `/communities/${course.id}/messages`,
      { headers },
    );
    expect(history.status).toBe(200);
    expect(history.body.messages).toEqual([expect.objectContaining({ content: 'Hello course' })]);
  });

  it('makes archived communities read-only for both authors and admins', async () => {
    const [student, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Message author',
          email: 'author@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Community admin',
          email: 'community-admin@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
    ]);
    const course = await prisma.course.create({
      data: { title: 'Archived community', price: 100, archived: true },
    });
    const round = await prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-30'),
        capacity: 10,
      },
    });
    await prisma.booking.create({
      data: { studentId: student.id, roundId: round.id, price: 100, status: 'CONFIRMED' },
    });
    const message = await prisma.communityMessage.create({
      data: { courseId: course.id, senderId: student.id, content: 'Existing message' },
    });
    const [studentLogin, adminLogin] = await Promise.all(
      [student, admin].map((user) =>
        api<{ accessToken: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: user.email, password }),
        }),
      ),
    );
    const [studentSocket, adminSocket] = await Promise.all([
      connect(studentLogin.body.accessToken),
      connect(adminLogin.body.accessToken),
    ]);
    try {
      await expect(
        acknowledge(studentSocket, 'community:deleteMessage', { messageId: message.id.toString() }),
      ).resolves.toMatchObject({ error: 'COMMUNITY_READ_ONLY' });
      await expect(
        acknowledge(adminSocket, 'community:deleteMessage', { messageId: message.id.toString() }),
      ).resolves.toMatchObject({ error: 'COMMUNITY_READ_ONLY' });
    } finally {
      studentSocket.disconnect();
      adminSocket.disconnect();
    }

    await expect(
      prisma.communityMessage.findUnique({ where: { id: message.id } }),
    ).resolves.toMatchObject({
      deletedAt: null,
    });
  });

  it('requires a course with community history to be archived instead of deleted', async () => {
    const admin = await prisma.user.create({
      data: {
        name: 'Community instructor',
        email: 'community-instructor@example.com',
        passwordHash: await hashPassword(password),
        emailVerified: true,
        role: 'ADMIN',
      },
    });
    const course = await prisma.course.create({
      data: { title: 'Community history', price: 100 },
    });
    await prisma.communityMessage.create({
      data: { courseId: course.id, senderId: admin.id, content: 'Keep this history' },
    });
    const login = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: admin.email, password }),
    });

    const deleted = await api(`/courses/${course.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${login.body.accessToken}` },
    });

    expect(deleted.status).toBe(409);
    expect(deleted.body).toMatchObject({ error: 'COURSE_HAS_COMMUNITY_HISTORY' });
    await expect(prisma.course.findUnique({ where: { id: course.id } })).resolves.not.toBeNull();
  });

  it('requires reauthentication after a token expires without losing room membership', async () => {
    const [student, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Expiring student',
          email: 'expiring@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Broadcast admin',
          email: 'broadcast-admin@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
    ]);
    const course = await prisma.course.create({
      data: { title: 'Reauthentication course', price: 100 },
    });
    const round = await prisma.courseRound.create({
      data: {
        courseId: course.id,
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-30'),
        capacity: 10,
      },
    });
    await prisma.booking.create({
      data: { studentId: student.id, roundId: round.id, price: 100, status: 'CONFIRMED' },
    });
    const adminLogin = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: admin.email, password }),
    });
    const [studentSocket, adminSocket] = await Promise.all([
      connect(signShortLivedAccessToken(student)),
      connect(adminLogin.body.accessToken),
    ]);
    try {
      await expect(
        acknowledge(studentSocket, 'community:join', { courseId: course.id.toString() }),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        acknowledge(adminSocket, 'community:join', { courseId: course.id.toString() }),
      ).resolves.toMatchObject({ ok: true });

      await new Promise((resolve) => setTimeout(resolve, 2_100));
      await expect(
        acknowledge(studentSocket, 'community:sendMessage', {
          courseId: course.id.toString(),
          content: 'Expired message',
        }),
      ).resolves.toMatchObject({ error: 'UNAUTHENTICATED' });

      const noDelivery = expectNoEvent(studentSocket, 'community:messageCreated');
      await expect(
        acknowledge(adminSocket, 'community:sendMessage', {
          courseId: course.id.toString(),
          content: 'Admin message while student is expired',
        }),
      ).resolves.toMatchObject({ ok: true });
      await noDelivery;

      const freshLogin = await api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: student.email, password }),
      });
      await expect(
        acknowledge(studentSocket, 'community:reauth', { token: freshLogin.body.accessToken }),
      ).resolves.toEqual({ ok: true });

      const delivered = new Promise<Record<string, unknown>>((resolve) =>
        studentSocket.once('community:messageCreated', resolve),
      );
      await expect(
        acknowledge(adminSocket, 'community:sendMessage', {
          courseId: course.id.toString(),
          content: 'Admin message after reauthentication',
        }),
      ).resolves.toMatchObject({ ok: true });
      await expect(delivered).resolves.toMatchObject({
        content: 'Admin message after reauthentication',
      });
      await expect(
        acknowledge(studentSocket, 'community:sendMessage', {
          courseId: course.id.toString(),
          content: 'Student message after reauthentication',
        }),
      ).resolves.toMatchObject({ ok: true });
    } finally {
      studentSocket.disconnect();
      adminSocket.disconnect();
    }
  });
});
