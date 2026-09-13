# Refactoring record

This document records structural changes to the backend. Refactoring work must preserve the
public HTTP API and database schema unless a separately documented feature change requires an
explicit migration and API update.

## Guardrails

- Work in one module or cohesive cross-cutting concern at a time.
- Keep route paths, request validation, response payloads, HTTP status codes, and error codes
  unchanged during a behavior-preserving refactor.
- Keep database migrations out of structural-only changes.
- Run `npm run lint`, `npm run build`, and `npm test` after every completed change set.
- Record the scope, verification result, and follow-up work below.

## Target module shape

Not every module needs every file. Introduce files only when they give a clear ownership boundary.

```text
modules/<feature>/
├── routes.ts       # Fastify registration, authorization, and HTTP status selection
├── schemas.ts      # Zod request schemas and inferred input types
├── service.ts      # Business workflows and transaction boundaries
├── presenter.ts    # Persistence models mapped to public API payloads
└── repository.ts   # Reusable persistence queries, when a service needs them
```

`common/` remains limited to cross-feature rules and utilities. Infrastructure modules own
external integrations; feature services own orchestration and business decisions.

## Change log

### 2026-09-13 — Refactor programme established

- Established this record and the behavior-preserving guardrails.
- Selected `bookings` as the first feature because it contains the most sensitive locking,
  capacity, payment-review, and cancellation workflows.
- Baseline before structural changes: lint, TypeScript build, and 37 integration/unit tests pass.

### 2026-09-13 — Bookings request/presentation extraction

- Moved bookings Zod schemas and inferred request/filter types into `schemas.ts`.
- Moved calendar normalization and public response mapping into `presenter.ts`.
- Kept all routes, payloads, status codes, transaction logic, and database schema unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Bookings service extraction

- Added `service.ts` as the sole owner of bookings Prisma query shapes, row locks, transactions,
  capacity checks, payment review, and cancellation transitions.
- Added `common/dates/calendar.ts` for the shared UTC calendar-day boundary used by booking
  workflows and booking presentation.
- Reduced `routes.ts` to HTTP-specific concerns without changing any route contract.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Rounds request, presentation, and service extraction

- Moved rounds Zod schemas and inferred mutation input types into `schemas.ts`.
- Moved round and material public response mapping into `presenter.ts`.
- Moved Prisma query shapes, locking, booking safeguards, schedule mutations, material validation,
  and orphan-file database cleanup into `service.ts`.
- Kept Fastify routes responsible for authorization, HTTP response selection, and object-storage
  deletion after the service has identified an orphaned file.
- Kept all routes, payloads, status codes, database schema, and error codes unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Courses request, presentation, and service extraction

- Moved courses Zod schemas and inferred request/query types into `schemas.ts`.
- Moved public course and ordered-image response mapping into `presenter.ts`.
- Moved catalogue filtering/rating queries, prerequisite validation, course creation and update,
  archive state mutation, image ownership/order validation, and transactional deletion cleanup
  into `service.ts`.
- Kept Fastify routes responsible for authorization, HTTP response selection, and object-storage
  deletion after the service has identified orphaned images.
- Kept all routes, payloads, status codes, database schema, and error codes unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Sessions request, presentation, and service extraction

- Moved sessions Zod schemas and inferred mutation input types into `schemas.ts`.
- Moved session and protected join-detail public response mapping into `presenter.ts`.
- Moved course-delivery access checks, round existence checks, join-detail updates, and session
  query and mutation workflows into `service.ts`.
- Kept Fastify routes responsible for authentication, authorization, request parsing, and HTTP
  response selection, with all routes, payloads, status codes, and error codes unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Student request, presentation, and service extraction

- Moved student course-list and round-param Zod schemas and inferred query type into `schemas.ts`.
- Moved the student course list, accessible-round lookup, confirmed-enrollment safeguard, and
  dashboard query workflows into `service.ts`.
- Moved student course cards, course-detail, dashboard, recording, material, and schedule public
  response mapping into `presenter.ts`.
- Kept Fastify routes responsible for authentication, student-role authorization, request parsing,
  and HTTP response selection, with all routes, payloads, status codes, and error codes unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Reviews request, presentation, and service extraction

- Moved review request, pagination, moderation schemas, and inferred inputs into `schemas.ts`.
- Moved public, owner, and moderator review response mapping into `presenter.ts`.
- Moved course lookup, confirmed-enrollment eligibility, review creation/resubmission, listing, and
  moderation state transitions into `service.ts`.
- Kept Fastify routes responsible for authentication, archived-course administrator access, request
  parsing, and HTTP response selection, with all routes, payloads, status codes, and error codes
  unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Users request, presentation, and service extraction

- Moved profile validation and inferred update input into `schemas.ts`.
- Moved public user and avatar response mapping into `presenter.ts`.
- Moved current-user lookup, profile mutation, avatar ownership/type/size validation, and Prisma
  update payload construction into `service.ts`.
- Kept Fastify routes responsible for authentication, request parsing, and HTTP response selection,
  with all routes, payloads, status codes, and error codes unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Payment-methods request and service extraction

- Moved payment-method creation, update, and parameter schemas with inferred inputs into
  `schemas.ts`.
- Moved list, create, update, and deletion persistence workflows into `service.ts`.
- Kept Fastify routes responsible for administrator authorization, request parsing, and HTTP
  response selection, with all routes, payloads, status codes, and error codes unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Communities request, presentation, and service extraction

- Moved community route parameters, cursor query validation, and inferred query input into
  `schemas.ts`.
- Moved public community and message response mapping into `presenter.ts`; socket delivery now
  reuses the same message presenter.
- Extended `service.ts` to own accessible-community listing and cursor-based history lookup while
  retaining existing community access and message workflows.
- Kept Fastify routes responsible for authentication, access authorization, request parsing, and
  HTTP response selection, with all routes, payloads, status codes, and error codes unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Files request, presentation, and service extraction

- Moved upload, completion, file-ID schemas, MIME-type rules, and inferred inputs into
  `schemas.ts`.
- Moved the reusable public file payload into `presenter.ts` and updated dependent feature
  presenters to import it directly.
- Moved signed-upload creation, completed-upload inspection/persistence, file lookup, and
  material/receipt/community download-access checks into `service.ts`.
- Kept Fastify routes responsible for authentication, administrator upload authorization, request
  parsing, and redirect/HTTP response selection, with all routes, payloads, status codes, and
  error codes unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### Next: follow-up review

### 2026-09-13 — Auth request, presentation, and service extraction

- Moved authentication request schemas and inferred inputs into `schemas.ts`.
- Moved the public authentication user response mapping into `presenter.ts`.
- Extended `service.ts` to own registration, email verification, credential validation, password
  reset, and password-change workflows alongside OTP and refresh-session persistence.
- Kept Fastify routes responsible for request parsing, JWT signing and verification, refresh-cookie
  handling, and HTTP response selection, with all routes, payloads, status codes, and error codes
  unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### Next: follow-up review

The planned route-heavy module boundary pass is complete. Review cross-feature duplication only
when a separate, cohesive refactor scope is identified. Continue to run the full quality gate after
each future behavior-preserving change set.

### 2026-09-13 — Communities Socket.IO boundary completion

- Moved Socket.IO event schemas and inferred event inputs into `schemas.ts`.
- Moved community message sending, archived-community protection, author/administrator deletion
  authorization, and soft-deletion persistence into `service.ts`.
- Reduced `socket.ts` to Socket.IO authentication, event parsing, room membership, acknowledgement,
  and delivery concerns; it no longer accesses Prisma directly.
- Kept all socket event names, payloads, acknowledgement/error codes, access rules, and database
  schema unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### 2026-09-13 — Repository boundary pass: foundational modules

- Added named persistence repositories for `auth`, `payment-methods`, `users`, `sessions`,
  `reviews`, and `files`.
- Moved each module's Prisma reads/writes and reusable include/query shapes into its repository;
  their services now retain workflows, authorization decisions, passwords, external storage/email
  orchestration, and HTTP-independent error selection.
- Kept public routes, payloads, status codes, error codes, and database schema unchanged.
- Verification: `npm run lint`, `npm run build`, and `npm test` passed (37 tests).

### Next: transaction-heavy repository pass

Extract the remaining repository boundaries one module at a time: `communities`, `courses`,
`student`, `bookings`, and `rounds`. Preserve the existing transaction and row-lock boundaries in
the services while moving reusable Prisma queries and include shapes into repositories.
