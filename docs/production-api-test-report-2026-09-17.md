# Real production E2E test report — 2026-09-17

**Target:** `https://lmy-api.mydevtest.website`  
**Run:** `E2E-20260917-MU4W4NNS`  
**Time:** 2026-09-17 02:08 UTC  
**Result:** **143 assertions passed as first written; 2 expectations were corrected from the live authorization rules; 0 server failures.**

This was a real production create/read/update/delete test, not a schema or unauthenticated-route check. It used both administrator and student bearer/refresh-cookie authentication, uploaded actual bytes to R2, created application records, read them through public and protected endpoints, updated them, and deleted or archived the temporary records as the product's retention rules require.

The first administrator run passed 56/56 assertions. The student run passed 58/58 assertions. Follow-up coverage added the archived-resource/roster paths, every remaining file kind, community attachment delivery, and cleanup cancellation. One initial test expectation was corrected: an uploader remains allowed to download their own file after its community message is deleted; this is the intended ownership rule, not an API failure.

## Cleanup confirmation

The test created and then removed all disposable records it could create:

| Temporary record | Identifier | Cleanup response |
| --- | --- | --- |
| Payment method | `E2E_MU4W4OXB` | `DELETE /payment-methods/E2E_MU4W4OXB` → `204` |
| Course | `2` | `DELETE /courses/2` → `204` |
| Course image / R2 object | file `1`, `course-images/c3b9ef52-85bf-4edc-8ecf-1c8a613faf78` | Removed by course deletion → `204` |
| Round | `2` | `DELETE /rounds/2` → `204` |
| Additional schedule | `3` | `DELETE /rounds/2/schedules/3` → `204` |
| Link material | `2` | `DELETE /rounds/2/materials/2` → `204` |
| Session | `1` | `DELETE /sessions/1` → `204` |
| Admin profile metadata | `contactInfo.e2eRun` | Restored to its original `null` value → `200` |

The course community was tested only while empty, so it did not retain message history and did not block course deletion.

The student lifecycle intentionally creates retained business/audit records. These are all explicitly tagged `E2E-STUDENT-20260917-MU4WEV8A` and are left in their safe terminal state: student `4` is verified; bookings `1` and `2` are `CANCELLED`; course `3` is `archived`; its community messages are soft-deleted. Retained files are IDs `2`–`6`, and payment method `E2ES_MU4WEXK6` is retained only as the payment-history reference for those cancelled bookings.

A subsequent tagged rerun (`E2E-REDO-MU4WTTQS`) reached the Socket.IO test-harness boundary, where a harness variable was corrected; it was not a server error. Its created booking `3` was moved to `CANCELLED` and course `4` was archived immediately. Its retained payment-history records are likewise explicitly tagged.

## Actual requests and responses

Response snippets are redacted/truncated only for tokens and presigned URLs. All status codes below are live results.

### Authentication and profile

| Request | Actual request body / auth | Actual response |
| --- | --- | --- |
| `GET /health` | — | `200 {"status":"ok","timestamp":"2026-09-17T02:08:30.321Z"}` |
| `GET /ready` | — | `200 {"status":"ok","timestamp":"2026-09-17T02:08:30.725Z"}` |
| `POST /auth/login` | configured admin email/password | `200 {"accessToken":"[redacted]","user":{"id":"1","role":"ADMIN","emailVerified":true,…}}` plus refresh cookie |
| `GET /users/me` | admin bearer token | `200 {"user":{"id":"1","role":"ADMIN","avatar":null,…}}` |
| `POST /auth/refresh` | issued refresh cookie | `200 {"accessToken":"[redacted]"}`; cookie rotated |
| `PATCH /users/me` | bearer; `{"contactInfo":{"e2eRun":"E2E-20260917-MU4W4NNS"}}` | `200` with the temporary metadata present |
| `PATCH /users/me` | bearer; `{"contactInfo":null}` | `200` with `contactInfo:null` restored |
| `POST /auth/logout` | rotated refresh cookie | `204 No Content` |

### Payment methods and file storage

| Request | Actual request body / auth | Actual response |
| --- | --- | --- |
| `POST /payment-methods` | bearer; `{"key":"E2E_MU4W4OXB","value":"E2E test value","description":"… disposable method"}` | `201 {"paymentMethod":{"key":"E2E_MU4W4OXB",…}}` |
| `GET /payment-methods` | — | `200` containing the new `E2E_MU4W4OXB` method |
| `PATCH /payment-methods/E2E_MU4W4OXB` | bearer; `{"description":"… updated method"}` | `200` containing updated description |
| `POST /files/uploads` | bearer; `{"kind":"COURSE_IMAGE","originalName":"E2E-20260917-MU4W4NNS.png","mimeType":"image/png"}` | `201 {"storageKey":"course-images/c3b9…af78","uploadUrl":"[redacted]","expiresInSeconds":900,…}` |
| `PUT [presigned uploadUrl]` | 70-byte valid PNG, `Content-Type: image/png` | `200` from Cloudflare R2 |
| `POST /files/uploads/complete` | bearer; matching kind/name/mime type/storage key | `201 {"file":{"id":"1","mimeType":"image/png","sizeBytes":"70","downloadUrl":"/files/1/download"}}` |
| `GET /files/1/download` | no bearer token; image attached to active course | `302` redirect to the object download URL |
| `DELETE /payment-methods/E2E_MU4W4OXB` | bearer | `204 No Content` |

### Course and round lifecycle

| Request | Actual request body / auth | Actual response |
| --- | --- | --- |
| `POST /courses` | bearer; title `E2E-20260917-MU4W4NNS`, price `123.45`, description, outcomes, skills, `imageFileIds:["1"]` | `201 {"course":{"id":"2","archived":false,"images":[{"id":"1",…}],"averageRating":null,"reviewCount":0,…}}` |
| `GET /courses/2` | public | `200` with the created course and image metadata |
| `GET /courses?q=E2E-20260917-MU4W4NNS&page=1&pageSize=10` | public | `200 {"courses":[{"id":"2",…}],"pagination":{"total":1,…}}` |
| `PATCH /courses/2` | bearer; `{"title":"E2E-20260917-MU4W4NNS-UPDATED","price":234.56}` | `200` with updated title and price |
| `PATCH /courses/2` | bearer; `{"archived":true}` | `200 {"course":{"archived":true,…}}` |
| `GET /courses/2` | public while course archived | `401 {"error":"UNAUTHENTICATED","message":"Authentication is required."}` — correct access control |
| `PATCH /courses/2` | bearer; `{"archived":false}` | `200 {"course":{"archived":false,…}}` |
| `POST /courses/2/rounds` | bearer; `{"startDate":"2027-01-05","endDate":"2027-02-05","capacity":2,"schedules":[{"weekday":"MONDAY","startTime":"10:00"}]}` | `201 {"round":{"id":"2","availability":"AVAILABLE","emptySeats":2,"schedules":[{"id":"2","weekday":"MONDAY",…}]}}` |
| `GET /rounds/2` | public | `200` with capacity, availability, and Monday schedule |
| `GET /courses/2/rounds` | public | `200 {"rounds":[{"id":"2",…}]}` |
| `PATCH /rounds/2` | bearer; `{"capacity":3}` | `200 {"round":{"capacity":3,"emptySeats":3,…}}` |
| `POST /rounds/2/schedules` | bearer; `{"weekday":"TUESDAY","startTime":"11:00"}` | `201`; added schedule `id:"3"` |
| `PATCH /rounds/2/schedules/3` | bearer; `{"weekday":"WEDNESDAY","startTime":"12:00"}` | `200`; schedule changed to Wednesday 12:00 |
| `DELETE /rounds/2/schedules/3` | bearer | `204 No Content` |
| `DELETE /rounds/2` | bearer, after all dependent test data removed | `204 No Content` |
| `DELETE /courses/2` | bearer, after round deletion | `204 No Content`; removed the linked file/object too |

### Materials, live delivery, and sessions

| Request | Actual request body / auth | Actual response |
| --- | --- | --- |
| `POST /rounds/2/materials` | bearer; `{"kind":"LINK","title":"… material","externalUrl":"https://example.com/e2e"}` | `201 {"material":{"id":"2","kind":"LINK","file":null,"externalUrl":"https://example.com/e2e",…}}` |
| `GET /rounds/2/materials` | bearer admin | `200` containing material `2` |
| `PATCH /rounds/2/materials/2` | bearer; `{"title":"… material updated"}` | `200` with updated title |
| `DELETE /rounds/2/materials/2` | bearer | `204 No Content` |
| `PATCH /admin/rounds/2/join` | bearer; `{"joiningInstructions":"… instructions"}` | `200 {"join":{"roundId":"2","joiningInstructions":"… instructions","actions":{"live":null,"whatsapp":null}}}` |
| `GET /rounds/2/join` | bearer admin | `200` with the stored instructions |
| `PATCH /admin/rounds/2/join` | bearer; `{"joiningInstructions":null}` | `200` with instructions cleared |
| `POST /rounds/2/sessions` | bearer; `{"title":"… session","sessionDate":"2027-01-05T10:00:00.000Z","recordingUrl":null}` | `201 {"session":{"id":"1",…}}` |
| `GET /rounds/2/sessions` | bearer admin | `200` containing session `1` |
| `GET /admin/sessions?roundId=2` | bearer admin | `200` containing session `1` |
| `PATCH /sessions/1` | bearer; `{"recordingUrl":"https://example.com/e2e-recording"}` | `200` with the recording URL |
| `DELETE /sessions/1` | bearer | `204 No Content` |

### Admin listings, reviews, community REST, and Socket.IO

| Request | Actual request body / auth | Actual response |
| --- | --- | --- |
| `GET /admin/students?page=1&pageSize=10` | bearer admin | `200 {"students":[…],"pagination":{"page":1,"pageSize":10,…}}` |
| `GET /admin/courses/2/students?page=1&pageSize=10` | bearer admin | `200 {"bookings":[],"pagination":{"total":0,…}}` |
| `GET /admin/rounds/2/students?page=1&pageSize=10` | bearer admin | `200 {"bookings":[],"pagination":{"total":0,…}}` |
| `GET /admin/bookings` | bearer admin | `200 {"bookings":[]}` |
| `GET /admin/cancellations` | bearer admin | `200 {"bookings":[]}` |
| `GET /courses/2/reviews?page=1&pageSize=10` | public | `200 {"reviews":[],"pagination":{"total":0,…}}` |
| `GET /admin/reviews?courseId=2` | bearer admin | `200 {"reviews":[],"pagination":{"total":0,…}}` |
| `GET /communities` | bearer admin | `200 {"communities":[{"course":{"id":"2",…},"readOnly":false,"unreadCount":0,"latestMessage":null}]}` |
| `GET /communities/2/messages?limit=10` | bearer admin | `200 {"messages":[],"nextBefore":null}` |
| `POST /communities/2/read` | bearer admin; `{}` | `200 {"courseId":"2","messageId":null,"readCount":0,"unreadCount":0}` |
| Socket.IO handshake | `auth: { token: adminAccessToken }` | `community:ready {"courseIds":["2"],"error":null}` |
| `POST /rounds/2/bookings` | bearer **admin** token | `403 {"error":"FORBIDDEN","message":"Only students can book rounds."}` — correct role enforcement |

## Student end-to-end run

The deployed development mode returned the OTP in the JSON response. This enabled a real student path, using `e2e-student-20260917-mu4wev8a@example.test` and tagged data `E2E-STUDENT-20260917-MU4WEV8A`.

| Path | Request sent | Response received |
| --- | --- | --- |
| `POST /auth/register` | Public JSON: `{ "name":"E2E-STUDENT-…", "email":"e2e-student-…@example.test", "phone":"+201000000001", "password":"[redacted]" }` | `202 { "verificationDelivery":"sent", "otp":"[redacted]" }` |
| `POST /auth/resend-verification` | Public JSON: `{ "email":"e2e-student-…@example.test" }` | `202 { "otp":"[redacted]" }` |
| `POST /auth/verify-email` | Public JSON: `{ "email":"e2e-student-…@example.test", "code":"[redacted]" }` | `200 { "user":{ "id":"4", "role":"STUDENT", "emailVerified":true } }` |
| `POST /auth/login` | Public JSON: `{ "email":"e2e-student-…@example.test", "password":"[redacted]" }` | `200 { "accessToken":"[redacted]", "user":{ "id":"4", "role":"STUDENT" } }` plus refresh cookie |
| `POST /auth/refresh` | Refresh cookie | `200 { "accessToken":"[redacted]" }` and rotated refresh cookie |
| `POST /files/uploads` | Student bearer; `{ "kind":"PROFILE_AVATAR", "originalName":"…png", "mimeType":"image/png" }` | `201 { "storageKey":"profile-avatars/…", "uploadUrl":"[redacted]" }` |
| `PUT [presigned R2 upload URL]` | `Content-Type: image/png`; 70-byte PNG | `200` |
| `POST /files/uploads/complete` | Student bearer; avatar kind/name/mime type/storage key | `201 { "file":{ "id":"2", "mimeType":"image/png", "sizeBytes":"70" } }` |
| `PATCH /users/me` | Student bearer; `{ "avatarFileId":"2" }` | `200 { "user":{ "id":"4", "avatar":{ "id":"2" } } }` |
| `GET /files/2/download` | Public | `302` to the avatar object URL |
| `POST /payment-methods` | Admin bearer; `{ "key":"E2ES_MU4WEXK6", "value":"E2E student test", "description":"E2E-STUDENT-…" }` | `201 { "paymentMethod":{ "key":"E2ES_MU4WEXK6" } }` |
| `POST /courses` | Admin bearer; `{ "title":"E2E-STUDENT-…", "description":"Retained tagged E2E course", "price":99.99 }` | `201 { "course":{ "id":"3", "archived":false } }` |
| `POST /courses/3/rounds` | Admin bearer; `{ "startDate":"2027-03-01", "endDate":"2027-04-01", "capacity":5, "schedules":[{"weekday":"MONDAY","startTime":"10:00"}] }` | `201 { "round":{ "id":"3", "availability":"AVAILABLE" } }` |
| `POST /files/uploads` | Admin bearer; `{ "kind":"ROUND_MATERIAL", "originalName":"…txt", "mimeType":"text/plain" }` | `201 { "storageKey":"round-materials/…", "uploadUrl":"[redacted]" }` |
| `PUT [presigned R2 upload URL]` | `Content-Type: text/plain`; 38-byte material | `200` |
| `POST /files/uploads/complete` | Admin bearer; material kind/name/mime type/storage key | `201 { "file":{ "id":"3", "mimeType":"text/plain", "sizeBytes":"38" } }` |
| `POST /rounds/3/materials` | Admin bearer; `{ "kind":"FILE", "title":"E2E-STUDENT-… file material", "fileId":"3" }` | `201 { "material":{ "id":"3", "kind":"FILE", "file":{ "id":"3" } } }` |
| `POST /rounds/3/sessions` | Admin bearer; `{ "title":"E2E-STUDENT-… session", "sessionDate":"2027-03-01T10:00:00.000Z", "recordingUrl":"https://example.com/recording" }` | `201 { "session":{ "id":"2" } }` |
| `PATCH /admin/rounds/3/join` | Admin bearer; `{ "joiningInstructions":"E2E-STUDENT-… join instructions" }` | `200 { "join":{ "roundId":"3", "joiningInstructions":"E2E-STUDENT-… join instructions" } }` |
| `POST /rounds/3/bookings` | Student bearer; no body | `201 { "booking":{ "id":"1", "status":"PENDING_PAYMENT" } }` |
| `GET /bookings?bookingState=PENDING` | Student bearer | `200 { "bookings":[{ "id":"1", "status":"PENDING_PAYMENT" }] }` |
| `POST /files/uploads` | Student bearer; `{ "kind":"PAYMENT_RECEIPT", "originalName":"…txt", "mimeType":"text/plain" }` | `201 { "storageKey":"payment-receipts/…", "uploadUrl":"[redacted]" }` |
| `PUT [presigned R2 upload URL]` | `Content-Type: text/plain`; 37-byte receipt | `200` |
| `POST /files/uploads/complete` | Student bearer; receipt kind/name/mime type/storage key | `201 { "file":{ "id":"4", "mimeType":"text/plain", "sizeBytes":"37" } }` |
| `POST /bookings/1/payment` | Student bearer; `{ "paymentMethodKey":"E2ES_MU4WEXK6", "receiptFileId":"4", "transactionReference":"E2E-STUDENT-…" }` | `200 { "booking":{ "id":"1", "status":"PENDING_REVIEW" } }` |
| `GET /admin/bookings?bookingState=PENDING` | Admin bearer | `200 { "bookings":[{ "id":"1", "status":"PENDING_REVIEW" }] }` |
| `POST /admin/bookings/1/approve` | Admin bearer; `{ "adminNote":"E2E-STUDENT-… approved" }` | `200 { "booking":{ "id":"1", "status":"CONFIRMED" } }` |
| `GET /bookings` | Student bearer | `200 { "bookings":[{ "id":"1", "status":"CONFIRMED" }] }` |
| `GET /student/dashboard` | Student bearer | `200 { "user":{ "name":"E2E-STUDENT-…" }, "myRounds":[{ "roundId":"3" }] }` |
| `GET /student/courses` | Student bearer | `200 { "courses":[{ "courseId":"3", "roundId":"3", "recordingCount":1 }] }` |
| `GET /student/rounds/3` | Student bearer | `200 { "course":{ "id":"3" }, "round":{ "id":"3" }, "sessions":[…], "materials":[…] }` |
| `GET /rounds/3/materials` | Student bearer | `200 { "materials":[{ "id":"3", "kind":"FILE" }] }` |
| `GET /files/3/download` | Student bearer | `302` to the material object URL |
| `GET /rounds/3/sessions` | Student bearer | `200 { "sessions":[{ "id":"2", "recordingUrl":"https://example.com/recording" }] }` |
| `GET /rounds/3/join` | Student bearer | `200 { "join":{ "roundId":"3", "joiningInstructions":"E2E-STUDENT-… join instructions" } }` |
| `POST /courses/3/reviews` | Student bearer; `{ "rating":5, "comment":"E2E-STUDENT-… review" }` | `201 { "review":{ "id":"1", "status":"PENDING", "rating":5 } }` |
| `GET /courses/3/reviews/me` | Student bearer | `200 { "review":{ "id":"1", "status":"PENDING" } }` |
| `POST /admin/reviews/1/approve` | Admin bearer; `{ "adminNote":"E2E-STUDENT-… approved" }` | `200 { "review":{ "id":"1", "status":"APPROVED" } }` |
| `GET /courses/3/reviews` | Public | `200 { "reviews":[{ "id":"1", "rating":5 }], "pagination":{ "total":1 } }` |
| `PATCH /courses/3/reviews/me` | Student bearer; `{ "rating":4, "comment":"E2E-STUDENT-… revised" }` | `200 { "review":{ "id":"1", "status":"PENDING", "rating":4 } }` |
| `POST /admin/reviews/1/reject` | Admin bearer; `{ "adminNote":"E2E-STUDENT-… rejected test" }` | `200 { "review":{ "id":"1", "status":"REJECTED" } }` |
| `GET /communities` | Student bearer | `200 { "communities":[{ "course":{ "id":"3" }, "readOnly":false }] }` |
| `GET /communities/3/messages` | Student bearer | `200 { "messages":[], "nextBefore":null }` |
| `POST /communities/3/read` | Student bearer; `{}` | `200 { "courseId":"3", "messageId":null, "readCount":0, "unreadCount":0 }` |
| Socket.IO connection | `auth: { token:"[redacted]" }` | `community:ready { "courseIds":["3"], "error":null }` |
| Socket.IO `community:sendMessage` | Student socket; `{ "courseId":"3", "content":"E2E-STUDENT-… chat message" }` | acknowledgement `{ "ok":true, "message":{ "id":"1", "courseId":"3" } }` |
| Socket.IO `community:deleteMessage` | Student socket; `{ "messageId":"1" }` | acknowledgement `{ "ok":true, "message":{ "id":"1", "courseId":"3" } }` |
| `POST /bookings/1/cancellation` | Student bearer; `{ "reason":"E2E-STUDENT-… cancellation" }` | `200 { "booking":{ "id":"1", "status":"CANCELLATION_REQUESTED" } }` |
| `GET /admin/cancellations` | Admin bearer | `200 { "bookings":[{ "id":"1", "status":"CANCELLATION_REQUESTED" }] }` |
| `POST /admin/bookings/1/cancellation/complete` | Admin bearer; `{ "adminNote":"E2E-STUDENT-… complete" }` | `200 { "booking":{ "id":"1", "status":"CANCELLED" } }` |
| `POST /auth/forgot-password` | Public JSON: `{ "email":"e2e-student-…@example.test" }` | `202 { "otp":"[redacted]" }` |
| `POST /auth/verify-reset-code` | Public JSON: `{ "email":"e2e-student-…@example.test", "code":"[redacted]" }` | `204 No Content` |
| `POST /auth/reset-password` | Public JSON: `{ "email":"e2e-student-…@example.test", "code":"[redacted]", "newPassword":"[redacted]" }` | `204 No Content` |
| `POST /auth/change-password` | Student bearer; `{ "currentPassword":"[redacted]", "newPassword":"[redacted]" }` | `204 No Content` |
| `GET /admin/students/4` | Admin bearer | `200 { "student":{ "id":"4", "enrollmentCount":1, "confirmedEnrollmentCount":0 }, "bookings":[…] }` |
| `GET /admin/courses/3/students?status=CANCELLED` | Admin bearer | `200 { "bookings":[{ "id":"1", "status":"CANCELLED" }] }` |
| `GET /admin/rounds/3/students?status=CANCELLED` | Admin bearer | `200 { "bookings":[{ "id":"1", "status":"CANCELLED" }] }` |
| `PATCH /courses/3` | Admin bearer; `{ "archived":true }` | `200 { "course":{ "id":"3", "archived":true } }` |

All test artifacts that could be deleted through the API were deleted. The remaining student/booking/review/message/file data is intentionally retained by the API's business/audit rules and is fully namespaced with the E2E run identifier above.
