-- Existing schedules did not record a duration. Preserve them as one-hour lessons so the
-- required end-time column can be introduced without blocking deployment; administrators can
-- correct a legacy entry through the schedule update endpoint if needed.
ALTER TABLE "round_schedules" ADD COLUMN "end_time" TIME(0);

UPDATE "round_schedules"
SET "end_time" = ("start_time" + INTERVAL '1 hour')::TIME(0);

ALTER TABLE "round_schedules" ALTER COLUMN "end_time" SET NOT NULL;
