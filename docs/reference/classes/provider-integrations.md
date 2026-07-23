# Provider integration class catalog

Status: Evolving
Scope: `@carbonenginejs/tools-core` Kick and Twitch integration classes
Audience: Users, maintainers, and automated readers
Summary: Provides source-backed purpose descriptors for public provider adapters and their internal implementations.

<!-- class:CjsKickActivityService -->
## `CjsKickActivityService`

Declares the live Kick activity projection over shared webhook ingress.

- Source: `src/integrations/kick/CjsKickActivityService.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsKickStateService -->
## `CjsKickStateService`

Materializes snapshot-recoverable Kick state over shared webhook ingress.

- Source: `src/integrations/kick/CjsKickStateService.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsKickWebhookHandler -->
## `CjsKickWebhookHandler`

Authenticates and normalizes official Kick webhook deliveries.

- Source: `src/integrations/kick/CjsKickWebhookHandler.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:KickActivityService -->
## `KickActivityService`

Public live Kick activity service over shared webhook ingress.

- Export: `@carbonenginejs/tools-core/integrations/kick`
- Source: `src/integrations/kick/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:KickStateService -->
## `KickStateService`

Public snapshot-backed Kick stream state service.

- Export: `@carbonenginejs/tools-core/integrations/kick`
- Source: `src/integrations/kick/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:KickWebhookHandler -->
## `KickWebhookHandler`

Public official-signature Kick webhook normalizer.

- Export: `@carbonenginejs/tools-core/integrations/kick`
- Source: `src/integrations/kick/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeTwitchActivityNormalizer -->
## `CjsRealtimeTwitchActivityNormalizer`

Maps Twitch EventSub notifications into provider-neutral activity events.

- Source: `src/integrations/twitch/CjsRealtimeTwitchActivityNormalizer.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsRealtimeTwitchActivityService -->
## `CjsRealtimeTwitchActivityService`

Exposes Twitch EventSub activity through a live provider-neutral service.

- Source: `src/integrations/twitch/CjsRealtimeTwitchActivityService.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsRealtimeTwitchChatNormalizer -->
## `CjsRealtimeTwitchChatNormalizer`

Canonicalizes Twitch IRC and EventSub messages into the common chat family.

- Source: `src/integrations/twitch/CjsRealtimeTwitchChatNormalizer.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsRealtimeTwitchChatService -->
## `CjsRealtimeTwitchChatService`

Exposes a Twitch transport through the provider-neutral live chat family.

- Source: `src/integrations/twitch/CjsRealtimeTwitchChatService.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsRealtimeTwitchStateNormalizer -->
## `CjsRealtimeTwitchStateNormalizer`

Maps Twitch EventSub notifications into provider-neutral state patches.

- Source: `src/integrations/twitch/CjsRealtimeTwitchStateNormalizer.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsRealtimeTwitchStateService -->
## `CjsRealtimeTwitchStateService`

Exposes materialized Twitch stream state with snapshot recovery.

- Source: `src/integrations/twitch/CjsRealtimeTwitchStateService.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchActivitySource -->
## `CjsTwitchActivitySource`

Owns one Twitch activity provider and fans it into service projections.

- Source: `src/integrations/twitch/CjsTwitchActivitySource.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchChatSource -->
## `CjsTwitchChatSource`

Owns one Twitch transport and fans its live output into several chat services.

- Source: `src/integrations/twitch/CjsTwitchChatSource.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchEventSubActivityProvider -->
## `CjsTwitchEventSubActivityProvider`

Adds Twitch activity declarations and normalization to an EventSub source.

- Source: `src/integrations/twitch/CjsTwitchEventSubActivityProvider.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchEventSubChatProvider -->
## `CjsTwitchEventSubChatProvider`

Adds chat room and normalization policy to a static EventSub source.

- Source: `src/integrations/twitch/CjsTwitchEventSubChatProvider.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchEventSubSession -->
## `CjsTwitchEventSubSession`

Owns one family-neutral Twitch EventSub WebSocket session lifecycle.

- Source: `src/integrations/twitch/CjsTwitchEventSubSession.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchEventSubSource -->
## `CjsTwitchEventSubSource`

Composes static family declarations over one Twitch EventSub session.

- Source: `src/integrations/twitch/CjsTwitchEventSubSource.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchEventSubStateProvider -->
## `CjsTwitchEventSubStateProvider`

Adds Twitch stream-state declarations and Helix seeding to EventSub.

- Source: `src/integrations/twitch/CjsTwitchEventSubStateProvider.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchHelixClient -->
## `CjsTwitchHelixClient`

Applies shared Twitch OAuth identity, scope, and reactive refresh to Helix requests.

- Source: `src/integrations/twitch/CjsTwitchHelixClient.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchIrcChatProvider -->
## `CjsTwitchIrcChatProvider`

Adapts an injected tmi.js-compatible client into the Twitch chat source contract.

- Source: `src/integrations/twitch/CjsTwitchIrcChatProvider.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchOAuthTokenProvider -->
## `CjsTwitchOAuthTokenProvider`

Validates externally acquired Twitch user tokens and serializes optional refresh.

- Source: `src/integrations/twitch/CjsTwitchOAuthTokenProvider.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsTwitchStateSource -->
## `CjsTwitchStateSource`

Owns one Twitch state provider and materializes its shared channel state.

- Source: `src/integrations/twitch/CjsTwitchStateSource.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:TwitchActivityNormalizer -->
## `TwitchActivityNormalizer`

Public Twitch activity normalizer backed by the internal implementation.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS
<!-- class:TwitchActivityService -->
## `TwitchActivityService`

Public provider-neutral Twitch activity service.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchActivitySource -->
## `TwitchActivitySource`

Public shared Twitch activity source.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchChatNormalizer -->
## `TwitchChatNormalizer`

Public Twitch chat normalizer backed by the internal Carbon implementation.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchChatService -->
## `TwitchChatService`

Public Twitch chat service backed by the internal Carbon implementation.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchChatSource -->
## `TwitchChatSource`

Public shared Twitch chat source backed by the internal Carbon implementation.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchEventSubActivityProvider -->
## `TwitchEventSubActivityProvider`

Public Twitch EventSub activity provider.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchEventSubChatProvider -->
## `TwitchEventSubChatProvider`

Public Twitch EventSub chat provider backed by the internal implementation.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchEventSubSession -->
## `TwitchEventSubSession`

Public family-neutral Twitch EventSub session transport.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchEventSubSource -->
## `TwitchEventSubSource`

Public static family registry and shared Twitch EventSub source.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchEventSubStateProvider -->
## `TwitchEventSubStateProvider`

Public Twitch EventSub state provider with bounded Helix seeding.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchHelixClient -->
## `TwitchHelixClient`

Public Twitch Helix client backed by the internal Carbon implementation.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchIrcChatProvider -->
## `TwitchIrcChatProvider`

Public Twitch IRC chat provider backed by the internal implementation.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchOAuthTokenProvider -->
## `TwitchOAuthTokenProvider`

Public Twitch OAuth token provider backed by the internal implementation.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchStateNormalizer -->
## `TwitchStateNormalizer`

Public Twitch state normalizer backed by the internal implementation.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchStateService -->
## `TwitchStateService`

Public snapshot-backed Twitch stream state service.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchStateSource -->
## `TwitchStateSource`

Public shared materialized Twitch state source.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/index.js`
- Visibility: Public
- Kind: CarbonEngineJS
