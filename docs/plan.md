# Lumify Backend — Final Implementation Plan

This plan treats Lumify as a **single-instructor course platform**. The backend covers authentication, profiles, course/round management, manual booking/payment approval, course access, materials, and sessions. Those are the mandatory workflows defined by the SRS.

## 1. Final stack

```text
Runtime          Node.js
Language         TypeScript
Framework        Fastify
Database         PostgreSQL
ORM              Prisma
Validation       Zod / Fastify schemas
API Docs         Swagger + Swagger UI
Email            Resend
File Storage     Cloudflare R2
Reverse Proxy    Nginx
Deployment       Docker + Docker Compose
Server           VPS
```

Swagger will **not** be manually maintained.

The API schemas used by the actual routes will be the source of truth:

```text
Route
 ├── request schema
 ├── response schema
 └── validation
        │
        ▼
   Swagger/OpenAPI
        │
        ▼
   Runtime API docs
```

So when an endpoint/schema changes, Swagger reflects it from the application configuration rather than requiring a separate API document.

---

# 2. Final database scope

The initial database consists of:

```text
users
auth_tokens
files
payment_methods

courses
course_images

course_rounds
round_schedules
round_materials

bookings
sessions
```

Relationships:

```text
users
 ├── auth_tokens
 ├── files
 └── bookings
          │
          ▼
     course_rounds
       ├── round_schedules
       ├── round_materials
       ├── sessions
       └── course
             └── course_images

payment_methods
      │
      └── bookings
```

Payments and cancellation state stay within `bookings`; we do not need separate payment/refund domain tables for the current requirements. A booking records the selected manual payment method and its uploaded receipt.

---

# 3. Project structure

Keep it as a modular monolith.

```text
src/
├── app/
│   ├── app.ts
│   └── server.ts
│
├── modules/
│   ├── auth/
│   ├── users/
│   ├── files/
│   ├── payment-methods/
│   ├── courses/
│   ├── rounds/
│   ├── bookings/
│   └── sessions/
│
├── infrastructure/
│   ├── database/
│   ├── r2/
│   └── resend/
│
├── common/
│   ├── errors/
│   ├── authorization/
│   ├── validation/
│   └── utilities/
│
└── config/
```

No microservices or unnecessary abstraction.

---

# Phase 1 — Foundation — ✅ Completed (2026-08-16)

Build the application skeleton first.

### Work

* Initialize Node.js + TypeScript.
* Configure Fastify.
* Configure Prisma.
* Connect PostgreSQL.
* Implement the approved database schema.
* Create initial migration.
* Configure environment validation.
* Configure global error handling.
* Configure structured logging.
* Configure CORS and security headers.
* Add `/health`.
* Configure Swagger/OpenAPI.
* Configure Swagger UI.
* Add Dockerfile.
* Add Docker Compose.
* Add lint/test/build CI.

### Result

At the end of this phase:

```text
Backend starts
PostgreSQL connects
Prisma migrations work
Swagger UI loads
Health check works
Docker environment works
```

### Completion record

Implemented the Fastify/TypeScript application foundation, Prisma schema and initial PostgreSQL migration, environment validation, error handling, structured logging, CORS/security headers, health endpoint, generated Swagger UI, Docker configuration, and CI. Verified formatting, TypeScript build, linting, health/Swagger tests, Docker Compose configuration, and migration deployment against a PostgreSQL container.

---

# Phase 2 — Authentication, users, and configuration — ✅ Completed (2026-08-16)

The SRS requires registration, OTP verification, login, forgot password, profile management, and password changes.

### Authentication

Implement:

* Registration.
* Email OTP verification.
* Resend OTP.
* Login.
* Logout.
* Token refresh if using refresh tokens.
* Forgot password.
* Password reset.
* Change password.
* `ADMIN` / `STUDENT` authorization.

Registration collects name, email, phone, and password. Password validation must enforce the agreed strong-password policy wherever a password is set or changed.

Resend handles:

```text
Registration OTP
Password-reset OTP
```

### Profile

Implement:

* Get current profile.
* Update name.
* Update phone.
* Update `contact_info` JSONB.
* Require phone before booking.

### Payment methods

Admin CRUD:

```text
INSTAPAY      → account/phone information
VODAFONE_CASH → account/phone information
```

Students can list currently configured payment methods.

### Frontend localisation boundary

English/Arabic localization, system-language selection, and English fallback are frontend responsibilities. The backend has no locale preference, translation catalogue, or `Accept-Language` behavior in this scope; the frontend translates any API messages it displays.

### Acceptance gate

Run journey tests covering:

* registration
* OTP
* login
* password reset
* profile editing
* phone requirement
* payment-method management
* role authorization

### Completion record

Implemented OTP registration/verification and password-reset flows through Resend, hashed password and OTP storage, JWT access tokens with rotated HttpOnly refresh sessions, profile APIs, `ADMIN`/`STUDENT` guards, environment-based admin bootstrap, and payment-method CRUD. OTPs are returned only in development/test responses (and test mode makes no outbound email request). Verified API journeys against PostgreSQL.

---

# Phase 3 — Files and courses — ✅ Completed (2026-08-20)

The SRS requires course information, multiple images, prerequisite information and an external demo video. 

## File service

Build the generic R2 integration once.

It will handle:

```text
course images
round materials
payment receipts
```

Flow:

```text
Frontend
   │
   │ asks for upload permission
   ▼
Backend
   │
   │ signed R2 upload information
   ▼
Frontend ─────────► R2
   │
   │ upload complete
   ▼
Backend
   │
   ▼
files record
```

Private files such as payment receipts must require authorization.

## Courses

Implement:

* Create course.
* Update course.
* Archive course.
* View archived courses.
* Permanently delete only when the course has no round that has started; explain that this action is irreversible in the admin-facing API contract.
* Course details.
* Multiple images.
* Image ordering.
* Price.
* Outcomes JSON.
* Skills JSON.
* Prerequisite skills JSON.
* Prerequisite course.
* External demo video URL.

## Course catalogue

Implement:

* List available courses.
* Get course details.
* Search by:

  * title
  * description
  * skills

The SRS calls for filtering by `rate`, but defines neither a rating source nor a review/rating submission workflow. Do not silently reinterpret it as price. Before implementation, obtain a product decision on whether `rate` means a stored course rating (and how it is populated) or another existing field; then add only the minimal data model and catalogue filter required by that decision.

### Acceptance gate

Run journeys for:

* course creation
* image upload
* course editing
* archive
* search
* unauthorized course management

### Completion record

Implemented private Cloudflare R2-compatible signed uploads and authorized downloads for course images, including JPEG/PNG/WebP validation and a 50 MB limit. Implemented course creation, editing, image ordering, archiving, guarded deletion, prerequisite validation, external demo-video URLs, and the public searchable course catalogue. Verified Phase 3 journeys alongside existing authentication and health tests.

---

# Phase 4 — Rounds, schedules, and materials — ✅ Completed (2026-08-22)

The SRS defines rounds with dates, recurring weekdays/times, capacity and materials. 

## Course rounds

Implement:

* Create round.
* Get round.
* List course rounds.
* Update the round's core details only while it has no bookings.
* Delete a round only while it has no bookings.
* Update materials and external material links regardless of enrollment, as the SRS explicitly allows.

The SRS says a round may be updated or deleted only when no students are registered. Treat any existing booking as enrollment for these two guards, including a pending booking, so an admin cannot invalidate a student's request. This replaces the earlier assumption that capacity could always be changed. If the product needs capacity changes after enrollment, it must be explicitly approved as a policy exception and include an audit trail.

## Flexible schedule

Use `round_schedules`.

Example:

```text
Saturday   14:00
Monday     16:00
Thursday   20:30
```

Implement:

* Add schedule entry.
* Update schedule entry.
* Delete schedule entry.
* Return complete weekly schedule.

## Materials

Support:

```text
FILE
→ uploaded through Lumify → R2

LINK
→ arbitrary external URL
```

The platform does not integrate with Drive, Dropbox, or other external providers; they are simply URLs.

### Acceptance gate

Test:

* round creation
* different times per weekday
* schedule modification
* capacity modification before enrollment
* R2 material upload
* external material link
* rejection of core updates/deletion once a booking exists
* permitted material/link update after enrollment

### Completion record

Implemented public course-round listing and details, admin round creation/update/deletion,
flexible per-weekday schedules, and booking-aware mutation guards. Added private R2 material
uploads with file/link material CRUD and confirmed-student access controls. Verified Phase 4
journeys and the complete existing test suite against PostgreSQL.

---

# Phase 5 — Booking and manual payments — ✅ Completed (2026-08-22)

This is the most important business phase.

The SRS requires students to book a round, submit payment evidence, and allow the admin to review bookings and remaining capacity.

## Booking

Student:

```text
Select round
    ↓
Check round has available capacity
    ↓
Create booking
    ↓
PENDING_PAYMENT
```

Store:

```text
student
round
price at booking time
status
```

The historical booking price must not change if the course price changes later.

## Payment submission

```text
PENDING_PAYMENT
       ↓
choose a configured payment method
       ↓
transfer money manually to its account/phone number
       ↓
upload a screenshot of the payment to R2
       ↓
PENDING_REVIEW
```

The platform performs no automated payment verification and does not integrate with a payment gateway. Students see the configured account/phone details (for example, Instapay or Vodafone Cash), send the money outside Lumify, and upload a screenshot of the payment. The receipt is private in R2 and the booking moves to `PENDING_REVIEW`.

## Admin review

Admin views:

* Student.
* Phone.
* Course.
* Round.
* Expected payment.
* Payment method and its account/phone details.
* Payment receipt screenshot.
* Submission details.

Admin can:

```text
APPROVE
REJECT
```

Approval:

```text
PENDING_REVIEW → CONFIRMED
```

Rejection:

```text
PENDING_REVIEW → PAYMENT_REJECTED
```

Rejected payments can be resubmitted.

The admin verifies the receipt manually against transactions in the payment account they control, then approves or rejects the booking. Lumify does not attempt to inspect or reconcile the admin's account automatically.

## Booking administration and student list

Admin booking lists must provide the student's profile, course, round, booking datetime, payment-method details, and receipt; they must also report confirmed-booked and empty-seat counts. Support the SRS booking-state filters: `PENDING`, `REJECTED`, and `CANCELLED` (mapped explicitly to the internal booking statuses in the API documentation).

Students can list their booked rounds and filter by either booking state (`PENDING`, `REJECTED`, `CANCELLED`) or calculated round state (`UPCOMING`, `IN_PROGRESS`, `FINISHED`). Define the filter semantics so that a state can be selected independently and combined predictably; round states are derived from start/end dates.

---

# 6. Capacity rules

These rules should be implemented exactly.

### Only confirmed students consume capacity

```text
available =
MAX(round.capacity - confirmed_bookings, 0)
```

Pending requests do not consume capacity.

For example:

```text
Capacity       40
Confirmed      15
Pending        80

Available      25
```

Students may continue applying.

### Full round

```text
Capacity       40
Confirmed      40
Available       0
```

No new booking can be created.

### Approval must check capacity again

```text
capacity = 40
confirmed = 39

Booking A pending
Booking B pending
```

Approve A:

```text
confirmed = 40
```

Approval of B must then fail.

This check must use a PostgreSQL transaction/locking strategy so simultaneous approvals cannot result in:

```text
41 / 40
```

### Capacity follows round update rules

Capacity is a core round detail. It can be changed while the round has no bookings, but the SRS does not allow it to be changed after students have registered. This avoids silently putting confirmed students over a newly lowered capacity. Materials and links remain independently editable after enrollment.

### Acceptance gate

The booking phase is not complete until the journey tests for:

* duplicate booking
* historical pricing
* receipt submission
* manual payment-method details and receipt access
* admin verification against a recorded manual-payment submission
* approval
* rejection
* resubmission
* admin booking counts and state filters
* student booked-round state filters
* pending requests exceeding capacity
* final-seat approval
* simultaneous approval race
* capacity update before enrollment and rejection after enrollment

all pass.

### Completion record

Implemented student round booking with phone, duplicate, historical-price, archived-course, and
confirmed-capacity guards. Added private receipt-image uploads, configured manual-payment
submission with preserved account details, admin approval/rejection, rejected-payment
resubmission, admin enrollment counts, and composable booking/round-state filters. PostgreSQL row
locking serializes booking and approval decisions for a round so concurrent final-seat approvals
cannot exceed capacity. Verified every Phase 5 acceptance journey and the complete existing test
suite against PostgreSQL.

---

# Phase 6 — Course delivery

The SRS requires students to access their rounds, live links, WhatsApp links, materials and recorded sessions. 

## Student rounds

Expose:

```text
UPCOMING
IN_PROGRESS
FINISHED
```

These are calculated from dates rather than stored.

The student's booked-round endpoint implements the SRS filters described in Phase 5, including booking outcomes and these calculated round states.

## Live access

After the round start date is reached, admin can set or update:

* live meeting URL
* WhatsApp URL
* joining instructions

Reject attempts to add either join URL before the start date. Only confirmed students can retrieve protected join information.

Provide a dedicated join-screen payload containing the instructions plus the live-join and WhatsApp actions when their links are available. Do not expose either URL in public course or round responses.

## Sessions

Admin can:

* Create session.
* Update session.
* Delete session.
* Add title.
* Add date.
* Add external recording URL.

Lumify doesn't manage the recording platform.

A recording URL can point to anything:

```text
Google Drive
Dropbox
Vimeo
YouTube
other service
```

## Historical access

A confirmed student retains access to the round's materials and recorded sessions after it ends. Admins have access to all sessions of all rounds. This implements the SRS requirement that enrolled students and admins can access sessions even after the round ends.

---

# Phase 7 — Cancellation

Cancellation is desirable rather than mandatory in the SRS. 

Implement:

```text
CONFIRMED
    ↓
CANCELLATION_REQUESTED
    ↓
Admin reviews
    ↓
Admin manually refunds externally
    ↓
CANCELLED
```

Store:

* Cancellation reason.
* Admin note.
* Cancellation timestamp.

Lumify does not perform the actual financial refund.

Admin can list cancellation requests with the student profile, course, round, and original booking details; completing the request records `CANCELLED` and removes the student's course access. This is a desirable SRS feature and should follow the mandatory phases if delivery must be staged.

---

# Phase 8 — Final testing and hardening

At this point run the complete approved journey suite.

The major test categories are:

```text
Authentication journeys
Profile journeys
Payment-method journeys
Course journeys
Round/schedule journeys
File journeys
Booking/payment journeys
Capacity/concurrency journeys
Course-access journeys
Session journeys
Cancellation journeys
Authorization journeys
Swagger journey
```

In addition to journey tests, include:

### Unit tests

For important business rules:

* Capacity calculation.
* Booking-state transitions.
* Password/token rules.
* Authorization.
* Round-state calculation.

### Integration tests

Against a real PostgreSQL test database:

* Prisma repositories.
* Booking transactions.
* Capacity locking.
* Course/round relationships.
* File ownership.

### API tests

Exercise complete HTTP requests through Fastify.

---

# Phase 9 — Production deployment

VPS layout:

```text
                     Internet
                         │
                         ▼
                       Nginx
                         │
                         ▼
                  Backend container
                         │
                         ▼
                    PostgreSQL

External:
├── Cloudflare R2
└── Resend
```

Nginx handles:

* HTTPS termination.
* Reverse proxying.
* Request limits.
* Forwarded headers.

Docker Compose runs:

```text
api
postgres
```

Nginx can run either on the host or as another container; I would keep it on the host unless there is a reason to containerize it.

---

# Phase 10 — Production completion checklist

I would consider Lumify backend **done** when:

* Database schema and Prisma migrations are stable.
* All agreed features are implemented.
* All approved journey tests pass.
* Capacity cannot be exceeded under concurrency.
* R2 private-file authorization works.
* Admin/student authorization works.
* Resend flows work in production.
* Manual payment methods show the correct account/phone details, receipts remain private, and admins can approve/reject after their own account verification.
* Swagger documents the running API automatically.
* Application runs behind Nginx.
* HTTPS is enabled.
* PostgreSQL backups are configured.
* Production environment variables/secrets are configured.
* Health endpoint works.
* Backend can be redeployed reliably through Docker.

## Final execution order

```text
1. Project foundation
       ↓
2. Auth + profiles + payment methods
       ↓
3. Files + courses
       ↓
4. Rounds + schedules + materials
       ↓
5. Booking + manual payments + capacity
       ↓
6. Student access + sessions
       ↓
7. Cancellation
       ↓
8. Complete journey testing
       ↓
9. Security / production hardening
       ↓
10. Nginx + VPS deployment
```

The course-community/chat section is optional in the SRS and is deferred from this baseline. It needs its own moderation, real-time delivery, file-access, and retention design before it can be scheduled.

This is the implementation order I would use for the repository as well: each phase should end in a working, testable slice rather than building all database/repository code first and delaying functional workflows until the end.
