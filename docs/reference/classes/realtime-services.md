# Realtime service class catalog

Status: Evolving
Scope: `@carbonenginejs/tools-core` realtime, service-hosting, and webhook classes
Audience: Users, maintainers, and automated readers
Summary: Provides source-backed purpose descriptors for realtime protocol, transport, hosting, and webhook classes.

<!-- class:CjsRealtimeChatContract -->
## `CjsRealtimeChatContract`

Validates provider-neutral live-chat message and source-status payloads.

- Export: `@carbonenginejs/tools-core/realtime/chat`
- Source: `src/realtime/chat/CjsRealtimeChatContract.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeError -->
## `CjsRealtimeError`

Stable protocol-facing error for realtime requests and transports.

- Export: `@carbonenginejs/tools-core/realtime`
- Source: `src/realtime/CjsRealtimeError.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeProtocol -->
## `CjsRealtimeProtocol`

Validation and normalization for the versioned realtime wire boundary.

- Export: `@carbonenginejs/tools-core/realtime`
- Source: `src/realtime/CjsRealtimeProtocol.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeSerialLane -->
## `CjsRealtimeSerialLane`

Minimal promise lane for deterministic per-service work ordering.

- Source: `src/realtime/internal/CjsRealtimeSerialLane.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsRealtimeServiceController -->
## `CjsRealtimeServiceController`

Owns lifecycle, publication order, cursors, and subscribers for one service.

- Source: `src/realtime/internal/CjsRealtimeServiceController.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsRealtimeLivestreamContract -->
## `CjsRealtimeLivestreamContract`

Validates provider-neutral livestream activity and state payloads.

- Export: `@carbonenginejs/tools-core/realtime/livestream`
- Source: `src/realtime/livestream/CjsRealtimeLivestreamContract.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeResourceWatchService -->
## `CjsRealtimeResourceWatchService`

Materialized logical-file service backed by an injected filesystem observer.

- Export: `@carbonenginejs/tools-core/realtime/resource-watch`
- Source: `src/realtime/resource-watch/CjsRealtimeResourceWatchService.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeConnection -->
## `CjsRealtimeConnection`

One authenticated, transport-neutral realtime protocol connection.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsRealtimeConnection.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeHttpRouter -->
## `CjsRealtimeHttpRouter`

Authenticated HTTP discovery, snapshots, and service-owned content.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsRealtimeHttpRouter.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeHub -->
## `CjsRealtimeHub`

Transport-neutral realtime service host and protocol coordinator.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsRealtimeHub.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeMemoryOperationStore -->
## `CjsRealtimeMemoryOperationStore`

Bounded in-memory single-flight and completed-operation deduplication.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsRealtimeMemoryOperationStore.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeServiceContext -->
## `CjsRealtimeServiceContext`

Bounded host capabilities supplied to one registered realtime service.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsRealtimeServiceContext.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeServiceRegistry -->
## `CjsRealtimeServiceRegistry`

Registers independently authored realtime services before host startup.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsRealtimeServiceRegistry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeSessionAuthority -->
## `CjsRealtimeSessionAuthority`

Authenticates injected capabilities and enforces their service scopes.

- Export: `@carbonenginejs/tools-core/realtime/server`
- Source: `src/realtime/server/CjsRealtimeSessionAuthority.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeWebSocketGateway -->
## `CjsRealtimeWebSocketGateway`

Secure ws transport adapter for the transport-neutral realtime hub.

- Export: `@carbonenginejs/tools-core/realtime/websocket`
- Source: `src/realtime/websocket/CjsRealtimeWebSocketGateway.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeWebSocketTransport -->
## `CjsRealtimeWebSocketTransport`

Adapts one ws socket to the transport-neutral connection contract.

- Export: `@carbonenginejs/tools-core/realtime/websocket`
- Source: `src/realtime/websocket/CjsRealtimeWebSocketTransport.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsRealtimeServer -->
## `CjsRealtimeServer`

Owns a composed realtime hub, HTTP listener, WebSocket gateway, and shutdown order.

- Export: `@carbonenginejs/tools-core/service`
- Source: `src/service/CjsRealtimeServer.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolServiceHost -->
## `CjsToolServiceHost`

Composes realtime routes and upgrades with an optional existing HTTP adapter.

- Export: `@carbonenginejs/tools-core/service`
- Source: `src/service/CjsToolServiceHost.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsWebhookError -->
## `CjsWebhookError`

Stable HTTP-facing failure raised by webhook endpoints and processors.

- Export: `@carbonenginejs/tools-core/webhook`
- Source: `src/webhook/CjsWebhookError.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsWebhookHttpRouter -->
## `CjsWebhookHttpRouter`

Bounded raw HTTP ingress for independently authenticated webhook endpoints.

- Export: `@carbonenginejs/tools-core/webhook`
- Source: `src/webhook/CjsWebhookHttpRouter.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsWebhookIngressSource -->
## `CjsWebhookIngressSource`

Authenticates one webhook endpoint and routes deliveries to family services.

- Export: `@carbonenginejs/tools-core/webhook`
- Source: `src/webhook/CjsWebhookIngressSource.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsWebhookProjectionService -->
## `CjsWebhookProjectionService`

Exposes one live service family projected from shared webhook ingress.

- Export: `@carbonenginejs/tools-core/webhook`
- Source: `src/webhook/CjsWebhookProjectionService.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsWebhookStreamService -->
## `CjsWebhookStreamService`

Adapts authenticated provider webhooks into one realtime service stream.

- Export: `@carbonenginejs/tools-core/webhook`
- Source: `src/webhook/CjsWebhookStreamService.js`
- Visibility: Public
- Kind: CarbonEngineJS
