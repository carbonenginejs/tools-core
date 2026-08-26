# Tools-core API reference

Status: Stable  
Scope: `@carbonenginejs/tools-core` package exports  
Audience: Node.js users and integrators  
Summary: Maps each public package subpath to its owned responsibility and principal exports.

## Public subpaths

| Subpath | Responsibility | Principal exports |
| --- | --- | --- |
| `.` | SDE/SOF composition facade | `CjsToolCore` |
| `./audio` | Audio-library preparation, optional individual BNK media, exact-build media reads, and optional neutral music catalogs | `CjsToolAudio`, `CjsToolAudioBuilder`, `CjsToolAudioMediaBuilder`, `CjsToolAudioRepository`, `CjsToolAudioSource`, `CjsToolMusicSource` |
| `./black` | Indexed Black-to-public-JSON reads | `CjsToolBlack` |
| `./cache` | Shared cache layout and access | `CjsToolCache` |
| `./character` | Schema-v10 character-library target policy, lossless decoded-definition retention, additive typed compilation, source-catalog gathering, effective version materialization, and prepared-document loading | `CjsToolCharacter`, `CjsToolCharacterBuilder`, `CjsToolCharacterCatalogGatherer`, `CjsToolCharacterDefinitionCompiler`, `CjsToolCharacterRepository` |
| `./dogma` | Published attribute evaluation and skill-profile application | `CjsToolDogma`, `CjsToolDogmaOperations`, `CjsToolDogmaProfile` |
| `./fitting` | EVE fitting parsing, serialization, and slot classification | `CjsToolFitting`, `CjsToolFittingCodec`, `CjsToolFittingFlags` |
| `./fsd` | Read-only structural inspection of modern FSD64/cFSD bytes | `CjsToolFsdInspectReader` |
| `./icons` | Exact-build SDE icon identifiers composed into loadable resource paths | `CjsToolIcons`, `NormalizeIconResourcePath` |
| `./identity` | Public ESI identity resolution and normalized identity graphs | `CjsToolPublicEsi`, `CjsToolPublicIdentity` |
| `./index` | Exact-build app/res indexes, overlays, and validated bytes | `CjsToolIndex`, `CjsToolIndexOverlayStore` |
| `./industry` | Blueprint, manufacturing-input, and reprocessing projections | `CjsToolIndustry` |
| `./integrations/kick` | Signed Kick webhook normalization | `KickWebhookHandler`, `KickActivityService`, `KickStateService` |
| `./integrations/twitch` | Twitch OAuth, Helix, IRC/EventSub, chat, activity, and state | Public `Twitch*` classes |
| `./library` | Canonical JSON and deterministic gzip artifacts | `CjsToolLibraryArtifact` |
| `./localisation` | Localized-name lookup and explicit gap handling | `CjsToolLocalisation`, `CjsToolLocalisationGuess` |
| `./map` | Region/constellation/system/celestial documents, composed names, stargate orientation, and derived per-system lighting | `CjsToolMap`, `BuildMapIndex`, `BlackbodyColor`, `StargateDirection` |
| `./market` | ESI order-book normalization and PLEX-rate projections | `CjsToolMarketEsi`, `CjsToolPlexRate` |
| `./prefetch` | Exact-build cache preparation from explicit resource profiles | `CjsToolPrefetch` |
| `./proxy` | Optional local query/resource HTTP adapter | `CjsToolHttpProxy` |
| `./realtime` | Protocol constants and validation | `CjsToolRealtimeProtocol`, `CjsToolRealtimeError` |
| `./realtime/chat` | Provider-neutral live-chat contract | `CjsToolRealtimeChatContract`, family/topic constants |
| `./realtime/livestream` | Provider-neutral livestream contracts | `CjsToolRealtimeLivestreamContract`, family/topic constants |
| `./realtime/resource-watch` | Snapshot-recoverable filesystem projection | `CjsToolRealtimeResourceWatchService` |
| `./realtime/server` | Service registry, authority, hub, HTTP router, and connections | `CjsToolRealtimeHub`, `CjsToolRealtimeSessionAuthority`, related classes |
| `./realtime/websocket` | Node WebSocket gateway and transport | `CjsToolRealtimeGatewayWebsocket`, `CjsToolRealtimeTransportWebsocket` |
| `./schema` | Carbon schema scanning, checking, and class emission | `CjsFormatCarbon` |
| `./service` | HTTP/realtime composition and standalone listener | `CjsToolServiceHost`, `CjsToolRealtimeServer` |
| `./sde` | Exact-build archive or profile-driven SDE preparation and queries | `CjsToolSde`, `CjsToolSdeBuild`, profile/archive/database/repository classes |
| `./shader` | Exact-build shader catalog and build orchestration | `CjsToolShaderTargetRegistry`, `CjsToolShaderBuilderWebgl`, `CjsToolShaderBuilderWebgpu` |
| `./skin` | SKIN and SKINR generated libraries | `CjsToolSkin`, `CjsToolSkinBuilder`, `CjsToolSkinrBuilder` |
| `./skills` | Skill requirements, closures, and mastery projections | `CjsToolSkills` |
| `./sof` | Exact-build SOF catalogs, class-default expansion, and self-contained SOF bundles | `CjsToolSofRepository`, `CjsToolSofCatalog`, `CjsToolSofBundle`, `ExpandSofDefaults`, `PrepareSofDefaults` |
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
