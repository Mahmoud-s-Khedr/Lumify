# Local Docker API test report — 2026-09-22

## Environment and result

The API was rebuilt with `docker compose build api` and started with `docker compose up -d api db`.
It was healthy at `http://127.0.0.1:3000/health`; the API and PostgreSQL containers were both
running. The image applied all 12 Prisma migrations, including the timetable migrations.

The live journey below completed successfully. Each entry records the complete JSON request and
JSON response body. Generated JWT access tokens and `lumify_refresh_token` cookies are shown as
`[REDACTED]`: they are credentials, not durable API data. A `204` response has no body.

## Health and authentication

### `GET /health` — `200`

Request: no body.

```json
{"status":"ok","timestamp":"2026-09-22T02:59:13.213Z"}
```

### `POST /auth/register` — `202`

```json
{"name":"API Report Student","email":"api-report-student@example.com","phone":"01012345678","password":"StudentReportPass1!"}
```

```json
{"verificationDelivery":"sent","otp":"147858"}
```

### `POST /auth/resend-verification` — `202`

```json
{"email":"api-report-student@example.com"}
```

```json
{"otp":"009107"}
```

### `POST /auth/verify-email` — `200`

```json
{"email":"api-report-student@example.com","code":"009107"}
```

```json
{"user":{"id":"3035","name":"API Report Student","email":"api-report-student@example.com","phone":"01012345678","contactInfo":null,"role":"STUDENT","emailVerified":true,"createdAt":"2026-09-22T02:59:13.355Z","updatedAt":"2026-09-22T02:59:13.355Z"}}
```

### `POST /auth/login` — `200`

```json
{"email":"api-report-student@example.com","password":"StudentReportPass1!"}
```

```json
{"accessToken":"[REDACTED]","user":{"id":"3035","name":"API Report Student","email":"api-report-student@example.com","phone":"01012345678","contactInfo":null,"role":"STUDENT","emailVerified":true,"createdAt":"2026-09-22T02:59:13.355Z","updatedAt":"2026-09-22T02:59:13.355Z"}}
```

Response header: `Set-Cookie: lumify_refresh_token=[REDACTED]; Max-Age=2592000; Path=/auth; HttpOnly; SameSite=Lax`.

### `POST /auth/refresh` — `200`

Request header: `Cookie: lumify_refresh_token=[REDACTED]`; no body.

```json
{"accessToken":"[REDACTED]"}
```

### `POST /auth/change-password` — `204`

Authorization: `Bearer [REDACTED]`.

```json
{"currentPassword":"StudentReportPass1!","newPassword":"StudentReportPass2!"}
```

Response: no body; the refresh-cookie response header clears the session.

### `POST /auth/login` (after password change) — `200`

```json
{"email":"api-report-student@example.com","password":"StudentReportPass2!"}
```

```json
{"accessToken":"[REDACTED]","user":{"id":"3035","name":"API Report Student","email":"api-report-student@example.com","phone":"01012345678","contactInfo":null,"role":"STUDENT","emailVerified":true,"createdAt":"2026-09-22T02:59:13.355Z","updatedAt":"2026-09-22T02:59:13.585Z"}}
```

### `POST /auth/forgot-password` — `202`

```json
{"email":"api-report-student@example.com"}
```

```json
{"otp":"041228"}
```

### `POST /auth/verify-reset-code` — `204`

```json
{"email":"api-report-student@example.com","code":"041228"}
```

Response: no body.

### `POST /auth/reset-password` — `204`

```json
{"email":"api-report-student@example.com","code":"041228","newPassword":"StudentReportPass3!"}
```

Response: no body.

### `POST /auth/login` (after reset) — `200`

```json
{"email":"api-report-student@example.com","password":"StudentReportPass3!"}
```

```json
{"accessToken":"[REDACTED]","user":{"id":"3035","name":"API Report Student","email":"api-report-student@example.com","phone":"01012345678","contactInfo":null,"role":"STUDENT","emailVerified":true,"createdAt":"2026-09-22T02:59:13.355Z","updatedAt":"2026-09-22T02:59:13.657Z"}}
```

### `POST /auth/logout` — `204`

Request header: `Cookie: lumify_refresh_token=[REDACTED]`; no body.

Response: no body; refresh cookie cleared.

## Protected round-timetable journey

An isolated `ADMIN` fixture was created locally for this journey, then authenticated through
`POST /auth/login` (`200`, response access token redacted). All following protected requests
used `Authorization: Bearer [REDACTED]` and `Content-Type: application/json` when a body exists.

### `POST /courses` — `201` (fixture)

```json
{"title":"API Report Timetable Course","price":"100.00"}
```

```json
{"course":{"id":"1652","title":"API Report Timetable Course","description":null,"price":"100.00","outcomes":null,"skills":null,"prerequisiteSkills":null,"prerequisiteCourseId":null,"demoVideoUrl":null,"archived":false,"createdAt":"2026-09-22T02:59:13.883Z","updatedAt":"2026-09-22T02:59:13.883Z","averageRating":null,"reviewCount":0,"images":[]}}
```

### `POST /courses/1652/rounds` — `201` (extended create API)

```json
{"startDate":"2027-10-01","endDate":"2027-10-03","capacity":20,"scheduleMode":"WEEKLY","schedules":[{"weekday":"THURSDAY","startTime":"20:30","endTime":"00:00"}]}
```

```json
{"round":{"id":"1509","course":{"id":"1652","title":"API Report Timetable Course"},"startDate":"2027-10-01","endDate":"2027-10-03","capacity":20,"confirmedBooked":0,"emptySeats":20,"availability":"AVAILABLE","scheduleMode":"WEEKLY","schedules":[{"id":"296","weekday":"THURSDAY","startTime":"20:30","endTime":"00:00","endsNextDay":true}],"occurrences":[],"createdAt":"2026-09-22T02:59:13.900Z","updatedAt":"2026-09-22T02:59:13.900Z"}}
```

### `GET /courses/1652/rounds?includeUnavailable=true` — `200`

Request: no body.

```json
{"rounds":[{"id":"1509","course":{"id":"1652","title":"API Report Timetable Course"},"startDate":"2027-10-01","endDate":"2027-10-03","capacity":20,"confirmedBooked":0,"emptySeats":20,"availability":"AVAILABLE","scheduleMode":"WEEKLY","schedules":[{"id":"296","weekday":"THURSDAY","startTime":"20:30","endTime":"00:00","endsNextDay":true}],"occurrences":[],"createdAt":"2026-09-22T02:59:13.900Z","updatedAt":"2026-09-22T02:59:13.900Z"}]}
```

### `POST /rounds/1509/schedules` — `201`

```json
{"weekday":"FRIDAY","startTime":"01:00","endTime":"02:00"}
```

```json
{"round":{"id":"1509","scheduleMode":"WEEKLY","schedules":[{"id":"296","weekday":"THURSDAY","startTime":"20:30","endTime":"00:00","endsNextDay":true},{"id":"297","weekday":"FRIDAY","startTime":"01:00","endTime":"02:00","endsNextDay":false}],"occurrences":[]}}
```

### `PATCH /rounds/1509/schedules/297` — `200`

```json
{"startTime":"01:30"}
```

```json
{"round":{"id":"1509","scheduleMode":"WEEKLY","schedules":[{"id":"296","weekday":"THURSDAY","startTime":"20:30","endTime":"00:00","endsNextDay":true},{"id":"297","weekday":"FRIDAY","startTime":"01:30","endTime":"02:00","endsNextDay":false}],"occurrences":[]}}
```

### `PATCH /rounds/1509` — `200`

```json
{"capacity":25}
```

```json
{"round":{"id":"1509","course":{"id":"1652","title":"API Report Timetable Course"},"startDate":"2027-10-01","endDate":"2027-10-03","capacity":25,"confirmedBooked":0,"emptySeats":25,"availability":"AVAILABLE","scheduleMode":"WEEKLY","schedules":[{"id":"296","weekday":"THURSDAY","startTime":"20:30","endTime":"00:00","endsNextDay":true},{"id":"297","weekday":"FRIDAY","startTime":"01:30","endTime":"02:00","endsNextDay":false}],"occurrences":[]}}
```

### `PATCH /rounds/1509/schedule-mode` — `200` (switch to custom)

```json
{"scheduleMode":"CUSTOM","occurrences":[{"startAt":"2027-10-03T22:00:00Z","endAt":"2027-10-04T00:00:00Z"}]}
```

```json
{"round":{"id":"1509","scheduleMode":"CUSTOM","schedules":[],"occurrences":[{"id":"9","startAt":"2027-10-03T22:00:00.000Z","endAt":"2027-10-04T00:00:00.000Z"}]}}
```

### `POST /rounds/1509/occurrences` — `201`

```json
{"startAt":"2027-10-02T10:00:00Z","endAt":"2027-10-02T11:00:00Z"}
```

```json
{"round":{"id":"1509","scheduleMode":"CUSTOM","schedules":[],"occurrences":[{"id":"10","startAt":"2027-10-02T10:00:00.000Z","endAt":"2027-10-02T11:00:00.000Z"},{"id":"9","startAt":"2027-10-03T22:00:00.000Z","endAt":"2027-10-04T00:00:00.000Z"}]}}
```

### `PATCH /rounds/1509/occurrences/10` — `200`

```json
{"startAt":"2027-10-02T10:30:00Z"}
```

```json
{"round":{"id":"1509","scheduleMode":"CUSTOM","schedules":[],"occurrences":[{"id":"10","startAt":"2027-10-02T10:30:00.000Z","endAt":"2027-10-02T11:00:00.000Z"},{"id":"9","startAt":"2027-10-03T22:00:00.000Z","endAt":"2027-10-04T00:00:00.000Z"}]}}
```

### `GET /rounds/1509` — `200` (custom timetable)

Request: no body.

```json
{"round":{"id":"1509","course":{"id":"1652","title":"API Report Timetable Course"},"startDate":"2027-10-01","endDate":"2027-10-03","capacity":25,"confirmedBooked":0,"emptySeats":25,"availability":"AVAILABLE","scheduleMode":"CUSTOM","schedules":[],"occurrences":[{"id":"10","startAt":"2027-10-02T10:30:00.000Z","endAt":"2027-10-02T11:00:00.000Z"},{"id":"9","startAt":"2027-10-03T22:00:00.000Z","endAt":"2027-10-04T00:00:00.000Z"}],"createdAt":"2026-09-22T02:59:13.900Z","updatedAt":"2026-09-22T02:59:13.988Z"}}
```

### `DELETE /rounds/1509/occurrences/10` — `204`

Request: no body. Response: no body.

### `PATCH /rounds/1509/schedule-mode` — `200` (switch back to weekly)

```json
{"scheduleMode":"WEEKLY","schedules":[{"weekday":"SATURDAY","startTime":"09:00","endTime":"10:00"}]}
```

```json
{"round":{"id":"1509","scheduleMode":"WEEKLY","schedules":[{"id":"298","weekday":"SATURDAY","startTime":"09:00","endTime":"10:00","endsNextDay":false}],"occurrences":[]}}
```

### `DELETE /rounds/1509/schedules/298` — `204`

Request: no body. Response: no body.

## Automated checks

- `npm run build` — passed.
- `npm run lint` — passed.
- `vitest run test/rounds.test.ts test/health.test.ts` — 6 tests passed.
- A previous full-suite run passed 44 of 45 tests. The remaining unrelated failure is the existing
  no-body community-read request validation case in `test/communities.test.ts`.
