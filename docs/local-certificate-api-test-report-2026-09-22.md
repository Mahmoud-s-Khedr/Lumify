# Local certificate API test report — 2026-09-22

## Result

The Docker Compose API was rebuilt from the current workspace and tested at `http://127.0.0.1:3001`. This run used a disposable student, course, round, payment method, uploaded template, receipt, and issued certificate.

The uploaded administrator template was `certificate_template_fillable.pdf` from the repository root. Its exact inspected field report is included below. The student and course deliberately combine Arabic, English, numerals, and punctuation.

Bearer tokens, passwords, the job secret, and presigned-object query strings are redacted. Binary request bodies are represented by their exact byte length and SHA-256; the corresponding response body is empty.

The issued PDF was downloaded through its authorized redirect and rendered locally with Poppler. It is a one-page A4 certificate with zero remaining form fields; Arabic glyphs are joined and right-to-left, embedded English/numbers retain their order, and the long values remain within their template fields. The inspection response shows this uploaded template has the five text fields but no `qr_code` button, so its existing static `QR verification` placeholder is intentionally not replaced by a QR image.

## Local-only completion-date fixture

The API intentionally permits bookings only for future rounds and prevents changing dates after a booking exists. The isolated Docker database was therefore updated after approval so the scheduled issuance job could run immediately:

```text
id | start_date |  end_date  
----+------------+------------
  4 | 2026-09-19 | 2026-09-20
(1 row)

UPDATE 1
```

## Complete API transcript

### 1. GET /ready — local deployment readiness

Request:

```http
GET /ready HTTP/1.1
Host: 127.0.0.1:3001
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "status": "ok",
  "timestamp": "2026-09-22T05:34:15.930Z"
}
```

### 2. POST /auth/login — administrator authentication

Request:

```http
POST /auth/login HTTP/1.1
Host: 127.0.0.1:3001
content-type: application/json
{
  "email": "admin@YOUR-DOMAIN.com",
  "password": "<redacted>"
}
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "accessToken": "<redacted>",
  "user": {
    "id": "1",
    "name": "Lumify Staging Admin",
    "email": "admin@your-domain.com",
    "phone": null,
    "contactInfo": null,
    "role": "ADMIN",
    "emailVerified": true,
    "createdAt": "2026-09-22T04:28:24.816Z",
    "updatedAt": "2026-09-22T04:28:24.816Z"
  }
}
```

### 3. POST /files/uploads — create certificate-template upload

Request:

```http
POST /files/uploads HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "kind": "CERTIFICATE_TEMPLATE",
  "originalName": "certificate_template_fillable.pdf",
  "mimeType": "application/pdf"
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "storageKey": "certificate-templates/bd4d5ef1-da0e-4cb4-8bc8-eadb117ead7d",
  "uploadUrl": "https://<private-object-storage-host>/certificate-templates/bd4d5ef1-da0e-4cb4-8bc8-eadb117ead7d?<redacted-presigned-query>",
  "expiresInSeconds": 900,
  "maxSizeBytes": 20971520
}
```

### 4. PUT <certificate-template uploadUrl> — direct object upload

Request:

```http
PUT https://<private-object-storage-host>/certificate-templates/bd4d5ef1-da0e-4cb4-8bc8-eadb117ead7d?<redacted-presigned-query> HTTP/1.1
Host: 127.0.0.1:3001
content-type: application/pdf
<binary certificate_template_fillable.pdf; 8423 bytes; SHA-256 b6d5d0def506527f9b46ca95921f356d3bb5a065472197c9bc2a30bc95817fdb>
```

Response:

```http
HTTP/1.1 200
content-type: text/plain;charset=UTF-8
etag: "3cefaef28dba9ea64e1c6e335562a5c1"
```

### 5. POST /files/uploads/complete — persist certificate template

Request:

```http
POST /files/uploads/complete HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "kind": "CERTIFICATE_TEMPLATE",
  "originalName": "certificate_template_fillable.pdf",
  "mimeType": "application/pdf",
  "storageKey": "certificate-templates/bd4d5ef1-da0e-4cb4-8bc8-eadb117ead7d"
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "file": {
    "id": "10",
    "originalName": "certificate_template_fillable.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": "8423",
    "downloadUrl": "/files/10/download"
  }
}
```

### 6. POST /admin/certificate-template/inspect — inspect all mapped fields

Request:

```http
POST /admin/certificate-template/inspect HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "fileId": "10"
}
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "fieldReport": {
    "fields": [
      {
        "name": "student_name",
        "type": "TEXT",
        "populated": true,
        "status": "POPULATED"
      },
      {
        "name": "course_name",
        "type": "TEXT",
        "populated": true,
        "status": "POPULATED"
      },
      {
        "name": "completion_date",
        "type": "TEXT",
        "populated": true,
        "status": "POPULATED"
      },
      {
        "name": "certificate_id",
        "type": "TEXT",
        "populated": true,
        "status": "POPULATED"
      },
      {
        "name": "verification_url",
        "type": "TEXT",
        "populated": true,
        "status": "POPULATED"
      }
    ],
    "warning": null
  }
}
```

### 7. PUT /admin/certificate-template — activate inspected template

Request:

```http
PUT /admin/certificate-template HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "fileId": "10"
}
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "template": {
    "file": {
      "id": "10",
      "originalName": "certificate_template_fillable.pdf",
      "mimeType": "application/pdf",
      "createdAt": "2026-09-22T05:34:16.540Z"
    },
    "fieldReport": {
      "fields": [
        {
          "name": "student_name",
          "type": "TEXT",
          "status": "POPULATED",
          "populated": true
        },
        {
          "name": "course_name",
          "type": "TEXT",
          "status": "POPULATED",
          "populated": true
        },
        {
          "name": "completion_date",
          "type": "TEXT",
          "status": "POPULATED",
          "populated": true
        },
        {
          "name": "certificate_id",
          "type": "TEXT",
          "status": "POPULATED",
          "populated": true
        },
        {
          "name": "verification_url",
          "type": "TEXT",
          "status": "POPULATED",
          "populated": true
        }
      ],
      "warning": null
    },
    "inspectedAt": "2026-09-22T05:34:16.722Z",
    "activatedAt": "2026-09-22T05:34:16.743Z"
  }
}
```

### 8. GET /admin/certificate-template — read active template

Request:

```http
GET /admin/certificate-template HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "template": {
    "file": {
      "id": "10",
      "originalName": "certificate_template_fillable.pdf",
      "mimeType": "application/pdf",
      "createdAt": "2026-09-22T05:34:16.540Z"
    },
    "fieldReport": {
      "fields": [
        {
          "name": "student_name",
          "type": "TEXT",
          "status": "POPULATED",
          "populated": true
        },
        {
          "name": "course_name",
          "type": "TEXT",
          "status": "POPULATED",
          "populated": true
        },
        {
          "name": "completion_date",
          "type": "TEXT",
          "status": "POPULATED",
          "populated": true
        },
        {
          "name": "certificate_id",
          "type": "TEXT",
          "status": "POPULATED",
          "populated": true
        },
        {
          "name": "verification_url",
          "type": "TEXT",
          "status": "POPULATED",
          "populated": true
        }
      ],
      "warning": null
    },
    "inspectedAt": "2026-09-22T05:34:16.722Z",
    "activatedAt": "2026-09-22T05:34:16.743Z"
  }
}
```

### 9. POST /auth/register — register Arabic/mixed-language student

Request:

```http
POST /auth/register HTTP/1.1
Host: 127.0.0.1:3001
content-type: application/json
{
  "name": "محمد Example Student 123، اختبار",
  "email": "certificate-e2e-20260922053415878@example.test",
  "phone": "+201000000000",
  "password": "<redacted>"
}
```

Response:

```http
HTTP/1.1 202
content-type: application/json; charset=utf-8
{
  "verificationDelivery": "sent",
  "otp": "173426"
}
```

### 10. POST /auth/verify-email — verify student email

Request:

```http
POST /auth/verify-email HTTP/1.1
Host: 127.0.0.1:3001
content-type: application/json
{
  "email": "certificate-e2e-20260922053415878@example.test",
  "code": "173426"
}
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "user": {
    "id": "5",
    "name": "محمد Example Student 123، اختبار",
    "email": "certificate-e2e-20260922053415878@example.test",
    "phone": "+201000000000",
    "contactInfo": null,
    "role": "STUDENT",
    "emailVerified": true,
    "createdAt": "2026-09-22T05:34:16.960Z",
    "updatedAt": "2026-09-22T05:34:16.960Z"
  }
}
```

### 11. POST /auth/login — student authentication

Request:

```http
POST /auth/login HTTP/1.1
Host: 127.0.0.1:3001
content-type: application/json
{
  "email": "certificate-e2e-20260922053415878@example.test",
  "password": "<redacted>"
}
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "accessToken": "<redacted>",
  "user": {
    "id": "5",
    "name": "محمد Example Student 123، اختبار",
    "email": "certificate-e2e-20260922053415878@example.test",
    "phone": "+201000000000",
    "contactInfo": null,
    "role": "STUDENT",
    "emailVerified": true,
    "createdAt": "2026-09-22T05:34:16.960Z",
    "updatedAt": "2026-09-22T05:34:16.960Z"
  }
}
```

### 12. POST /payment-methods — create manual payment method

Request:

```http
POST /payment-methods HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "key": "CERT_E2E_20260922053415878",
  "value": "Certificate E2E bank transfer",
  "description": "Disposable local certificate test payment method."
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "paymentMethod": {
    "key": "CERT_E2E_20260922053415878",
    "value": "Certificate E2E bank transfer",
    "description": "Disposable local certificate test payment method."
  }
}
```

### 13. POST /courses — create mixed-language course

Request:

```http
POST /courses HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "title": "دورة TypeScript المتقدمة — Level 2",
  "description": "Disposable certificate E2E course.",
  "price": 99.99,
  "outcomes": [
    "Certificate issuance"
  ]
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "course": {
    "id": "4",
    "title": "دورة TypeScript المتقدمة — Level 2",
    "description": "Disposable certificate E2E course.",
    "price": "99.99",
    "outcomes": [
      "Certificate issuance"
    ],
    "skills": null,
    "prerequisiteSkills": null,
    "prerequisiteCourseId": null,
    "demoVideoUrl": null,
    "archived": false,
    "createdAt": "2026-09-22T05:34:17.031Z",
    "updatedAt": "2026-09-22T05:34:17.031Z",
    "averageRating": null,
    "reviewCount": 0,
    "images": []
  }
}
```

### 14. POST /courses/:courseId/rounds — create bookable round

Request:

```http
POST /courses/4/rounds HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "startDate": "2026-09-24",
  "endDate": "2026-09-25",
  "capacity": 1,
  "scheduleMode": "WEEKLY",
  "schedules": [
    {
      "weekday": "THURSDAY",
      "startTime": "10:00",
      "endTime": "12:00"
    }
  ]
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "round": {
    "id": "4",
    "course": {
      "id": "4",
      "title": "دورة TypeScript المتقدمة — Level 2"
    },
    "startDate": "2026-09-24",
    "endDate": "2026-09-25",
    "capacity": 1,
    "confirmedBooked": 0,
    "emptySeats": 1,
    "availability": "AVAILABLE",
    "scheduleMode": "WEEKLY",
    "schedules": [
      {
        "id": "4",
        "weekday": "THURSDAY",
        "startTime": "10:00",
        "endTime": "12:00",
        "endsNextDay": false
      }
    ],
    "occurrences": [],
    "createdAt": "2026-09-22T05:34:17.041Z",
    "updatedAt": "2026-09-22T05:34:17.041Z"
  }
}
```

### 15. POST /rounds/:id/bookings — create student booking

Request:

```http
POST /rounds/4/bookings HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "booking": {
    "id": "4",
    "student": {
      "id": "5",
      "name": "محمد Example Student 123، اختبار",
      "email": "certificate-e2e-20260922053415878@example.test",
      "phone": "+201000000000",
      "contactInfo": null
    },
    "round": {
      "id": "4",
      "course": {
        "id": "4",
        "title": "دورة TypeScript المتقدمة — Level 2"
      },
      "startDate": "2026-09-24",
      "endDate": "2026-09-25",
      "state": "UPCOMING",
      "capacity": 1,
      "confirmedBooked": 0,
      "emptySeats": 1,
      "scheduleMode": "WEEKLY",
      "schedules": [
        {
          "id": "4",
          "weekday": "THURSDAY",
          "startTime": "10:00",
          "endTime": "12:00",
          "endsNextDay": false
        }
      ],
      "occurrences": []
    },
    "price": "99.99",
    "status": "PENDING_PAYMENT",
    "bookingState": "PENDING",
    "paymentMethod": null,
    "transactionReference": null,
    "receipt": null,
    "adminNote": null,
    "reviewedAt": null,
    "cancellationReason": null,
    "cancelledAt": null,
    "createdAt": "2026-09-22T05:34:17.058Z",
    "updatedAt": "2026-09-22T05:34:17.058Z"
  }
}
```

### 16. POST /files/uploads — create payment-receipt upload

Request:

```http
POST /files/uploads HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "kind": "PAYMENT_RECEIPT",
  "originalName": "receipt-e2e-20260922053415878.pdf",
  "mimeType": "application/pdf"
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "storageKey": "payment-receipts/e757e952-4961-4255-bc86-e25876750045",
  "uploadUrl": "https://<private-object-storage-host>/payment-receipts/e757e952-4961-4255-bc86-e25876750045?<redacted-presigned-query>",
  "expiresInSeconds": 900,
  "maxSizeBytes": 10485760
}
```

### 17. PUT <payment-receipt uploadUrl> — direct object upload

Request:

```http
PUT https://<private-object-storage-host>/payment-receipts/e757e952-4961-4255-bc86-e25876750045?<redacted-presigned-query> HTTP/1.1
Host: 127.0.0.1:3001
content-type: application/pdf
<binary receipt-e2e-20260922053415878.pdf; 8423 bytes; SHA-256 b6d5d0def506527f9b46ca95921f356d3bb5a065472197c9bc2a30bc95817fdb>
```

Response:

```http
HTTP/1.1 200
content-type: text/plain;charset=UTF-8
etag: "3cefaef28dba9ea64e1c6e335562a5c1"
```

### 18. POST /files/uploads/complete — persist payment receipt

Request:

```http
POST /files/uploads/complete HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "kind": "PAYMENT_RECEIPT",
  "originalName": "receipt-e2e-20260922053415878.pdf",
  "mimeType": "application/pdf",
  "storageKey": "payment-receipts/e757e952-4961-4255-bc86-e25876750045"
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "file": {
    "id": "11",
    "originalName": "receipt-e2e-20260922053415878.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": "8423",
    "downloadUrl": "/files/11/download"
  }
}
```

### 19. POST /bookings/:id/payment — submit payment evidence

Request:

```http
POST /bookings/4/payment HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "paymentMethodKey": "CERT_E2E_20260922053415878",
  "receiptFileId": "11",
  "transactionReference": "CERT-E2E-20260922053415878"
}
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "booking": {
    "id": "4",
    "student": {
      "id": "5",
      "name": "محمد Example Student 123، اختبار",
      "email": "certificate-e2e-20260922053415878@example.test",
      "phone": "+201000000000",
      "contactInfo": null
    },
    "round": {
      "id": "4",
      "course": {
        "id": "4",
        "title": "دورة TypeScript المتقدمة — Level 2"
      },
      "startDate": "2026-09-24",
      "endDate": "2026-09-25",
      "state": "UPCOMING",
      "capacity": 1,
      "confirmedBooked": 0,
      "emptySeats": 1,
      "scheduleMode": "WEEKLY",
      "schedules": [
        {
          "id": "4",
          "weekday": "THURSDAY",
          "startTime": "10:00",
          "endTime": "12:00",
          "endsNextDay": false
        }
      ],
      "occurrences": []
    },
    "price": "99.99",
    "status": "PENDING_REVIEW",
    "bookingState": "PENDING",
    "paymentMethod": {
      "key": "CERT_E2E_20260922053415878",
      "value": "Certificate E2E bank transfer",
      "description": "Disposable local certificate test payment method."
    },
    "transactionReference": "CERT-E2E-20260922053415878",
    "receipt": {
      "id": "11",
      "originalName": "receipt-e2e-20260922053415878.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": "8423",
      "downloadUrl": "/files/11/download"
    },
    "adminNote": null,
    "reviewedAt": null,
    "cancellationReason": null,
    "cancelledAt": null,
    "createdAt": "2026-09-22T05:34:17.058Z",
    "updatedAt": "2026-09-22T05:34:17.353Z"
  }
}
```

### 20. POST /admin/bookings/:id/approve — confirm booking

Request:

```http
POST /admin/bookings/4/approve HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "adminNote": "Approved by local certificate E2E test."
}
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "booking": {
    "id": "4",
    "student": {
      "id": "5",
      "name": "محمد Example Student 123، اختبار",
      "email": "certificate-e2e-20260922053415878@example.test",
      "phone": "+201000000000",
      "contactInfo": null
    },
    "round": {
      "id": "4",
      "course": {
        "id": "4",
        "title": "دورة TypeScript المتقدمة — Level 2"
      },
      "startDate": "2026-09-24",
      "endDate": "2026-09-25",
      "state": "UPCOMING",
      "capacity": 1,
      "confirmedBooked": 1,
      "emptySeats": 0,
      "scheduleMode": "WEEKLY",
      "schedules": [
        {
          "id": "4",
          "weekday": "THURSDAY",
          "startTime": "10:00",
          "endTime": "12:00",
          "endsNextDay": false
        }
      ],
      "occurrences": []
    },
    "price": "99.99",
    "status": "CONFIRMED",
    "bookingState": "CONFIRMED",
    "paymentMethod": {
      "key": "CERT_E2E_20260922053415878",
      "value": "Certificate E2E bank transfer",
      "description": "Disposable local certificate test payment method."
    },
    "transactionReference": "CERT-E2E-20260922053415878",
    "receipt": {
      "id": "11",
      "originalName": "receipt-e2e-20260922053415878.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": "8423",
      "downloadUrl": "/files/11/download"
    },
    "adminNote": "Approved by local certificate E2E test.",
    "reviewedAt": "2026-09-22T05:34:17.367Z",
    "cancellationReason": null,
    "cancelledAt": null,
    "createdAt": "2026-09-22T05:34:17.058Z",
    "updatedAt": "2026-09-22T05:34:17.368Z"
  }
}
```

### 21. POST /internal/jobs/certificates/issue — issue certificate

Request:

```http
POST /internal/jobs/certificates/issue HTTP/1.1
Host: 127.0.0.1:3001
x-certificate-job-secret: <redacted-x-certificate-job-secret>
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "issued": 1,
  "deliveryRetried": 1,
  "deliveryFailed": 0
}
```

### 22. POST /internal/jobs/certificates/issue — idempotency retry

Request:

```http
POST /internal/jobs/certificates/issue HTTP/1.1
Host: 127.0.0.1:3001
x-certificate-job-secret: <redacted-x-certificate-job-secret>
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "issued": 0,
  "deliveryRetried": 0,
  "deliveryFailed": 0
}
```

### 23. GET /certificates — list student certificates

Request:

```http
GET /certificates HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "certificates": [
    {
      "id": "4",
      "publicId": "kjiC4Vg2IKsEeAuNpruGyUZQe3_6Rjta",
      "issuedAt": "2026-09-22T05:34:18.091Z",
      "completionDate": "2026-09-20",
      "course": {
        "id": "4",
        "title": "دورة TypeScript المتقدمة — Level 2"
      },
      "student": {
        "id": "5",
        "name": "محمد Example Student 123، اختبار"
      },
      "emailDeliveredAt": "2026-09-22T05:34:18.261Z"
    }
  ]
}
```

### 24. GET /certificates/:id/download — authorized private download redirect

Request:

```http
GET /certificates/4/download HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
```

Response:

```http
HTTP/1.1 302
location: https://<private-object-storage-host>/certificates/e5732cc0-f1d0-4c28-81dc-3d7a7520e786.pdf?<redacted-presigned-query>
```

### 25. GET <certificate download Location> — download issued PDF

Request:

```http
GET https://<private-object-storage-host>/certificates/e5732cc0-f1d0-4c28-81dc-3d7a7520e786.pdf?<redacted-presigned-query> HTTP/1.1
Host: 127.0.0.1:3001
```

Response:

```http
HTTP/1.1 200
content-type: application/pdf
etag: "49e989fc0e110d4c7c9571a16f6733dc"
{
  "binary": {
    "bytes": 50421,
    "sha256": "7a740000535ba70772873b6746e6367d6c70f6a8aaec6e36fb4fe509fa482f46",
    "pages": 1,
    "remainingAcroFormFields": 0
  }
}
```

### 26. GET /certificates/:publicId/verify — public verification

Request:

```http
GET /certificates/kjiC4Vg2IKsEeAuNpruGyUZQe3_6Rjta/verify HTTP/1.1
Host: 127.0.0.1:3001
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "valid": true,
  "certificateId": "kjiC4Vg2IKsEeAuNpruGyUZQe3_6Rjta",
  "studentName": "محمد Example Student 123، اختبار",
  "courseTitle": "دورة TypeScript المتقدمة — Level 2",
  "completionDate": "2026-09-20"
}
```

## Coverage

All 26 HTTP exchanges completed successfully. This includes template inspection/activation, direct object uploads, registration and verification, booking/payment/approval, first issuance plus idempotency retry, private-download authorization, and public verification.
