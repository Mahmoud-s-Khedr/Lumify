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

function connectWithReady(
  token: string,
): Promise<{ socket: Socket; ready: { courseIds: string[]; error: string | null } }> {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, { auth: { token }, transports: ['websocket'], autoConnect: false });
    socket.once('connect_error', reject);
    socket.once('community:ready', (ready) => resolve({ socket, ready }));
    socket.connect();
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

describe('Course community journeys', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.communityMessageAttachment.deleteMany();
    await prisma.communityReadState.deleteMany();
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

    const [studentConnection, adminConnection] = await Promise.all([
      connectWithReady(studentLogin.body.accessToken),
      connectWithReady(adminLogin.body.accessToken),
    ]);
    const { socket: studentSocket } = studentConnection;
    const { socket: adminSocket } = adminConnection;
    try {
      // Event arguments are untrusted: a non-function acknowledgement must not crash the server.
      studentSocket.emit('community:read', { courseId: course.id.toString() }, { malformed: true });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect((await api('/health')).status).toBe(200);
      expect(studentConnection.ready).toEqual({ courseIds: [course.id.toString()], error: null });
      expect(adminConnection.ready).toEqual({ courseIds: [course.id.toString()], error: null });
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

  it('automatically joins every eligible community and tracks unread messages per member', async () => {
    const [student, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: 'Unread student',
          email: 'unread-student@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          name: 'Unread instructor',
          email: 'unread-instructor@example.com',
          passwordHash: await hashPassword(password),
          emailVerified: true,
          role: 'ADMIN',
        },
      }),
    ]);
    const course = await prisma.course.create({ data: { title: 'Unread community', price: 100 } });
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
    const [studentLogin, adminLogin] = await Promise.all(
      [student, admin].map((user) =>
        api<{ accessToken: string }>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: user.email, password }),
        }),
      ),
    );
    const first = await prisma.communityMessage.create({
      data: { courseId: course.id, senderId: admin.id, content: 'First unread message' },
    });
    const second = await prisma.communityMessage.create({
      data: { courseId: course.id, senderId: admin.id, content: 'Second unread message' },
    });
    const studentHeaders = { authorization: `Bearer ${studentLogin.body.accessToken}` };

    const beforeRead = await api<{
      communities: Array<{ course: { id: string }; unreadCount: number }>;
    }>('/communities', { headers: studentHeaders });
    expect(beforeRead.body.communities).toEqual([
      expect.objectContaining({
        course: expect.objectContaining({ id: course.id.toString() }),
        unreadCount: 2,
      }),
    ]);

    const [studentConnection, adminConnection] = await Promise.all([
      connectWithReady(studentLogin.body.accessToken),
      connectWithReady(adminLogin.body.accessToken),
    ]);
    const { socket: studentSocket } = studentConnection;
    const { socket: adminSocket } = adminConnection;
    try {
      expect(studentConnection.ready).toEqual({ courseIds: [course.id.toString()], error: null });
      expect(adminConnection.ready).toEqual({ courseIds: [course.id.toString()], error: null });
      const delivered = new Promise<Record<string, unknown>>((resolve) =>
        studentSocket.once('community:messageCreated', resolve),
      );
      await expect(
        acknowledge(adminSocket, 'community:sendMessage', {
          courseId: course.id.toString(),
          content: 'Delivered without a manual join',
        }),
      ).resolves.toMatchObject({ ok: true });
      await expect(delivered).resolves.toMatchObject({
        content: 'Delivered without a manual join',
      });

      const read = await api<{
        courseId: string;
        messageId: string | null;
        readCount: number;
        unreadCount: number;
      }>(`/communities/${course.id}/read`, {
        method: 'POST',
        headers: studentHeaders,
        body: JSON.stringify({ messageId: first.id.toString() }),
      });
      expect(read.body).toMatchObject({
        courseId: course.id.toString(),
        messageId: first.id.toString(),
        readCount: 1,
        unreadCount: 2,
      });

      const socketRead = await acknowledge(studentSocket, 'community:read', {
        courseId: course.id.toString(),
        messageId: second.id.toString(),
      });
      expect(socketRead).toMatchObject({
        ok: true,
        messageId: second.id.toString(),
        readCount: 1,
        unreadCount: 1,
      });
    } finally {
      studentSocket.disconnect();
      adminSocket.disconnect();
    }

    const afterRead = await api<{ communities: Array<{ unreadCount: number }> }>('/communities', {
      headers: studentHeaders,
    });
    expect(afterRead.body.communities).toEqual([expect.objectContaining({ unreadCount: 1 })]);

    const markAll = await api<{ readCount: number; unreadCount: number }>(
      `/communities/${course.id}/read`,
      { method: 'POST', headers: studentHeaders },
    );
    expect(markAll.body).toMatchObject({ readCount: 1, unreadCount: 0 });

    const afterMarkAll = await api<{ communities: Array<{ unreadCount: number }> }>(
      '/communities',
      {
        headers: studentHeaders,
      },
    );
    expect(afterMarkAll.body.communities).toEqual([expect.objectContaining({ unreadCount: 0 })]);
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

  it('keeps an authenticated socket usable after its handshake token expires', async () => {
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
      data: { title: 'Stateful socket course', price: 100 },
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
    const [studentConnection, adminConnection] = await Promise.all([
      connectWithReady(signShortLivedAccessToken(student)),
      connectWithReady(adminLogin.body.accessToken),
    ]);
    const { socket: studentSocket } = studentConnection;
    const { socket: adminSocket } = adminConnection;
    try {
      expect(studentConnection.ready).toEqual({ courseIds: [course.id.toString()], error: null });
      expect(adminConnection.ready).toEqual({ courseIds: [course.id.toString()], error: null });

      await new Promise((resolve) => setTimeout(resolve, 2_100));
      const delivered = new Promise<Record<string, unknown>>((resolve) =>
        studentSocket.once('community:messageCreated', resolve),
      );
      await expect(
        acknowledge(adminSocket, 'community:sendMessage', {
          courseId: course.id.toString(),
          content: 'Admin message after token expiry',
        }),
      ).resolves.toMatchObject({ ok: true });
      await expect(delivered).resolves.toMatchObject({
        content: 'Admin message after token expiry',
      });
      await expect(
        acknowledge(studentSocket, 'community:sendMessage', {
          courseId: course.id.toString(),
          content: 'Student message after token expiry',
        }),
      ).resolves.toMatchObject({ ok: true });
    } finally {
      studentSocket.disconnect();
      adminSocket.disconnect();
    }
  });
});
