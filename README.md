# Lumify Backend

Backend for Lumify, a single-instructor course platform. It will support student authentication and profiles, course rounds, manual payment review, learning materials, and recorded sessions.

## Stack

- Node.js 20.18+ (Node.js 22 is used by Docker and CI)
- TypeScript and Fastify
- PostgreSQL and Prisma
- Zod for environment validation
- Swagger UI for generated API documentation
- Docker and Docker Compose

## Current status

The application foundation is in place:

- Fastify application with security headers, CORS, structured logging, and consistent error responses
- PostgreSQL schema and initial Prisma migration
- Health endpoint and generated OpenAPI/Swagger UI
- Docker image, Docker Compose configuration, and GitHub Actions verification

Authentication, profiles, role authorization, refresh sessions, transactional OTP delivery, and payment-method management are implemented. Course, booking, payment-review, file, and session modules remain on the roadmap. See [docs/plan.md](docs/plan.md) for the roadmap and [docs/schema.md](docs/schema.md) for the database design.

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

| Variable                 | Default                 | Purpose                                                              |
| ------------------------ | ----------------------- | -------------------------------------------------------------------- |
| `NODE_ENV`               | `development`           | Application environment: `development`, `test`, or `production`.     |
| `HOST`                   | `0.0.0.0`               | Interface on which Fastify listens.                                  |
| `PORT`                   | `3000`                  | HTTP port.                                                           |
| `DATABASE_URL`           | —                       | PostgreSQL connection URL. Required outside Docker Compose defaults. |
| `LOG_LEVEL`              | `info`                  | Pino log level.                                                      |
| `CORS_ORIGIN`            | `http://localhost:5173` | Comma-separated allowed browser origins.                             |
| `JWT_ACCESS_SECRET`      | Development-only value  | At least 32 characters; required in production.                      |
| `JWT_REFRESH_SECRET`     | Development-only value  | At least 32 characters; required in production.                      |
| `ACCESS_TOKEN_TTL`       | `15m`                   | Access-token lifetime.                                               |
| `REFRESH_TOKEN_TTL_DAYS` | `30`                    | Rotated refresh-session lifetime.                                    |
| `OTP_TTL_MINUTES`        | `10`                    | Email-verification/reset OTP lifetime.                               |
| `RESEND_API_KEY`         | —                       | Resend credential; required in production.                           |
| `RESEND_FROM_EMAIL`      | —                       | Verified Resend sender; required in production.                      |
| `ADMIN_EMAIL`            | —                       | Optional idempotent bootstrap-admin email.                           |
| `ADMIN_PASSWORD`         | —                       | Bootstrap-admin password (8+ characters).                            |
| `ADMIN_NAME`             | `Lumify Admin`          | Bootstrap-admin display name.                                        |
| `DATABASE_URL_DOCKER`    | Compose database URL    | Overrides the API database URL used by Docker Compose.               |
| `POSTGRES_PORT`          | `5432`                  | Host port exposed for PostgreSQL by Docker Compose.                  |

Never commit `.env`; use `.env.example` as the template.

## API documentation

| Endpoint           | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `GET /health`      | Returns the service health and timestamp.                            |
| `/docs/`           | Swagger UI generated from Fastify route schemas.                     |
| `/docs/json`       | OpenAPI JSON document.                                               |
| `/auth/*`          | Registration, OTP verification, login, sessions, and password flows. |
| `/users/me`        | Read and update the authenticated user profile.                      |
| `/payment-methods` | Authenticated listing and admin management.                          |

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
├── common/errors/       # Shared application errors
├── config/              # Environment validation
└── infrastructure/      # Database and external-service adapters

prisma/
├── schema.prisma        # Prisma data model
└── migrations/          # Versioned PostgreSQL migrations

test/                    # Automated tests
docs/                    # Requirements, schema, and implementation plan
```

## CI

GitHub Actions runs dependency installation, Prisma client generation, formatting, linting, TypeScript compilation, and tests on every push and pull request.
