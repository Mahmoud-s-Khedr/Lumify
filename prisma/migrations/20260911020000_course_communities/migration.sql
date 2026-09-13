CREATE TABLE "community_messages" (
    "id" BIGSERIAL NOT NULL,
    "course_id" BIGINT NOT NULL,
    "sender_id" BIGINT NOT NULL,
    "content" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_message_attachments" (
    "id" BIGSERIAL NOT NULL,
    "message_id" BIGINT NOT NULL,
    "file_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "community_message_attachments_file_id_key"
    ON "community_message_attachments"("file_id");
CREATE INDEX "community_messages_course_id_created_at_id_idx"
    ON "community_messages"("course_id", "created_at", "id");
CREATE INDEX "community_messages_sender_id_idx" ON "community_messages"("sender_id");
CREATE INDEX "community_message_attachments_message_id_idx"
    ON "community_message_attachments"("message_id");

ALTER TABLE "community_messages"
    ADD CONSTRAINT "community_messages_course_id_fkey"
    FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_messages"
    ADD CONSTRAINT "community_messages_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_message_attachments"
    ADD CONSTRAINT "community_message_attachments_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "community_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_message_attachments"
    ADD CONSTRAINT "community_message_attachments_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
