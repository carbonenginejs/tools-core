# Tools-core API reference

Status: Stable  
Scope: `@carbonenginejs/tools-core` package exports  
Audience: Node.js users and integrators  
Summary: Maps each public package subpath to its owned responsibility and principal exports.

## Public subpaths

| Subpath | Responsibility | Principal exports |
| --- | --- | --- |
| `.` | SDE/SOF composition facade | `CjsToolCore` |
| `./audio` | Audio-library preparation and exact-build media reads | `CjsToolAudio`, `CjsToolAudioBuilder`, `CjsToolAudioRepository`, `CjsToolAudioSource` |
| `./black` | Indexed Black-to-public-JSON reads | `CjsToolBlack` |
| `./cache` | Shared cache layout and access | `CjsToolCache` |
| `./character` | Character library build, normalization, serialization, and queries | `CjsToolCharacter`, assembler/compiler/library/repository classes |
| `./index` | Exact-build app/res indexes, overlays, and validated bytes | `CjsToolIndex`, `CjsIndexOverlayStore` |
| `./integrations/kick` | Signed Kick webhook normalization | `KickWebhookHandler`, `KickActivityService`, `KickStateService` |
| `./integrations/twitch` | Twitch OAuth, Helix, IRC/EventSub, chat, activity, and state | Public `Twitch*` classes |
| `./library` | Canonical JSON and deterministic gzip artifacts | `CjsToolLibraryArtifact` |
| `./prefetch` | Exact-build cache preparation from explicit resource profiles | `CjsToolPrefetch` |
| `./proxy` | Optional local query/resource HTTP adapter | `CjsToolHttpProxy` |
| `./realtime` | Protocol constants and validation | `CjsRealtimeProtocol`, `CjsRealtimeError` |
| `./realtime/chat` | Provider-neutral live-chat contract | `CjsRealtimeChatContract`, family/topic constants |
| `./realtime/livestream` | Provider-neutral livestream contracts | `CjsRealtimeLivestreamContract`, family/topic constants |
| `./realtime/resource-watch` | Snapshot-recoverable filesystem projection | `CjsRealtimeResourceWatchService` |
| `./realtime/server` | Service registry, authority, hub, HTTP router, and connections | `CjsRealtimeHub`, `CjsRealtimeSessionAuthority`, related classes |
| `./realtime/websocket` | Node WebSocket gateway and transport | `CjsRealtimeWebSocketGateway`, `CjsRealtimeWebSocketTransport` |
| `./schema` | Carbon schema scanning, checking, and class emission | `CjsFormatCarbon` |
| `./service` | HTTP/realtime composition and standalone listener | `CjsToolServiceHost`, `CjsRealtimeServer` |
| `./sde` | Exact-build JSONL SDE preparation and queries | `CjsSde`, archive/database/repository classes |
| `./shader` | Exact-build shader catalog and build orchestration | `CjsShaderTargetRegistry`, `CjsToolWebglBuilder`, `CjsToolWebgpuBuilder` |
| `./skin` | SKIN and SKINR generated libraries | `CjsToolSkin`, `CjsToolSkinBuilder`, `CjsToolSkinrBuilder` |
| `./target` | Audited public target identities and capabilities | `CjsToolTargetRegistry` |
| `./webhook` | Bounded authenticated webhook ingress and projections | Router, ingress, projection, and stream service classes |
| `./weapon` | Weapon/ammunition/projectile library joins | `CjsToolWeapon`, `CjsToolWeaponBuilder` |
| `./utils` | Shared low-level normalization and validation helpers | Named utility exports |

## Import rules

Import the narrowest subpath that owns the required capability. Provider
integrations expose provider-led public class names; generic CarbonEngineJS
infrastructure retains the `Cjs*` prefix. All package source is modern ESM
except the retained Carbon Blue scanner entry point.

## Related documentation

- [Architecture](../architecture.md)
- [Class catalogs](classes/README.md)
- [Generated libraries](../guides/generated-libraries.md)
- [Exact-build cache prefetch](../guides/prefetch.md)
- [Local service](../guides/local-service.md)
- [Realtime service](../guides/realtime-service.md)
