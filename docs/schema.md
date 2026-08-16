-- =========================================================
-- ENUMS
-- =========================================================

CREATE TYPE user_role AS ENUM (
    'ADMIN',
    'STUDENT'
);


CREATE TYPE auth_token_type AS ENUM (
    'EMAIL_VERIFICATION',
    'PASSWORD_RESET'
);


CREATE TYPE weekday AS ENUM (
    'SATURDAY',
    'SUNDAY',
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY'
);


CREATE TYPE booking_status AS ENUM (
    'PENDING_PAYMENT',
    'PENDING_REVIEW',
    'CONFIRMED',
    'PAYMENT_REJECTED',
    'CANCELLATION_REQUESTED',
    'CANCELLED'
);


CREATE TABLE payment_methods (
    key     VARCHAR(100) PRIMARY KEY,
    value   TEXT NOT NULL
);

-- =========================================================
-- USERS
-- =========================================================

CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,

    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    phone           VARCHAR(50),
    contact_info    JSONB,

    password_hash   TEXT NOT NULL,

    role            user_role NOT NULL DEFAULT 'STUDENT',

    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,

    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);


-- =========================================================
-- AUTH TOKENS
-- =========================================================

CREATE TABLE auth_tokens (
    id              BIGSERIAL PRIMARY KEY,

    user_id         BIGINT NOT NULL REFERENCES users(id),

    type            auth_token_type NOT NULL,

    token_hash      TEXT NOT NULL,
    expires_at      TIMESTAMP NOT NULL,

    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);


-- =========================================================
-- FILES
-- =========================================================

CREATE TABLE files (
    id              BIGSERIAL PRIMARY KEY,

    storage_key     TEXT NOT NULL,

    original_name   TEXT NOT NULL,
    mime_type       VARCHAR(255),
    size_bytes      BIGINT,

    uploaded_by     BIGINT REFERENCES users(id),

    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);


-- =========================================================
-- COURSES
-- =========================================================

CREATE TABLE courses (
    id                      BIGSERIAL PRIMARY KEY,

    title                   VARCHAR(255) NOT NULL,
    description             TEXT,

    price                   NUMERIC(10, 2) NOT NULL,

    outcomes                JSONB,
    skills                  JSONB,
    prerequisite_skills     JSONB,

    prerequisite_course_id  BIGINT REFERENCES courses(id),

    demo_video_url          TEXT,

    archived                BOOLEAN NOT NULL DEFAULT FALSE,

    created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);


-- =========================================================
-- COURSE IMAGES
-- =========================================================

CREATE TABLE course_images (
    id              BIGSERIAL PRIMARY KEY,

    course_id       BIGINT NOT NULL REFERENCES courses(id),
    file_id         BIGINT NOT NULL REFERENCES files(id),

    sort_order      INTEGER,

    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);


-- =========================================================
-- COURSE ROUNDS
-- =========================================================

CREATE TABLE course_rounds (
    id                      BIGSERIAL PRIMARY KEY,

    course_id               BIGINT NOT NULL REFERENCES courses(id),

    start_date              DATE NOT NULL,
    end_date                DATE NOT NULL,

    capacity                INTEGER NOT NULL,

    live_join_url           TEXT,
    whatsapp_url            TEXT,
    joining_instructions    TEXT,

    created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);


-- =========================================================
-- ROUND SCHEDULE
-- =========================================================

CREATE TABLE round_schedules (
    id              BIGSERIAL PRIMARY KEY,

    round_id        BIGINT NOT NULL REFERENCES course_rounds(id),

    weekday         weekday NOT NULL,
    start_time      TIME NOT NULL,

    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);


-- =========================================================
-- ROUND MATERIALS
-- =========================================================

CREATE TABLE round_materials (
    id              BIGSERIAL PRIMARY KEY,

    round_id        BIGINT NOT NULL REFERENCES course_rounds(id),

    title           VARCHAR(255) NOT NULL,

    file_id         BIGINT REFERENCES files(id),
    external_url    TEXT,

    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);


-- =========================================================
-- BOOKINGS
-- =========================================================

CREATE TABLE bookings (
    id                      BIGSERIAL PRIMARY KEY,

    student_id              BIGINT NOT NULL REFERENCES users(id),
    round_id                BIGINT NOT NULL REFERENCES course_rounds(id),

    price                   NUMERIC(10, 2) NOT NULL,

    status                  booking_status NOT NULL
                            DEFAULT 'PENDING_PAYMENT',

    payment_method_key      VARCHAR(100)
                            REFERENCES payment_methods(key),
    receipt_file_id         BIGINT REFERENCES files(id),

    admin_note              TEXT,
    reviewed_at             TIMESTAMP,

    cancellation_reason     TEXT,
    cancelled_at            TIMESTAMP,

    created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP NOT NULL DEFAULT NOW(),

    UNIQUE (student_id, round_id)
);


-- =========================================================
-- SESSIONS
-- =========================================================

CREATE TABLE sessions (
    id              BIGSERIAL PRIMARY KEY,

    round_id        BIGINT NOT NULL REFERENCES course_rounds(id),

    title           VARCHAR(255) NOT NULL,
    session_date    TIMESTAMP NOT NULL,

    recording_url   TEXT,

    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);