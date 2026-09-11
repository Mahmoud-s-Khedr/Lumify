ALTER TABLE "users" ADD COLUMN "avatar_file_id" BIGINT;

CREATE UNIQUE INDEX "users_avatar_file_id_key" ON "users"("avatar_file_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_avatar_file_id_fkey"
  FOREIGN KEY ("avatar_file_id") REFERENCES "files"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
