-- Replace the single prerequisite reference with a many-to-many relation while
-- retaining every existing prerequisite assignment.
CREATE TABLE "course_prerequisites" (
    "course_id" BIGINT NOT NULL,
    "prerequisite_course_id" BIGINT NOT NULL,

    CONSTRAINT "course_prerequisites_pkey" PRIMARY KEY ("course_id", "prerequisite_course_id")
);

INSERT INTO "course_prerequisites" ("course_id", "prerequisite_course_id")
SELECT "id", "prerequisite_course_id"
FROM "courses"
WHERE "prerequisite_course_id" IS NOT NULL;

CREATE INDEX "course_prerequisites_prerequisite_course_id_idx"
ON "course_prerequisites"("prerequisite_course_id");

ALTER TABLE "course_prerequisites"
ADD CONSTRAINT "course_prerequisites_course_id_fkey"
FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "course_prerequisites"
ADD CONSTRAINT "course_prerequisites_prerequisite_course_id_fkey"
FOREIGN KEY ("prerequisite_course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "courses" DROP CONSTRAINT "courses_prerequisite_course_id_fkey";
ALTER TABLE "courses" DROP COLUMN "prerequisite_course_id";
