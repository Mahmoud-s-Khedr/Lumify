import { rgb, PDFDocument, StandardFonts, TextAlignment } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';

const outputPath = new URL('../certificate_template_lumify.pdf', import.meta.url);
const pdf = await PDFDocument.create();
pdf.setTitle('Lumify Certificate Template');
pdf.setSubject('Fillable course-completion certificate template for Lumify');
pdf.setAuthor('Lumify');

const page = pdf.addPage([841.89, 595.276]);
const form = pdf.getForm();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
const navy = rgb(0.07, 0.12, 0.23);
const slate = rgb(0.34, 0.40, 0.52);
const gold = rgb(0.77, 0.52, 0.08);
const paleGold = rgb(0.97, 0.94, 0.86);

function text(value, x, y, size, options = {}) {
  page.drawText(value, { x, y, size, font: options.font ?? font, color: options.color ?? navy });
}

function centered(value, y, size, options = {}) {
  const chosenFont = options.font ?? font;
  const width = chosenFont.widthOfTextAtSize(value, size);
  text(value, (page.getWidth() - width) / 2, y, size, { ...options, font: chosenFont });
}

function line(x1, y1, x2, y2, color = gold, thickness = 1) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
}

function textField(name, x, y, width, height, size, alignment = TextAlignment.Center) {
  const field = form.createTextField(name);
  field.addToPage(page, {
    x,
    y,
    width,
    height,
    textColor: navy,
    backgroundColor: rgb(1, 1, 1),
    borderColor: rgb(1, 1, 1),
    borderWidth: 0,
  });
  field.setAlignment(alignment);
  field.setFontSize(size);
  return field;
}

// Frame and non-editable artwork.
page.drawRectangle({ x: 22, y: 22, width: 798, height: 551, borderColor: navy, borderWidth: 4 });
page.drawRectangle({ x: 32, y: 32, width: 778, height: 531, borderColor: gold, borderWidth: 1.5 });
centered('LUMIFY', 522, 14, { font: bold, color: navy });
centered('CERTIFICATE OF COMPLETION', 466, 34, { font: bold, color: navy });
line(330, 451, 512, 451, gold, 1.5);
centered('This certificate is proudly presented to', 417, 14, { color: slate });
centered('for successfully completing the course', 314, 14, { color: slate });
centered('and meeting the completion requirements', 229, 13, { color: slate });

// Lumify controlled fields. These exact names are required by the certificate service.
textField('student_name', 115, 348, 612, 48, 29);
line(140, 344, 702, 344, gold, 1);
textField('course_name', 115, 263, 612, 42, 23);

text('DATE OF COMPLETION', 78, 134, 10, { font: bold, color: slate });
textField('completion_date', 78, 110, 185, 22, 11, TextAlignment.Left);
text('CERTIFICATE ID', 78, 87, 10, { font: bold, color: slate });
textField('certificate_id', 78, 63, 260, 22, 10, TextAlignment.Left);

// Signature space remains part of the template artwork.
line(334, 92, 522, 92, navy, 0.8);
centered('Signature / seal', 106, 13, { font: italic, color: navy });
centered('AUTHORIZED SIGNATURE', 78, 10, { font: bold, color: slate });

// A PDF button, not a text field. Lumify draws the verification QR here.
page.drawRectangle({ x: 672, y: 63, width: 82, height: 82, color: paleGold, borderColor: gold, borderWidth: 1.2 });
const qrButton = form.createButton('qr_code');
qrButton.addToPage('', page, { x: 674, y: 65, width: 78, height: 78, borderWidth: 0 });
text('SCAN TO VERIFY', 668, 49, 7.5, { font: bold, color: slate });
textField('verification_url', 470, 32, 280, 14, 6.5, TextAlignment.Right);

// Give standard fields visible placeholders for design-time preview. Lumify removes these
// fields and rasterizes the final values on issue, including Arabic and mixed-direction text.
form.getTextField('student_name').setText('STUDENT NAME');
form.getTextField('course_name').setText('COURSE TITLE');
form.getTextField('completion_date').setText('YYYY-MM-DD');
form.getTextField('certificate_id').setText('CERTIFICATE ID');
form.getTextField('verification_url').setText('https://api.example.com/certificates/.../verify');
form.updateFieldAppearances(font);

await writeFile(outputPath, await pdf.save());
