# Lumify Backend

Backend for Lumify, a single-instructor course platform. It supports student authentication and
profiles, course rounds, manual payment review, protected course delivery, recorded sessions, and
cancellation processing.

## Stack

- Node.js 20.18+ (Node.js 22 is used by Docker and CI)
- TypeScript and Fastify
- PostgreSQL and Prisma
- Zod for environment validation
- Cloudflare R2 via its S3-compatible API for private uploaded files
- Swagger UI for generated API documentation
- Docker and Docker Compose

## Current status

The planned backend workflows are implemented:

- OTP registration/reset, JWT access and rotated refresh sessions, profiles, and role authorization
- Payment-method administration and private Cloudflare R2 uploads/downloads
- Course catalogue/administration, rounds, weekly schedules, and protected materials
- Booking, historical pricing, receipt submission, manual review, and transaction-safe capacity
- Protected live/WhatsApp join payloads and recorded-session management with historical access
- Student cancellation requests and admin completion after an external refund
- Course-wide real-time communities for confirmed students and the instructor, with moderated history and private attachments
- Runtime OpenAPI/Swagger, PostgreSQL journey tests, Docker, CI, Nginx templates, and backups

See [docs/plan.md](docs/plan.md) for implementation decisions, [docs/schema.md](docs/schema.md)
for the data model, [docs/refactoring.md](docs/refactoring.md) for the active structural-change
record, and [docs/deployment.md](docs/deployment.md) for the production runbook.

## Prerequisites

- Node.js `>=20.18.0`
- npm
- PostgreSQL 16+, or Docker with Docker Compose

## Local development

Install dependencies and create a local environment file:

```bash
npm ci
cp .env.example .env
```

Update `DATABASE_URL` in `.env` if PostgreSQL is not running locally with the example credentials. Apply migrations, then start the development server:

```bash
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

The API is available at `http://localhost:3000` by default.

## Docker Compose

Create the environment file before starting Compose:

```bash
cp .env.example .env
docker compose up --build
```

This starts the API and a PostgreSQL 16 database. The API waits for the database health check, applies pending Prisma migrations, then starts listening on port `3000`.

Stop the services with:

```bash
docker compose down
```

To also remove the local database volume:

```bash
docker compose down --volumes
```

## Environment variables

| Variable                       | Default                 | Purpose                                                               |
| ------------------------------ | ----------------------- | --------------------------------------------------------------------- |
| `NODE_ENV`                     | `development`           | Application environment: `development`, `test`, or `production`.      |
| `HOST`                         | `0.0.0.0`               | Interface on which Fastify listens.                                   |
| `PORT`                         | `3000`                  | HTTP port.                                                            |
| `TRUST_PROXY`                  | `false`                 | Trust reverse-proxy headers; enable only behind the production proxy. |
| `DATABASE_URL`                 | —                       | PostgreSQL connection URL. Required outside Docker Compose defaults.  |
| `LOG_LEVEL`                    | `info`                  | Pino log level.                                                       |
| `CORS_ORIGIN`                  | `http://localhost:5173` | Comma-separated allowed browser origins.                              |
| `JWT_ACCESS_SECRET`            | Development-only value  | At least 32 characters; required in production.                       |
| `JWT_REFRESH_SECRET`           | Development-only value  | At least 32 characters; required in production.                       |
| `ACCESS_TOKEN_TTL`             | `15m`                   | Access-token lifetime.                                                |
| `REFRESH_TOKEN_TTL_DAYS`       | `30`                    | Rotated refresh-session lifetime.                                     |
| `OTP_TTL_MINUTES`              | `10`                    | Email-verification/reset OTP lifetime.                                |
| `EXPOSE_OTP_IN_RESPONSE`       | `false`                 | Return OTPs in API responses; use only for non-public staging.        |
| `RESEND_API_KEY`               | —                       | Resend credential; required in production.                            |
| `RESEND_FROM_EMAIL`            | —                       | Verified Resend sender; required in production.                       |
| `R2_ACCOUNT_ID`                | —                       | Cloudflare account ID; required in production.                        |
| `R2_BUCKET_NAME`               | —                       | Private Cloudflare R2 bucket name; required in production.            |
| `R2_ACCESS_KEY_ID`             | —                       | R2 API-token access key; required in production.                      |
| `R2_SECRET_ACCESS_KEY`         | —                       | R2 API-token secret; required in production.                          |
| `R2_PRESIGNED_URL_TTL_SECONDS` | `900`                   | Upload and download URL lifetime (60–3600 seconds).                   |
| `ADMIN_EMAIL`                  | —                       | Optional idempotent bootstrap-admin email.                            |
| `ADMIN_PASSWORD`               | —                       | Bootstrap-admin password (8+ characters).                             |
| `ADMIN_NAME`                   | `Lumify Admin`          | Bootstrap-admin display name.                                         |
| `DATABASE_URL_DOCKER`          | Compose database URL    | Overrides the API database URL used by Docker Compose.                |
| `POSTGRES_PORT`                | `5432`                  | Host port exposed for PostgreSQL by Docker Compose.                   |

Never commit `.env`; use `.env.example` as the template.

Configure the private R2 bucket CORS policy for the frontend origins in `CORS_ORIGIN`, allowing `PUT`, `GET`, and `HEAD` with all request headers and exposing `ETag`. Do not enable public bucket access: the API authorizes course-image downloads and redirects to short-lived signed URLs.

## API documentation

| Endpoint           | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `GET /health`      | Returns the service health and timestamp.                            |
| `GET /ready`       | Checks API and PostgreSQL readiness.                                 |
| `/docs/`           | Swagger UI generated from Fastify route schemas.                     |
| `/docs/json`       | OpenAPI JSON document.                                               |
| `/auth/*`          | Registration, OTP verification, login, sessions, and password flows. |
| `/users/me`        | Read and update the authenticated user profile.                      |
| `/payment-methods` | Public listing and admin management.                                 |
| `/files/*`         | Signed image/document uploads and authorized private-file reads.     |
| `/courses`         | Public catalogue plus administrator course management.               |
| `/rounds/*`        | Rounds, schedules, protected materials, join payloads, and sessions. |
| `/bookings`        | Student bookings, payment evidence, state filters, and cancellation. |
| `/admin/*`         | Payment review, cancellation queue/completion, and session listing.  |
| `/communities`     | Eligible course-community list and cursor-paginated message history. |

## Course communities

Socket.IO is served from the API host. Connect with the JWT access token in
`handshake.auth.token`, then join a course room with `community:join`. The server verifies the
access token and current course eligibility for every community action and before each delivery.
An expired socket stays connected but cannot act or receive community events until the client emits
`community:reauth` with `{ token: freshAccessToken }`. Confirmed students can access communities
for any course round they are currently confirmed in; admins can access all communities. Archived
courses remain readable but prohibit both sending and deleting messages. This deployment runs one
API instance; horizontal scaling requires a Socket.IO Redis adapter (or equivalent shared pub/sub).

## Commands

```bash
npm run dev             # Start the development server with file watching
npm run build           # Compile TypeScript to dist/
npm start               # Run the compiled server
npm test                # Run tests
npm run lint            # Lint TypeScript source
npm run format:check    # Check Prettier formatting
npm run format          # Format files with Prettier
npm run prisma:generate # Generate the Prisma client
npm run prisma:migrate  # Create and apply a development migration
npm run prisma:deploy   # Apply committed migrations
```

## Project layout

```text
src/
├── app/                 # Fastify construction and server startup
├── common/              # Authorization, business rules, errors, security, and validation
├── config/              # Environment validation
├── infrastructure/      # Database and external-service adapters
└── modules/             # Auth, users, files, courses, rounds, bookings, and sessions

prisma/
├── schema.prisma        # Prisma data model
└── migrations/          # Versioned PostgreSQL migrations

test/                    # Automated tests
docs/                    # Requirements, schema, and implementation plan
deploy/                  # Nginx templates and PostgreSQL backup command
```

## Production deployment

Use `docker-compose.production.yml` with a private `.env.production`, host Nginx, HTTPS, and a
scheduled off-host PostgreSQL backup. The complete sequence and verification checklist are in
[docs/deployment.md](docs/deployment.md). Do not expose the production database port publicly.

## CI

GitHub Actions runs dependency installation, Prisma client generation, formatting, linting, TypeScript compilation, and tests on every push and pull request.
