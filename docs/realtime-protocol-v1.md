# Carbon tools realtime protocol v1

Status: normative package contract, 2026-07-23

This document defines the version 1 boundary implemented by `tools-core` and
consumed by `tools-browser` or other process clients. The executable examples
are checked in beside it as
`docs/realtime-protocol-v1.transcript.json`. Package tests replay those
transcripts through the real hub so that documentation and implementation do
not drift silently.

## Transport and handshake

The WebSocket endpoint is `/v1/realtime` and the required WebSocket
subprotocol is `carbon.tools.realtime.v1`. Requests with a query string are
rejected. Application messages are UTF-8 JSON text objects; binary messages
are not accepted. The transport disables per-message compression and applies
bounded inbound and outbound queues.

The client must send `hello` as its first application message before the
server's hello deadline:

```json
{
    "type": "hello",
    "protocolVersion": 1,
    "capability": "launcher-injected-bearer-value",
    "client": {
        "id": "viewer-main",
        "kind": "browser"
    }
}
```

`client` is optional descriptive JSON and is not an authority. The capability
is the authority. A successful response includes the authenticated actor,
effective scopes, server limits, and discovery route:

```json
{
    "type": "hello",
    "protocol": "carbon.tools.realtime",
    "protocolVersion": 1,
    "connectionId": "connection-opaque",
    "actor": {
        "id": "viewer-main",
        "kind": "browser"
    },
    "scopes": {
        "discover": true,
        "services": {}
    },
    "discoveryRef": "/v1/realtime",
    "limits": {},
    "heartbeat": {}
}
```

The client must treat IDs as opaque strings. It must not derive meaning from
the example prefixes used by tests.

## Authentication boundary

Capabilities are random bearer values supplied by the embedding launcher or
another trusted local control plane. They are never placed in a URL, query
string, discovery document, event, error, or log. HTTP requests use
`Authorization: Bearer <capability>`; WebSocket clients send the capability in
the first `hello` message after a permitted upgrade.

Authentication has two independent gates:

1. The WebSocket gateway admits an exact browser `Origin`, or deliberately
   admits a missing Origin when its own `allowMissingOrigin` is enabled.
2. The individual capability grant must admit that same exact Origin, or have
   its own `allowMissingOrigin` enabled.

A browser capability normally has one or more exact `allowedOrigins` and does
not allow a missing Origin. A Codex, Claude, or other non-browser process uses
a separate, short-lived, least-privilege grant with no browser origins and
`allowMissingOrigin: true`. Enabling only one of the two missing-Origin gates
does not grant access. A missing-Origin grant must not be reused by page code.

Grant scopes independently control discovery and each service's topics,
commands, snapshots, and content. Expiry, revocation, or replacement
invalidates an established session when it is next validated. Authentication
failures are intentionally indistinguishable and do not reveal which check
failed.

## Client messages

After hello, each client request has a connection-unique `requestId`. A used
request ID cannot be reused, even after its request has completed.

### Subscribe

```json
{
    "type": "subscribe",
    "requestId": "subscribe-chat-1",
    "serviceId": "primary-chat",
    "topics": [
        "chat.message.received",
        "chat.status.changed"
    ]
}
```

Topics must be non-empty and unique. Version 1 permits at most one active
subscription to a given service on one connection. The completed result
contains the opaque `subscriptionId`, service identity, and a cursor captured
on the service publication lane:

```json
{
    "type": "result",
    "requestId": "subscribe-chat-1",
    "status": "completed",
    "data": {
        "subscriptionId": "subscription-opaque",
        "service": {
            "family": "chat",
            "familyVersion": 1,
            "kind": "twitch.chat",
            "id": "primary-chat"
        },
        "cursor": {
            "streamId": "stream-opaque",
            "sequence": 12,
            "topicSequences": {
                "chat.message.received": 12,
                "chat.status.changed": 0
            }
        }
    }
}
```

The result is a barrier: matching events already ordered before that cursor
are not replayed to the new subscription, and later matching events are
delivered after the result. An aggregate chat service may carry an unlimited
configured set of provider rooms in its payloads. Exact-room services are
separate least-privilege projections over the same provider source, not one
WebSocket connection per room.

### Unsubscribe

```json
{
    "type": "unsubscribe",
    "requestId": "unsubscribe-chat-1",
    "subscriptionId": "subscription-opaque"
}
```

The completed result contains the removed `subscriptionId`. Events ordered
before the unsubscribe barrier may arrive before its result; no later event
for that subscription may follow the result.

### Command

```json
{
    "type": "command",
    "requestId": "speak-1",
    "serviceId": "character-main",
    "action": "speak",
    "operationId": "agent-turn-42",
    "data": {
        "text": "Hello"
    }
}
```

`operationId` is required unless the service declares the action read-only.
For mutating commands it provides idempotency within the operation store's
retention scope. Reusing an operation identity with different data fails. A
result status is `completed` or `accepted`; `accepted` means that deferred work
must later re-enter the service publication lane and is not a completion
notification by itself.

## Server messages

### Event

Every event belongs to exactly one service stream:

```json
{
    "type": "event",
    "eventId": "event-opaque",
    "service": {
        "family": "chat",
        "familyVersion": 1,
        "kind": "twitch.chat",
        "id": "primary-chat"
    },
    "streamId": "stream-opaque",
    "sequence": 13,
    "topic": "chat.message.received",
    "topicSequence": 13,
    "occurredAt": "2026-07-23T00:00:00.000Z",
    "publishedAt": "2026-07-23T00:00:00.100Z",
    "actor": {
        "id": "primary-chat",
        "kind": "service"
    },
    "payload": {
        "schema": "chat.event",
        "version": 1,
        "data": {}
    },
    "subscriptionId": "subscription-opaque"
}
```

`sequence` is a total order only within one `streamId`. `topicSequence` is the
order within one topic. A service restart creates a new stream ID and resets
its counters. `occurredAt` is source time when known; `publishedAt` is host
publication time. Consumers must use the service and stream identity with a
cursor, never compare bare sequence numbers across services or streams.

Several clients may receive the same event independently. Delivery to one
client neither consumes nor acknowledges delivery for another. The hub does
not define cross-service order, provider deduplication, or generic history.

### Result and error

Every accepted request terminates with one `result` or one request-correlated
`error`. Results contain `type`, `requestId`, `status`, and JSON `data` (null
when absent). Errors contain:

```json
{
    "type": "error",
    "requestId": "subscribe-chat-1",
    "code": "topic_not_found",
    "message": "Realtime topic was not found",
    "retryable": false,
    "connectionUsable": true
}
```

Optional bounded `details` may be present. Clients branch on `code`,
`retryable`, and `connectionUsable`, not human text. An unusable connection is
closed rather than kept alive for another request.

## Discovery, snapshots, and content

Authenticated HTTP routes share the WebSocket capability authority:

- `GET /v1/realtime` returns no-store discovery filtered to visible services.
- `GET /v1/realtime/services/<serviceId>/snapshot` returns a no-store snapshot
  and cursor captured atomically on the service publication lane.
- `GET|HEAD /v1/realtime/services/<serviceId>/content/<path>?revision=<opaque>`
  opens revision-pinned service content. Physical paths are never exposed.

Browser HTTP requests require an allowed Origin and use exact CORS responses.
Process clients may omit Origin only when their capability allows it. Query
parameters are not authentication and are rejected unless explicitly defined
by the revision-pinned content route.

Discovery has schema `carbon.tools.realtime.discovery`, version 1. Snapshots
have schema `carbon.tools.realtime.snapshot`, version 1, a service identity,
cursor, and family-versioned payload.

For a topic whose discovery recovery is `snapshot`, a client subscribes first,
buffers matching events, obtains a snapshot, discards buffered events from a
different stream or at/below the snapshot cursor, and applies the remainder in
sequence. For `loss-tolerant` topics, reconnect means resume from now. The hub
does not resend old chat or activity events. A `resync_required` close restarts
the snapshot algorithm where the service offers one.

## Limits, closes, and evolution

The server hello advertises the application limits needed by clients. The
transport also enforces hello, heartbeat, idle, payload, queue, and listener
limits. Important close outcomes include:

| Code | Reason | Meaning |
| --- | --- | --- |
| 1001 | `server_shutdown` | host is stopping |
| 1002 | protocol error code | malformed order, JSON, or version |
| 1003 | `text_messages_required` | binary application message |
| 1008 | `unauthorized` or `rate_limited` | policy failure |
| 1009 | `message_too_large` | payload exceeded a bound |
| 1011 | transport/serialization failure | internal delivery failure |
| 4408 | `hello_timeout` | hello was not received in time |
| 4409 | `resync_required` | slow client exceeded outbound bounds |

Version 1 readers ignore unknown object members so compatible producers may
add optional metadata. They do not ignore an unknown message `type`, protocol
version, family payload version, required field, or incompatible field type.
A semantic change to ordering, authentication, required fields, or message
meaning requires a new protocol version and WebSocket subprotocol.

## Provenance

Twitch and Kick names and API terms identify interoperable third-party
protocol surfaces. CarbonEngineJS is not affiliated with or endorsed by Twitch
or Kick.
