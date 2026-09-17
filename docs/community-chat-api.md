# Community Chat API Reference

This document describes the REST and Socket.IO interfaces used by course communities.

## Access and IDs

All community REST endpoints require an access token:

```http
Authorization: Bearer <accessToken>
```

Community access is available to students with a currently `CONFIRMED` booking in any round of the course. Admins can access all course communities. All IDs are decimal strings.

## Community REST API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/communities` | List communities the current user can access. |
| `GET` | `/communities/:courseId/messages?before=&limit=` | Load message history, newest first. |
| `POST` | `/communities/:courseId/read` | Update the current user's read marker and unread count. |

### List communities

```http
GET /communities
```

```json
{
  "communities": [
    {
      "course": {
        "id": "12",
        "title": "UI Design",
        "description": "…",
        "archived": false
      },
      "readOnly": false,
      "unreadCount": 3,
      "latestMessage": {
        "id": "88",
        "courseId": "12",
        "content": "Welcome!",
        "createdAt": "2026-09-17T10:00:00.000Z",
        "sender": {
          "id": "4",
          "name": "Mohand",
          "avatar": null
        },
        "attachments": []
      }
    }
  ]
}
```

### Load message history

```http
GET /communities/:courseId/messages?limit=50&before=88
```

`limit` ranges from `1` to `100` and defaults to `50`. `before` is optional and uses the previous response's `nextBefore` value to load older messages.

```json
{
  "messages": [
    {
      "id": "88",
      "courseId": "12",
      "content": "Welcome!",
      "createdAt": "2026-09-17T10:00:00.000Z",
      "sender": {
        "id": "4",
        "name": "Mohand",
        "avatar": null
      },
      "attachments": [
        {
          "id": "33",
          "originalName": "guide.pdf",
          "mimeType": "application/pdf",
          "sizeBytes": "12000",
          "downloadUrl": "/files/33/download"
        }
      ]
    }
  ],
  "nextBefore": "88"
}
```

`nextBefore: null` means there are no older messages.

### Mark messages as read

Mark through one message:

```http
POST /communities/:courseId/read
Content-Type: application/json

{
  "messageId": "88"
}
```

Send an empty object to mark every currently visible message as read:

```json
{}
```

```json
{
  "courseId": "12",
  "messageId": "88",
  "readCount": 3,
  "unreadCount": 1
}
```

There are no REST endpoints for sending or deleting messages; those are Socket.IO actions.

## Attachment REST API

Attachments must be uploaded before they are referenced by a `community:sendMessage` event.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/files/uploads` | Create a signed upload URL. |
| `POST` | `/files/uploads/complete` | Register the uploaded file and obtain its file ID. |
| `GET` | `/files/:id/download` | Download an attachment when authorized. |

### 1. Create a signed upload URL

```http
POST /files/uploads
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

Upload the binary file directly to `uploadUrl`.

### 2. Register the completed upload

```http
POST /files/uploads/complete
Content-Type: application/json

{
  "kind": "COMMUNITY_ATTACHMENT",
  "originalName": "guide.pdf",
  "mimeType": "application/pdf",
  "storageKey": "community-attachments/<uuid>"
}
```

```json
{
  "file": {
    "id": "33",
    "originalName": "guide.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": "12000",
    "downloadUrl": "/files/33/download"
  }
}
```

Community attachments have a 20 MB maximum size. Supported formats are JPEG, PNG, GIF, WebP, PDF, plain text, Word, Excel, and PowerPoint files. A message can contain at most ten attachments; each attachment must belong to its sender and can be used only once.

## Socket.IO API

Connect using the current access token:

```ts
const socket = io(API_URL, {
  auth: { token: accessToken },
});
```

The server automatically joins every eligible community. Wait for `community:ready` before considering the connection ready.

### Client events

| Event | Payload | Successful acknowledgement |
| --- | --- | --- |
| `community:sendMessage` | `{ courseId, content?, attachmentIds? }` | `{ ok: true, message }` |
| `community:deleteMessage` | `{ messageId }` | `{ ok: true, message: { id, courseId } }` |
| `community:read` | `{ courseId, messageId? }` | `{ ok: true, courseId, userId, messageId, unreadCount, readCount }` |

Send a text message:

```ts
socket.emit(
  'community:sendMessage',
  { courseId: '12', content: 'Hello everyone' },
  console.log,
);
```

Send a message with uploaded attachments:

```ts
socket.emit(
  'community:sendMessage',
  {
    courseId: '12',
    content: 'Here is the guide',
    attachmentIds: ['33', '34'],
  },
  console.log,
);
```

A message needs text or at least one attachment. Text is trimmed and has a 5,000-character maximum.

### Server events

| Event | Payload |
| --- | --- |
| `community:ready` | `{ courseIds: string[], error: string \| null }` |
| `community:messageCreated` | Complete public message object. |
| `community:messageDeleted` | `{ id, courseId }` |
| `community:read` | `{ courseId, userId, messageId, unreadCount }` |

```json
{
  "id": "88",
  "courseId": "12",
  "content": "Hello everyone",
  "createdAt": "2026-09-17T10:00:00.000Z",
  "sender": {
    "id": "4",
    "name": "Mohand",
    "avatar": null
  },
  "attachments": []
}
```

Failed acknowledgements use this shape:

```json
{
  "error": "COMMUNITY_ACCESS_FORBIDDEN",
  "message": "You must have a confirmed booking in this course to use its community."
}
```

Common error codes include `UNAUTHENTICATED`, `COMMUNITY_ACCESS_FORBIDDEN`, `COMMUNITY_READ_ONLY`, `MESSAGE_DELETE_FORBIDDEN`, `INVALID_ATTACHMENT`, and `ATTACHMENT_FORBIDDEN`.

Students may delete their own messages; admins may delete any message. Deleted messages remain stored for audit but disappear from normal history. Archived communities remain readable but do not allow sending or deleting messages.

## Socket authentication lifetime

The access token is checked once when the Socket.IO connection is established. The authenticated
socket remains usable until it disconnects, even if that handshake token later expires. On a new
connection (including a Socket.IO reconnection), the client must provide a valid access token.
