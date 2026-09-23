import type { Prisma } from '@prisma/client';

export type CertificateWithDetails = Prisma.CertificateGetPayload<{
  include: { booking: { include: { student: true; round: { include: { course: true } } } } };
}>;

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function publicCertificate(certificate: CertificateWithDetails) {
  return {
    id: certificate.id.toString(),
    publicId: certificate.publicId,
    issuedAt: certificate.issuedAt.toISOString(),
    completionDate: dateOnly(certificate.completionDate),
    course: {
      id: certificate.booking.round.course.id.toString(),
      title: certificate.booking.round.course.title,
    },
    student: {
      id: certificate.booking.student.id.toString(),
      name: certificate.booking.student.name,
    },
    emailDeliveredAt: certificate.emailDeliveredAt?.toISOString() ?? null,
  };
}

export function publicVerification(certificate: CertificateWithDetails) {
  return {
    valid: true,
    certificateId: certificate.publicId,
    studentName: certificate.booking.student.name,
    courseTitle: certificate.booking.round.course.title,
    completionDate: dateOnly(certificate.completionDate),
  };
}
