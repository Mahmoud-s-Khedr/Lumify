import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { PDFButton, PDFDict, PDFDocument, PDFName, PDFTextField, TextAlignment } from 'pdf-lib';
import type { PDFPage, PDFWidgetAnnotation } from 'pdf-lib';
import QRCode from 'qrcode';
import { Prisma } from '@prisma/client';

import { utcCalendarToday } from '../../common/dates/calendar.js';
import { AppError } from '../../common/errors/app-error.js';
import { env } from '../../config/env.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { sendCertificateEmail } from '../../infrastructure/resend/mailer.js';
import { objectStorage } from '../../infrastructure/r2/storage.js';
import type { CertificateWithDetails } from './presenter.js';

const supportedTextFields = new Set([
  'student_name',
  'course_name',
  'completion_date',
  'certificate_id',
  'verification_url',
]);

const textRasterScale = 4;
const textFontFamily = 'Lumify Noto Sans Arabic';
const deliveryClaimLeaseMs = 30 * 60 * 1000;
let textFontRegistered = false;

const certificateInclude = {
  booking: { include: { student: true, round: { include: { course: true } } } },
} satisfies Prisma.CertificateInclude;

type FieldReport = {
  fields: Array<{
    name: string;
    type: string;
    populated: boolean;
    status: 'POPULATED' | 'IGNORED';
  }>;
  warning: string | null;
};

function fieldType(field: unknown): string {
  if (field instanceof PDFTextField) return 'TEXT';
  if (field instanceof PDFButton) return 'BUTTON';
  const name = (field as { constructor?: { name?: string } }).constructor?.name;
  return (
    name
      ?.replace(/^PDF/, '')
      .replace(/Field$/, '')
      .toUpperCase() || 'UNKNOWN'
  );
}

function reportFor(pdf: PDFDocument): FieldReport {
  const fields = pdf
    .getForm()
    .getFields()
    .map((field) => {
      const name = field.getName();
      const populated = supportedTextFields.has(name)
        ? field instanceof PDFTextField
        : name === 'qr_code' && field instanceof PDFButton;
      return {
        name,
        type: fieldType(field),
        populated,
        status: (populated ? 'POPULATED' : 'IGNORED') as 'POPULATED' | 'IGNORED',
      };
    });
  return {
    fields,
    warning: fields.some((field) => field.populated)
      ? null
      : 'This template has no supported fields. It can be activated, but Lumify will not add certificate data.',
  };
}

async function loadFillablePdf(
  bytes: Uint8Array,
): Promise<{ pdf: PDFDocument; report: FieldReport }> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
    if (!pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict))
      throw new Error('PDF has no AcroForm');
    return { pdf, report: reportFor(pdf) };
  } catch {
    throw new AppError(
      400,
      'The file must be a readable, fillable PDF.',
      'INVALID_CERTIFICATE_TEMPLATE',
    );
  }
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function verificationUrl(publicId: string): string {
  return `${(env.PUBLIC_BACKEND_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, '')}/certificates/${publicId}/verify`;
}

function ensureTextFont(): void {
  if (textFontRegistered) return;
  const require = createRequire(import.meta.url);
  const fontPath =
    require.resolve('@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf');
  if (!GlobalFonts.has(textFontFamily) && !GlobalFonts.registerFromPath(fontPath, textFontFamily))
    throw new Error('Unable to load the certificate text font.');
  textFontRegistered = true;
}

function textDirection(value: string): 'ltr' | 'rtl' {
  for (const character of value) {
    // Arabic and Hebrew are RTL strong scripts. Numbers are intentionally skipped so
    // that a leading date or certificate number follows the next strong character.
    if (/^[\u0590-\u05ff\u0600-\u065f\u066a-\u06ef\u06fa-\u08ff]$/u.test(character)) return 'rtl';
    if (/^\p{L}$/u.test(character)) return 'ltr';
  }
  return 'ltr';
}

function configuredFontSize(defaultAppearance: string | undefined, height: number): number {
  const match = defaultAppearance?.match(/\/[^\s]+\s+([0-9]+(?:\.[0-9]+)?)\s+Tf\b/);
  const size = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(size) && size > 0 ? size : height * 0.65;
}

function configuredTextColor(defaultAppearance: string | undefined): string {
  if (!defaultAppearance) return '#000000';
  const rgb = [...defaultAppearance.matchAll(/([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+rg\b/g)].at(-1);
  if (rgb) {
    const channels = rgb.slice(1).map((component) => Number(component));
    if (channels.length === 3 && channels.every(Number.isFinite))
      return `rgb(${Math.round(channels[0]! * 255)}, ${Math.round(channels[1]! * 255)}, ${Math.round(channels[2]! * 255)})`;
  }
  const gray = [...defaultAppearance.matchAll(/([0-9.]+)\s+g\b/g)].at(-1)?.[1];
  if (gray !== undefined && Number.isFinite(Number(gray))) {
    const channel = Math.round(Number(gray) * 255);
    return `rgb(${channel}, ${channel}, ${channel})`;
  }
  return '#000000';
}

function renderTextOverlay(input: {
  value: string;
  width: number;
  height: number;
  fontSize: number;
  alignment: TextAlignment;
  color: string;
}): Buffer {
  ensureTextFont();
  const width = Math.max(1, Math.ceil(input.width * textRasterScale));
  const height = Math.max(1, Math.ceil(input.height * textRasterScale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const padding = Math.min(8 * textRasterScale, width * 0.05, height * 0.15);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);

  context.direction = textDirection(input.value);
  context.fontKerning = 'normal';
  context.textRendering = 'optimizeLegibility';
  context.lang = context.direction === 'rtl' ? 'ar' : 'en';
  context.textBaseline = 'middle';
  context.textAlign =
    input.alignment === TextAlignment.Center
      ? 'center'
      : input.alignment === TextAlignment.Right
        ? 'right'
        : 'left';

  let fontSize = Math.min(input.fontSize * textRasterScale, availableHeight / 1.25);
  context.font = `${fontSize}px "${textFontFamily}"`;
  const measuredWidth = context.measureText(input.value).width;
  if (measuredWidth > availableWidth) fontSize *= availableWidth / measuredWidth;
  fontSize = Math.max(1, fontSize);
  context.font = `${fontSize}px "${textFontFamily}"`;
  context.fillStyle = input.color;

  const x =
    input.alignment === TextAlignment.Center
      ? width / 2
      : input.alignment === TextAlignment.Right
        ? width - padding
        : padding;
  context.fillText(input.value, x, height / 2);
  return canvas.toBuffer('image/png');
}

function pageForWidget(pdf: PDFDocument, widget: PDFWidgetAnnotation): PDFPage {
  const pageRef = widget.P();
  const page = pageRef ? pdf.getPages().find((candidate) => candidate.ref === pageRef) : undefined;
  if (page) return page;

  const widgetRef = pdf.context.getObjectRef(widget.dict);
  const widgetPage = widgetRef ? pdf.findPageForAnnotationRef(widgetRef) : undefined;
  if (!widgetPage) throw new Error('Unable to locate a certificate template field on a page.');
  return widgetPage;
}

export async function createCertificatePdf(input: {
  templateBytes: Uint8Array;
  studentName: string;
  courseName: string;
  completionDate: Date;
  publicId: string;
}): Promise<Uint8Array> {
  const { pdf } = await loadFillablePdf(input.templateBytes);
  const form = pdf.getForm();
  const values: Record<string, string> = {
    student_name: input.studentName,
    course_name: input.courseName,
    completion_date: dateOnly(input.completionDate),
    certificate_id: input.publicId,
    verification_url: verificationUrl(input.publicId),
  };

  const textOverlays: Array<{
    page: PDFPage;
    rectangle: { x: number; y: number; width: number; height: number };
    value: string;
    fontSize: number;
    alignment: TextAlignment;
    color: string;
  }> = [];
  const qrOverlays: Array<{
    page: PDFPage;
    rectangle: { x: number; y: number; width: number; height: number };
  }> = [];
  const controlledFields = [];

  for (const field of form.getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField && name in values) {
      const widgets = field.acroField.getWidgets();
      for (const widget of widgets) {
        const defaultAppearance =
          widget.getDefaultAppearance() ?? field.acroField.getDefaultAppearance();
        textOverlays.push({
          page: pageForWidget(pdf, widget),
          rectangle: widget.getRectangle(),
          value: values[name]!,
          fontSize: configuredFontSize(defaultAppearance, widget.getRectangle().height),
          alignment: field.getAlignment(),
          color: configuredTextColor(defaultAppearance),
        });
      }
      controlledFields.push(field);
    }
    if (field instanceof PDFButton && name === 'qr_code') {
      for (const widget of field.acroField.getWidgets())
        qrOverlays.push({ page: pageForWidget(pdf, widget), rectangle: widget.getRectangle() });
      controlledFields.push(field);
    }
  }

  // Remove Lumify-owned widgets before flattening so pdf-lib never attempts to
  // build their appearances. Other template fields retain their saved values and
  // appearances exactly as supplied by the administrator.
  for (const field of controlledFields) form.removeField(field);
  form.flatten({ updateFieldAppearances: false });

  for (const overlay of textOverlays) {
    const png = await pdf.embedPng(
      renderTextOverlay({
        value: overlay.value,
        width: overlay.rectangle.width,
        height: overlay.rectangle.height,
        fontSize: overlay.fontSize,
        alignment: overlay.alignment,
        color: overlay.color,
      }),
    );
    overlay.page.drawImage(png, overlay.rectangle);
  }

  if (qrOverlays.length) {
    const qrDataUrl = await QRCode.toDataURL(values.verification_url!, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 512,
    });
    const qr = await pdf.embedPng(Buffer.from(qrDataUrl.split(',')[1]!, 'base64'));
    for (const overlay of qrOverlays) {
      const side = Math.min(overlay.rectangle.width, overlay.rectangle.height);
      overlay.page.drawImage(qr, {
        x: overlay.rectangle.x + (overlay.rectangle.width - side) / 2,
        y: overlay.rectangle.y + (overlay.rectangle.height - side) / 2,
        width: side,
        height: side,
      });
    }
  }
  return pdf.save();
}

export async function inspectCertificateTemplate(fileId: bigint): Promise<FieldReport> {
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (
    !file ||
    !file.storageKey.startsWith('certificate-templates/') ||
    file.mimeType !== 'application/pdf'
  )
    throw new AppError(
      400,
      'The file must be a completed certificate-template PDF.',
      'INVALID_CERTIFICATE_TEMPLATE',
    );
  const { report } = await loadFillablePdf(await objectStorage().getBytes(file.storageKey));
  await prisma.certificateTemplateInspection.upsert({
    where: { fileId },
    create: { fileId, fieldReport: report },
    update: { fieldReport: report, inspectedAt: new Date() },
  });
  return report;
}

export async function activateCertificateTemplate(fileId: bigint) {
  const [file, inspection] = await Promise.all([
    prisma.file.findUnique({ where: { id: fileId } }),
    prisma.certificateTemplateInspection.findUnique({ where: { fileId } }),
  ]);
  if (
    !file ||
    !file.storageKey.startsWith('certificate-templates/') ||
    file.mimeType !== 'application/pdf'
  )
    throw new AppError(
      400,
      'The file must be a completed certificate-template PDF.',
      'INVALID_CERTIFICATE_TEMPLATE',
    );
  if (!inspection)
    throw new AppError(
      409,
      'Inspect this template before activating it.',
      'CERTIFICATE_TEMPLATE_NOT_INSPECTED',
    );

  const oldFile = await prisma.$transaction(async (tx) => {
    const current = await tx.certificateTemplate.findUnique({ where: { id: 1 } });
    await tx.certificateTemplate.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        fileId,
        fieldReport: inspection.fieldReport as Prisma.InputJsonValue,
        inspectedAt: inspection.inspectedAt,
      },
      update: {
        fileId,
        fieldReport: inspection.fieldReport as Prisma.InputJsonValue,
        inspectedAt: inspection.inspectedAt,
        activatedAt: new Date(),
      },
    });
    return current?.fileId !== undefined && current.fileId !== fileId ? current.fileId : null;
  });
  if (oldFile) {
    const previous = await prisma.file.findUnique({ where: { id: oldFile } });
    if (previous) {
      await objectStorage().delete(previous.storageKey);
      await prisma.file.delete({ where: { id: oldFile } });
    }
  }
  return getCertificateTemplate();
}

export async function getCertificateTemplate() {
  const template = await prisma.certificateTemplate.findUnique({
    where: { id: 1 },
    include: { file: true },
  });
  if (!template) return null;
  return {
    file: {
      id: template.file.id.toString(),
      originalName: template.file.originalName,
      mimeType: template.file.mimeType,
      createdAt: template.file.createdAt.toISOString(),
    },
    fieldReport: template.fieldReport,
    inspectedAt: template.inspectedAt.toISOString(),
    activatedAt: template.activatedAt.toISOString(),
  };
}

function nextPublicId(): string {
  return randomBytes(24).toString('base64url');
}

export async function issueCertificates(): Promise<{
  issued: number;
  deliveryRetried: number;
  deliveryFailed: number;
}> {
  const template = await prisma.certificateTemplate.findUnique({
    where: { id: 1 },
    include: { file: true },
  });
  if (!template) return { issued: 0, deliveryRetried: 0, deliveryFailed: 0 };
  const templateBytes = await objectStorage().getBytes(template.file.storageKey);
  const bookings = await prisma.booking.findMany({
    where: {
      status: 'CONFIRMED',
      round: { endDate: { lt: utcCalendarToday() } },
      certificate: null,
    },
    include: { student: true, round: { include: { course: true } } },
  });
  let issued = 0;
  for (const booking of bookings) {
    const publicId = nextPublicId();
    const bytes = await createCertificatePdf({
      templateBytes,
      studentName: booking.student.name,
      courseName: booking.round.course.title,
      completionDate: booking.round.endDate,
      publicId,
    });
    const storageKey = `certificates/${randomUUID()}.pdf`;
    await objectStorage().putBytes(storageKey, bytes, 'application/pdf');
    try {
      await prisma.$transaction(async (tx) => {
        const file = await tx.file.create({
          data: {
            storageKey,
            originalName: `certificate-${publicId}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: BigInt(bytes.byteLength),
          },
        });
        await tx.certificate.create({
          data: {
            publicId,
            bookingId: booking.id,
            fileId: file.id,
            completionDate: booking.round.endDate,
          },
        });
      });
      issued += 1;
    } catch (error) {
      await objectStorage().delete(storageKey);
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
        throw error;
    }
  }
  const delivery = await retryCertificateDelivery();
  return { issued, ...delivery };
}

async function retryCertificateDelivery(): Promise<{
  deliveryRetried: number;
  deliveryFailed: number;
}> {
  const claimExpiredBefore = new Date(Date.now() - deliveryClaimLeaseMs);
  const certificates = await prisma.certificate.findMany({
    where: {
      emailDeliveredAt: null,
      OR: [{ deliveryClaimedAt: null }, { deliveryClaimedAt: { lt: claimExpiredBefore } }],
    },
    include: certificateInclude,
  });
  let deliveryRetried = 0;
  let deliveryFailed = 0;
  for (const certificate of certificates) {
    const deliveryClaimToken = randomUUID();
    const claim = await prisma.certificate.updateMany({
      where: {
        id: certificate.id,
        emailDeliveredAt: null,
        OR: [{ deliveryClaimedAt: null }, { deliveryClaimedAt: { lt: claimExpiredBefore } }],
      },
      data: { deliveryClaimedAt: new Date(), deliveryClaimToken },
    });
    if (claim.count === 0) continue;

    deliveryRetried += 1;
    try {
      const bytes = await objectStorage().getBytes(
        certificate.fileId
          ? (await prisma.file.findUniqueOrThrow({ where: { id: certificate.fileId } })).storageKey
          : '',
      );
      await sendCertificateEmail({
        email: certificate.booking.student.email,
        studentName: certificate.booking.student.name,
        courseName: certificate.booking.round.course.title,
        attachment: bytes,
        filename: `certificate-${certificate.publicId}.pdf`,
      });
      await prisma.certificate.updateMany({
        where: { id: certificate.id, emailDeliveredAt: null, deliveryClaimToken },
        data: {
          emailDeliveredAt: new Date(),
          deliveryClaimedAt: null,
          deliveryClaimToken: null,
          deliveryAttempts: { increment: 1 },
          lastDeliveryError: null,
        },
      });
    } catch (error) {
      deliveryFailed += 1;
      await prisma.certificate.updateMany({
        where: { id: certificate.id, emailDeliveredAt: null, deliveryClaimToken },
        data: {
          deliveryClaimedAt: null,
          deliveryClaimToken: null,
          deliveryAttempts: { increment: 1 },
          lastDeliveryError:
            error instanceof Error ? error.message.slice(0, 2000) : 'Unknown email delivery error',
        },
      });
    }
  }
  return { deliveryRetried, deliveryFailed };
}

export async function listCertificates(studentId: bigint): Promise<CertificateWithDetails[]> {
  return prisma.certificate.findMany({
    where: { booking: { studentId } },
    include: certificateInclude,
    orderBy: { issuedAt: 'desc' },
  });
}

export async function findCertificateForDownload(
  id: bigint,
): Promise<CertificateWithDetails & { file: { storageKey: string } }> {
  const certificate = await prisma.certificate.findUnique({
    where: { id },
    include: { ...certificateInclude, file: true },
  });
  if (!certificate) throw new AppError(404, 'Certificate was not found.', 'CERTIFICATE_NOT_FOUND');
  return certificate;
}

export async function verifyCertificate(publicId: string): Promise<CertificateWithDetails> {
  const certificate = await prisma.certificate.findUnique({
    where: { publicId },
    include: certificateInclude,
  });
  if (!certificate) throw new AppError(404, 'Certificate was not found.', 'CERTIFICATE_NOT_FOUND');
  return certificate;
}
