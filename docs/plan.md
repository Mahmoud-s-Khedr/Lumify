# Lumify Backend — Final Implementation Plan

This plan treats Lumify as a **single-instructor course platform**. The backend covers authentication, profiles, course/round management, manual booking/payment approval, course access, materials, and sessions. Those are the core workflows defined by the SRS.   

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

Payments and cancellation state stay within `bookings`; we do not need separate payment/refund domain tables for the current requirements.

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

# Phase 3 — Files and courses

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
* Delete where permitted.
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

The `"rate"` filter mentioned in the SRS remains excluded until its meaning is clarified because no rating/review system is defined. 

### Acceptance gate

Run journeys for:

* course creation
* image upload
* course editing
* archive
* search
* unauthorized course management

---

# Phase 4 — Rounds, schedules, and materials

The SRS defines rounds with dates, recurring weekdays/times, capacity and materials. 

## Course rounds

Implement:

* Create round.
* Get round.
* List course rounds.
* Update round.
* Delete round according to business rules.
* Change capacity at any time.

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
* capacity modification
* R2 material upload
* external material link

---

# Phase 5 — Booking and manual payments

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
choose payment method
       ↓
pay externally
       ↓
upload receipt to R2
       ↓
PENDING_REVIEW
```

The platform performs no automated payment verification.

## Admin review

Admin views:

* Student.
* Phone.
* Course.
* Round.
* Expected payment.
* Payment method.
* Receipt.
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

### Capacity can always be changed

Admin may change:

```text
40 → 60
60 → 30
30 → 100
```

If:

```text
confirmed = 40
capacity = 30
```

the existing 40 students remain confirmed.

Available becomes:

```text
0
```

and no additional booking can be approved until capacity permits it.

### Acceptance gate

The booking phase is not complete until the journey tests for:

* duplicate booking
* historical pricing
* receipt submission
* approval
* rejection
* resubmission
* pending requests exceeding capacity
* final-seat approval
* simultaneous approval race
* capacity increase
* capacity decrease

all pass.

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

## Live access

Admin sets:

* live meeting URL
* WhatsApp URL
* joining instructions

Only confirmed students can retrieve protected join information.

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

A student who completed the round retains access to its materials and recorded sessions after the round ends, as explicitly required by the SRS. 

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

The community/chat section is intentionally absent. Although it appears as an optional feature in the SRS, it is outside the agreed project scope. 

This is the implementation order I would use for the repository as well: each phase should end in a working, testable slice rather than building all database/repository code first and delaying functional workflows until the end.
