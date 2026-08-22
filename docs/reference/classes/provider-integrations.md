# Provider integration class catalog

Status: Evolving
Scope: `@carbonenginejs/tools-core` Kick and Twitch integration classes
Audience: Users, maintainers, and automated readers
Summary: Provides source-backed purpose descriptors for every public provider integration class.

<!-- class:KickActivityService -->
## `KickActivityService`

Declares the live Kick activity projection over shared webhook ingress.

- Export: `@carbonenginejs/tools-core/integrations/kick`
- Source: `src/integrations/kick/KickActivityService.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:KickStateService -->
## `KickStateService`

Materializes snapshot-recoverable Kick state over shared webhook ingress.

- Export: `@carbonenginejs/tools-core/integrations/kick`
- Source: `src/integrations/kick/KickStateService.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:KickWebhookHandler -->
## `KickWebhookHandler`

Authenticates and normalizes official Kick webhook deliveries.

- Export: `@carbonenginejs/tools-core/integrations/kick`
- Source: `src/integrations/kick/KickWebhookHandler.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchActivityNormalizer -->
## `TwitchActivityNormalizer`

Maps Twitch EventSub notifications into provider-neutral activity events.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchActivityNormalizer.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchActivityService -->
## `TwitchActivityService`

Exposes Twitch EventSub activity through a live provider-neutral service.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchActivityService.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchChatNormalizer -->
## `TwitchChatNormalizer`

Canonicalizes Twitch IRC and EventSub messages into the common chat family.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchChatNormalizer.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchChatService -->
## `TwitchChatService`

Exposes a Twitch transport through the provider-neutral live chat family.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchChatService.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchStateNormalizer -->
## `TwitchStateNormalizer`

Maps Twitch EventSub notifications into provider-neutral state patches.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchStateNormalizer.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchStateService -->
## `TwitchStateService`

Exposes materialized Twitch stream state with snapshot recovery.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchStateService.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchActivitySource -->
## `TwitchActivitySource`

Owns one Twitch activity provider and fans it into service projections.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchActivitySource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchChatSource -->
## `TwitchChatSource`

Owns one Twitch transport and fans its live output into several chat services.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchChatSource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchEventSubActivityProvider -->
## `TwitchEventSubActivityProvider`

Adds Twitch activity declarations and normalization to an EventSub source.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchEventSubActivityProvider.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchEventSubChatProvider -->
## `TwitchEventSubChatProvider`

Adds chat room and normalization policy to a static EventSub source.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchEventSubChatProvider.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchEventSubSession -->
## `TwitchEventSubSession`

Owns one family-neutral Twitch EventSub WebSocket session lifecycle.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchEventSubSession.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchEventSubSource -->
## `TwitchEventSubSource`

Composes static family declarations over one Twitch EventSub session.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchEventSubSource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchEventSubStateProvider -->
## `TwitchEventSubStateProvider`

Adds Twitch stream-state declarations and Helix seeding to EventSub.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchEventSubStateProvider.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchHelixClient -->
## `TwitchHelixClient`

Applies shared Twitch OAuth identity, scope, and reactive refresh to Helix requests.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchHelixClient.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchIrcChatProvider -->
## `TwitchIrcChatProvider`

Adapts an injected tmi.js-compatible client into the Twitch chat source contract.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchIrcChatProvider.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchOAuthTokenProvider -->
## `TwitchOAuthTokenProvider`

Validates externally acquired Twitch user tokens and serializes optional refresh.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchOAuthTokenProvider.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchStateSource -->
## `TwitchStateSource`

Owns one Twitch state provider and materializes its shared channel state.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchStateSource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:TwitchChatAssetResolver -->
## `TwitchChatAssetResolver`

Resolves and caches Twitch channel profile images and preferred static or animated IRC emote URLs before chat publication.

- Export: `@carbonenginejs/tools-core/integrations/twitch`
- Source: `src/integrations/twitch/TwitchChatAssetResolver.js`
- Visibility: Public
- Kind: CarbonEngineJS
