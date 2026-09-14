import type { FastifySchema, RouteOptions } from 'fastify';

type Schema = Record<string, unknown>;
type Response = { description: string; content?: Record<string, { schema: Schema }> };

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (items: Schema): Schema => ({ type: 'array', items });
const nullable = (schema: Schema): Schema =>
  '$ref' in schema ? { allOf: [schema], nullable: true } : { ...schema, nullable: true };
const object = (properties: Record<string, Schema>, required: string[]): Schema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const response = (description: string, schema?: Schema): Response =>
  schema ? { description, content: { 'application/json': { schema } } } : { description };
const wrapped = (name: string, value: Schema): Schema => object({ [name]: value }, [name]);
const list = (name: string, item: Schema): Schema => wrapped(name, arrayOf(item));
const paginated = (name: string, item: Schema): Schema =>
  object(
    {
      [name]: arrayOf(item),
      pagination: ref('Pagination'),
    },
    [name, 'pagination'],
  );

const errorResponses: Record<string, Response> = {
  400: response('Invalid request or business-rule violation.', ref('Error')),
  401: response('Authentication is required or the access token is invalid.', ref('Error')),
  403: response('The authenticated user is not permitted to perform this action.', ref('Error')),
  404: response('The requested resource was not found.', ref('Error')),
  409: response('The request conflicts with the current resource state.', ref('Error')),
  500: response('An unexpected server error occurred.', ref('Error')),
};

/**
 * Components describe values returned by the presenter functions. They are intentionally
 * independent of database models: only fields that are actually exposed are documented.
 */
export const openapiComponents = {
  schemas: {
    Error: object({ error: { type: 'string' }, message: { type: 'string' } }, ['error', 'message']),
    Pagination: object(
      {
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        total: { type: 'integer', minimum: 0 },
      },
      ['page', 'pageSize', 'total'],
    ),
    File: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        originalName: { type: 'string' },
        mimeType: nullable({ type: 'string' }),
        sizeBytes: nullable({ type: 'string', pattern: '^\\d+$' }),
        downloadUrl: { type: 'string' },
      },
      ['id', 'originalName', 'mimeType', 'sizeBytes', 'downloadUrl'],
    ),
    User: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        phone: nullable({ type: 'string' }),
        contactInfo: nullable({}),
        avatar: nullable(ref('File')),
        role: { type: 'string', enum: ['STUDENT', 'ADMIN'] },
        emailVerified: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      [
        'id',
        'name',
        'email',
        'phone',
        'contactInfo',
        'avatar',
        'role',
        'emailVerified',
        'createdAt',
        'updatedAt',
      ],
    ),
    AuthUser: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        phone: nullable({ type: 'string' }),
        contactInfo: nullable({}),
        role: { type: 'string', enum: ['STUDENT', 'ADMIN'] },
        emailVerified: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      [
        'id',
        'name',
        'email',
        'phone',
        'contactInfo',
        'role',
        'emailVerified',
        'createdAt',
        'updatedAt',
      ],
    ),
    AdminStudent: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        phone: nullable({ type: 'string' }),
        contactInfo: nullable({}),
        avatar: nullable(ref('File')),
        role: { type: 'string', enum: ['STUDENT'] },
        emailVerified: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        enrollmentCount: { type: 'integer', minimum: 0 },
        confirmedEnrollmentCount: { type: 'integer', minimum: 0 },
      },
      [
        'id',
        'name',
        'email',
        'phone',
        'contactInfo',
        'avatar',
        'role',
        'emailVerified',
        'createdAt',
        'updatedAt',
        'enrollmentCount',
        'confirmedEnrollmentCount',
      ],
    ),
    PaymentMethod: object(
      { key: { type: 'string' }, value: { type: 'string' }, description: { type: 'string' } },
      ['key', 'value', 'description'],
    ),
    Course: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        title: { type: 'string' },
        description: nullable({ type: 'string' }),
        price: { type: 'string', pattern: '^\\d+(?:\\.\\d{2})?$' },
        outcomes: nullable(arrayOf({ type: 'string' })),
        skills: nullable(arrayOf({ type: 'string' })),
        prerequisiteSkills: nullable(arrayOf({ type: 'string' })),
        prerequisiteCourseId: nullable({ type: 'string', pattern: '^\\d+$' }),
        demoVideoUrl: nullable({ type: 'string', format: 'uri' }),
        archived: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        averageRating: nullable({ type: 'number', minimum: 1, maximum: 5 }),
        reviewCount: { type: 'integer', minimum: 0 },
        images: arrayOf(ref('File')),
      },
      [
        'id',
        'title',
        'description',
        'price',
        'outcomes',
        'skills',
        'prerequisiteSkills',
        'prerequisiteCourseId',
        'demoVideoUrl',
        'archived',
        'createdAt',
        'updatedAt',
        'averageRating',
        'reviewCount',
        'images',
      ],
    ),
    Schedule: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        weekday: {
          type: 'string',
          enum: ['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
        },
        startTime: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
      },
      ['id', 'weekday', 'startTime'],
    ),
    Round: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        course: object({ id: { type: 'string', pattern: '^\\d+$' }, title: { type: 'string' } }, [
          'id',
          'title',
        ]),
        startDate: { type: 'string', format: 'date' },
        endDate: { type: 'string', format: 'date' },
        capacity: { type: 'integer', minimum: 1 },
        confirmedBooked: { type: 'integer', minimum: 0 },
        emptySeats: { type: 'integer', minimum: 0 },
        availability: { type: 'string', enum: ['AVAILABLE', 'FULL'] },
        schedules: arrayOf(ref('Schedule')),
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      [
        'id',
        'course',
        'startDate',
        'endDate',
        'capacity',
        'confirmedBooked',
        'emptySeats',
        'availability',
        'schedules',
        'createdAt',
        'updatedAt',
      ],
    ),
    Material: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        title: { type: 'string' },
        kind: { type: 'string', enum: ['FILE', 'LINK'] },
        file: nullable(ref('File')),
        externalUrl: nullable({ type: 'string', format: 'uri' }),
        createdAt: { type: 'string', format: 'date-time' },
      },
      ['id', 'title', 'kind', 'file', 'externalUrl', 'createdAt'],
    ),
    Booking: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        student: object(
          {
            id: { type: 'string', pattern: '^\\d+$' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: nullable({ type: 'string' }),
            contactInfo: nullable({}),
          },
          ['id', 'name', 'email', 'phone', 'contactInfo'],
        ),
        round: object(
          {
            id: { type: 'string', pattern: '^\\d+$' },
            course: object(
              { id: { type: 'string', pattern: '^\\d+$' }, title: { type: 'string' } },
              ['id', 'title'],
            ),
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            state: { type: 'string', enum: ['UPCOMING', 'IN_PROGRESS', 'FINISHED'] },
            capacity: { type: 'integer' },
            confirmedBooked: { type: 'integer', minimum: 0 },
            emptySeats: { type: 'integer', minimum: 0 },
            schedules: arrayOf(ref('Schedule')),
          },
          [
            'id',
            'course',
            'startDate',
            'endDate',
            'state',
            'capacity',
            'confirmedBooked',
            'emptySeats',
            'schedules',
          ],
        ),
        price: { type: 'string' },
        status: {
          type: 'string',
          enum: [
            'PENDING_PAYMENT',
            'PENDING_REVIEW',
            'CONFIRMED',
            'PAYMENT_REJECTED',
            'CANCELLATION_REQUESTED',
            'CANCELLED',
          ],
        },
        bookingState: {
          type: 'string',
          enum: ['PENDING', 'REJECTED', 'CONFIRMED', 'CANCELLATION_REQUESTED', 'CANCELLED'],
        },
        paymentMethod: nullable(ref('PaymentMethod')),
        transactionReference: nullable({ type: 'string' }),
        receipt: nullable(ref('File')),
        adminNote: nullable({ type: 'string' }),
        reviewedAt: nullable({ type: 'string', format: 'date-time' }),
        cancellationReason: nullable({ type: 'string' }),
        cancelledAt: nullable({ type: 'string', format: 'date-time' }),
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      [
        'id',
        'student',
        'round',
        'price',
        'status',
        'bookingState',
        'paymentMethod',
        'transactionReference',
        'receipt',
        'adminNote',
        'reviewedAt',
        'cancellationReason',
        'cancelledAt',
        'createdAt',
        'updatedAt',
      ],
    ),
    Review: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        rating: { type: 'integer', minimum: 1, maximum: 5 },
        comment: { type: 'string' },
        student: object({ id: { type: 'string', pattern: '^\\d+$' }, name: { type: 'string' } }, [
          'id',
          'name',
        ]),
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      ['id', 'rating', 'comment', 'student', 'createdAt', 'updatedAt'],
    ),
    OwnerReview: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        rating: { type: 'integer', minimum: 1, maximum: 5 },
        comment: { type: 'string' },
        student: object({ id: { type: 'string', pattern: '^\\d+$' }, name: { type: 'string' } }, [
          'id',
          'name',
        ]),
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
        adminNote: nullable({ type: 'string' }),
        reviewedAt: nullable({ type: 'string', format: 'date-time' }),
      },
      [
        'id',
        'rating',
        'comment',
        'student',
        'createdAt',
        'updatedAt',
        'status',
        'adminNote',
        'reviewedAt',
      ],
    ),
    AdminReview: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        rating: { type: 'integer', minimum: 1, maximum: 5 },
        comment: { type: 'string' },
        student: object(
          {
            id: { type: 'string', pattern: '^\\d+$' },
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
          },
          ['id', 'name', 'email'],
        ),
        course: object({ id: { type: 'string', pattern: '^\\d+$' }, title: { type: 'string' } }, [
          'id',
          'title',
        ]),
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
        adminNote: nullable({ type: 'string' }),
        reviewedAt: nullable({ type: 'string', format: 'date-time' }),
      },
      [
        'id',
        'rating',
        'comment',
        'student',
        'course',
        'createdAt',
        'updatedAt',
        'status',
        'adminNote',
        'reviewedAt',
      ],
    ),
    Session: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        round: object(
          {
            id: { type: 'string', pattern: '^\\d+$' },
            course: object(
              { id: { type: 'string', pattern: '^\\d+$' }, title: { type: 'string' } },
              ['id', 'title'],
            ),
          },
          ['id', 'course'],
        ),
        title: { type: 'string' },
        sessionDate: { type: 'string', format: 'date-time' },
        recordingUrl: nullable({ type: 'string', format: 'uri' }),
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      ['id', 'round', 'title', 'sessionDate', 'recordingUrl', 'createdAt', 'updatedAt'],
    ),
    JoinDetails: object(
      {
        roundId: { type: 'string', pattern: '^\\d+$' },
        joiningInstructions: nullable({ type: 'string' }),
        actions: object(
          {
            live: nullable(object({ url: { type: 'string', format: 'uri' } }, ['url'])),
            whatsapp: nullable(object({ url: { type: 'string', format: 'uri' } }, ['url'])),
          },
          ['live', 'whatsapp'],
        ),
      },
      ['roundId', 'joiningInstructions', 'actions'],
    ),
    CommunityMessage: object(
      {
        id: { type: 'string', pattern: '^\\d+$' },
        courseId: { type: 'string', pattern: '^\\d+$' },
        content: nullable({ type: 'string' }),
        createdAt: { type: 'string', format: 'date-time' },
        sender: object(
          {
            id: { type: 'string', pattern: '^\\d+$' },
            name: { type: 'string' },
            avatar: nullable(ref('File')),
          },
          ['id', 'name', 'avatar'],
        ),
        attachments: arrayOf(ref('File')),
      },
      ['id', 'courseId', 'content', 'createdAt', 'sender', 'attachments'],
    ),
    Community: object(
      {
        course: object(
          {
            id: { type: 'string', pattern: '^\\d+$' },
            title: { type: 'string' },
            description: nullable({ type: 'string' }),
            archived: { type: 'boolean' },
          },
          ['id', 'title', 'description', 'archived'],
        ),
        readOnly: { type: 'boolean' },
        latestMessage: nullable(ref('CommunityMessage')),
      },
      ['course', 'readOnly', 'latestMessage'],
    ),
  },
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Access token returned by the login or refresh endpoint.',
    },
    refreshCookie: {
      type: 'apiKey',
      in: 'cookie',
      name: 'lumify_refresh_token',
      description: 'HttpOnly refresh-session cookie set by login and rotated by refresh.',
    },
  },
};

const operationResponses: Record<string, Record<string, Response>> = {
  'POST /auth/register': {
    201: response(
      'Student account created. `otp` is included only when OTP exposure is enabled outside production.',
      object({ user: ref('AuthUser'), otp: { type: 'string', pattern: '^\\d{6}$' } }, ['user']),
    ),
  },
  'POST /auth/verify-email': {
    200: response('Email verified.', object({ user: ref('AuthUser') }, ['user'])),
  },
  'POST /auth/resend-verification': {
    202: response(
      'Verification code requested. `otp` is included only when OTP exposure is enabled outside production.',
      object({ otp: { type: 'string', pattern: '^\\d{6}$' } }, []),
    ),
  },
  'POST /auth/login': {
    200: response(
      'Session created; also sets the refresh cookie.',
      object({ accessToken: { type: 'string' }, user: ref('AuthUser') }, ['accessToken', 'user']),
    ),
  },
  'POST /auth/refresh': {
    200: response(
      'Session rotated; also sets the refresh cookie.',
      object({ accessToken: { type: 'string' } }, ['accessToken']),
    ),
  },
  'POST /auth/logout': { 204: response('Session revoked and refresh cookie cleared.') },
  'POST /auth/forgot-password': {
    202: response(
      'Password-reset code requested. `otp` is included only when OTP exposure is enabled outside production.',
      object({ otp: { type: 'string', pattern: '^\\d{6}$' } }, []),
    ),
  },
  'POST /auth/reset-password': { 204: response('Password reset.') },
  'POST /auth/verify-reset-code': { 204: response('Password-reset code is valid.') },
  'POST /auth/change-password': { 204: response('Password changed and refresh cookie cleared.') },
  'GET /users/me': { 200: response('Current profile.', wrapped('user', ref('User'))) },
  'PATCH /users/me': { 200: response('Updated profile.', wrapped('user', ref('User'))) },
  'GET /payment-methods': {
    200: response('Configured payment methods.', list('paymentMethods', ref('PaymentMethod'))),
  },
  'POST /payment-methods': {
    201: response('Payment method created.', wrapped('paymentMethod', ref('PaymentMethod'))),
  },
  'PATCH /payment-methods/:key': {
    200: response('Payment method updated.', wrapped('paymentMethod', ref('PaymentMethod'))),
  },
  'DELETE /payment-methods/:key': { 204: response('Payment method deleted.') },
  'POST /files/uploads': {
    201: response(
      'Signed upload URL created.',
      object(
        {
          storageKey: { type: 'string' },
          uploadUrl: { type: 'string', format: 'uri' },
          expiresInSeconds: { type: 'integer', minimum: 1 },
          maxSizeBytes: { type: 'integer', minimum: 1 },
        },
        ['storageKey', 'uploadUrl', 'expiresInSeconds', 'maxSizeBytes'],
      ),
    ),
  },
  'POST /files/uploads/complete': {
    201: response('Uploaded file persisted.', wrapped('file', ref('File'))),
  },
  'GET /files/:id/download': {
    302: {
      description: 'Redirect to a short-lived private-download URL.',
      headers: { Location: { schema: { type: 'string', format: 'uri' } } },
    } as Response,
  },
  'GET /courses': { 200: response('Course catalogue.', paginated('courses', ref('Course'))) },
  'POST /courses': { 201: response('Course created.', wrapped('course', ref('Course'))) },
  'GET /courses/:id': { 200: response('Course details.', wrapped('course', ref('Course'))) },
  'PATCH /courses/:id': { 200: response('Course updated.', wrapped('course', ref('Course'))) },
  'DELETE /courses/:id': { 204: response('Course deleted.') },
  'GET /courses/:courseId/reviews': {
    200: response('Approved reviews.', paginated('reviews', ref('Review'))),
  },
  'POST /courses/:courseId/reviews': {
    201: response('Review submitted for moderation.', wrapped('review', ref('OwnerReview'))),
  },
  'GET /courses/:courseId/reviews/me': {
    200: response('Current student review.', wrapped('review', ref('OwnerReview'))),
  },
  'PATCH /courses/:courseId/reviews/me': {
    200: response(
      'Review revised and submitted for moderation.',
      wrapped('review', ref('OwnerReview')),
    ),
  },
  'GET /admin/reviews': {
    200: response('Reviews for moderation.', paginated('reviews', ref('AdminReview'))),
  },
  'POST /admin/reviews/:id/approve': {
    200: response('Review approved.', wrapped('review', ref('AdminReview'))),
  },
  'POST /admin/reviews/:id/reject': {
    200: response('Review rejected.', wrapped('review', ref('AdminReview'))),
  },
  'GET /courses/:courseId/rounds': {
    200: response('Course rounds.', list('rounds', ref('Round'))),
  },
  'POST /courses/:courseId/rounds': {
    201: response('Round created.', wrapped('round', ref('Round'))),
  },
  'GET /rounds/:id': { 200: response('Round details.', wrapped('round', ref('Round'))) },
  'PATCH /rounds/:id': { 200: response('Round updated.', wrapped('round', ref('Round'))) },
  'DELETE /rounds/:id': { 204: response('Round deleted.') },
  'POST /rounds/:id/schedules': {
    201: response('Schedule entry added.', wrapped('round', ref('Round'))),
  },
  'PATCH /rounds/:id/schedules/:scheduleId': {
    200: response('Schedule entry updated.', wrapped('round', ref('Round'))),
  },
  'DELETE /rounds/:id/schedules/:scheduleId': { 204: response('Schedule entry deleted.') },
  'GET /rounds/:id/materials': {
    200: response('Round materials.', list('materials', ref('Material'))),
  },
  'POST /rounds/:id/materials': {
    201: response('Material added.', wrapped('material', ref('Material'))),
  },
  'PATCH /rounds/:id/materials/:materialId': {
    200: response('Material updated.', wrapped('material', ref('Material'))),
  },
  'DELETE /rounds/:id/materials/:materialId': { 204: response('Material deleted.') },
  'POST /rounds/:id/bookings': {
    201: response('Booking created.', wrapped('booking', ref('Booking'))),
  },
  'POST /bookings/:id/payment': {
    200: response('Payment evidence submitted.', wrapped('booking', ref('Booking'))),
  },
  'GET /bookings': { 200: response('Current student bookings.', list('bookings', ref('Booking'))) },
  'GET /admin/bookings': {
    200: response('Bookings for review.', list('bookings', ref('Booking'))),
  },
  'POST /admin/bookings/:id/approve': {
    200: response('Booking payment approved.', wrapped('booking', ref('Booking'))),
  },
  'POST /admin/bookings/:id/reject': {
    200: response('Booking payment rejected.', wrapped('booking', ref('Booking'))),
  },
  'POST /bookings/:id/cancellation': {
    200: response('Cancellation processed or requested.', wrapped('booking', ref('Booking'))),
  },
  'GET /admin/cancellations': {
    200: response('Cancellation requests.', list('bookings', ref('Booking'))),
  },
  'POST /admin/bookings/:id/cancellation/complete': {
    200: response('Cancellation completed.', wrapped('booking', ref('Booking'))),
  },
  'PATCH /admin/rounds/:id/join': {
    200: response('Join details updated.', wrapped('join', ref('JoinDetails'))),
  },
  'GET /rounds/:id/join': {
    200: response('Protected join details.', wrapped('join', ref('JoinDetails'))),
  },
  'GET /rounds/:id/sessions': {
    200: response('Round sessions.', list('sessions', ref('Session'))),
  },
  'GET /admin/sessions': { 200: response('Sessions.', list('sessions', ref('Session'))) },
  'POST /rounds/:id/sessions': {
    201: response('Session created.', wrapped('session', ref('Session'))),
  },
  'PATCH /sessions/:id': { 200: response('Session updated.', wrapped('session', ref('Session'))) },
  'DELETE /sessions/:id': { 204: response('Session deleted.') },
  'GET /admin/students': {
    200: response('Student accounts.', paginated('students', ref('AdminStudent'))),
  },
  'GET /admin/students/:id': {
    200: response(
      'Student profile and booking history.',
      object({ student: ref('AdminStudent'), bookings: arrayOf(ref('Booking')) }, [
        'student',
        'bookings',
      ]),
    ),
  },
  'GET /admin/courses/:courseId/students': {
    200: response('Course roster.', paginated('bookings', ref('Booking'))),
  },
  'GET /admin/rounds/:roundId/students': {
    200: response('Round roster.', paginated('bookings', ref('Booking'))),
  },
  'GET /communities': {
    200: response('Available communities.', list('communities', ref('Community'))),
  },
  'GET /communities/:courseId/messages': {
    200: response(
      'Community message history.',
      object(
        {
          messages: arrayOf(ref('CommunityMessage')),
          nextBefore: nullable({ type: 'string', pattern: '^\\d+$' }),
        },
        ['messages', 'nextBefore'],
      ),
    ),
  },
};

const publicOperations = new Set([
  'GET /health',
  'GET /ready',
  'POST /auth/register',
  'POST /auth/verify-email',
  'POST /auth/resend-verification',
  'POST /auth/login',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'POST /auth/verify-reset-code',
  'GET /payment-methods',
  'GET /courses',
  'GET /courses/:id',
  'GET /courses/:courseId/reviews',
  'GET /courses/:courseId/rounds',
]);
const refreshCookieOperations = new Set(['POST /auth/refresh', 'POST /auth/logout']);
const studentOnlyOperations = new Set([
  'POST /rounds/:id/bookings',
  'POST /bookings/:id/payment',
  'GET /bookings',
  'POST /bookings/:id/cancellation',
  'GET /courses/:courseId/reviews/me',
  'POST /courses/:courseId/reviews',
  'PATCH /courses/:courseId/reviews/me',
  'GET /student/courses',
  'GET /student/rounds/:id',
  'GET /student/dashboard',
]);
const existingSuccessDescriptions: Record<string, string> = {
  'GET /health': 'Application health.',
  'GET /ready': 'Application readiness.',
  'GET /student/courses': "Authenticated student's accessible course rounds.",
  'GET /student/rounds/:id': 'Accessible student round details.',
  'GET /student/dashboard': 'Authenticated student dashboard.',
};

function normalizeMethod(method: RouteOptions['method']): string {
  const firstMethod = Array.isArray(method) ? method[0] : method;
  return (firstMethod ?? 'GET').toUpperCase();
}

/** Adds documentation-only response and security metadata after Fastify registers a route. */
export function documentRoute(
  schema: FastifySchema,
  url: string,
  route: RouteOptions,
): FastifySchema {
  const method = normalizeMethod(route.method);
  const key = `${method} ${url}`;
  const documented = structuredClone(schema) as FastifySchema & {
    description?: string;
    response?: Record<string, Response>;
    security?: Array<Record<string, string[]>>;
  };
  if (!documented.response && operationResponses[key])
    documented.response = operationResponses[key];
  if (!documented.response && key === 'GET /health')
    documented.response = {
      200: response(
        'Application is healthy.',
        object(
          {
            status: { type: 'string', enum: ['ok'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
          ['status', 'timestamp'],
        ),
      ),
    };
  if (!documented.response && key === 'GET /ready')
    documented.response = {
      200: response(
        'Application and database are ready.',
        object(
          {
            status: { type: 'string', enum: ['ok'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
          ['status', 'timestamp'],
        ),
      ),
      503: response(
        'Database is unavailable.',
        object(
          {
            status: { type: 'string', enum: ['unavailable'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
          ['status', 'timestamp'],
        ),
      ),
    };
  if (!publicOperations.has(key))
    documented.security = refreshCookieOperations.has(key)
      ? [{ refreshCookie: [] }]
      : [{ bearerAuth: [] }];
  if (studentOnlyOperations.has(key))
    documented.description = `${documented.description ? `${documented.description}\n\n` : ''}Requires a STUDENT access token.`;
  if (
    key.includes('/admin/') ||
    [
      'POST /payment-methods',
      'PATCH /payment-methods/:key',
      'DELETE /payment-methods/:key',
      'POST /courses',
      'PATCH /courses/:id',
      'DELETE /courses/:id',
      'POST /courses/:courseId/rounds',
      'PATCH /rounds/:id',
      'DELETE /rounds/:id',
      'POST /rounds/:id/schedules',
      'PATCH /rounds/:id/schedules/:scheduleId',
      'DELETE /rounds/:id/schedules/:scheduleId',
      'POST /rounds/:id/materials',
      'PATCH /rounds/:id/materials/:materialId',
      'DELETE /rounds/:id/materials/:materialId',
      'POST /rounds/:id/sessions',
      'PATCH /sessions/:id',
      'DELETE /sessions/:id',
    ].includes(key)
  ) {
    documented.description = `${documented.description ? `${documented.description}\n\n` : ''}Requires an ADMIN access token.`;
  }
  if (documented.response && existingSuccessDescriptions[key]) {
    for (const [status, documentedResponse] of Object.entries(documented.response)) {
      if (status.startsWith('2')) {
        documentedResponse.description = existingSuccessDescriptions[key];
      }
    }
  }
  if (documented.response) {
    for (const [status, documentedResponse] of Object.entries(documented.response)) {
      if (!documentedResponse.description)
        documentedResponse.description =
          status === '503' ? 'Application dependency is unavailable.' : 'Response.';
    }
  }
  if (documented.response) documented.response = { ...documented.response, ...errorResponses };
  return documented;
}
