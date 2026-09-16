CREATE TABLE "community_read_states" (
    "course_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "last_read_message_id" BIGINT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_read_states_pkey" PRIMARY KEY ("course_id", "user_id")
);

CREATE INDEX "community_read_states_user_id_idx" ON "community_read_states"("user_id");

ALTER TABLE "community_read_states"
    ADD CONSTRAINT "community_read_states_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_read_states"
    ADD CONSTRAINT "community_read_states_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
