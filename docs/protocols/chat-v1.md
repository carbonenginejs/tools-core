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

An IRC-backed service may advertise the `chat.room` subscription target.
Clients then select a room by provider, optional integration and space, and a
stable room ID or provider login. The server joins an upstream room for the
first downstream listener, fans that room out to every matching listener, and
parts it only after the final listener leaves or disconnects. The shared IRC
connection can remain active for other rooms.

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
        assets: {
            icon: {
                id: "server-one-icon",
                url: "https://cdn.example.test/server-one.png",
                contentType: "image/png",
                animated: false,
            },
        },
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
Rooms and spaces may carry URL-backed `assets.icon` and `assets.banner`
objects. A targeted subscription result returns the resolved hierarchy
metadata, so a Twitch or Kick channel profile image and a Discord guild icon
are available before the first message arrives.

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
Consumers render fragments rather than reducing a message to `text`.
Emotes may declare provider-reported `formats`, including `animated`, and an
`asset` containing the server-selected HTTPS URL, content type, and explicit
animation flag. A `media` fragment uses the same URL-backed media shape for
provider-hosted visual content. Consumers render these URLs directly; provider
catalog templates, CDN rules, theme choices, and image selection remain
server-owned.

Twitch IRC emote ranges are reconstructed as typed fragments. IRC supplies the
emote ID but not its available static or animated formats; those come from the
Twitch emote APIs and a bounded server cache. Unknown IRC emote IDs may be
probed once and cached so the preferred animated or static URL is still
selected before publication. EventSub fragments already carry the format
list. Twitch IRC-hosted GIF tags retain the complete provider URL without
rewriting it.

Credentials, raw provider payloads, authorization headers, webhook signatures,
and credential-bearing URLs are never extensions.

## Optional block policy

`CjsRealtimeChatBlockList` provides empty-by-default literal term and user
blocks for a logical chat projection. Terms are case-insensitive substrings and
may be global or scoped by provider, integration, space, and stable room ID or
login fallback. User selectors use a provider, an optional integration, and
either a stable user ID or a login fallback.

A stable room or user ID takes precedence when its selector also contains a
login, so a rename does not bypass the block and a reused login does not block
a different stable identity. Omitting the integration ID applies the selector
to all integrations for that provider.

Term and user blocks suppress matching messages. The library supplies no
built-in entries or persistence. Provider-managed blocked terms, AutoMod rules,
and user block lists remain separate privileged integration capabilities; this
local policy does not synchronize or claim semantic parity with them.

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
