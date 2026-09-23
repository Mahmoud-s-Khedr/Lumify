import { PDFDocument, TextAlignment } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { createCertificatePdf } from '../src/modules/certificates/service.js';

async function fillableTemplate(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([842, 595]);
  const form = pdf.getForm();
  const fields = [
    ['student_name', 90, 410, 660, 42],
    ['course_name', 90, 330, 660, 42],
    ['completion_date', 90, 140, 180, 24],
    ['certificate_id', 90, 100, 280, 24],
    ['verification_url', 420, 55, 330, 18],
  ] as const;

  for (const [name, x, y, width, height] of fields) {
    const field = form.createTextField(name);
    field.addToPage(page, { x, y, width, height });
    field.setAlignment(TextAlignment.Center);
    field.setFontSize(name === 'verification_url' ? 8 : 24);
  }
  form.createButton('qr_code').addToPage('QR', page, { x: 690, y: 90, width: 60, height: 60 });

  // This unsupported field proves flattening preserves existing template
  // appearances while Lumify-owned fields are removed and overlaid separately.
  const preservedField = form.createTextField('admin_note');
  preservedField.addToPage(page, { x: 90, y: 55, width: 180, height: 18 });
  preservedField.setText('Template-owned value');
  form.updateFieldAppearances();
  return pdf.save();
}

describe('certificate text rendering', () => {
  it.each([
    ['محمد أحمد', 'دورة تطوير الويب'],
    ['Ada Lovelace', 'Advanced TypeScript'],
    ['محمد Example Student', 'دورة TypeScript — Level 2'],
    ['أحمد 123، الدفعة الثانية!', 'أساسيات AI 2026'],
  ])('rasterizes shaped text for %s', async (studentName, courseName) => {
    const rendered = await createCertificatePdf({
      templateBytes: await fillableTemplate(),
      studentName,
      courseName,
      completionDate: new Date('2026-09-20T00:00:00.000Z'),
      publicId: 'AE2VfCl9t3bLVUTkc2FJ-dS31wmo4Z1M',
    });
    const output = await PDFDocument.load(rendered);

    // All fields, including the QR button and the template-owned field, become
    // immutable PDF content. The five controlled text fields are PNG overlays,
    // so their Unicode source must not be emitted as an unshaped PDF text run.
    expect(output.getForm().getFields()).toEqual([]);
    expect(Buffer.from(rendered).includes(Buffer.from(studentName))).toBe(false);
    expect(Buffer.from(rendered).includes(Buffer.from(courseName))).toBe(false);
    expect(
      Buffer.from(rendered)
        .toString('latin1')
        .match(/\/Subtype \/Image/g)?.length,
    ).toBeGreaterThanOrEqual(6);
  });
});
