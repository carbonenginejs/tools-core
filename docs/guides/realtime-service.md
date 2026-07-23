# Host realtime services

Status: Stable  
Scope: `@carbonenginejs/tools-core/realtime`, `./service`, and `./webhook`  
Audience: Node.js service integrators  
Summary: Composes authenticated HTTP, WebSocket, webhook, and filesystem-backed realtime services.

## Quick start

```js
import { CjsRealtimeServer } from "@carbonenginejs/tools-core/service";

const realtime = new CjsRealtimeServer({
    services: [ aggregateChat, exactChannelChat ],
    grants,
    allowedOrigins: [ "http://127.0.0.1:8080" ],
});

const address = await realtime.Listen({
    host: "127.0.0.1",
    port: 0,
});

// Use address.host and address.port; capabilities remain server-owned.
await realtime.Stop();
```

The server starts registered services before accepting traffic and stops HTTP
admission before draining WebSockets and services. Its default network policy
accepts only explicit loopback addresses.

## Service contract

A registered service provides `Describe()`, idempotent `Start(context)` and
`Stop()`, plus optional snapshot, content, and command methods. The hub owns:

- service stream IDs and global/per-topic sequences;
- capability authentication and actor attribution;
- subscriptions, snapshot cursors, and slow-consumer recovery;
- bounded queues, rate limits, and operation deduplication.

Services own family semantics and receive no raw socket. Stateful sources use
`context.Commit()` to update materialized state and publish its event on the
same service lane used for snapshots.

## Authentication and recovery

The embedding application creates random capability grants. Each grant maps to
one server-owned actor, exact origins, expiry, and explicit
service/topic/action scopes. HTTP sends the capability as a Bearer value;
WebSocket sends it in the first `hello` message. Capabilities never belong in
URLs, discovery payloads, logs, or preferences.

Subscriptions are future-only. Snapshot-recoverable consumers:

1. subscribe and buffer newer events;
2. fetch the cursor-stamped snapshot;
3. apply buffered events from the same stream above that cursor.

A slow consumer is closed with `resync_required` and repeats the algorithm.
The complete wire contract is [Realtime protocol v1](../protocols/realtime-v1.md).

## Webhook ingress

`CjsWebhookHttpRouter` reads bounded exact request bytes.
`AuthenticateWebhook()` validates the provider signature, timestamp, replay
identity, and raw body before `HandleWebhook()` may return canonical events.
One `CjsWebhookIngressSource` can feed several statically registered family
projections without verifying the same provider delivery repeatedly.

Webhook endpoints are loopback-only by default and do not accept browser CORS.
A public deployment requires HTTPS, bounded admission, source rate limits, and
durable replay protection.

## Resource watch

`CjsRealtimeResourceWatchService` projects one configured filesystem root into
snapshot entries and `add`, `update`, or `remove` events. Physical paths,
native watcher objects, symlink escapes, and provider errors never enter public
payloads. Watcher notifications are hints; authoritative state is reread and
bounded overflow collapses into a complete reconciliation.

## Provider integrations

The Twitch subpath supplies OAuth/Helix, IRC/EventSub, and shared chat,
activity, and state sources. The Kick subpath verifies signed webhooks and maps
activity/state into the same provider-neutral livestream contract.

One provider connection may back aggregate and exact-channel services. See
[Chat and livestream source topology](../concepts/chat-and-livestream-sources.md)
for multi-provider and multi-channel composition.
