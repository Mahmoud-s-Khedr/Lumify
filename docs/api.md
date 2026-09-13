# Lumify API reference

The API is served from the application root (for example, `http://localhost:3000`).
The interactive OpenAPI documentation is available at `GET /docs`; its machine-readable
representations are `GET /docs/json` and `GET /docs/yaml`.

## Conventions

- Resource IDs (`:id`, `:courseId`, `:scheduleId`, and `:materialId`) are decimal strings.
- Protected endpoints use `Authorization: Bearer <access-token>`, obtained from login or
  refresh. `Admin` means an authenticated user with the `ADMIN` role. `Student` means an
  authenticated user with the `STUDENT` role.
- Login and refresh set an HTTP-only `lumify_refresh_token` cookie. Send that cookie to
  `/auth/refresh` and `/auth/logout`.
- Successful delete and password-change operations return `204 No Content` unless noted.
- Validation failures return `400` with `{ "error": "VALIDATION_ERROR", "message": "..." }`.
  Application errors use `{ "error": "ERROR_CODE", "message": "..." }`.

## System and documentation

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Public | Liveness check; returns `status` and `timestamp`. |
| GET | `/ready` | Public | Database readiness check; returns `200` or `503`. |
| GET | `/docs` | Public | Swagger UI. |
| GET | `/docs/json` | Public | OpenAPI document as JSON. |
| GET | `/docs/yaml` | Public | OpenAPI document as YAML. |

## Authentication

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Create a student: `{ name, email, password }`; returns the user and development/notification OTP payload. |
| POST | `/auth/verify-email` | Public | Verify `{ email, code }`, where `code` is six digits. |
| POST | `/auth/resend-verification` | Public | Resend verification code for `{ email }`; always responds `202`. |
| POST | `/auth/login` | Public | Authenticate `{ email, password }`; returns `accessToken` and `user`, and sets refresh cookie. |
| POST | `/auth/refresh` | Refresh cookie | Rotate the refresh session and return a new `accessToken`. |
| POST | `/auth/logout` | Optional refresh cookie | Revoke the current refresh session and clear its cookie. |
| POST | `/auth/forgot-password` | Public | Request reset code for `{ email }`; always responds `202`. |
| POST | `/auth/verify-reset-code` | Public | Verify an unexpired reset code for `{ email, code }`; responds `204` without consuming the code. |
| POST | `/auth/reset-password` | Public | Reset with `{ email, code, newPassword }`. |
| POST | `/auth/change-password` | Authenticated | Change password with `{ currentPassword, newPassword }`; revokes all refresh sessions. |

## User profile

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| GET | `/users/me` | Authenticated | Get the current user profile. |
| PATCH | `/users/me` | Authenticated | Update one or more of `{ name?, phone?, contactInfo?, avatarFileId? }`; `phone`, `contactInfo`, and `avatarFileId` may be `null`. An avatar file must first be uploaded by the current user. |

## Student dashboard

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| GET | `/student/dashboard` | Student | Return the current student's name, confirmed-round summaries (with the next future session if any), up to four newest active courses not already confirmed-enrolled, and up to three newest eligible recording summaries. The response excludes join URLs, WhatsApp links, booking/payment data, receipts, and other students' data. |

## Student course pages

Both endpoints below require a student token. They include enrollments with booking status
`CONFIRMED` or `CANCELLATION_REQUESTED`; pending, rejected, and cancelled bookings do not have
access. Administrators receive `403`.

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| GET | `/student/courses` | Student | List card-ready accessible course rounds. Query: `q?` (case-insensitive course-title match), `roundState=UPCOMING\|IN_PROGRESS\|FINISHED`, `recordings=AVAILABLE\|NONE`, `page?` (default `1`), and `pageSize?` (default `20`, max `100`). Results sort in-progress first, then upcoming by nearest start date, then finished by most recent end date. |
| GET | `/student/rounds/:id` | Enrolled student | Return the enrolled course and round page data. A missing round returns `404`; a round without an accessible enrollment returns `403`. |

`GET /student/courses` returns `{ courses, pagination }`. Each course card contains
`courseId`, `title`, `image` (the first course-image file metadata and download URL, or `null`),
`roundId`, `startDate`, `endDate`, calculated `state`, `nextSession` (or `null`), and
`recordingCount`. `AVAILABLE` means one or more sessions have a non-null `recordingUrl`, even if
the session is in the future; `NONE` means no session has one.

`GET /student/rounds/:id` returns `{ course, round, sessions, materials }`. `course` contains
`id`, `title`, and `description`; `round` contains `id`, dates, calculated `state`, and weekly
`schedules`; sessions are chronological and expose only `id`, `title`, `sessionDate`, and
`recordingUrl`. Materials use the existing material shape (`id`, `title`, `kind`, `file`,
`externalUrl`, `createdAt`), including file metadata and its protected download URL. This payload
never includes live-join, WhatsApp, or joining-instruction values. Use `GET /rounds/:id/join`
when the student selects a session to join; its `actions.live.url` and `actions.whatsapp.url` are
the delivery links.

## Payment methods

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| GET | `/payment-methods` | Public | List configured manual-payment methods. |
| POST | `/payment-methods` | Admin | Create `{ key, value, description }`; keys are uppercase identifiers such as `VODAFONE_CASH`. |
| PATCH | `/payment-methods/:key` | Admin | Update one or both of `{ value?, description? }`. |
| DELETE | `/payment-methods/:key` | Admin | Delete a payment method. |

## Files

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| POST | `/files/uploads` | Authenticated for receipts, avatars, and community attachments; Admin for course images/materials | Create a signed upload URL. `COMMUNITY_ATTACHMENT` permits JPEG, PNG, GIF, WebP, PDF, TXT, DOC/DOCX, XLS/XLSX, and PPT/PPTX, up to 20 MB. |
| POST | `/files/uploads/complete` | Same as upload | Persist a completed upload. Community files use the private `community-attachments/` key prefix. |
| GET | `/files/:id/download` | Public for images of active courses and attached profile avatars; otherwise authorized | Community attachments are available to their uploader/admin and currently confirmed community members while the message remains visible. |

## Courses

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| GET | `/courses` | Public; Admin when `archived` is supplied | List active courses. Query: `q?`, `page?` (default `1`), `pageSize?` (default `20`, max `100`), `minRating?` (1–5), `sort=rating_desc\|rating_asc`, and `archived=true\|false` (admin only). Course results include approved-review `averageRating` (or `null`) and `reviewCount`. |
| GET | `/courses/:id` | Public for active courses; Admin for archived | Get course details, including approved-review rating summary. |
| POST | `/courses` | Admin | Create a course. Required: `{ title, price }`; optional: `description`, `outcomes`, `skills`, `prerequisiteSkills`, `prerequisiteCourseId`, `demoVideoUrl`, `imageFileIds`. |
| PATCH | `/courses/:id` | Admin | Update one or more create fields, plus `archived`. |
| DELETE | `/courses/:id` | Admin | Delete a course with no rounds or retained community history. Courses with rounds or community history must be archived instead. |

## Rounds and schedules

`weekday` is one of `SATURDAY`, `SUNDAY`, `MONDAY`, `TUESDAY`, `WEDNESDAY`, `THURSDAY`, or `FRIDAY`; `startTime` uses `HH:MM`, and dates use `YYYY-MM-DD`.

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| GET | `/courses/:courseId/rounds` | Public for active courses; Admin for archived | List only upcoming, non-full rounds. Each round includes `confirmedBooked`, `emptySeats`, and `availability` (`AVAILABLE` or `FULL`). Admins may use `includeUnavailable=true` to list every round. |
| GET | `/rounds/:id` | Public for active courses; Admin for archived | Get a round and its weekly schedule, capacity counts, and availability. |
| POST | `/courses/:courseId/rounds` | Admin | Create `{ startDate, endDate, capacity, schedules? }`; each schedule is `{ weekday, startTime }`. |
| PATCH | `/rounds/:id` | Admin | Update one or more of `{ startDate, endDate, capacity }`. Dates cannot change after bookings exist. |
| DELETE | `/rounds/:id` | Admin | Delete a round with no bookings. |
| POST | `/rounds/:id/schedules` | Admin | Add `{ weekday, startTime }`; unavailable after bookings exist. |
| PATCH | `/rounds/:id/schedules/:scheduleId` | Admin | Update `{ weekday?, startTime? }`; unavailable after bookings exist. |
| DELETE | `/rounds/:id/schedules/:scheduleId` | Admin | Delete a schedule entry; unavailable after bookings exist. |

## Course communities

Confirmed students may use a course-wide community when they have a currently `CONFIRMED` booking
in any round of that course. `CANCELLATION_REQUESTED`, cancelled, pending, and unrelated students
are excluded. Admins are the instructor and may access every community. Responses never expose
email addresses.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/communities` | Eligible student or admin | List accessible courses, `readOnly` archive state, and latest visible-message preview. |
| GET | `/communities/:courseId/messages?before=&limit=` | Eligible student or admin | Newest-first history; `limit` defaults to 50 (max 100), and `nextBefore` is the ID for the next page. |

Connect Socket.IO with `{ auth: { token: accessToken } }`. Every community action verifies the
socket's current access token and re-checks current course membership. Client events are
`community:join` and `community:leave` with `{ courseId }`, `community:sendMessage` with
`{ courseId, content?, attachmentIds? }`, and `community:deleteMessage` with `{ messageId }`.
When an access token expires, the socket stays connected but actions return
`{ error: "UNAUTHENTICATED", message }` and it receives no community events. Obtain a fresh token
through the normal authentication flow, then emit `community:reauth` with `{ token }`; its
successful acknowledgement is `{ ok: true }` and the socket keeps its joined rooms. Text is
trimmed and limited to 5,000 characters; each message can have at most ten uploaded community
attachments. Server events are `community:messageCreated` (a complete public message) and
`community:messageDeleted` (`{ id, courseId }`). Acknowledgement failures use `{ error, message }`.
Authors can delete their own messages; admins can delete any message. Deleted rows remain for
audit but disappear from history, and their attachments are no longer downloadable by other
students. Archived communities are fully read-only: both sending and deleting messages return
`COMMUNITY_READ_ONLY`.

## Round materials and course delivery

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| GET | `/rounds/:id/materials` | Admin or confirmed student | List protected materials. |
| POST | `/rounds/:id/materials` | Admin | Add `{ kind: "FILE", title, fileId }` or `{ kind: "LINK", title, externalUrl }`. |
| PATCH | `/rounds/:id/materials/:materialId` | Admin | Update `title`; changing source requires `kind` plus `fileId` (`FILE`) or `externalUrl` (`LINK`). |
| DELETE | `/rounds/:id/materials/:materialId` | Admin | Delete a material. |
| PATCH | `/admin/rounds/:id/join` | Admin | Set `{ liveJoinUrl?, whatsappUrl?, joiningInstructions? }`; live/WhatsApp URLs cannot be added before the round starts. Fields may be `null` to clear them. |
| GET | `/rounds/:id/join` | Admin or confirmed student | Get protected joining instructions and live/WhatsApp actions. |

## Sessions

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| GET | `/rounds/:id/sessions` | Admin or confirmed student | List protected recorded sessions for a round. |
| GET | `/admin/sessions` | Admin | List sessions across rounds; optional query `roundId`. |
| POST | `/rounds/:id/sessions` | Admin | Create `{ title, sessionDate, recordingUrl? }`; `sessionDate` is an offset-aware ISO datetime and `recordingUrl` may be `null`. |
| PATCH | `/sessions/:id` | Admin | Update one or more of `{ title, sessionDate, recordingUrl }`. |
| DELETE | `/sessions/:id` | Admin | Delete a recorded session. |

## Bookings and cancellations

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| POST | `/rounds/:id/bookings` | Student | Book an upcoming available round. The student's profile must have a phone number. |
| POST | `/bookings/:id/payment` | Student owner | Submit or resubmit manual-payment evidence: `{ paymentMethodKey, receiptFileId, transactionReference? }`. Set `transactionReference` to `null` or omit it to clear it. The receipt must be the student's completed `PAYMENT_RECEIPT` upload. Booking owner/admin payloads include it. |
| GET | `/bookings` | Student | List the current student's bookings. Optional query: `bookingState=PENDING|REJECTED|CANCELLED` and `roundState=UPCOMING|IN_PROGRESS|FINISHED`. |
| GET | `/admin/bookings` | Admin | List bookings for review. Optional query: `bookingState=PENDING|REJECTED|CANCELLED`. |
| POST | `/admin/bookings/:id/approve` | Admin | Approve a pending payment review. Optional body `{ adminNote? }`. |
| POST | `/admin/bookings/:id/reject` | Admin | Reject a pending payment review. Optional body `{ adminNote? }`. |
| POST | `/bookings/:id/cancellation` | Student owner | Cancel a pending booking immediately, or request cancellation of a confirmed booking that is upcoming or has fewer than two sessions in progress: `{ reason }`. |
| GET | `/admin/cancellations` | Admin | List cancellation requests awaiting external refund. |
| POST | `/admin/bookings/:id/cancellation/complete` | Admin | Mark an externally refunded cancellation complete. Optional body `{ adminNote? }`. |

## Booking states

The API response field `status` uses internal values such as `PENDING_PAYMENT`,
`PENDING_REVIEW`, `PAYMENT_REJECTED`, `CONFIRMED`, `CANCELLATION_REQUESTED`, and
`CANCELLED`. The list-filter field `bookingState` groups the first two as `PENDING` and
`PAYMENT_REJECTED` as `REJECTED`.

## Course reviews

Students can submit one review per course only after a booking in one of that course's rounds is
confirmed. A review has `{ rating, comment }`, where rating is an integer from 1 through 5. New
and revised reviews are `PENDING`; only `APPROVED` reviews are public and count toward course
ratings.

| Method | Path | Access | Body / purpose |
| --- | --- | --- | --- |
| GET | `/courses/:courseId/reviews` | Public for active courses; Admin for archived | Paginate approved reviews with `page?` and `pageSize?`. |
| GET | `/courses/:courseId/reviews/me` | Student | Get the student's own review, including moderation status and note. |
| POST | `/courses/:courseId/reviews` | Eligible student | Submit `{ rating, comment }` for moderation. |
| PATCH | `/courses/:courseId/reviews/me` | Eligible student | Revise `{ rating, comment }`; resubmits the review as pending and clears prior moderation data. |
| GET | `/admin/reviews` | Admin | Paginate reviews for moderation. Optional `courseId`, `status=PENDING\|APPROVED\|REJECTED`, `page`, and `pageSize`. |
| POST | `/admin/reviews/:id/approve` | Admin | Approve a pending review. Optional `{ adminNote? }`. |
| POST | `/admin/reviews/:id/reject` | Admin | Reject a pending review. Optional `{ adminNote? }`. |
