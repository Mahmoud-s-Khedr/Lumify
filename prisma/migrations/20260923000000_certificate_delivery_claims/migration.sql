-- AlterTable
ALTER TABLE "certificates"
  ADD COLUMN "delivery_claimed_at" TIMESTAMP(3),
  ADD COLUMN "delivery_claim_token" VARCHAR(36);

DROP INDEX "certificates_email_delivered_at_idx";
CREATE INDEX "certificates_email_delivered_at_delivery_claimed_at_idx"
  ON "certificates"("email_delivered_at", "delivery_claimed_at");
