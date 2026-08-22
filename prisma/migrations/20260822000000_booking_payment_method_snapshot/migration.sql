-- Preserve the exact manual-payment destination shown to the student when
-- evidence is submitted, even if the configured payment method later changes.
ALTER TABLE "bookings"
ADD COLUMN "payment_method_snapshot" JSONB;
