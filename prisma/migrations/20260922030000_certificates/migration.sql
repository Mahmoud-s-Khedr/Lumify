-- CreateTable
CREATE TABLE "certificate_templates" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "file_id" BIGINT NOT NULL,
    "field_report" JSONB NOT NULL,
    "inspected_at" TIMESTAMP(3) NOT NULL,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_template_inspections" (
    "file_id" BIGINT NOT NULL,
    "field_report" JSONB NOT NULL,
    "inspected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "certificate_template_inspections_pkey" PRIMARY KEY ("file_id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" BIGSERIAL NOT NULL,
    "public_id" VARCHAR(64) NOT NULL,
    "booking_id" BIGINT NOT NULL,
    "file_id" BIGINT NOT NULL,
    "completion_date" DATE NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email_delivered_at" TIMESTAMP(3),
    "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_delivery_error" TEXT,
    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "certificate_templates_file_id_key" ON "certificate_templates"("file_id");
CREATE UNIQUE INDEX "certificates_public_id_key" ON "certificates"("public_id");
CREATE UNIQUE INDEX "certificates_booking_id_key" ON "certificates"("booking_id");
CREATE UNIQUE INDEX "certificates_file_id_key" ON "certificates"("file_id");
CREATE INDEX "certificates_public_id_idx" ON "certificates"("public_id");
CREATE INDEX "certificates_email_delivered_at_idx" ON "certificates"("email_delivered_at");

ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificate_template_inspections" ADD CONSTRAINT "certificate_template_inspections_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
