# Realtime chat contract v1

Status: Stable  
Scope: `@carbonenginejs/tools-core/realtime/chat`, family version 1  
Audience: Provider integration authors and realtime consumers  
Summary: Defines provider-neutral live-chat messages, hierarchical room identity, and provider-source status.

This contract defines the payloads published by a realtime service whose
family is `chat` and family version is `1`. Realtime protocol v1 carries these
values inside `event.payload.data`. `CjsRealtimeChatContract` is the executable
validator, and the adjacent JSON file contains public conformance fixtures.

## Topics and recovery

Version 1 defines two loss-tolerant topics:

- `chat.message.received`
- `chat.status.changed`

Both are future-only. A new or reconnecting subscription receives events
published after its subscription barrier. Provider history, reconnect replay,
or catch-up messages must not be presented as newly occurring live messages.

## Physical sources and logical services

A physical provider source owns one configured authenticated integration. It
may use several sockets, webhooks, or API sessions and may subscribe to many
rooms. A logical chat service is an authorized projection over one room,
several rooms, or several provider sources.

Clients subscribe to logical services. They do not connect directly to
provider transports, and one browser subscription does not create one upstream
provider connection.

## Room identity

Every message carries its complete provider-native conversation identity:

```js
{
    provider: "discord",
    integrationId: "discord-primary",
    space: {
        id: "server-one",
        kind: "server",
        login: null,
        displayName: "Example Server",
    },
    id: "thread-one",
    kind: "thread",
    parentRoomId: "channel-one",
    login: null,
    displayName: "Example Thread",
}
```

`integrationId` is an optional host-assigned, non-secret identifier for a
configured provider account or installation. It is not a provider token,
credential, or transient socket ID.

`space` is the optional parent workspace, server, guild, or community. Twitch
and Kick channels normally omit it. A thread is itself a room and identifies
its parent with `parentRoomId`. Common room kinds are `channel`, `thread`, and
`direct`; adapters may use another bounded kind when those meanings do not fit.

The stable room key is the provider, integration ID, space ID, and room ID
tuple. Display names and logins are labels, never identity.

## Message payload

`chat.message.received` contains:

```js
{
    id: "provider-message-id",
    text: "Hello",
    occurredAt: "2026-07-24T02:00:00.000Z",
    deliveryMode: "live",
    room: {},
    author: {
        id: "provider-user-id",
        login: "viewer",
        displayName: "Viewer",
        color: null,
        roles: [],
    },
    reply: null,
    fragments: [
        { type: "text", text: "Hello" },
    ],
    extensions: {
        twitch: {},
    },
}
```

Message IDs are stable only within their complete room identity. Deduplication
therefore combines the room key and message ID.

`reply`, when present, identifies the parent message and may include bounded
parent-author labels and text supplied by the provider. `fragments` preserve
ordered visible text plus normalized emote, mention, or contribution metadata.
Provider-only values stay under `extensions.<provider>`.

Credentials, raw provider payloads, authorization headers, webhook signatures,
and credential-bearing URLs are never extensions.

## Status payload

`chat.status.changed` reports the state of one configured provider integration
or, when `room` is present, one room beneath that integration:

```js
{
    state: "degraded",
    reasonCode: "provider_unavailable",
    retryable: true,
    occurredAt: "2026-07-24T02:02:00.000Z",
    source: {
        provider: "discord",
        integrationId: "discord-primary",
    },
    room: null,
    extensions: {
        discord: {},
    },
}
```

States are `ready`, `reconnecting`, and `degraded`. Aggregate services retain
the affected source identity so one failing provider does not imply that every
room is unavailable.

## Ordering and deduplication

Realtime sequence numbers define authoritative order only within one logical
service stream. No total order is implied across services or upstream
providers. A provider source suppresses bounded duplicate delivery by complete
room identity and stable message ID; version 1 does not claim exactly-once
delivery across a cold host restart.

## Mutating operations

Version 1 is receive-first. Posting, editing, deleting, reactions, and
moderation remain planned capability-scoped commands documented in
[Realtime operations](../reference/realtime-operations.md). Their payloads and
resulting canonical events become stable only after a real outbound provider
adapter proves them.

## Implementations

Twitch IRC and EventSub currently implement the message contract. The
hierarchical fixture proves the contract shape for a server and thread but
does not claim that a Discord adapter is implemented. Kick currently implements
livestream activity and state, not chat.

## Versioning

Readers ignore unknown object members, but adapters publish only fields
accepted by the executable contract. Changing delivery semantics, required
identity, topic meaning, or enumeration values requires a reviewed family
version. Provider extension fields may evolve additively.

## Provenance

Twitch, Kick, and Discord names and API terms identify interoperable
third-party surfaces. CarbonEngineJS is not affiliated with or endorsed by
those providers.
