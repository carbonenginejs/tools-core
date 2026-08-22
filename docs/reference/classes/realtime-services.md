# Realtime service class catalog

Status: Evolving
Scope: `@carbonenginejs/tools-core` realtime, service-hosting, and webhook classes
Audience: Users, maintainers, and automated readers
Summary: Provides source-backed purpose descriptors for realtime protocol, transport, hosting, and webhook classes.

<!-- class:CjsToolRealtimeChatBlockList -->
## `CjsToolRealtimeChatBlockList`

Applies immutable, empty-by-default term and user blocks to provider-neutral chat payloads.

- Export: `@carbonenginejs/tools-core/realtime/chat`
- Source: `src/realtime/chat/CjsToolRealtimeChatBlockList.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeChatContract -->
## `CjsToolRealtimeChatContract`

Validates provider-neutral live-chat message and source-status payloads.

- Export: `@carbonenginejs/tools-core/realtime/chat`
- Source: `src/realtime/chat/CjsToolRealtimeChatContract.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeError -->
## `CjsToolRealtimeError`

Stable protocol-facing error for realtime requests and transports.

- Export: `@carbonenginejs/tools-core/realtime`
- Source: `src/realtime/CjsToolRealtimeError.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsTwitchChatAssetResolver -->
## `CjsTwitchChatAssetResolver`

Resolves and caches Twitch channel profile images and preferred static or animated IRC emote URLs before chat publication.

- Source: `src/integrations/twitch/CjsTwitchChatAssetResolver.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsToolRealtimeProtocol -->
## `CjsToolRealtimeProtocol`

Validation and normalization for the versioned realtime wire boundary.

- Export: `@carbonenginejs/tools-core/realtime`
- Source: `src/realtime/CjsToolRealtimeProtocol.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeSerialLane -->
## `CjsToolRealtimeSerialLane`

Minimal promise lane for deterministic per-service work ordering.

- Source: `src/realtime/internal/CjsToolRealtimeSerialLane.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsToolRealtimeServiceController -->
## `CjsToolRealtimeServiceController`

Owns lifecycle, publication order, cursors, and subscribers for one service.

- Source: `src/realtime/internal/CjsToolRealtimeServiceController.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsToolRealtimeLivestreamContract -->
## `CjsToolRealtimeLivestreamContract`

Validates provider-neutral livestream activity and state payloads.

- Export: `@carbonenginejs/tools-core/realtime/livestream`
- Source: `src/realtime/livestream/CjsToolRealtimeLivestreamContract.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeResourceWatchService -->
## `CjsToolRealtimeResourceWatchService`

Materialized logical-file service backed by an injected filesystem observer.

- Export: `@carbonenginejs/tools-core/realtime/resource-watch`
- Source: `src/realtime/resource-watch/CjsToolRealtimeResourceWatchService.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeConnection -->
## `CjsToolRealtimeConnection`

One authenticated, transport-neutral realtime protocol connection.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsToolRealtimeConnection.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeHttpRouter -->
## `CjsToolRealtimeHttpRouter`

Authenticated HTTP discovery, snapshots, and service-owned content.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsToolRealtimeHttpRouter.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeHub -->
## `CjsToolRealtimeHub`

Transport-neutral realtime service host and protocol coordinator.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsToolRealtimeHub.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeOperationStoreMemory -->
## `CjsToolRealtimeOperationStoreMemory`

Bounded in-memory single-flight and completed-operation deduplication.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsToolRealtimeOperationStoreMemory.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeServiceContext -->
## `CjsToolRealtimeServiceContext`

Bounded host capabilities supplied to one registered realtime service.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsToolRealtimeServiceContext.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeServiceRegistry -->
## `CjsToolRealtimeServiceRegistry`

Registers independently authored realtime services before host startup.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsToolRealtimeServiceRegistry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeSessionAuthority -->
## `CjsToolRealtimeSessionAuthority`

Authenticates injected capabilities and enforces their service scopes.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsToolRealtimeSessionAuthority.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeGatewayWebsocket -->
## `CjsToolRealtimeGatewayWebsocket`

Secure ws transport adapter for the transport-neutral realtime hub.

- Export: `@carbonenginejs/tools-core/realtime/websocket`
- Source: `src/realtime/websocket/CjsToolRealtimeGatewayWebsocket.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeTransportWebsocket -->
## `CjsToolRealtimeTransportWebsocket`

Adapts one ws socket to the transport-neutral connection contract.

- Export: `@carbonenginejs/tools-core/realtime/websocket`
- Source: `src/realtime/websocket/CjsToolRealtimeTransportWebsocket.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolRealtimeServer -->
## `CjsToolRealtimeServer`

Owns a composed realtime hub, HTTP listener, WebSocket gateway, and shutdown order.

- Export: `@carbonenginejs/tools-core/service`
- Source: `src/service/CjsToolRealtimeServer.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolServiceHost -->
## `CjsToolServiceHost`

Composes realtime routes and upgrades with an optional existing HTTP adapter.

- Export: `@carbonenginejs/tools-core/service`
- Source: `src/service/CjsToolServiceHost.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolWebhookError -->
## `CjsToolWebhookError`

Stable HTTP-facing failure raised by webhook endpoints and processors.

- Export: `@carbonenginejs/tools-core/webhook`
- Source: `src/webhook/CjsToolWebhookError.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolWebhookHttpRouter -->
## `CjsToolWebhookHttpRouter`

Bounded raw HTTP ingress for independently authenticated webhook endpoints.

- Export: `@carbonenginejs/tools-core/webhook`
- Source: `src/webhook/CjsToolWebhookHttpRouter.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolWebhookIngressSource -->
## `CjsToolWebhookIngressSource`

Authenticates one webhook endpoint and routes deliveries to family services.

- Export: `@carbonenginejs/tools-core/webhook`
- Source: `src/webhook/CjsToolWebhookIngressSource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolWebhookProjectionService -->
## `CjsToolWebhookProjectionService`

Exposes one live service family projected from shared webhook ingress.

- Export: `@carbonenginejs/tools-core/webhook`
- Source: `src/webhook/CjsToolWebhookProjectionService.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolWebhookStreamService -->
## `CjsToolWebhookStreamService`

Adapts authenticated provider webhooks into one realtime service stream.

- Export: `@carbonenginejs/tools-core/webhook`
- Source: `src/webhook/CjsToolWebhookStreamService.js`
- Visibility: Public
- Kind: CarbonEngineJS
