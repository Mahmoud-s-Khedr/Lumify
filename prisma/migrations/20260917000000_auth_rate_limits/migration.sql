-- Distributed authentication rate limits. Keys are SHA-256 hashes so that IP
-- addresses and email addresses are not stored in plaintext.
CREATE TABLE "auth_rate_limits" (
    "action" VARCHAR(50) NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("action", "key_hash")
);

CREATE INDEX "auth_rate_limits_updated_at_idx" ON "auth_rate_limits"("updated_at");
