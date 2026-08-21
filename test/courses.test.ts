import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword } from '../src/common/security/passwords.js';
import { prisma } from '../src/infrastructure/database/prisma.js';
import { api } from './http.js';

describe('Phase 3 file and course journeys', () => {
  const password = 'admin-password';

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    await prisma.courseImage.deleteMany();
    await prisma.course.deleteMany();
    await prisma.file.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('uploads ordered images, creates and searches a course, then archives it', async () => {
    const [admin, student] = await Promise.all([
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
          passwordHash: await hashPassword(password),
          emailVerified: true,
        },
      }),
    ]);
    const [adminLogin, studentLogin] = await Promise.all([
      api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: admin.email, password }),
      }),
      api<{ accessToken: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: student.email, password }),
      }),
    ]);
    const adminHeaders = { authorization: `Bearer ${adminLogin.body.accessToken}` };

    const upload = async (name: string) => {
      const permission = await api<{ storageKey: string }>('/files/uploads', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ kind: 'COURSE_IMAGE', originalName: name, mimeType: 'image/png' }),
      });
      expect(permission.status).toBe(201);
      const completed = await api<{ file: { id: string } }>('/files/uploads/complete', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          kind: 'COURSE_IMAGE',
          storageKey: permission.body.storageKey,
          originalName: name,
          mimeType: 'image/png',
        }),
      });
      expect(completed.status).toBe(201);
      return completed.body.file.id;
    };

    const [firstImage, secondImage] = await Promise.all([
      upload('first.png'),
      upload('second.png'),
    ]);
    const created = await api<{ course: { id: string; images: Array<{ id: string }> } }>(
      '/courses',
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          title: 'TypeScript Foundations',
          description: 'Learn reliable backend engineering.',
          price: 1250,
          outcomes: ['Build APIs'],
          skills: ['TypeScript', 'Fastify'],
          prerequisiteSkills: ['JavaScript'],
          demoVideoUrl: 'https://example.com/demo',
          imageFileIds: [secondImage, firstImage],
        }),
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.course.images.map((image) => image.id)).toEqual([secondImage, firstImage]);

    const publicDownload = await api(`/files/${firstImage}/download`, { redirect: 'manual' });
    expect(publicDownload.status).toBe(302);

    const search = await api<{ courses: Array<{ id: string }> }>('/courses?q=fastify');
    expect(search.status).toBe(200);
    expect(search.body.courses).toHaveLength(1);

    const forbidden = await api('/courses', {
      method: 'POST',
      headers: { authorization: `Bearer ${studentLogin.body.accessToken}` },
      body: JSON.stringify({ title: 'Nope', price: 0 }),
    });
    expect(forbidden.status).toBe(403);

    const archived = await api(`/courses/${created.body.course.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ archived: true }),
    });
    expect(archived.status).toBe(200);
    const publicList = await api<{ courses: unknown[] }>('/courses');
    expect(publicList.body.courses).toHaveLength(0);
    const adminArchivedList = await api<{ courses: unknown[] }>('/courses?archived=true', {
      headers: adminHeaders,
    });
    expect(adminArchivedList.body.courses).toHaveLength(1);
  });

  it('rejects a course image that has not been uploaded by the current admin', async () => {
    const admin = await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@example.com',
        passwordHash: await hashPassword(password),
        emailVerified: true,
        role: 'ADMIN',
      },
    });
    const foreignFile = await prisma.file.create({
      data: {
        storageKey: 'course-images/11111111-1111-1111-1111-111111111111',
        originalName: 'x.png',
      },
    });
    const login = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: admin.email, password }),
    });
    const response = await api('/courses', {
      method: 'POST',
      headers: { authorization: `Bearer ${login.body.accessToken}` },
      body: JSON.stringify({
        title: 'Course',
        price: 1,
        imageFileIds: [foreignFile.id.toString()],
      }),
    });
    expect(response.status).toBe(400);
  });
});
