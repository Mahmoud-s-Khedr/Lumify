# Community Chat integration guide

This is the implementation contract for web and mobile clients. The community is one real-time
chat room per **course**; it is not a direct-message or per-round chat system.

Use REST to hydrate and paginate state, and Socket.IO for live mutations and updates. All IDs are
decimal **strings**. Do not convert them to JavaScript numbers, because database IDs can exceed
safe integer precision.

## What a client must support

- A community list with latest-message previews and unread badges.
- Newest-first message history with "load older" pagination.
- Live message creation, deletion, and read-state updates.
- Text messages and optional attachments.
- Read-only rendering for archived courses.

The backend does not provide typing indicators, presence, reactions, editing, threads, manual
room joining, or a REST endpoint to send/delete messages.

## Access rules

Every REST request requires:

```http
Authorization: Bearer <accessToken>
```

Socket.IO authenticates with the same access token during its connection handshake.

| User / course state | Can read | Can send or delete |
| --- | --- | --- |
| Student with a currently `CONFIRMED` booking in any round of the course | Yes | Yes; may delete only their own messages. |
| Admin | Yes, for every course | Yes; may delete any message. |
| Pending, payment-rejected, cancellation-requested, cancelled, or unrelated student | No | No |
| Eligible user in an archived course | Yes | No; the community is read-only. |

Eligibility is checked on every REST action, every Socket.IO mutation, and immediately before a
live event is delivered. There is no separate "access revoked" socket event: after a booking
changes, reload `/communities` and handle subsequent authorization failures by removing or locking
the affected community in the UI.

## Shared data shapes

The examples use TypeScript, but the JSON shape is platform-neutral.

```ts
type ChatFile = {
  id: string;
  originalName: string;
  mimeType: string | null;
  sizeBytes: string | null;
  // Absolute API URL. It requires Authorization and redirects to a short-lived storage URL.
  downloadUrl: string;
};

type ChatSender = {
  id: string;
  name: string;
  avatar: ChatFile | null;
};

type CommunityMessage = {
  id: string;
  courseId: string;
  content: string | null;
  createdAt: string; // ISO-8601 UTC timestamp
  sender: ChatSender;
  attachments: ChatFile[];
};

type CommunitySummary = {
  course: {
    id: string;
    title: string;
    description: string | null;
    archived: boolean;
  };
  readOnly: boolean;
  unreadCount: number;
  latestMessage: CommunityMessage | null;
};

type ChatError = {
  error: string;
  message: string;
};
```

`content` is `null` when a message contains attachments only. A message always has either
non-empty text or at least one attachment.

## Recommended client lifecycle

Register all socket listeners before connecting, then use this order after a user has a valid
access token:

1. Connect Socket.IO and wait for `community:ready`.
2. Fetch `GET /communities`.
3. When the user opens a community, fetch its first history page.
4. Merge REST and socket messages by message ID; Socket.IO events can arrive while REST loading is
   in progress.
5. When the latest visible received message is read, call `community:read` or the REST read API.
6. On logout, disconnect the socket and clear all community state.

Do not emit a manual room-join event. The server automatically joins every currently eligible
course room.

## REST API

### `GET /communities`

Lists communities available to the current user, ordered by course title. Use it to build the
inbox/sidebar and refresh access or unread state after reconnecting.

```http
GET /communities
Authorization: Bearer <accessToken>
```

```json
{
  "communities": [
    {
      "course": {
        "id": "12",
        "title": "UI Design",
        "description": "Learn the foundations of interface design.",
        "archived": false
      },
      "readOnly": false,
      "unreadCount": 3,
      "latestMessage": {
        "id": "88",
        "courseId": "12",
        "content": "Welcome!",
        "createdAt": "2026-09-17T10:00:00.000Z",
        "sender": { "id": "4", "name": "Mohand", "avatar": null },
        "attachments": []
      }
    }
  ]
}
```

`unreadCount` counts only messages from other users. A user's own messages never make their
community unread.

### `GET /communities/:courseId/messages?before=&limit=`

Loads visible message history in descending order: newest message first. Render it in your desired
chat direction, but preserve the returned cursor semantics.

| Query parameter | Required | Rules |
| --- | --- | --- |
| `limit` | No | `1`–`100`; default `50`. |
| `before` | No | The previous response's `nextBefore` value; loads older messages. |

```http
GET /communities/12/messages?limit=50&before=88
Authorization: Bearer <accessToken>
```

```json
{
  "messages": [
    {
      "id": "87",
      "courseId": "12",
      "content": "Here is the guide.",
      "createdAt": "2026-09-17T09:58:00.000Z",
      "sender": { "id": "4", "name": "Mohand", "avatar": null },
      "attachments": [
        {
          "id": "33",
          "originalName": "guide.pdf",
          "mimeType": "application/pdf",
          "sizeBytes": "12000",
          "downloadUrl": "https://api.example.com/files/33/download"
        }
      ]
    }
  ],
  "nextBefore": "87"
}
```

Pass `nextBefore` unchanged to get the next older page. `nextBefore: null` means there are no more
older messages. Treat an invalid or cross-community cursor as an `INVALID_CURSOR` error rather
than silently starting a new history query.

### `POST /communities/:courseId/read`

Advances the current user's read marker. It never moves the marker backward.

```http
POST /communities/12/read
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "messageId": "88" }
```

Send `{}` to mark through the newest visible message currently in that community.

```json
{
  "courseId": "12",
  "messageId": "88",
  "readCount": 3,
  "unreadCount": 1
}
```

`readCount` is the number of newly read messages from other users for this operation. `unreadCount`
is the number remaining after the marker advances. Do not decrement a badge locally without using
the response/event as the source of truth.

## Attachments

Upload an attachment before sending the socket message that references it.

| Constraint | Value |
| --- | --- |
| Maximum file size | 20 MiB (`20,971,520` bytes) |
| Attachments per message | Maximum 10 |
| Supported MIME types | `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`, `text/plain`, Word, Excel, and PowerPoint (legacy and OOXML) |
| Ownership | The uploading user must send it. |
| Reuse | A file can be attached to only one successfully created message. |

The accepted Office MIME types are:

```text
application/msword
application/vnd.openxmlformats-officedocument.wordprocessingml.document
application/vnd.ms-excel
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
application/vnd.ms-powerpoint
application/vnd.openxmlformats-officedocument.presentationml.presentation
```

### Upload sequence

1. Ask the API for a signed upload URL.
2. Upload the raw binary to that URL with the exact requested `Content-Type`.
3. Register the completed upload with the API.
4. Send the returned file ID in `community:sendMessage`.

```http
POST /files/uploads
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "kind": "COMMUNITY_ATTACHMENT",
  "originalName": "guide.pdf",
  "mimeType": "application/pdf"
}
```

```json
{
  "storageKey": "community-attachments/<uuid>",
  "uploadUrl": "https://…",
  "expiresInSeconds": 900,
  "maxSizeBytes": 20971520
}
```

Upload directly to `uploadUrl`; do not send the binary through Lumify's API server. If the signed
upload URL expires or the binary upload fails, request a new URL. The mobile/web HTTP client must
allow the storage origin; browser deployments also need the storage bucket's CORS configuration to
permit `PUT`, `GET`, and `HEAD` from the frontend origin.

```http
POST /files/uploads/complete
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "kind": "COMMUNITY_ATTACHMENT",
  "originalName": "guide.pdf",
  "mimeType": "application/pdf",
  "storageKey": "community-attachments/<uuid>"
}
```

The response is `{ "file": ChatFile }`. Keep its `id` until send succeeds. If sending fails
before a message is created, the same file ID may be retried. After a successful send, never reuse
that ID in another message.

### Downloading

`downloadUrl` is an absolute API URL, not an already-public file URL. Request it with the current
Bearer token; the API authorizes access and responds with a redirect to a short-lived storage URL.

- Mobile: use the authenticated HTTP client and follow the redirect or download the resulting URL.
- Web applications using header-based JWT storage: fetch it with `Authorization`, then turn the
  returned bytes into a blob/object URL. Do not navigate directly to it if the browser cannot add
  the Authorization header.

An attachment belongs to a normal message only while that message is visible. When its message is
deleted, other students can no longer download it; the original uploader and admins retain their
normal file access.

## Socket.IO

Socket.IO is served at the same API origin as REST. Use a WebSocket transport where supported;
Socket.IO polling remains a library fallback.

```ts
import { io } from 'socket.io-client';

const socket = io(API_URL, {
  auth: { token: accessToken },
  transports: ['websocket'],
});
```

Wait for `community:ready` before treating the real-time layer as usable. On every reconnect,
provide the latest access token, register listeners before calling `connect`, and wait for a new
`community:ready` event before resuming optimistic actions.

```ts
socket.auth = { token: latestAccessToken };
socket.connect();
```

The handshake token is checked once. A connected socket remains usable if that token later expires,
but every new connection/reconnection requires a valid token. Refresh tokens proactively when your
app normally does so; do not rely on an expired token reconnecting successfully.

### Client → server events

Every mutation uses a Socket.IO acknowledgement callback. A success has `ok: true`; failures have
`error` and `message` and do **not** include `ok: false`.

```ts
type ChatAck<T extends object> = ({ ok: true } & T) | ChatError;
```

| Event | Payload | Success acknowledgement |
| --- | --- | --- |
| `community:sendMessage` | `{ courseId, content?, attachmentIds? }` | `{ ok: true, message: CommunityMessage }` |
| `community:deleteMessage` | `{ messageId }` | `{ ok: true, message: { id, courseId } }` |
| `community:read` | `{ courseId, messageId? }` | `{ ok: true, courseId, userId, messageId, unreadCount, readCount }` |

```ts
function emitWithAck<T extends object>(event: string, payload: object): Promise<ChatAck<T>> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

const result = await emitWithAck<{ message: CommunityMessage }>('community:sendMessage', {
  courseId: '12',
  content: 'Hello everyone',
});

if ('error' in result) {
  // Show result.message; use result.error for a typed UI action.
} else {
  // Merge result.message by ID. The same message also arrives as messageCreated.
}
```

`content` is trimmed by the server and has a 5,000-character maximum. Send either non-whitespace
text or one/more attachment IDs. Do not add a message twice: merge the acknowledgement result and
the `community:messageCreated` event by `message.id`.

### Server → client events

The server emits room events to every eligible connected member, including the member who performed
the action.

| Event | Payload | Client action |
| --- | --- | --- |
| `community:ready` | `{ courseIds: string[], error: string \| null }` | Record available real-time courses. If `error` is non-null, REST may still be usable; retry/reconnect according to app policy. |
| `community:messageCreated` | `CommunityMessage` | Upsert the message, update its community preview, and increase unread only when it is from another user and the conversation is not marked read. |
| `community:messageDeleted` | `{ id: string, courseId: string }` | Remove the message if loaded and refresh/update the community preview if needed. |
| `community:read` | `{ courseId: string, userId: string, messageId: string \| null, unreadCount: number }` | Apply unread state only when `userId` is the current user; other users' read markers can be ignored unless the product later displays them. |

```ts
socket.on('connect_error', (error) => {
  const authError = error.data as ChatError | undefined;
  // Invalid/missing handshake tokens use authError.error === 'UNAUTHENTICATED'.
});

socket.on('community:messageCreated', (message: CommunityMessage) => {
  // upsert by message.id
});

socket.on('community:messageDeleted', ({ id, courseId }) => {
  // remove id from loaded history for courseId
});
```

## Error handling

REST errors use the same JSON shape as socket acknowledgement failures:

```json
{
  "error": "COMMUNITY_ACCESS_FORBIDDEN",
  "message": "You must have a confirmed booking in this course to use its community."
}
```

| Error code | Typical client response |
| --- | --- |
| `UNAUTHENTICATED` | Refresh/login and reconnect with a new token. |
| `COMMUNITY_ACCESS_FORBIDDEN` | Remove/lock the community and refresh the community list. |
| `COMMUNITY_READ_ONLY` | Disable composer/delete controls and preserve readable history. |
| `MESSAGE_DELETE_FORBIDDEN` | Keep the message; show that only its author or an admin may delete it. |
| `MESSAGE_NOT_FOUND` / `MESSAGE_ALREADY_DELETED` | Treat local content as deleted and refetch if necessary. |
| `INVALID_CURSOR` | Reset history pagination and reload the first page. |
| `INVALID_MESSAGE` | Do not advance the read marker; refresh the current history. |
| `VALIDATION_ERROR` | Show local validation feedback; verify text and attachment count. |
| `INVALID_ATTACHMENT` / `ATTACHMENT_FORBIDDEN` / `ATTACHMENT_ALREADY_USED` | Remove the invalid attachment from the composer and require a new upload if it was already used. |
| `FILE_ACCESS_FORBIDDEN` | Do not display/download the attachment; refresh access state. |
| `FILE_STORAGE_UNAVAILABLE` | Keep the draft and offer retry once storage is available. |

## Delivery checklist

Before declaring a client implementation complete, verify:

- REST requests and attachment downloads send the Bearer token.
- IDs stay strings end-to-end.
- Socket listeners are registered before connecting and the UI waits for `community:ready`.
- Socket reconnect supplies a fresh token and does not manually join rooms.
- REST and socket messages are deduplicated by message ID.
- A `readOnly` community has no send or delete affordance.
- The composer validates attachment MIME type/count/size before upload, while also rendering server
  validation errors.
- The app handles upload → complete → send as a three-step flow and does not reuse a sent file ID.
- History uses `nextBefore` unchanged and handles `null` as the end of pagination.
- The app handles its own `community:read` events and safely ignores other users' unread counts.
- Logout disconnects Socket.IO and clears cached community state.

## Backend source of truth

- REST routes: `src/modules/communities/routes.ts`
- Socket events: `src/modules/communities/socket.ts`
- Authorization and business rules: `src/modules/communities/service.ts`
- Attachment endpoints: `src/modules/files/routes.ts`

If the API contract changes, update this guide and the community journey tests together.
