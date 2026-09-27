import 'dotenv/config';

import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { io } from 'socket.io-client';

const contextPath = resolve(process.env.SIMULATION_CONTEXT_FILE ?? 'tmp/community-simulation.json');
const baseUrl = (
  process.env.SIMULATION_API_URL ??
  process.env.PUBLIC_BACKEND_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');

export const simulation = { baseUrl, contextPath };

function fail(message) {
  throw new Error(`[community simulation] ${message}`);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`${name} must be set (it may be supplied in .env).`);
  return value;
}

export function adminCredentials() {
  return {
    email: process.env.SIMULATION_ADMIN_EMAIL ?? requireEnv('ADMIN_EMAIL'),
    password: process.env.SIMULATION_ADMIN_PASSWORD ?? requireEnv('ADMIN_PASSWORD'),
  };
}

export async function request(
  path,
  { token, method = 'GET', body, redirect, allowStatuses = [] } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    redirect,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload =
    response.status === 204
      ? null
      : contentType.includes('application/json')
        ? await response.json()
        : await response.text();
  if (!response.ok && !allowStatuses.includes(response.status)) {
    const detail =
      typeof payload === 'object' && payload
        ? `${payload.error ?? response.status}: ${payload.message ?? 'request failed'}`
        : `${response.status}: ${payload}`;
    fail(`${method} ${path} failed — ${detail}`);
  }
  return { body: payload, response };
}

export async function login(credentials) {
  const { body } = await request('/auth/login', { method: 'POST', body: credentials });
  return { token: body.accessToken, user: body.user };
}

export async function writeContext(context) {
  await mkdir(resolve(contextPath, '..'), { recursive: true });
  await writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`, 'utf8');
  await chmod(contextPath, 0o600);
}

export async function readContext() {
  try {
    return JSON.parse(await readFile(contextPath, 'utf8'));
  } catch {
    fail(
      `could not read ${contextPath}; run the admin setup and fake-user enrollment stages first.`,
    );
  }
}

function nextDate(daysFromNow) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + daysFromNow);
  return value.toISOString().slice(0, 10);
}

export async function setUpAdminScenario() {
  const admin = await login(adminCredentials());
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const paymentMethodKey = `SIM_${runId.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`;
  const auth = { token: admin.token };

  await request('/payment-methods', {
    ...auth,
    method: 'POST',
    body: {
      key: paymentMethodKey,
      value: 'Simulated local payment',
      description: `Automated community test payment method ${runId}`,
    },
  });
  const { body: courseResult } = await request('/courses', {
    ...auth,
    method: 'POST',
    body: {
      title: `Community simulation ${runId}`,
      description: 'Created by the local community simulation.',
      price: 100,
    },
  });
  const courseId = courseResult.course.id;
  const { body: roundResult } = await request(`/courses/${courseId}/rounds`, {
    ...auth,
    method: 'POST',
    body: { startDate: nextDate(30), endDate: nextDate(60), capacity: 10 },
  });
  const context = {
    runId,
    courseId,
    roundId: roundResult.round.id,
    paymentMethodKey,
    students: [],
  };
  await writeContext(context);
  return context;
}

async function uploadOwnedFile(token, kind, originalName, mimeType, bytes) {
  const { body: upload } = await request('/files/uploads', {
    token,
    method: 'POST',
    body: { kind, originalName, mimeType },
  });
  const uploadResponse = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    body: bytes,
  });
  if (!uploadResponse.ok)
    fail(`direct upload for ${originalName} failed with ${uploadResponse.status}.`);
  const { body: completed } = await request('/files/uploads/complete', {
    token,
    method: 'POST',
    body: { kind, originalName, mimeType, storageKey: upload.storageKey },
  });
  return completed.file;
}

async function createStudent(context, index) {
  const local = `community-sim-${context.runId}-${index}`.toLowerCase();
  const email = `${local}@example.test`;
  const password = `Simulation-${context.runId}-${index}-A9!`;
  const registration = await request('/auth/register', {
    method: 'POST',
    body: { name: `Simulation Student ${index}`, email, phone: `+20100000${index}00`, password },
  });
  const otp = registration.body.otp;
  if (!otp)
    fail('The local environment must set EXPOSE_OTP_IN_RESPONSE=true for automated registration.');
  await request('/auth/verify-email', { method: 'POST', body: { email, code: otp } });
  const session = await login({ email, password });
  const { body: bookingResult } = await request(`/rounds/${context.roundId}/bookings`, {
    token: session.token,
    method: 'POST',
  });
  const receipt = await uploadOwnedFile(
    session.token,
    'PAYMENT_RECEIPT',
    `simulation-receipt-${index}.txt`,
    'text/plain',
    `Simulated receipt for ${context.runId} student ${index}`,
  );
  await request(`/bookings/${bookingResult.booking.id}/payment`, {
    token: session.token,
    method: 'POST',
    body: {
      paymentMethodKey: context.paymentMethodKey,
      receiptFileId: receipt.id,
      transactionReference: `SIM-${context.runId}-${index}`,
    },
  });
  return { email, password, bookingId: bookingResult.booking.id };
}

export async function enrollFakeStudents() {
  const context = await readContext();
  if (context.students?.length)
    fail('This scenario already has fake students. Start a new admin setup for another run.');
  context.students = await Promise.all([createStudent(context, 1), createStudent(context, 2)]);
  await writeContext(context);
  return context;
}

export async function approveFakeStudents() {
  const context = await readContext();
  if (!context.students?.length)
    fail('No students exist yet. Run the fake-user enrollment stage first.');
  const admin = await login(adminCredentials());
  await Promise.all(
    context.students.map(({ bookingId }) =>
      request(`/admin/bookings/${bookingId}/approve`, {
        token: admin.token,
        method: 'POST',
        body: { adminNote: `Approved by community simulation ${context.runId}` },
      }),
    ),
  );
  return context;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, { auth: { token }, transports: ['websocket'], autoConnect: false });
    const timer = setTimeout(() => reject(new Error('Socket connection timed out.')), 10_000);
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('community:ready', (ready) => {
      clearTimeout(timer);
      resolve({ socket, ready });
    });
    socket.connect();
  });
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}.`)), 10_000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emit(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event} acknowledgement.`)),
      10_000,
    );
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      if (!result?.ok)
        reject(
          new Error(
            `${event} failed — ${result?.error ?? 'unknown error'}: ${result?.message ?? ''}`,
          ),
        );
      else resolve(result);
    });
  });
}

export async function exerciseLiveCommunity() {
  const context = await readContext();
  if (!context.students?.length) fail('No students exist yet.');
  const admin = await login(adminCredentials());
  const students = await Promise.all(context.students.map(login));
  const connections = await Promise.all([
    connect(admin.token),
    ...students.map(({ token }) => connect(token)),
  ]);
  const [adminConnection, firstStudent, secondStudent] = connections;
  const allSockets = connections.map(({ socket }) => socket);
  try {
    const expectedRoom = context.courseId;
    if (
      !connections.every(
        ({ ready }) => ready.error === null && ready.courseIds.includes(expectedRoom),
      )
    )
      fail('One or more users were not automatically joined to the course community.');

    const welcomeEvents = allSockets.map((socket) => once(socket, 'community:messageCreated'));
    await emit(adminConnection.socket, 'community:sendMessage', {
      courseId: context.courseId,
      content: `Welcome to simulation ${context.runId}`,
    });
    await Promise.all(welcomeEvents);

    const attachment = await uploadOwnedFile(
      students[0].token,
      'COMMUNITY_ATTACHMENT',
      'simulation-note.txt',
      'text/plain',
      `Community attachment for ${context.runId}`,
    );
    const attachmentEvents = allSockets.map((socket) => once(socket, 'community:messageCreated'));
    const sent = await emit(firstStudent.socket, 'community:sendMessage', {
      courseId: context.courseId,
      content: 'Student message with an attachment',
      attachmentIds: [attachment.id],
    });
    const delivered = await Promise.all(attachmentEvents);
    if (
      !delivered.every(
        (message) =>
          message.id === sent.message.id && message.attachments?.[0]?.id === attachment.id,
      )
    )
      fail('The attachment message was not delivered intact to every community member.');

    const download = await request(`/files/${attachment.id}/download`, {
      token: students[1].token,
      redirect: 'manual',
      allowStatuses: [302],
    });
    if (download.response.status !== 302)
      fail('An eligible peer could not obtain the attachment download redirect.');

    const readEvents = allSockets.map((socket) => once(socket, 'community:read'));
    await emit(secondStudent.socket, 'community:read', { courseId: context.courseId });
    await Promise.all(readEvents);

    const deleteEvents = allSockets.map((socket) => once(socket, 'community:messageDeleted'));
    await emit(firstStudent.socket, 'community:deleteMessage', { messageId: sent.message.id });
    await Promise.all(deleteEvents);

    const { body: history } = await request(`/communities/${context.courseId}/messages`, {
      token: admin.token,
    });
    if (history.messages.some((message) => message.id === sent.message.id))
      fail('The deleted message is still returned in normal history.');
    return {
      courseId: context.courseId,
      runId: context.runId,
      historyMessageCount: history.messages.length,
    };
  } finally {
    allSockets.forEach((socket) => socket.disconnect());
  }
}
