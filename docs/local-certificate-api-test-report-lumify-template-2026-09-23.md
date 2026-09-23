# Local certificate API test report — 2026-09-23

## Result

The Docker Compose API was rebuilt from the current workspace and tested at `http://127.0.0.1:3001`. This run used a disposable student, course, round, payment method, uploaded template, receipt, and issued certificate.

The uploaded administrator template was `certificate_template_lumify.pdf` from the repository root. Its exact inspected field report is included below. The student and course deliberately combine Arabic, English, numerals, and punctuation.

Bearer tokens, passwords, the job secret, and presigned-object query strings are redacted. Binary request bodies are represented by their exact byte length and SHA-256; the corresponding response body is empty.

## Local-only completion-date fixture

The API intentionally permits bookings only for future rounds and prevents changing dates after a booking exists. The isolated Docker database was therefore updated after approval so the scheduled issuance job could run immediately:

```text
id | start_date |  end_date  
----+------------+------------
  5 | 2026-09-20 | 2026-09-21
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
  "timestamp": "2026-09-23T03:34:43.493Z"
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
  "originalName": "certificate_template_lumify.pdf",
  "mimeType": "application/pdf"
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "storageKey": "certificate-templates/2959e681-c2a3-46c8-a2a8-c92d927a9798",
  "uploadUrl": "https://<private-object-storage-host>/certificate-templates/2959e681-c2a3-46c8-a2a8-c92d927a9798?<redacted-presigned-query>",
  "expiresInSeconds": 900,
  "maxSizeBytes": 20971520
}
```

### 4. PUT <certificate-template uploadUrl> — direct object upload

Request:

```http
PUT https://<private-object-storage-host>/certificate-templates/2959e681-c2a3-46c8-a2a8-c92d927a9798?<redacted-presigned-query> HTTP/1.1
Host: 127.0.0.1:3001
content-type: application/pdf
<binary certificate_template_lumify.pdf; 6582 bytes; SHA-256 05637321c307575e4ffa0525cf402690b56ee520594429b4b417b1f89d53dbc5>
```

Response:

```http
HTTP/1.1 200
content-type: text/plain;charset=UTF-8
etag: "3d308a33ff02742b703e173e56a78ddb"
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
  "originalName": "certificate_template_lumify.pdf",
  "mimeType": "application/pdf",
  "storageKey": "certificate-templates/2959e681-c2a3-46c8-a2a8-c92d927a9798"
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "file": {
    "id": "13",
    "originalName": "certificate_template_lumify.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": "6582",
    "downloadUrl": "/files/13/download"
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
  "fileId": "13"
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
        "name": "qr_code",
        "type": "BUTTON",
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
  "fileId": "13"
}
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "template": {
    "file": {
      "id": "13",
      "originalName": "certificate_template_lumify.pdf",
      "mimeType": "application/pdf",
      "createdAt": "2026-09-23T03:34:44.538Z"
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
          "name": "qr_code",
          "type": "BUTTON",
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
    "inspectedAt": "2026-09-23T03:34:44.688Z",
    "activatedAt": "2026-09-23T03:34:44.717Z"
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
      "id": "13",
      "originalName": "certificate_template_lumify.pdf",
      "mimeType": "application/pdf",
      "createdAt": "2026-09-23T03:34:44.538Z"
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
          "name": "qr_code",
          "type": "BUTTON",
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
    "inspectedAt": "2026-09-23T03:34:44.688Z",
    "activatedAt": "2026-09-23T03:34:44.717Z"
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
  "email": "certificate-e2e-20260923033443456@example.test",
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
  "otp": "968142"
}
```

### 10. POST /auth/verify-email — verify student email

Request:

```http
POST /auth/verify-email HTTP/1.1
Host: 127.0.0.1:3001
content-type: application/json
{
  "email": "certificate-e2e-20260923033443456@example.test",
  "code": "968142"
}
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "user": {
    "id": "6",
    "name": "محمد Example Student 123، اختبار",
    "email": "certificate-e2e-20260923033443456@example.test",
    "phone": "+201000000000",
    "contactInfo": null,
    "role": "STUDENT",
    "emailVerified": true,
    "createdAt": "2026-09-23T03:34:44.946Z",
    "updatedAt": "2026-09-23T03:34:44.946Z"
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
  "email": "certificate-e2e-20260923033443456@example.test",
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
    "id": "6",
    "name": "محمد Example Student 123، اختبار",
    "email": "certificate-e2e-20260923033443456@example.test",
    "phone": "+201000000000",
    "contactInfo": null,
    "role": "STUDENT",
    "emailVerified": true,
    "createdAt": "2026-09-23T03:34:44.946Z",
    "updatedAt": "2026-09-23T03:34:44.946Z"
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
  "key": "CERT_E2E_20260923033443456",
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
    "key": "CERT_E2E_20260923033443456",
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
    "id": "5",
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
    "createdAt": "2026-09-23T03:34:45.029Z",
    "updatedAt": "2026-09-23T03:34:45.029Z",
    "averageRating": null,
    "reviewCount": 0,
    "images": []
  }
}
```

### 14. POST /courses/:courseId/rounds — create bookable round

Request:

```http
POST /courses/5/rounds HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "startDate": "2026-09-25",
  "endDate": "2026-09-26",
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
    "id": "5",
    "course": {
      "id": "5",
      "title": "دورة TypeScript المتقدمة — Level 2"
    },
    "startDate": "2026-09-25",
    "endDate": "2026-09-26",
    "capacity": 1,
    "confirmedBooked": 0,
    "emptySeats": 1,
    "availability": "AVAILABLE",
    "scheduleMode": "WEEKLY",
    "schedules": [
      {
        "id": "5",
        "weekday": "THURSDAY",
        "startTime": "10:00",
        "endTime": "12:00",
        "endsNextDay": false
      }
    ],
    "occurrences": [],
    "createdAt": "2026-09-23T03:34:45.045Z",
    "updatedAt": "2026-09-23T03:34:45.045Z"
  }
}
```

### 15. POST /rounds/:id/bookings — create student booking

Request:

```http
POST /rounds/5/bookings HTTP/1.1
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
    "id": "5",
    "student": {
      "id": "6",
      "name": "محمد Example Student 123، اختبار",
      "email": "certificate-e2e-20260923033443456@example.test",
      "phone": "+201000000000",
      "contactInfo": null
    },
    "round": {
      "id": "5",
      "course": {
        "id": "5",
        "title": "دورة TypeScript المتقدمة — Level 2"
      },
      "startDate": "2026-09-25",
      "endDate": "2026-09-26",
      "state": "UPCOMING",
      "capacity": 1,
      "confirmedBooked": 0,
      "emptySeats": 1,
      "scheduleMode": "WEEKLY",
      "schedules": [
        {
          "id": "5",
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
    "createdAt": "2026-09-23T03:34:45.070Z",
    "updatedAt": "2026-09-23T03:34:45.070Z"
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
  "originalName": "receipt-e2e-20260923033443456.pdf",
  "mimeType": "application/pdf"
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "storageKey": "payment-receipts/0fac3d34-a2a9-45b8-a0f6-7810914cedc6",
  "uploadUrl": "https://<private-object-storage-host>/payment-receipts/0fac3d34-a2a9-45b8-a0f6-7810914cedc6?<redacted-presigned-query>",
  "expiresInSeconds": 900,
  "maxSizeBytes": 10485760
}
```

### 17. PUT <payment-receipt uploadUrl> — direct object upload

Request:

```http
PUT https://<private-object-storage-host>/payment-receipts/0fac3d34-a2a9-45b8-a0f6-7810914cedc6?<redacted-presigned-query> HTTP/1.1
Host: 127.0.0.1:3001
content-type: application/pdf
<binary receipt-e2e-20260923033443456.pdf; 6582 bytes; SHA-256 05637321c307575e4ffa0525cf402690b56ee520594429b4b417b1f89d53dbc5>
```

Response:

```http
HTTP/1.1 200
content-type: text/plain;charset=UTF-8
etag: "3d308a33ff02742b703e173e56a78ddb"
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
  "originalName": "receipt-e2e-20260923033443456.pdf",
  "mimeType": "application/pdf",
  "storageKey": "payment-receipts/0fac3d34-a2a9-45b8-a0f6-7810914cedc6"
}
```

Response:

```http
HTTP/1.1 201
content-type: application/json; charset=utf-8
{
  "file": {
    "id": "14",
    "originalName": "receipt-e2e-20260923033443456.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": "6582",
    "downloadUrl": "/files/14/download"
  }
}
```

### 19. POST /bookings/:id/payment — submit payment evidence

Request:

```http
POST /bookings/5/payment HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
content-type: application/json
{
  "paymentMethodKey": "CERT_E2E_20260923033443456",
  "receiptFileId": "14",
  "transactionReference": "CERT-E2E-20260923033443456"
}
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "booking": {
    "id": "5",
    "student": {
      "id": "6",
      "name": "محمد Example Student 123، اختبار",
      "email": "certificate-e2e-20260923033443456@example.test",
      "phone": "+201000000000",
      "contactInfo": null
    },
    "round": {
      "id": "5",
      "course": {
        "id": "5",
        "title": "دورة TypeScript المتقدمة — Level 2"
      },
      "startDate": "2026-09-25",
      "endDate": "2026-09-26",
      "state": "UPCOMING",
      "capacity": 1,
      "confirmedBooked": 0,
      "emptySeats": 1,
      "scheduleMode": "WEEKLY",
      "schedules": [
        {
          "id": "5",
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
      "key": "CERT_E2E_20260923033443456",
      "value": "Certificate E2E bank transfer",
      "description": "Disposable local certificate test payment method."
    },
    "transactionReference": "CERT-E2E-20260923033443456",
    "receipt": {
      "id": "14",
      "originalName": "receipt-e2e-20260923033443456.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": "6582",
      "downloadUrl": "/files/14/download"
    },
    "adminNote": null,
    "reviewedAt": null,
    "cancellationReason": null,
    "cancelledAt": null,
    "createdAt": "2026-09-23T03:34:45.070Z",
    "updatedAt": "2026-09-23T03:34:45.367Z"
  }
}
```

### 20. POST /admin/bookings/:id/approve — confirm booking

Request:

```http
POST /admin/bookings/5/approve HTTP/1.1
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
    "id": "5",
    "student": {
      "id": "6",
      "name": "محمد Example Student 123، اختبار",
      "email": "certificate-e2e-20260923033443456@example.test",
      "phone": "+201000000000",
      "contactInfo": null
    },
    "round": {
      "id": "5",
      "course": {
        "id": "5",
        "title": "دورة TypeScript المتقدمة — Level 2"
      },
      "startDate": "2026-09-25",
      "endDate": "2026-09-26",
      "state": "UPCOMING",
      "capacity": 1,
      "confirmedBooked": 1,
      "emptySeats": 0,
      "scheduleMode": "WEEKLY",
      "schedules": [
        {
          "id": "5",
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
      "key": "CERT_E2E_20260923033443456",
      "value": "Certificate E2E bank transfer",
      "description": "Disposable local certificate test payment method."
    },
    "transactionReference": "CERT-E2E-20260923033443456",
    "receipt": {
      "id": "14",
      "originalName": "receipt-e2e-20260923033443456.pdf",
      "mimeType": "application/pdf",
      "sizeBytes": "6582",
      "downloadUrl": "/files/14/download"
    },
    "adminNote": "Approved by local certificate E2E test.",
    "reviewedAt": "2026-09-23T03:34:45.384Z",
    "cancellationReason": null,
    "cancelledAt": null,
    "createdAt": "2026-09-23T03:34:45.070Z",
    "updatedAt": "2026-09-23T03:34:45.385Z"
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
      "id": "5",
      "publicId": "YK7MkMCUdO1MkbGON8h-d5guspmdCTul",
      "issuedAt": "2026-09-23T03:34:46.482Z",
      "completionDate": "2026-09-21",
      "course": {
        "id": "5",
        "title": "دورة TypeScript المتقدمة — Level 2"
      },
      "student": {
        "id": "6",
        "name": "محمد Example Student 123، اختبار"
      },
      "emailDeliveredAt": "2026-09-23T03:34:46.726Z"
    }
  ]
}
```

### 24. GET /certificates/:id/download — authorized private download redirect

Request:

```http
GET /certificates/5/download HTTP/1.1
Host: 127.0.0.1:3001
authorization: <redacted-authorization>
```

Response:

```http
HTTP/1.1 302
location: https://<private-object-storage-host>/certificates/0e8c6b27-a92e-4b4d-94de-040688f24cdd.pdf?<redacted-presigned-query>
```

### 25. GET <certificate download Location> — download issued PDF

Request:

```http
GET https://<private-object-storage-host>/certificates/0e8c6b27-a92e-4b4d-94de-040688f24cdd.pdf?<redacted-presigned-query> HTTP/1.1
Host: 127.0.0.1:3001
```

Response:

```http
HTTP/1.1 200
content-type: application/pdf
etag: "0e3d3a036dd7ba4d0edd77817696a99d"
{
  "binary": {
    "bytes": 123460,
    "sha256": "1cfcc0e02121c98b43950db4b98b1a02a8749df549cdb9680bb73ae912965f1f",
    "pages": 1,
    "remainingAcroFormFields": 0
  }
}
```

### 26. GET /certificates/:publicId/verify — public verification

Request:

```http
GET /certificates/YK7MkMCUdO1MkbGON8h-d5guspmdCTul/verify HTTP/1.1
Host: 127.0.0.1:3001
```

Response:

```http
HTTP/1.1 200
content-type: application/json; charset=utf-8
{
  "valid": true,
  "certificateId": "YK7MkMCUdO1MkbGON8h-d5guspmdCTul",
  "studentName": "محمد Example Student 123، اختبار",
  "courseTitle": "دورة TypeScript المتقدمة — Level 2",
  "completionDate": "2026-09-21"
}
```

## Coverage

All 26 HTTP exchanges completed successfully. This includes template inspection/activation, direct object uploads, registration and verification, booking/payment/approval, first issuance plus idempotency retry, private-download authorization, and public verification.
