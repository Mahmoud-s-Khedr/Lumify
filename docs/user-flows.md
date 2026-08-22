# Feature list

## 1. Authentication

* Student registration.
* Email verification using OTP.
* Resend verification OTP.
* Login.
* Logout.
* Forgot password.
* Reset password.
* Change password.
* `ADMIN` and `STUDENT` roles.
* Resend used for transactional emails.

The SRS explicitly requires registration, OTP verification, login, forgot password, and password validation. 

## 2. User profile

Students can:

* View their profile.
* Update name.
* Update phone.
* Update `contact_info` JSON.
* Change password.

A phone number is required before booking a round, as required by the SRS.  

---

## 3. Payment methods management

Admin can manage available manual payment methods.

Each payment method is essentially:

```text
key   → INSTAPAY
value → 01234567890
```

or:

```text
key   → VODAFONE_CASH
value → 01012345678
```

Admin can:

* Add payment method.
* Edit payment method.
* Delete payment method.
* List payment methods.

Students see these when paying for a round.

No payment gateway exists.

---

## 4. File management

One central file system handles all files uploaded by Lumify.

Examples:

* Course images.
* Course material files.
* Payment receipts.

Metadata lives in the database through the `files` table.

Actual files live in Cloudflare R2.

External resources are **not files managed by Lumify**.

Examples:

* Google Drive link.
* Dropbox link.
* Zoom link.
* Google Meet link.
* External video link.

Those remain simple URLs.

---

## 5. Course management

Admin can:

* Create course.
* Edit course.
* Archive course.
* View archived courses.
* Delete course where allowed.
* Add:

  * title
  * description
  * price
  * outcomes
  * skills
  * prerequisite skills
  * prerequisite course
  * external demo video URL
* Upload multiple course images.
* Order course images.

These fields and operations come from the SRS course requirements. 

---

## 6. Course catalogue

Students and admin can:

* List available courses.
* Open course details.
* Search by:

  * title
  * description
  * skills

The SRS explicitly requires this search functionality. 

The `"rate"` filtering mentioned in the SRS remains unresolved because the SRS never defines a rating feature.

---

## 7. Course rounds

Admin can create multiple rounds for a course.

A round contains:

* Start date.
* End date.
* Capacity.
* Weekly schedule.
* Live meeting URL.
* WhatsApp group URL.
* Joining instructions.
* Materials.

The SRS defines rounds using start/end dates, weekdays, time, capacity, and materials. 

Admin can:

* Create round.
* View round.
* Edit round.
* Delete round where allowed.
* Change capacity at any time.

---

## 8. Flexible round schedule

A round can have multiple weekly days with different starting times.

Example:

```text
Saturday   → 14:00
Monday     → 16:00
Thursday   → 20:30
```

The admin can add, update, and remove schedule entries.

---

## 9. Round materials

Admin can attach materials to a round as either:

### Uploaded file

```text
PDF
ZIP
PowerPoint
document
etc.
```

stored in R2 and linked through `files`.

### External URL

```text
Google Drive
Dropbox
website
external document
etc.
```

This directly matches the SRS requirement for materials as `"files or link"`. 

---

# 10. Booking a round

Student can apply for an upcoming round.

Requirements:

* Student must have a phone number.
* Student cannot book the same round twice.
* Booking stores the price at the time of booking.
* Booking starts as:

```text
PENDING_PAYMENT
```

The SRS requires users to book upcoming rounds and provide payment evidence. 

---

# 11. Manual payment

Student:

1. Creates booking.
2. Chooses one of the configured payment methods.
3. Pays outside Lumify.
4. Uploads payment receipt.
5. Receipt becomes a `files` record.
6. Booking moves to:

```text
PENDING_REVIEW
```

The receipt can be an image, PDF, or other document MIME type up to 10 MB.

---

# 12. Admin payment review

Admin can see pending payment requests with:

* Student.
* Phone.
* Course.
* Round.
* Price.
* Payment method.
* Receipt.
* Submission date.

Admin can:

```text
APPROVE
```

or:

```text
REJECT
```

Approval:

```text
PENDING_REVIEW
      ↓
CONFIRMED
```

Rejection:

```text
PENDING_REVIEW
      ↓
PAYMENT_REJECTED
```

Admin can attach a note explaining rejection.

The SRS requires the admin to see booked students and payment receipts. 

---

# 13. Round capacity

This is now a very specific rule.

Only:

```text
CONFIRMED
```

bookings consume capacity.

Example:

```text
capacity       = 40
confirmed      = 25
pending review = 70

available      = 15
```

The 70 pending requests do **not** reduce capacity.

Students can continue applying until:

```text
confirmed == capacity
```

Then new applications are blocked.

Available capacity:

```text
MAX(capacity - confirmed, 0)
```

---

## 14. Capacity check during approval

The system must check capacity again when the admin approves a booking.

Example:

```text
capacity = 40
confirmed = 39

Student A → pending
Student B → pending
```

Admin approves A:

```text
confirmed = 40
```

Admin then attempts to approve B:

```text
REJECT APPROVAL
ROUND FULL
```

This operation must be transactional so two simultaneous approvals cannot exceed the round capacity.

---

## 15. Capacity modification

Capacity can be raised or lowered at any time. Any booking, including a pending request, still
locks the round dates and weekly schedule. Materials and external links remain editable after
enrollment.

If capacity is lowered below the confirmed count, existing confirmations remain valid, available
capacity is reported as zero, and no further booking can be approved until capacity is raised.

---

# 16. Student rounds

Students can list their rounds as:

* Upcoming.
* In progress.
* Finished.

These states are calculated from the round dates.

This functionality is explicitly required by the SRS. 

---

# 17. Live course access

Admin can set:

* Live meeting URL.
* WhatsApp group URL.
* Joining instructions.

Live and WhatsApp URLs can be added only when the round start date has been reached. These values
never appear in public course or round responses; confirmed students retrieve a dedicated join
payload.

Confirmed students and students awaiting cancellation completion can access these.

Students without confirmed enrollment cannot.

The SRS requires live-session and WhatsApp access. 

---

# 18. Recorded sessions

Admin can:

* Create session.
* Update session.
* Delete session.
* Set title.
* Set date.
* Set external recording URL.

The external recording can be hosted anywhere.

Lumify only stores the URL.

Confirmed students can access sessions belonging to their round. Students awaiting cancellation
completion retain access until the admin completes the cancellation.

Students retain access after the round finishes, which is explicitly required by the SRS. 

---

# 19. Booking cancellation

Student can:

* Request cancellation.
* Provide reason.

Admin can:

* Review cancellation request.
* Refund money manually outside Lumify.
* Mark booking cancelled.

The cancellation queue includes the student profile, course, round, original booking, and reason.
The student retains protected course access while the request is pending. Completion records the
admin note and cancellation timestamp and removes that access; Lumify never performs the refund.

State:

```text
CONFIRMED
    ↓
CANCELLATION_REQUESTED
    ↓
CANCELLED
```

Cancellation/refund handling is marked desirable in the SRS. 

---

# 20. Runtime Swagger documentation

* Swagger UI.
* OpenAPI documentation generated automatically from API schemas/routes at runtime.
* Request schemas documented automatically.
* Response schemas documented automatically.
* Authentication requirements documented automatically.
* No manually maintained API specification.

---

# 21. Frontend localization

Frontend supports Arabic and English.

Backend has:

* No localization.
* No translations.
* No `/ar` or `/en` API routes.
* No bilingual database fields unless course content itself later requires them.

The SRS requires Arabic/English application localization, but in our architecture that responsibility belongs entirely to the frontend. 

---

# Explicitly out of scope

* Community.
* Chat.
* Messaging.
* WebSockets.
* Payment gateways.
* Automated payment verification.
* Automated refunds.
* Video hosting.
* Google Drive integration.
* Dropbox integration.
* Backend localization.
* Multi-instructor support.
* Multi-tenant support.

The community feature is optional in the SRS and has been intentionally removed. 

# Journey tests

These should represent the important **real user workflows**, rather than testing every endpoint independently.

## J01 — Registration and email verification

```text
Register
→ OTP sent through Resend
→ enter valid OTP
→ account verified
→ login succeeds
```

Also test:

```text
wrong OTP → fail
expired OTP → fail
```

---

## J02 — Login

```text
Verified student
→ correct email/password
→ login succeeds
→ authenticated APIs accessible
```

And:

```text
wrong password → rejected
```

---

## J03 — Password reset

```text
Forgot password
→ reset OTP sent
→ verify OTP
→ set new password
→ old password fails
→ new password succeeds
```

---

## J04 — Profile management

```text
Student logs in
→ reads profile
→ updates name
→ updates phone
→ updates contact_info JSON
→ retrieves profile
→ updated data returned
```

---

## J05 — Phone required for booking

```text
Student has no phone
→ attempts booking
→ rejected

Student adds phone
→ books again
→ succeeds
```

---

## J06 — Admin manages payment methods

```text
Admin creates:
INSTAPAY → 0123456789

→ payment method appears for students

Admin changes value
→ updated value returned

Admin adds Vodafone Cash
→ both methods available
```

---

## J07 — Admin creates course

```text
Admin
→ creates course
→ enters course details
→ uploads multiple images
→ adds demo URL
→ publishes course
→ course appears in catalogue
```

---

## J08 — Course editing

```text
Admin changes:
title
description
price
skills
outcomes
etc.

→ course reflects new values
```

---

## J09 — Course archiving

```text
Course active
→ appears publicly

Admin archives
→ disappears from available courses
→ remains visible to admin
```

---

## J10 — Course search

Create multiple courses and verify:

```text
search title
search description
search skills
```

returns the appropriate courses.

---

## J11 — Create round with flexible schedule

```text
Admin creates round:

capacity = 40

Saturday 14:00
Monday   16:00
Thursday 20:30

→ save
→ retrieve
→ all schedule entries returned correctly
```

---

## J12 — Modify round schedule

```text
Existing:
Saturday 14:00

Admin changes to:
Saturday 16:00

Admin adds:
Tuesday 18:00

→ updated schedule returned correctly
```

---

## J13 — Admin changes capacity

```text
capacity = 40

Admin changes to 50
→ capacity = 50

Admin changes to 20
→ capacity = 20
```

No existing confirmed bookings are removed.

---

## J14 — Upload round material

```text
Admin uploads PDF
→ R2 upload succeeds
→ file row exists
→ round material references file
→ confirmed student can access it
```

---

## J15 — Add external material

```text
Admin adds external URL
→ no Lumify file created
→ material contains URL
→ student can retrieve it
```

---

## J16 — Student books round

```text
Round capacity > confirmed students
→ student applies
→ booking created
→ status PENDING_PAYMENT
→ booking price captured
```

---

## J17 — Booking preserves historical price

```text
Course price = 1000
→ student books
→ booking.price = 1000

Admin changes course price to 1500

→ original booking still = 1000
```

---

## J18 — Duplicate booking prevented

```text
Student already booked round
→ attempts same round again
→ rejected
```

---

## J19 — Submit payment receipt

```text
PENDING_PAYMENT
→ student chooses InstaPay
→ uploads receipt
→ file created
→ booking links receipt
→ booking becomes PENDING_REVIEW
```

---

## J20 — Pending bookings do not consume capacity

```text
capacity = 40
confirmed = 0
pending review = 40

→ student #41 can still apply
```

This directly verifies the agreed business rule.

---

## J21 — Admin approves payment

```text
PENDING_REVIEW
→ admin opens receipt
→ verifies transaction manually
→ approves
→ booking becomes CONFIRMED
→ confirmed count increases
```

---

## J22 — Admin rejects payment

```text
PENDING_REVIEW
→ admin rejects
→ adds note
→ booking becomes PAYMENT_REJECTED
```

---

## J23 — Student resubmits rejected payment

```text
PAYMENT_REJECTED
→ student uploads new receipt
→ status returns PENDING_REVIEW
→ admin approves
→ CONFIRMED
```

---

## J24 — Capacity blocks new applications

```text
capacity = 40
confirmed = 40

→ new student tries to book
→ booking rejected because round is full
```

---

## J25 — Final seat race

```text
capacity = 40
confirmed = 39

Student A = PENDING_REVIEW
Student B = PENDING_REVIEW

Admin approves A
→ confirmed = 40

Admin approves B
→ rejected because capacity exhausted
```

---

## J26 — Concurrent approval protection

```text
capacity = 40
confirmed = 39

two approval requests happen simultaneously

→ only one succeeds
→ confirmed never becomes 41
```

This is the critical transactional capacity test.

---

## J27 — Increase full round capacity

```text
capacity = 40
confirmed = 40

→ applications blocked

Admin changes capacity → 50

→ available = 10
→ new applications allowed
```

---

## J28 — Decrease capacity below confirmed students

```text
capacity = 50
confirmed = 40

Admin changes capacity → 30

→ all 40 existing bookings remain CONFIRMED
→ available = 0
→ no new booking can be confirmed
```

---

## J29 — Admin enrollment counts

```text
capacity = 40
confirmed = 28
pending = 15

Admin views round

→ confirmed = 28
→ pending = 15
→ available = 12
```

Pending requests are not subtracted from availability.

---

## J30 — Student round classification

Student has three rounds:

```text
future round
current round
finished round
```

Verify they appear respectively under:

```text
UPCOMING
IN_PROGRESS
FINISHED
```

---

## J31 — Confirmed student accesses live links

```text
Admin adds:
meeting URL
WhatsApp URL
instructions

Confirmed student
→ opens round
→ receives all join information
```

---

## J32 — Unconfirmed student denied live access

```text
Student has:
PENDING_PAYMENT
or
PENDING_REVIEW
or
no booking

→ requests protected join information
→ access denied
```

---

## J33 — Admin creates recorded session

```text
Admin
→ adds title
→ date
→ recording URL

→ session appears in round
```

---

## J34 — Confirmed student accesses recordings

```text
Confirmed student
→ lists round sessions
→ recording links returned
```

---

## J35 — Finished-round access

```text
Student completed course
→ round end date passes
→ student opens sessions/materials
→ access still allowed
```

This is specifically required by the SRS. 

---

## J36 — Cancellation request

```text
CONFIRMED
→ student requests cancellation
→ provides reason
→ CANCELLATION_REQUESTED
```

---

## J37 — Complete manual cancellation

```text
Admin receives request
→ refunds manually outside platform
→ marks booking cancelled
→ status CANCELLED
→ cancelled_at recorded
```

---

## J38 — Private payment receipt authorization

```text
Student A uploads receipt

Admin → can view
Student A → can view if product requires it
Student B → cannot view
Anonymous user → cannot view
```

---

## J39 — Role authorization

Student attempts:

```text
create course
modify course
create round
change capacity
approve payment
create session
manage payment methods
```

Every operation must fail.

Admin performs the same operations and they succeed.

---

## J40 — Swagger runtime documentation

```text
Backend starts
→ Swagger UI available
→ endpoints appear
→ request schemas appear
→ response schemas appear
→ auth requirements appear
```

Then modify an API schema and confirm Swagger reflects the change without manually editing API documentation.
