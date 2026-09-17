# Local Docker API test report

**Executed:** 2026-09-17 00:19:27 UTC  
**Target:** `http://127.0.0.1:3000`  
**Runtime:** Docker Compose (`api` and PostgreSQL) with `NODE_ENV=test`

The test environment exposes OTPs in responses and does not deliver email. The password, OTP, email address, and user ID below are disposable local-test values.

## 1. Health check

**Request**

```http
GET /health HTTP/1.1
Host: 127.0.0.1:3000
```

**Response — `200 OK`**

```json
{
  "status": "ok",
  "timestamp": "2026-09-17T00:19:27.475Z"
}
```

## 2. Start registration

**Request**

```http
POST /auth/register HTTP/1.1
Host: 127.0.0.1:3000
Content-Type: application/json

{
  "name": "Docker Report Student",
  "email": "docker-report-20260917T001927Z@example.test",
  "phone": "01000000000",
  "password": "test-password-123"
}
```

**Response — `202 Accepted`**

```json
{
  "verificationDelivery": "sent",
  "otp": "166121"
}
```

## 3. Verify email and create account

**Request**

```http
POST /auth/verify-email HTTP/1.1
Host: 127.0.0.1:3000
Content-Type: application/json

{
  "email": "docker-report-20260917T001927Z@example.test",
  "code": "166121"
}
```

**Response — `200 OK`**

```json
{
  "user": {
    "id": "2896",
    "name": "Docker Report Student",
    "email": "docker-report-20260917t001927z@example.test",
    "phone": "01000000000",
    "contactInfo": null,
    "role": "STUDENT",
    "emailVerified": true,
    "createdAt": "2026-09-17T00:19:27.757Z",
    "updatedAt": "2026-09-17T00:19:27.757Z"
  }
}
```

## Result

All three requests succeeded. The registration endpoint returned `202` without creating an account immediately; submitting its OTP to verification returned `200` and created a verified student record with the requested phone number.
