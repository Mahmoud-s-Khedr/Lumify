CREATE TYPE "course_review_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "payment_methods"
ADD COLUMN "description" TEXT;

UPDATE "payment_methods"
SET "description" = ''
WHERE "description" IS NULL;

ALTER TABLE "payment_methods"
ALTER COLUMN "description" SET NOT NULL;

ALTER TABLE "bookings"
ADD COLUMN "transaction_reference" TEXT;

CREATE TABLE "course_reviews" (
  "id" BIGSERIAL NOT NULL,
  "course_id" BIGINT NOT NULL,
  "student_id" BIGINT NOT NULL,
  "rating" INTEGER NOT NULL,
  "comment" TEXT NOT NULL,
  "status" "course_review_status" NOT NULL DEFAULT 'PENDING',
  "admin_note" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "course_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "course_reviews_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5)
);

CREATE UNIQUE INDEX "course_reviews_course_id_student_id_key"
ON "course_reviews"("course_id", "student_id");

CREATE INDEX "course_reviews_course_id_status_created_at_idx"
ON "course_reviews"("course_id", "status", "created_at");

CREATE INDEX "course_reviews_student_id_idx" ON "course_reviews"("student_id");

ALTER TABLE "course_reviews"
ADD CONSTRAINT "course_reviews_course_id_fkey"
FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "course_reviews"
ADD CONSTRAINT "course_reviews_student_id_fkey"
FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
