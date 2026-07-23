# Realtime livestream contract v1

Status: normative package contract, 2026-07-23

This contract defines the provider-neutral payloads published by tools-core
livestream integrations. It is independent of the WebSocket framing contract:
the realtime v1 `event.data` value contains one payload from this document.
`CjsRealtimeLivestreamContract` is the executable validator, and the adjacent
JSON file contains public conformance fixtures.

## Families and recovery

`livestream.activity` is live-only and loss-tolerant. A new subscription starts
from now; reconnect never replays subscriber, follow, raid, contribution, or
reward alerts. Provider retries are deduplicated at ingress or by the provider
source before publication.

`livestream.state` is snapshot-recoverable. A client subscribes and buffers
changes, reads a materialized snapshot and its realtime cursor, then applies
only buffered changes from the same stream whose sequence is above the cursor.

The canonical topics are:

- `livestream.activity.subscription.received`
- `livestream.activity.subscription.gifted`
- `livestream.activity.follow.received`
- `livestream.activity.raid.received`
- `livestream.activity.contribution.received`
- `livestream.activity.reward.redeemed`
- `livestream.state.changed`

## Common event fields

Every activity and state-change payload contains:

```js
{
    id: "stable-logical-provider-event-id",
    occurredAt: "2026-07-23T04:00:00.000Z",
    deliveryMode: "live",
    source: {
        provider: "twitch",
        channelId: "123456",
        channelLogin: "example",
        channelDisplayName: "Example",
    },
    extensions: {
        twitch: {},
    },
}
```

`id` identifies the logical canonical event, not merely an HTTP request. If one
provider delivery becomes several canonical events, the adapter derives stable
suffixes. `occurredAt` is canonical UTC. When the provider supplies no event
time, the adapter uses the authenticated receive time and records
`extensions.<provider>.timeSource` as `"received"`.

Provider-only fields are contained below the matching provider extension.
OAuth tokens, webhook signatures, authorization headers, raw request bodies,
and provider URLs containing credentials are never extensions.

Activity payloads also contain `actor`, using `{ id, login, displayName }`.
Only inherently anonymous contribution and gift-batch events may use `null`.
Nullable identity labels are explicit rather than omitted.

## Subscription alerts

`livestream.activity.subscription.received` represents one beneficiary gaining
or renewing subscription access. Both Twitch `channel.subscribe` and Kick
`channel.subscription.new` therefore produce the same topic. Clients can make
one general subscriber alert or distinguish:

```js
{
    actor: {
        id: "subscriber-id",
        login: "subscriber-login",
        displayName: "Subscriber",
    },
    subscription: {
        kind: "new", // "new", "renewal", or "gift"
        giftedBy: null,
    },
}
```

For a gifted beneficiary, `actor` is the beneficiary, `kind` is `"gift"`, and
`giftedBy` contains the gifter when the provider discloses it. A provider gift
batch additionally uses `livestream.activity.subscription.gifted`; its actor is
the gifter or `null`, and `gift.count` is the batch size. This prevents a batch
alert from being confused with each beneficiary alert.

Tier, duration, cumulative tenure, expiry, and provider subscription IDs are
not reliably equivalent. They stay in the provider extension until a genuinely
shared meaning is established.

## Other activity topics

- A follow uses the common fields and its actor is the follower.
- A raid adds `raid.viewers`; its actor is the source broadcaster and its
  `source` is the destination channel.
- A contribution adds integer `contribution.amount`, bounded `unit`, and a
  nullable `message`. Unit names such as `bits` and `kicks` are not converted.
- A reward adds `reward.id`, `title`, integer `cost`, nullable `input`, and the
  canonical status `pending`, `fulfilled`, or `cancelled`.

Adapters do not speculate across providers. In particular, tools-core does not
convert contributions to money, deduplicate a Twitch actor against a Kick
actor, or impose a total order between provider services.

## State changes and snapshots

`livestream.state.changed` carries an atomic `changes` object. Supported fields
are `online`, `streamId`, `startedAt`, `endedAt`, `title`, `language`, `mature`,
`category`, and `viewers`. Omission means unchanged. `null` means the provider
or materializer knows the value is absent. An empty change is invalid.

```js
{
    id: "state-change-id",
    occurredAt: "2026-07-23T04:00:00.000Z",
    deliveryMode: "live",
    source: {},
    changes: {
        online: true,
        streamId: "stream-id",
        startedAt: "2026-07-23T04:00:00.000Z",
    },
    extensions: {},
}
```

A materialized snapshot is `{ observedAt, states }`. Each state has `source`,
a complete `stream` object containing every supported field, and provider
extensions. Sources are unique by provider plus channel ID and normalize into
that deterministic order. Exact-channel services normally contain one entry;
aggregate dashboards may contain several.

Provider events may be partial. Twitch `stream.online` does not invent a title,
and Kick metadata updates do not invent online status. The owning state service
applies patches to its materialized value and obtains missing initial fields
through the provider API when necessary.

## Versioning

Family version 1 permits additive fields only beneath existing provider
extensions. Adding a canonical field, topic, enumeration value, or changing
null/omission semantics requires a reviewed contract revision. Provider
adapters must pass the executable contract before publishing.
