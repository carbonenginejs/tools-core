# Configure livestream provider integrations

Status: Stable  
Scope: `@carbonenginejs/tools-core/integrations/twitch` and `./integrations/kick`  
Audience: Node.js integration authors  
Summary: Configures Twitch EventSub/IRC and Kick webhook sources over the provider-neutral realtime families.

## Twitch EventSub

The embedding application owns OAuth acquisition, refresh, and storage.
Tools-core validates the externally acquired identity and scopes, then shares
one EventSub source across chat, activity, and state providers.

```js
import {
    TwitchChatService,
    TwitchChatSource,
    TwitchEventSubChatProvider,
    TwitchEventSubSource,
    TwitchHelixClient,
    TwitchOAuthTokenProvider,
} from "@carbonenginejs/tools-core/integrations/twitch";

const oauth = new TwitchOAuthTokenProvider({
    clientId,
    getAccessToken: () => tokenStore.ReadAccessToken(),
    refreshAccessToken: () => tokenStore.RefreshAccessToken(),
});
const helix = new TwitchHelixClient({ oauth });
const eventSub = new TwitchEventSubSource({ oauth, helix });
const chatProvider = new TwitchEventSubChatProvider({
    source: eventSub,
    registrationId: "chat",
    rooms: [ { id: "123456", login: "example_channel" } ],
});
const chatSource = new TwitchChatSource({ provider: chatProvider });

hub.Register(new TwitchChatService({
    id: "all-chat",
    source: chatSource,
}));
hub.Register(new TwitchChatService({
    id: "example-channel-chat",
    source: chatSource,
    room: { id: "123456", login: "example_channel" },
}));
```

An aggregate service retains room identity for every event. An exact-room
service is suitable for a narrow overlay or character facade. Both share the
same upstream connection.

EventSub chat requires `user:read:chat`. The receive-only injected
tmi.js-compatible IRC adapter requires `chat:read`. Do not add write scopes
until an explicit sending integration exists. Do not run IRC and EventSub as
parallel active sources for the same room during cutover because their message
IDs are not guaranteed to match.

Activity providers may select subscription, follow, raid, cheer, reward, and
gift topics. State providers seed bounded Helix state before materializing
online, offline, and channel-metadata changes. Providers register with the
shared EventSub source before its first attachment.

## Kick webhooks

```js
import {
    KickActivityService,
    KickStateService,
    KickWebhookHandler,
} from "@carbonenginejs/tools-core/integrations/kick";
import {
    CjsWebhookHttpRouter,
    CjsWebhookIngressSource,
} from "@carbonenginejs/tools-core/webhook";

const ingress = new CjsWebhookIngressSource({
    id: "kick-main",
    handler: new KickWebhookHandler(),
});

hub.Register(new KickActivityService({
    id: "kick-activity",
    source: ingress,
}));
hub.Register(new KickStateService({
    id: "kick-state",
    source: ingress,
    readSnapshot: ({ signal }) => kickApi.ReadLivestreamSnapshot({ signal }),
}));

const webhookRouter = new CjsWebhookHttpRouter({
    endpoints: [ ingress ],
});
```

The handler verifies the official RSA-SHA256 signature over the exact message
ID, timestamp, and raw body. Applications may inject a refreshed trusted public
key. Subscription creation and initial API state remain embedding OAuth duties.

Keep development endpoints loopback-only behind a trusted relay. Public
deployment requires HTTPS, bounded request deadlines and admission, source rate
limits, and durable replay protection.

## Canonical output

Twitch and Kick integrations publish the same provider-neutral livestream
activity and state families. Provider evidence remains under
`extensions.twitch` or `extensions.kick`.

- [Livestream contract v1](../protocols/livestream-v1.md)
- [Chat and livestream source topology](../concepts/chat-and-livestream-sources.md)
- [Future realtime operations](../reference/realtime-operations.md)
