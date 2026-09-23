import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { promisify } from 'node:util';

import 'dotenv/config';

import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);
const apiBaseUrl = process.env.LOCAL_API_BASE_URL ?? 'http://127.0.0.1:3001';
const reportPath =
  process.env.LOCAL_CERTIFICATE_REPORT_PATH ??
  'docs/local-certificate-api-test-report-2026-09-22.md';
const certificateTemplatePath =
  process.env.CERTIFICATE_TEMPLATE_PATH ?? 'certificate_template_fillable.pdf';
const adminEmail = required('ADMIN_EMAIL');
const adminPassword = required('ADMIN_PASSWORD');
const certificateJobSecret = required('CERTIFICATE_JOB_SECRET');
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '');

type TranscriptEntry = {
  title: string;
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: unknown;
    binary?: { name: string; mimeType: string; bytes: number; sha256: string };
  };
  response: { status: number; headers: Record<string, string>; body?: unknown };
};

const transcript: TranscriptEntry[] = [];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.hostname.includes('r2.cloudflarestorage.com'))
      return `https://<private-object-storage-host>${url.pathname}${url.search ? '?<redacted-presigned-query>' : ''}`;
    if (url.search) url.search = '?<redacted-presigned-query>';
    return url.toString();
  } catch {
    return value;
  }
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.includes('X-Amz-') ? redactUrl(value) : value;
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      /token|cookie|password|secret/i.test(key) ? '<redacted>' : redact(child),
    ]),
  );
}

function documentedHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      /authorization|cookie|secret/i.test(key) ? `<redacted-${key}>` : value,
    ]),
  );
}

async function request(
  title: string,
  method: string,
  path: string,
  options: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
    expectedStatuses?: number[];
  } = {},
): Promise<{ body: unknown; response: Response }> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  transcript.push({
    title,
    request: { method, path, headers: documentedHeaders(headers), body: redact(options.body) },
    response: {
      status: response.status,
      headers: Object.fromEntries(
        ['content-type', 'location']
          .map((name) => [name, response.headers.get(name)] as const)
          .filter(([, value]) => value !== null)
          .map(([name, value]) => [name, name === 'location' ? redactUrl(value!) : value!]),
      ),
      body: redact(body),
    },
  });
  if (!response.ok && !options.expectedStatuses?.includes(response.status))
    throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
  return { body, response };
}

async function directUpload(
  title: string,
  uploadUrl: string,
  bytes: Uint8Array,
  mimeType: string,
  name: string,
) {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    body: bytes,
  });
  transcript.push({
    title,
    request: {
      method: 'PUT',
      path: redactUrl(uploadUrl),
      headers: { 'content-type': mimeType },
      binary: {
        name,
        mimeType,
        bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    },
    response: {
      status: response.status,
      headers: Object.fromEntries(
        ['content-type', 'etag']
          .map((name) => [name, response.headers.get(name)] as const)
          .filter(([, value]) => value !== null),
      ),
    },
  });
  if (!response.ok) throw new Error(`Direct upload failed with ${response.status}.`);
}

async function directDownload(title: string, downloadUrl: string) {
  const response = await fetch(downloadUrl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pdf = await PDFDocument.load(bytes);
  transcript.push({
    title,
    request: { method: 'GET', path: redactUrl(downloadUrl), headers: {} },
    response: {
      status: response.status,
      headers: Object.fromEntries(
        ['content-type', 'etag']
          .map((name) => [name, response.headers.get(name)] as const)
          .filter(([, value]) => value !== null),
      ),
      body: {
        binary: {
          bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          pages: pdf.getPageCount(),
          remainingAcroFormFields: pdf.getForm().getFields().length,
        },
      },
    },
  });
  if (!response.ok) throw new Error(`Certificate download failed with ${response.status}.`);
}

function dateOnly(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function markRoundCompleted(roundId: string): Promise<string> {
  const completedStart = dateOnly(-3);
  const completedEnd = dateOnly(-2);
  const sql = `UPDATE course_rounds SET start_date = DATE '${completedStart}', end_date = DATE '${completedEnd}' WHERE id = ${roundId} RETURNING id, start_date, end_date;`;
  const { stdout } = await execFileAsync('docker', [
    'compose',
    'exec',
    '-T',
    'db',
    'sh',
    '-lc',
    `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "${sql}"`,
  ]);
  return stdout.trim();
}

function markdownValue(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function renderEntry(entry: TranscriptEntry, index: number): string {
  const request = [
    `${entry.request.method} ${entry.request.path} HTTP/1.1`,
    `Host: ${new URL(apiBaseUrl).host}`,
    ...Object.entries(entry.request.headers).map(([key, value]) => `${key}: ${value}`),
    entry.request.body === undefined && !entry.request.binary ? '' : '',
    entry.request.body === undefined
      ? entry.request.binary
        ? `<binary ${entry.request.binary.name}; ${entry.request.binary.bytes} bytes; SHA-256 ${entry.request.binary.sha256}>`
        : ''
      : markdownValue(entry.request.body),
  ]
    .filter(Boolean)
    .join('\n');
  const response = [
    `HTTP/1.1 ${entry.response.status}`,
    ...Object.entries(entry.response.headers).map(([key, value]) => `${key}: ${value}`),
    entry.response.body === undefined ? '' : '',
    entry.response.body === undefined ? '' : markdownValue(entry.response.body),
  ]
    .filter(Boolean)
    .join('\n');
  return `### ${index + 1}. ${entry.title}\n\nRequest:\n\n\`\`\`http\n${request}\n\`\`\`\n\nResponse:\n\n\`\`\`http\n${response}\n\`\`\``;
}

async function main() {
  await request('GET /ready — local deployment readiness', 'GET', '/ready');
  const adminLogin = await request(
    'POST /auth/login — administrator authentication',
    'POST',
    '/auth/login',
    {
      body: { email: adminEmail, password: adminPassword },
    },
  );
  const adminToken = adminLogin.body.accessToken as string;

  const templateName = basename(certificateTemplatePath);
  const templateBytes = await readFile(certificateTemplatePath);
  const templateUpload = await request(
    'POST /files/uploads — create certificate-template upload',
    'POST',
    '/files/uploads',
    {
      token: adminToken,
      body: {
        kind: 'CERTIFICATE_TEMPLATE',
        originalName: templateName,
        mimeType: 'application/pdf',
      },
    },
  );
  await directUpload(
    'PUT <certificate-template uploadUrl> — direct object upload',
    templateUpload.body.uploadUrl,
    templateBytes,
    'application/pdf',
    templateName,
  );
  const templateFile = await request(
    'POST /files/uploads/complete — persist certificate template',
    'POST',
    '/files/uploads/complete',
    {
      token: adminToken,
      body: {
        kind: 'CERTIFICATE_TEMPLATE',
        originalName: templateName,
        mimeType: 'application/pdf',
        storageKey: templateUpload.body.storageKey,
      },
    },
  );
  const templateFileId = templateFile.body.file.id as string;
  await request(
    'POST /admin/certificate-template/inspect — inspect all mapped fields',
    'POST',
    '/admin/certificate-template/inspect',
    {
      token: adminToken,
      body: { fileId: templateFileId },
    },
  );
  await request(
    'PUT /admin/certificate-template — activate inspected template',
    'PUT',
    '/admin/certificate-template',
    {
      token: adminToken,
      body: { fileId: templateFileId },
    },
  );
  await request(
    'GET /admin/certificate-template — read active template',
    'GET',
    '/admin/certificate-template',
    {
      token: adminToken,
    },
  );

  const studentEmail = `certificate-e2e-${runId}@example.test`;
  const studentPassword = 'Certificate-E2E-Password-2026';
  const registration = await request(
    'POST /auth/register — register Arabic/mixed-language student',
    'POST',
    '/auth/register',
    {
      body: {
        name: 'محمد Example Student 123، اختبار',
        email: studentEmail,
        phone: '+201000000000',
        password: studentPassword,
      },
    },
  );
  await request('POST /auth/verify-email — verify student email', 'POST', '/auth/verify-email', {
    body: { email: studentEmail, code: registration.body.otp },
  });
  const studentLogin = await request(
    'POST /auth/login — student authentication',
    'POST',
    '/auth/login',
    {
      body: { email: studentEmail, password: studentPassword },
    },
  );
  const studentToken = studentLogin.body.accessToken as string;

  const paymentMethodKey = `CERT_E2E_${runId}`;
  await request(
    'POST /payment-methods — create manual payment method',
    'POST',
    '/payment-methods',
    {
      token: adminToken,
      body: {
        key: paymentMethodKey,
        value: 'Certificate E2E bank transfer',
        description: 'Disposable local certificate test payment method.',
      },
    },
  );
  const course = await request('POST /courses — create mixed-language course', 'POST', '/courses', {
    token: adminToken,
    body: {
      title: 'دورة TypeScript المتقدمة — Level 2',
      description: 'Disposable certificate E2E course.',
      price: 99.99,
      outcomes: ['Certificate issuance'],
    },
  });
  const courseId = course.body.course.id as string;
  const round = await request(
    'POST /courses/:courseId/rounds — create bookable round',
    'POST',
    `/courses/${courseId}/rounds`,
    {
      token: adminToken,
      body: {
        startDate: dateOnly(2),
        endDate: dateOnly(3),
        capacity: 1,
        scheduleMode: 'WEEKLY',
        schedules: [{ weekday: 'THURSDAY', startTime: '10:00', endTime: '12:00' }],
      },
    },
  );
  const roundId = round.body.round.id as string;
  const booking = await request(
    'POST /rounds/:id/bookings — create student booking',
    'POST',
    `/rounds/${roundId}/bookings`,
    {
      token: studentToken,
      body: {},
    },
  );
  const bookingId = booking.body.booking.id as string;

  const receiptUpload = await request(
    'POST /files/uploads — create payment-receipt upload',
    'POST',
    '/files/uploads',
    {
      token: studentToken,
      body: {
        kind: 'PAYMENT_RECEIPT',
        originalName: `receipt-e2e-${runId}.pdf`,
        mimeType: 'application/pdf',
      },
    },
  );
  await directUpload(
    'PUT <payment-receipt uploadUrl> — direct object upload',
    receiptUpload.body.uploadUrl,
    templateBytes,
    'application/pdf',
    `receipt-e2e-${runId}.pdf`,
  );
  const receiptFile = await request(
    'POST /files/uploads/complete — persist payment receipt',
    'POST',
    '/files/uploads/complete',
    {
      token: studentToken,
      body: {
        kind: 'PAYMENT_RECEIPT',
        originalName: `receipt-e2e-${runId}.pdf`,
        mimeType: 'application/pdf',
        storageKey: receiptUpload.body.storageKey,
      },
    },
  );
  await request(
    'POST /bookings/:id/payment — submit payment evidence',
    'POST',
    `/bookings/${bookingId}/payment`,
    {
      token: studentToken,
      body: {
        paymentMethodKey,
        receiptFileId: receiptFile.body.file.id,
        transactionReference: `CERT-E2E-${runId}`,
      },
    },
  );
  await request(
    'POST /admin/bookings/:id/approve — confirm booking',
    'POST',
    `/admin/bookings/${bookingId}/approve`,
    {
      token: adminToken,
      body: { adminNote: 'Approved by local certificate E2E test.' },
    },
  );
  const fixtureResult = await markRoundCompleted(roundId);

  await request(
    'POST /internal/jobs/certificates/issue — issue certificate',
    'POST',
    '/internal/jobs/certificates/issue',
    {
      headers: { 'x-certificate-job-secret': certificateJobSecret },
    },
  );
  await request(
    'POST /internal/jobs/certificates/issue — idempotency retry',
    'POST',
    '/internal/jobs/certificates/issue',
    {
      headers: { 'x-certificate-job-secret': certificateJobSecret },
    },
  );
  const certificates = await request(
    'GET /certificates — list student certificates',
    'GET',
    '/certificates',
    { token: studentToken },
  );
  const certificate = certificates.body.certificates.find(
    (item: { course: { id: string } }) => item.course.id === courseId,
  );
  if (!certificate) throw new Error('Issued certificate was not returned to the student.');
  const download = await request(
    'GET /certificates/:id/download — authorized private download redirect',
    'GET',
    `/certificates/${certificate.id}/download`,
    { token: studentToken, expectedStatuses: [302] },
  );
  const downloadUrl = download.response.headers.get('location');
  if (!downloadUrl)
    throw new Error('Certificate download response did not include a redirect location.');
  await directDownload('GET <certificate download Location> — download issued PDF', downloadUrl);
  await request(
    'GET /certificates/:publicId/verify — public verification',
    'GET',
    `/certificates/${certificate.publicId}/verify`,
  );

  const report = [
    `# Local certificate API test report — ${new Date().toISOString().slice(0, 10)}`,
    '',
    '## Result',
    '',
    `The Docker Compose API was rebuilt from the current workspace and tested at \`${apiBaseUrl}\`. This run used a disposable student, course, round, payment method, uploaded template, receipt, and issued certificate.`,
    '',
    `The uploaded administrator template was \`${templateName}\` from the repository root. Its exact inspected field report is included below. The student and course deliberately combine Arabic, English, numerals, and punctuation.`,
    '',
    'Bearer tokens, passwords, the job secret, and presigned-object query strings are redacted. Binary request bodies are represented by their exact byte length and SHA-256; the corresponding response body is empty.',
    '',
    '## Local-only completion-date fixture',
    '',
    'The API intentionally permits bookings only for future rounds and prevents changing dates after a booking exists. The isolated Docker database was therefore updated after approval so the scheduled issuance job could run immediately:',
    '',
    '```text',
    fixtureResult,
    '```',
    '',
    '## Complete API transcript',
    '',
    transcript.map(renderEntry).join('\n\n'),
    '',
    '## Coverage',
    '',
    `All ${transcript.length} HTTP exchanges completed successfully. This includes template inspection/activation, direct object uploads, registration and verification, booking/payment/approval, first issuance plus idempotency retry, private-download authorization, and public verification.`,
    '',
  ].join('\n');
  await writeFile(reportPath, report);
  process.stdout.write(`${reportPath}\n`);
}

void main();
