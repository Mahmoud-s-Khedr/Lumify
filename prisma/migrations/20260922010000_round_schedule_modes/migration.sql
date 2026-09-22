-- Existing rounds use the recurring weekly timetable. Custom occurrences are
-- deliberately independent from delivery sessions and recordings.
CREATE TYPE "round_schedule_mode" AS ENUM ('WEEKLY', 'CUSTOM');

ALTER TABLE "course_rounds"
  ADD COLUMN "schedule_mode" "round_schedule_mode" NOT NULL DEFAULT 'WEEKLY';

-- Weekly entries may now have more than one non-overlapping rule per weekday.
DROP INDEX IF EXISTS "round_schedules_round_id_weekday_key";

CREATE INDEX "round_schedules_round_id_weekday_idx"
  ON "round_schedules"("round_id", "weekday");

CREATE TABLE "round_occurrences" (
  "id" BIGSERIAL NOT NULL,
  "round_id" BIGINT NOT NULL,
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "round_occurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "round_occurrences_round_id_fkey"
    FOREIGN KEY ("round_id") REFERENCES "course_rounds"("id") ON DELETE CASCADE
);

CREATE INDEX "round_occurrences_round_id_start_at_idx"
  ON "round_occurrences"("round_id", "start_at");
