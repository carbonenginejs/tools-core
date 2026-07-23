# Chat and livestream source topology

Status: Evolving  
Scope: CarbonEngineJS realtime provider integrations  
Audience: Application architects and integration authors  
Summary: Models many providers, accounts, servers, and channels without coupling clients to physical connections.

## Identity hierarchy

Realtime identity is hierarchical rather than assuming one global chat:

```text
provider
  account or connection
    container
      channel or room
        logical service projection
          client subscriptions
```

The container level depends on the provider. Twitch and Kick commonly identify
a channel directly. Discord has an account connection, many servers, and many
channels within each server. Other providers may add organizations, projects,
threads, or broadcasts.

Canonical values retain enough identity to distinguish every source:

- provider;
- provider account or connection when relevant;
- container identity such as a Discord server;
- channel/room identity;
- message/event identity;
- actor identity;
- optional provider-specific details under `extensions.<provider>`.

## Physical sources and logical services

One physical provider source owns authentication, connection lifecycle,
upstream subscriptions, retry policy, and normalization. It may feed many
pre-registered logical services:

- an aggregate service carries events from many channels and retains their
  source identity;
- an exact-channel service emits only one channel or room;
- an activity service carries alerts such as subscriptions and follows;
- a state service materializes stream status and metadata.

This avoids one upstream connection per overlay, bot, character facade, or
browser subscriber. Clients receive grants only for the logical services they
need.

## Current implementations

Twitch IRC and EventSub normalize live chat into the same `chat` family.
EventSub can share one OAuth, Helix, and WebSocket foundation across chat,
livestream activity, and stream state. Kick currently enters through signed
webhooks and publishes livestream activity and state.

Discord and additional providers are architectural inputs, not implemented
integrations. A future adapter should map its server/channel hierarchy into the
same canonical identity model without flattening server identity into the
channel name.

## Delivery and recovery

Live chat and activity are future-only: reconnecting does not imply provider
history or replay. Materialized state is snapshot-recoverable. Stable
provider/message IDs suppress bounded current-run duplicates, while provider
extensions preserve evidence required for diagnosis.

Provider limits still apply to upstream rooms, subscriptions, sockets, and
requests. Scaling logical services does not remove those quotas; applications
add explicit provider sessions when one source reaches its upstream boundary.

## Related documentation

- [Host realtime services](../guides/realtime-service.md)
- [Realtime protocol v1](../protocols/realtime-v1.md)
- [Chat contract v1](../protocols/chat-v1.md)
- [Livestream contract v1](../protocols/livestream-v1.md)
- [Future realtime operations](../reference/realtime-operations.md)
