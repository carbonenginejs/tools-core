# @carbonenginejs/tools-core

`@carbonenginejs/tools-core` is the consolidated Node.js toolchain for
CarbonEngineJS. It provides independently importable modules for remote index
acquisition, one shared cache, prepared SDE identity joins, character-library
generation, SOF JSON graph construction, and optional local HTTP access.

This is tooling, not a browser runtime. Runtime packages never import it.

## Modules

```js
import { CjsToolCore } from "@carbonenginejs/tools-core";
import {
  CjsToolAudio,
  CjsToolAudioBuilder,
} from "@carbonenginejs/tools-core/audio";
import { CjsToolBlack } from "@carbonenginejs/tools-core/black";
import { CjsToolCache } from "@carbonenginejs/tools-core/cache";
import {
  CjsToolCharacter,
  CjsToolCharacterAssembler,
  CjsToolCharacterCompiler,
  CjsToolCharacterLibrary,
  CjsToolCharacterNormalizer,
  CjsToolCharacterRepository,
  CjsToolCharacterSerializer,
} from "@carbonenginejs/tools-core/character";
import {
  CjsIndexOverlayStore,
  CjsToolIndex,
} from "@carbonenginejs/tools-core/index";
import { CjsToolLibraryArtifact } from "@carbonenginejs/tools-core/library";
import {
  CjsSde,
  CjsSdeArchive,
  CjsSdeDatabase,
  CjsSdeRepository,
} from "@carbonenginejs/tools-core/sde";
import { CjsToolTargetRegistry } from "@carbonenginejs/tools-core/target";
import {
  CjsShaderTargetRegistry,
  CjsToolWebglBuilder,
  CjsToolWebgpuBuilder,
} from "@carbonenginejs/tools-core/shader";
import {
  CjsToolSkin,
  CjsToolSkinBuilder,
  CjsToolSkinrBuilder,
} from "@carbonenginejs/tools-core/skin";
import {
  CjsToolWeapon,
  CjsToolWeaponBuilder,
} from "@carbonenginejs/tools-core/weapon";
import { CjsToolHttpProxy } from "@carbonenginejs/tools-core/proxy";
import { normalizeExactBuild } from "@carbonenginejs/tools-core/utils";
```

- `index` reads CCP-compatible app/res indexes for the `Eve` and `Frontier`
  game classifications, composes target-specific resource overlays, and
  retrieves validated bytes. Remote metadata, index, and payload requests have
  configurable hard deadlines. Fetch response bodies are streamed through
  content-length preflight and byte ceilings before checksum/cache handling;
  `CjsToolIndex` defaults to 30 seconds, 64 KiB of metadata, 64 MiB per index,
  and 256 MiB per payload.
- `cache` owns the shared index, payload, and generated-output layout.
- `library` writes one canonical JSON byte sequence and a deterministic
  `.json.gz` distribution sibling. Cache-backed builders use
  `CjsToolCache.WriteCustomLibrary(...)`; arbitrary output paths use
  `CjsToolLibraryArtifact.write(...)`.
- `utils` owns shared low-level build, object, URL, response, byte-validation,
  freezing, and buffer operations used across the tool modules.
- `sde` acquires exact-build official JSONL archives and stores every table in
  one generic SQLite database. Minimal wrappers provide catalog, count, ID,
  pagination, and search access without requiring one class per table. The
  existing in-memory identity view still joins type, graphic, skin, and
  material-set records into SOF DNA.
- `black` reads `.black` resources (fetched through an `index` source) into
  public payload JSON via `@carbonenginejs/runtime-resource`'s `CjsBlackFormat`.
  It reads against **one checked-in schema snapshot**
  (`runtime-resource/src/formats/black/core/black-schema-v1-*.json`, generated
  from a `scripts/carbon-blue/convert.cjs --emit-schema` scan of a Carbon
  source tree) — there is no per-EVE-build schema selection. Requests against
  resources from a materially older or newer client build than the snapshot's
  source tree can fail to parse or silently misread fields if the binary
  layout drifted. Carbon-authored per-build schema versioning is possible
  (the scanner already emits build-scoped output) but intentionally not built;
  keep the snapshot reasonably current by re-running the scan instead.
- `audio` builds deterministic audio-library values from SoundbanksInfo,
  resfileindex records, and an optional plain-JSON metadata overlay.
  `new CjsToolAudio().Build()` (or static `CjsToolAudio.build()`) is the
  target-aware JavaScript API and returns the canonical
  `carbonenginejs.audioLibrary` plain object;
  `CjsToolAudioBuilder` exposes its stateless build, index parsing, and
  event-media table operations. Use `CjsToolAudio` for distributable builds:
  the low-level builder deliberately permits unscoped test/intermediate values,
  while the front door requires an exact supported target/build.
  `CjsToolLibraryArtifact` serializes that same value as JSON and deterministic
  gzip; these are transports for one schema, not separate API/file formats.

  The base schema-v1 result always contains `metadata`, loose-WEM `media`, and
  basename-keyed `banks`. `eventMedia` and `embeddedMedia` are optional and are
  produced by the CLI only with `--event-media`; without them, the document is
  a metadata/source catalog rather than a complete event-to-playable-media
  index. Runtime-audio may normalize the tables into an audio-file-index view;
  no second generated document is required.

  Current audio follow-up is intentionally localized: retain bank ID/language
  identity, represent prepared delivery variants, classify embedded WEM/MIDI/
  plugin entries, fold music and GameParameter descriptors into the tools-core
  build before artifact writing, and move the evolved contract to an explicit
  schema version. The current runtime-audio music post-step mutates JSON after
  the gzip sibling was written and must not remain the final pipeline. The
  CLI's default wall-clock `generatedAt` also makes otherwise identical
  invocations byte-different; reproducible builds must supply a fixed value,
  omit it from canonical bytes, or move build time to external provenance.
- `character` builds deterministic character-library JSON from prepared source
  files. `CjsToolCharacter` is its target-aware front door; the assembler,
  compiler, normalizer, and serializer expose focused stateless operations as
  static methods. `CjsToolCharacterCompiler.createLodBundles(...)` emits the
  same atomic configuration/geometry record shape hydrated by
  `CjsCharacterLodBundle` in `runtime-character`. `CjsToolCharacterLibrary`
  mirrors the runtime part, type-identity, name-candidate, category, and LOD
  query methods. `CjsToolCharacterRepository` opens exact prepared libraries
  from the shared cache for the optional HTTP service. Compact libraries also
  carry `recipeLinks`, one entry-index-aligned table per preset. Each row is
  explicitly resolved, ambiguous, or unresolved and may target a selectable
  `partID`, morph name, metadata rule node, or material. The compiler never
  picks one candidate from an ambiguous authored selection.

Optional identity enrichment uses a source-neutral prepared document. A local
composition adapter may join approved research records to the official type
identity view, then pass only this public shape to the compiler or
`--identities <file>` character-builder option:

```js
const enriched = CjsToolCharacterCompiler.applyPartIdentities(expanded, {
  schema: "carbonenginejs.characterPartIdentities",
  schemaVersion: 1,
  sourceTarget: "eve",
  sourceBuild: "3435006",
  parts: {
    "female/hair/hair_long_01/types/hair_long_01": {
      typeID: "9001",
      name: "Long Hair",
    },
  },
});
```

The keys remain CarbonEngineJS-owned part IDs. `typeID` is preserved as an
exact positive string and is never synthesized; a missing external identity
stays `null`. The prepared document is build-checked and does not expose the
shape or provenance of any optional local reader.
- `shader` catalogs exact provider/build-scoped source and compiled profile
  paths and provides independent WebGL/WebGPU Node builders. The format
  packages remain responsible for browser-safe whole-effect conversion.
- `skin` builds separate exact-source JSON libraries for developer-authored
  SKINs and player-authored SKINR catalogs. Their ID-addressable sections are
  also the HTTP response bodies, so offline and service-backed consumers use
  the same records without a translation layer.
- `weapon` builds the exact SDE joins needed by renderers: weapon TypeID to
  `graphicID`/authored `.red`/runtime `.black`, dogma charge groups and sizes
  to compatible ammunition TypeIDs, and the official launcher projectile
  graphic catalog. It does not infer an ammunition-to-projectile TypeID join
  from filenames because CCP does not publish that relationship explicitly.
- `proxy` is a small optional Node HTTP adapter over the core API.
- the root facade composes SDE identity resolution with `runtime-sof`'s
  device-free graph output. Plain model values (`BuildSofValues`) are the
  recommended boundary; the `carbon.document` node table remains available as
  an explicit compatibility/diagnostic format (`BuildSofDocument`).

## Target-specific library builders

Library builders are target-specific. A compatible app/res index format does
not mean that EVE, Frontier, and NetEase library inputs or outputs are
interchangeable. Every build must identify its target, provider, and exact
source build, and every input supplied to that build must come from the same
target/build. A builder must explicitly add support for a target before its
output is advertised for that target.

Shader builders must additionally declare their output profile. Profile
directories keep compiled effects disjoint: the current legacy runtime rewrites
`effect/**/*.fx` to `effect.gles2/**/*.sm_<quality>`. The shader builders use
the descriptive `effect.webgl2` and `effect.webgpu` profile names. CEWG and
CEWGPU are package formats, not public resource profiles. tools-core catalogs
the exact paths a builder emits and delegates conversion to the corresponding
format package.

At present, the audio builder is enabled for `eve` and `frontier`; character,
SKIN, SKINR, and weapons are enabled only for `eve`. This target support does
not imply that every library has an HTTP repository/route. `netease` library
builders and corresponding Frontier builds remain disabled until each input
contract has been audited.

The official downloadable SDE topic is enabled only for `eve`. Frontier has
client static-data resources and separate public data interfaces, but it is not
advertised as an EVE-style SDE target.

Current target identities are:

```text
eve       -> game Eve, provider ccp
frontier  -> game Frontier, provider ccp
netease   -> game Eve, provider netease
```

The audited Frontier WebGL2 shader target is `frontier-webgl2`. It maps exact
build `.sm_hi` resources from `res:/graphics/effect.dx11/...` to CEWG packages
at `res:/graphics/effect.webgl2/...`, preserving the managed path and quality
suffix. Its exact Frontier build catalog is separate from EVE's build-specific
WebGL2 catalog and does not alter EVE shader resolution.

```js
const shaderTarget = new CjsShaderTargetRegistry().Get("frontier-webgl2");
const catalog = shaderTarget.CreateCatalog([
  "res:/graphics/effect.dx11/managed/space/characters/standardpbr.sm_hi",
], { build: 3438337 });
```

`CreateCatalog` plans explicitly asserted source paths. Builders consuming an
opened resource index should use `CreateCatalogFromResolutions` instead; it
rejects mixed targets, games, providers, and builds before any output is
cataloged.

EVE additionally exposes `eve-webgl2` for `.sm_hi` and `.sm_depth` DX11
sources, and the incremental `eve-webgpu` target for qualified `.sm_hi` DX11
SM5.0 sources. WebGPU does not automatically substitute DX12 SM5.1 input. The
EVE WebGPU target records native comparison as pending audit. No Frontier
WebGPU target is registered yet; when its corpus is audited, its target policy
must require `native-hlslcc` qualification.

An offline resfileindex can be turned into the same deterministic source
inventory without fetching or converting payloads:

```powershell
npm run catalog:shader -- --index <resfileindex.txt> --shader-target frontier-webgl2 --build <exact-build> --out <catalog.json>
```

### Shader builds

The WebGL and WebGPU builders resolve `latest` once to an exact build, verify
the indexed size and MD5 of every `.sm_*` source, call the latest installed
format package's `buildEffect`/`inspect` APIs, stage an immutable report, and
optionally install a persistent resource overlay.

```powershell
npm run build:shader:webgl -- --shader-target eve-webgl2 --build latest --out <output>
npm run build:shader:webgpu -- --shader-target eve-webgpu --build latest --out <output>
```

Both commands accept repeated `--source` and `--quality` selections, a JSON
`--source-manifest` or `--conversion-policy`, bounded `--concurrency`,
`--qualification package|structural|native-hlslcc`,
`--dry-run`/`--catalog-only`, and `--diagnostic`. A command may strengthen but
not weaken its target's minimum qualification policy. For native qualification,
tools-core coordinates a format-owned qualifier and requires explicit HLSLcc
comparison evidence in the report; executable discovery and comparison logic
remain outside tools-core.

Outputs and overlays are immutable by default. An identical report is reused
safely. Agents may pass `--overwrite` or `--force` to transactionally replace
an unrelated output directory, `--replace-overlay` to transactionally replace
an existing named overlay, and `--no-reuse` to reject even an identical prior
output. These flags never authorize replacement of source `.sm_*` files.

Each shader CLI writes a complete JSONL event stream under `<out>/logs` by
default and prints lifecycle events plus periodic progress to stderr. Use
`--log <file>` to select the durable log, `--log-interval <count>` to control
console progress, and `--error-report <file>` to select the structured failure
report. Per-source failures include the logical paths, status, duration, and
normalized error; a failed run retains its deterministic build report inside
the error report even though staging is rolled back.

## Cache layout

Exact-build indexes include game and provider identity:

```text
<cache>/games/<game>/providers/<provider>/builds/<build>/indexes/<file-name>
```

Indexed payloads use the game-compatible content-addressed layout:

```text
<cache>/ResFiles/8f/8f44ee1a9a017bf2_<md5>
```

CCP and NetEase payloads can coexist because the storage name includes the
lowercase resource-path FNV-1 hash and content MD5. Game/provider/build
identity remains in cached index metadata. Generated outputs and databases use:

```text
<cache>/custom/games/<game>/providers/<provider>/builds/<build>/{name}_{version}.{extension}
```

For example:
`custom/games/eve/providers/ccp/builds/3435006/character_v1.json`.
The skin catalogs are `skin_v1.json` and `skinr_v1.json`, and the weapon
catalog is `weapons_v1.json`, in the same exact-build directory.
The corresponding canonical audio cache name is `audio_v1.json`, but the
current audio CLI requires an explicit `--out` path and does not install that
cache entry automatically. Programmatic callers can use
`CjsToolCache.WriteCustomLibrary(...)` when they want the canonical cache
location.
The full EVE database is
`custom/games/eve/providers/ccp/builds/3435006/sde_v1.sqlite`.

Existing installations may still use a cache root directory named
`tool-core`. That directory name is retained as the v1 on-disk compatibility
location; it is independent of the `tools-core` package identity.

## Persistent resource overlays

Target-specific resource overlays use resfileindex-compatible records without
changing ccpwgl resource paths. They live under a separate persistent root:

```text
<data>/games/<target>/overlays/<name>/overlay.json
<data>/games/<target>/overlays/<name>/resfileindex.txt
<data>/games/<target>/overlays/<name>/res/<logical-path>
```

This directory is not the shared cache and must not be removed by cache
cleanups. It is also ignored by Git because preserved game payloads and local
manifests are not package source. The resolver uses the small part of the old
resource artifact model needed here:

- `local-exact` artifacts mirror their public `res:/` logical paths under
  `<data>` and read checksum-validated payloads directly from that dedicated
  location. Their identity is the controlled target/overlay/path, not a hash;
- `hash-safe` official and remote artifacts retain indexed checksums and may
  download validated payloads through the disposable shared cache.

Shader conversion remains an explicit CLI/library operation. tools-core does
not expose request-triggered conversion queues or derived-artifact state in the
HTTP service.

Resolution checks generated/override overlays first, then the official index,
then fallback overlays. An explicit `indexName` still selects one official or
overlay index. The local EVE store currently preserves the legacy GLES2 shader
set as additive `local-exact` files. ccpwgl rewrites authored
`res:/graphics/effect/**/*.fx` paths to the selected profile and quality, such
as `res:/graphics/effect.gles2/**/*.sm_hi`; those rewritten paths are the ones
inserted into the resource view. Requests use ordinary paths such as
`/eve/latest/res/graphics/effect.gles2/...`; callers never see the overlay name
or a content-addressed hash. The store also registers
Incarna/walking-in-stations assets as a remote fallback. Future compiled shader
outputs should use their builder-selected profile paths, preferably
`res:/graphics/effect.webgl2/...` or `res:/graphics/effect.webgpu/...`, rather
than a shared `res:/synthetic` namespace.

The local EVE store also contains the existing 62-package CEWG v1 corpus under
the public `effect.webgl2` profile: 34 `.sm_hi` and 28 `.sm_depth` resources,
available only for DX11 source build 3430261. Each package's embedded source
path supplied its managed subdirectory and quality suffix; only the profile
segment changed from `effect.dx11` to `effect.webgl2`. CEWG remains the package
format and never appears as the public resource profile.

## Local service

`cjs-tools-service` starts a loopback-only HTTP service for local clients such
as ccpwgl and Blender. It selects an available port by default and writes one
JSON bootstrap record to stdout containing the port, protocol version, cache
directory, persistent data directory, and enabled capabilities.

Browser clients receive CORS headers on JSON and resource-byte responses. The
service answers `OPTIONS` preflight requests, including private-network access.
The current query/resource APIs do not require authentication; a future
write-capable service must define its own authentication boundary before it
accepts or persists caller data.

The service exposes versioned health, exact resource resolution, validated
resource fetch-to-cache endpoints, and generic EVE SDE reads. SOF composition
is available through `CjsToolHttpProxy` when the caller injects a fully
prepared core facade: `/v1/sof/values` (capability `sofValues`, recommended)
returns plain model values, and `/v1/sof/document` (capability `sofDocument`,
compatibility/diagnostic) returns the explicit `carbon.document`. The
standalone launcher does not claim SOF capabilities until that exact-build
runtime bootstrap is configured.

The JavaScript audio build API exists, but the checked-in service does not yet
configure an audio repository, advertise an `audio` capability, or implement
`GET /{target}/{build}/audio`. Generic `res`/`resources` routes can serve a
known indexed `res:/audio/...` file; they do not serve the generated audio
library or expose embedded bank members by media ID. A future audio route must
return the same canonical records as the JavaScript API and JSON/gzip
artifact, not an independently shaped HTTP library.

### Realtime service host

The independently importable realtime library provides a general authenticated
service host. It is not enabled by the standalone launcher yet and does not
change the existing unauthenticated query/resource routes.

The normative v1 messages, authentication boundary, ordering rules, and close
outcomes are in
[`docs/realtime-protocol-v1.md`](docs/realtime-protocol-v1.md); its adjacent
JSON transcript is replayed by package tests through the real hub and gateway.

```js
import {
    CjsRealtimeProtocol,
    REALTIME_SUBPROTOCOL,
} from "@carbonenginejs/tools-core/realtime";
import {
    CjsRealtimeHttpRouter,
    CjsRealtimeHub,
    CjsRealtimeSessionAuthority,
} from "@carbonenginejs/tools-core/realtime/server";
import {
    CjsRealtimeWebSocketGateway,
} from "@carbonenginejs/tools-core/realtime/websocket";
import { CjsToolServiceHost } from "@carbonenginejs/tools-core/service";
```

Registered services provide `Describe()`, idempotent `Start(context)` and
`Stop()`, plus optional `GetSnapshot(request)`, `OpenResource(path, request)`,
and `HandleCommand(command, context)`. The hub owns service stream IDs, global
and per-topic sequences, subscriptions, snapshot cursors, actor attribution,
and operation deduplication. A service owns only its family semantics and never
receives raw sockets.

The transport uses `carbon.tools.realtime.v1` and shares one route between HTTP
and WebSocket upgrades:

```text
GET     /v1/realtime
UPGRADE /v1/realtime
GET     /v1/realtime/services/<service-id>/snapshot
GET     /v1/realtime/services/<service-id>/content/<path>?revision=<revision>
HEAD    /v1/realtime/services/<service-id>/content/<path>?revision=<revision>
```

The trusted launcher or embedding application injects random capability grants
into `CjsRealtimeSessionAuthority`. Each grant maps to a server-owned actor,
exact origins, expiry, and explicit service/topic/action scopes. HTTP uses a
Bearer capability; WebSocket clients present the same capability in their first
`hello` text message. Capabilities never belong in URLs, discovery values,
logs, preferences, or the standalone stdout bootstrap record.

```js
const capability = CjsRealtimeSessionAuthority.createCapability();
const authority = new CjsRealtimeSessionAuthority({
    grants: [ {
        capability,
        actor: { id: "local-client", kind: "application" },
        allowedOrigins: [ "http://127.0.0.1:8080" ],
        scopes: {
            discover: true,
            services: {
                "example-service": {
                    topics: [ "example.changed" ],
                    commands: [ "update" ],
                    snapshots: true,
                    content: false,
                },
            },
        },
    } ],
});
const hub = new CjsRealtimeHub({ authority });

hub.Register(exampleService);
const realtimeRouter = new CjsRealtimeHttpRouter({
    hub,
    allowedOrigins: [ "http://127.0.0.1:8080" ],
});
const realtimeGateway = new CjsRealtimeWebSocketGateway({
    hub,
    allowedOrigins: [ "http://127.0.0.1:8080" ],
});
const host = new CjsToolServiceHost({
    hub,
    realtimeRouter,
    realtimeGateway,
    fallback: existingHttpProxy,
});

await host.Start();
const server = host.CreateServer();
server.listen(8080, "127.0.0.1");
```

`CreateServer()` deliberately does not listen. The embedding application owns
the listener and must stop admitting HTTP work before it calls `host.Stop()`;
the lower-level host remains suitable for composition with an existing server.
For a separate realtime listener, `CjsRealtimeServer` owns that lifecycle and
leaves the legacy `cjs-tools-service` launcher unchanged:

```js
import { CjsRealtimeServer } from "@carbonenginejs/tools-core/service";

const realtime = new CjsRealtimeServer({
    services: [ aggregateChat, exampleChannel ],
    grants,
    allowedOrigins: [ "http://127.0.0.1:8080" ],
});
const address = await realtime.Listen({ host: "127.0.0.1", port: 0 });

// address contains only host/port/family; capability grants are never returned.
await realtime.Stop();
```

`Listen()` starts every registered service before accepting traffic. `Stop()`
first closes HTTP admission, then drains WebSockets and services, then waits for
the listener to close. The default network policy accepts only explicit
loopback addresses. This class does not acquire Twitch credentials or generate
client capabilities; the trusted embedding application supplies both.

Capability expiry, replacement, or revocation invalidates established sessions.
Requests and event delivery revalidate immediately, while the WebSocket
heartbeat removes an otherwise idle invalid session. Only public `id` and
`kind` actor fields are retained and exposed.

Subscriptions are future-only. Stateful clients subscribe first, fetch the
cursor-stamped HTTP snapshot, buffer newer events, then apply only matching
`streamId` events above the snapshot cursor. The server never silently drops an
authoritative event: a slow consumer is closed with `resync_required` and must
reconnect and repeat snapshot reconciliation. Family-specific execution rules,
such as one or many character facades, remain registered-service policy rather
than WebSocket hub behavior.

Stateful external sources must mutate their materialized state and publish its
event inside `context.Commit(callback)`. Snapshot capture runs on the same
per-service lane. A command may call `context.Publish()` directly only while
its handler is active; accepted asynchronous work retains `context.Commit()`
for later canonical updates. Contexts are bound to one service stream and are
rejected after stop/restart rather than publishing into a new generation.

Mutating command operations are deduplicated in memory by actor kind, actor ID,
service ID, action, and operation ID. The default completed-operation retention
is 15 minutes. A duplicate joins or returns the original result; different data
under the same key returns `operation_conflict`. Retryable failures are removed
so the same operation may be attempted again. Tombstones survive an in-process
service restart for their retention window but are not durable across process
restarts.

Default limits include 64 KiB inbound messages, bounded inbound/outbound message
and byte queues, 32 subscriptions, 64 connections, a 600-request/minute window,
and a 3-second unauthenticated `hello` deadline. Servers reject binary v1
messages and disable WebSocket compression. Close codes `4408` and `4409` are
reserved by this protocol for `hello_timeout` and `resync_required`; standard
codes cover malformed protocol (`1002`), binary messages (`1003`), policy or
authorization (`1008`), oversized messages (`1009`), internal failure (`1011`),
and normal server shutdown (`1001`).

### Webhook-to-client streams

The independently importable webhook library turns authenticated provider HTTP
deliveries into ordinary realtime service streams. `CjsWebhookHttpRouter` owns
bounded raw ingress under `/v1/webhooks/<endpoint-id>`, while
`CjsWebhookStreamService` wraps a provider handler behind the same structural
`Describe()` / `Start(context)` / `Stop()` lifecycle used by other realtime
services:

```js
import {
    CjsWebhookHttpRouter,
    CjsWebhookIngressSource,
    CjsWebhookProjectionService,
    CjsWebhookStreamService,
} from "@carbonenginejs/tools-core/webhook";

const activity = new CjsWebhookStreamService({
    id: "provider-main",
    family: "livestream.activity",
    familyVersion: 1,
    kind: "provider.webhook",
    topics: [ "livestream.activity.subscription.received" ],
    handler: providerWebhookHandler,
});

hub.Register(activity);
const webhookRouter = new CjsWebhookHttpRouter({
    endpoints: [ activity ],
    maxBodyBytes: 256 * 1024,
    maxConcurrentRequests: 64,
    // Explicit remote opt-in; keep the default for local relay processes.
    loopbackOnly: false,
});
const host = new CjsToolServiceHost({
    hub,
    realtimeRouter,
    realtimeGateway,
    httpRouters: [ webhookRouter ],
    fallback: existingHttpProxy,
});
```

The injected handler must implement two explicit phases. Its
`AuthenticateWebhook(request)` receives the exact body bytes, lower-case request
headers, request target, receive time, peer address, and service abort signal;
it verifies the provider against the raw body before anything is trusted.
`HandleWebhook(request)` receives that result as `request.authentication` and
must remain side-effect-free while returning only canonical client events:

```js
{
    deliveryId: "provider-delivery-id",
    events: [ {
        topic: "livestream.activity.subscription.received",
        occurredAt: "2026-07-22T04:00:00.000Z",
        data: normalizedActivity,
    } ],
    response: {
        statusCode: 202,
        body: { accepted: true },
    },
}
```

Topic declarations and payloads are validated before publication. A bounded
current-run delivery-ID cache acknowledges exact provider retries without
publishing twice and rejects reuse of one ID with different canonical content.
Concurrent verification and request bytes are bounded; lifecycle or service
queue pressure returns a retryable HTTP error. The provider acknowledgement is
written only after the publications have entered the service lane.

Provider adapters validate canonical livestream payloads through the exact
`@carbonenginejs/tools-core/realtime/livestream` subpath. The normative topic,
activity, state-patch, snapshot, null, and extension semantics are documented
in `docs/realtime-livestream-v1.md`; its adjacent Twitch/Kick fixtures are
executable package tests.

`CjsWebhookStreamService` remains the compact one-endpoint/one-family wrapper.
Providers with one callback spanning several families use one
`CjsWebhookIngressSource` plus statically registered services. Authentication,
mapping, retry identity, and raw bytes run once; each canonical topic is routed
to exactly one owning service. Multi-family retries remember completed
publication steps, so a later-family failure does not republish earlier-family
events when the provider retries.

Webhook endpoints do not use local realtime client capabilities and do not
enable browser CORS. The router is loopback-only by default. A public deployment
must explicitly disable that guard behind HTTPS, request deadlines, admission
and source rate limits; its provider handler must verify the documented
signature, timestamp, and replay identity. Raw provider bodies, authentication
headers, and secrets are never forwarded automatically. Clients continue to
authenticate and subscribe over `/v1/realtime`; several facades may receive the
same live event, and a newly connected facade receives no webhook backlog.

### Realtime resource watch

The independently importable resource-watch service is the first concrete
realtime family:

```js
import {
    CjsRealtimeResourceWatchService,
} from "@carbonenginejs/tools-core/realtime/resource-watch";

const resources = new CjsRealtimeResourceWatchService({
    id: "project-resources",
    root: "E:\\project\\res",
    logicalRoot: "res:/",
    settleMs: 75,
    maxEntries: 10000,
    maxPendingPaths: 4096,
});

hub.Register(resources);
```

The embedding application grants only the required family scopes:

```js
{
    topics: [
        "resource.watch.entry.changed",
        "resource.watch.status.changed",
    ],
    commands: [],
    snapshots: true,
    content: true,
}
```

The service observes before its initial scan, queues changes that race the
scan, and publishes no artificial add backlog for the initial tree. Snapshot
entries are sorted relative logical file paths and include `type`, `byteSize`,
`modifiedAt`, opaque `revision`, and an authenticated relative `contentRef`.
Physical roots, native watcher operations, Node `Stats`, and provider errors
are never part of public payloads.

`resource.watch.entry.changed` carries `add`, `update`, or `remove`, the
relative `path`, the current `entry` (`null` for removal), and
`previousRevision`. `resource.watch.status.changed` reports sanitized `ready`
or `degraded` source status. Both recover through the materialized snapshot and
its host-stamped cursor; reconnecting does not receive an event backlog.

Watcher notifications are hints. The service re-reads authoritative file
state, settles repeated hints per path, and derives the canonical operation by
comparing its catalog. Pending paths are bounded; overflow collapses to one
complete root reconciliation instead of silently dropping changes. Observation
is injectable through an `observe({ root, signal, onChange, onError })`
function that returns a function, `Close()` object, or Node-style `close()`
object. The default uses recursive Node `fs.watch` support.

Content paths are already decoded and are validated again by the service. It
rejects absolute, drive, UNC, backslash, colon, NUL, empty, dot, dot-dot, and
encoded traversal/separator aliases. Scans do not follow symlink/reparse
entries, and resolved files must remain inside the canonical root. HTTP bytes
stream from an opened file handle with content length, modification time, ETag,
`GET`/`HEAD`, and conditional `304` support.

The v1 `size-mtime-v1` revision is a current-at-open precondition, not a
retained immutable artifact. If a referenced file has changed or disappeared,
the old `contentRef` returns retryable `revision_mismatch` and the consumer
reconciles from a fresh snapshot/event. Content hashing, historical revision
retention, and leased immutable artifacts remain future work for a consumer
that requires exact old bytes.

### Realtime Twitch integration

The independently importable Twitch slice supplies two implementations of the
provider-neutral `chat` family:

- `twitch.irc` is a small receive-only adapter around an injected
  tmi.js-compatible client; and
- `twitch.eventsub` uses Twitch OAuth, Helix, and EventSub WebSockets.

The integration subpath exports vendor-led `Twitch*` classes. Its `Cjs*`
backing classes are internal implementation details and are not package
exports. Another integration can use its own provider prefix and satisfy the
structural `Start`/`Stop` contract without inheriting a Carbon or Twitch class.

OAuth is the broader integration foundation rather than a chat-specific mode.
`TwitchOAuthTokenProvider` validates an externally acquired user access
token, checks the exact identity/scopes requested by each integration, caches
validation for at most one hour, and optionally serializes an injected refresh
callback. `TwitchHelixClient` applies the same identity and reactive `401`
refresh policy to arbitrary Helix routes. EventSub chat and livestream activity
share that foundation without joining their normalized family semantics.

```js
import {
    TwitchActivityService,
    TwitchActivitySource,
    TwitchChatService,
    TwitchChatSource,
    TwitchEventSubActivityProvider,
    TwitchEventSubChatProvider,
    TwitchEventSubSession,
    TwitchEventSubSource,
    TwitchEventSubStateProvider,
    TwitchHelixClient,
    TwitchOAuthTokenProvider,
    TwitchStateService,
    TwitchStateSource,
} from "@carbonenginejs/tools-core/integrations/twitch";
import {
    LIVESTREAM_ACTIVITY_TOPICS,
} from "@carbonenginejs/tools-core/realtime/livestream";

const oauth = new TwitchOAuthTokenProvider({
    clientId: twitchClientId,
    getAccessToken: () => tokenStore.ReadAccessToken(),
    refreshAccessToken: () => tokenStore.RefreshAccessToken(),
});
const helix = new TwitchHelixClient({ oauth });
const eventSub = new TwitchEventSubSource({ oauth, helix });
const provider = new TwitchEventSubChatProvider({
    source: eventSub,
    registrationId: "chat",
    rooms: [ { id: "123456", login: "example_channel" } ],
});
const activityProvider = new TwitchEventSubActivityProvider({
    source: eventSub,
    registrationId: "activity",
    rooms: [ { id: "123456" } ],
    topics: [
        LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
        LIVESTREAM_ACTIVITY_TOPICS.FOLLOW_RECEIVED,
    ],
});
const stateProvider = new TwitchEventSubStateProvider({
    source: eventSub,
    helix,
    registrationId: "state",
    rooms: [ { id: "123456", login: "example_channel" } ],
});
const source = new TwitchChatSource({ provider });
const activitySource = new TwitchActivitySource({ provider: activityProvider });
const stateSource = new TwitchStateSource({ provider: stateProvider });
const aggregateChat = new TwitchChatService({
    id: "primary-chat",
    source,
});
const exampleChannel = new TwitchChatService({
    id: "twitch-chat-example-channel",
    source,
    room: { id: "123456", login: "example_channel" },
});
const exampleChannelActivity = new TwitchActivityService({
    id: "twitch-activity-example-channel",
    source: activitySource,
    room: { id: "123456" },
});
const exampleChannelState = new TwitchStateService({
    id: "twitch-state-example-channel",
    source: stateSource,
    room: { id: "123456" },
});

hub.Register(aggregateChat);
hub.Register(exampleChannel);
hub.Register(exampleChannelActivity);
hub.Register(exampleChannelState);
```

One `TwitchChatSource` owns the upstream IRC or EventSub transport. Any number
of pre-registered `TwitchChatService` instances may share it without opening a
provider connection per service. A service with no `room` is an aggregate feed
whose messages retain their room identity; this suits CPPC-style consumers that
route many channels locally. A service with one exact `room` is the logical
emitter for that room and suits a character facade or overlay that should not
receive unrelated chat. Give narrow clients grants only for their exact room
service. The aggregate service is optional and should have a separate grant.

Room services are registered before hub startup because the realtime registry
is sealed once running. The set of logical room services is not itself capped
by the browser transport, although one client defaults to 32 simultaneous
service subscriptions. Provider connections still obey upstream room,
subscription, connection, and rate quotas; scale those with explicit provider
sessions rather than one transport per logical emitter.

The embedding application owns an Authorization Code or Device Code flow and
token persistence; tools-core does not open a browser, store a client secret,
or place credentials in public realtime messages. EventSub chat requests
`user:read:chat`. Receive-only IRC requests `chat:read`; add a write scope only
when an explicit sending integration is implemented.

`TwitchEventSubActivityProvider` registers only its selected canonical topics.
The shared EventSub source unions the corresponding Twitch scopes and
subscriptions before startup. Its normalizer covers subscriptions and renewals,
gift batches, follows, incoming raids, cheers, and reward redemptions. One
`TwitchActivitySource` can back an aggregate service plus exact-room services;
all remain future-only and suppress bounded current-run duplicates.

`TwitchEventSubStateProvider` registers `stream.online`, `stream.offline`, and
`channel.update` over that same EventSub source. `TwitchStateSource` opens the
event path before reading bounded initial Helix stream/channel state, queues
notifications that race that seed, and then materializes them in order. Its
aggregate and exact-room `TwitchStateService` projections publish atomic
`livestream.state.changed` patches and expose cursor-consistent snapshots.

Both transports publish `chat.message.received` with stable message, room, and
author identities, plain text, roles, reply/fragments, `deliveryMode: "live"`,
and provider details under `extensions.twitch`. They also publish sanitized
`chat.status.changed` health transitions. The service has no snapshot, history,
or provider backlog: a new WebSocket subscriber begins at its returned cursor
and receives only later messages. A bounded per-room stable-ID set suppresses
duplicate upstream delivery during the current service run.

Do not run IRC and EventSub against the same room as parallel active sources
during cutover: Twitch does not promise cross-interface message-ID equality.
EventSub is the preferred extensible path; IRC remains useful where a very
small chat-only compatibility adapter is sufficient. Neither provider is
enabled by the standalone launcher yet.

EventSub frames are serialized per socket. Notifications received while the
welcome handler is creating subscriptions wait behind setup instead of being
misclassified, and both welcome and subscription setup have configurable
8-second default deadlines. OAuth acquisition and Helix requests have
configurable 10-second hard deadlines, and OAuth validation responses are
streamed through a 64 KiB default ceiling.

`TwitchEventSubSession` owns the family-neutral socket lifecycle: bounded
raw frames, welcome/setup ordering, keepalives, Twitch-directed migration,
unexpected-gap backoff, and authorization suspension/resume. The chat provider
adds only its OAuth scope, Helix subscription declarations, room rules, and
normalizer. `TwitchEventSubSource` is the one lifecycle owner and static family
registry: providers register before first attachment, the source seals that
set, unions OAuth scopes, deduplicates identical Helix subscription bodies,
and routes isolated raw notifications by subscription type/version. The final
family detach stops the physical session. Do not make family adapters call
`Start()`/`Stop()` directly on the underlying session.

### Kick webhooks

The exact `@carbonenginejs/tools-core/integrations/kick` subpath provides
`KickWebhookHandler`, `KickActivityService`, and `KickStateService`.
`KickWebhookHandler` verifies the official RSA-SHA256 signature over the exact
message ID, timestamp, and raw body; validates the signed event headers and a
bounded freshness window; and maps subscriptions, gift batches, follows,
reward updates, KICK contributions, and livestream status/metadata into the
same canonical livestream contract as Twitch.

```js
import {
    KickActivityService,
    KickStateService,
    KickWebhookHandler,
} from "@carbonenginejs/tools-core/integrations/kick";
import {
    CjsWebhookIngressSource,
} from "@carbonenginejs/tools-core/webhook";

const kickIngress = new CjsWebhookIngressSource({
    id: "kick-main",
    handler: new KickWebhookHandler(),
});
const kickActivity = new KickActivityService({
    id: "kick-activity",
    source: kickIngress,
});
const kickState = new KickStateService({
    id: "kick-state",
    source: kickIngress,
    // The embedding OAuth/API integration supplies complete initial state.
    readSnapshot: ({ signal }) => kickApi.ReadLivestreamSnapshot({ signal }),
});

hub.Register(kickActivity);
hub.Register(kickState);
const webhookRouter = new CjsWebhookHttpRouter({
    endpoints: [ kickIngress ],
});
```

The checked-in public key is the documented Kick key at package release time;
applications may inject a refreshed trusted public key. Event-subscription
creation and initial Kick API state acquisition remain embedding OAuth duties.
Keep the endpoint loopback-only behind a trusted relay during development, or
explicitly deploy it behind HTTPS and durable delivery-ID replay protection.

The canonical public route shape is:

```text
/{target}/{build}/{topic}[/{path}]
```

Implemented target routes include:

```text
GET /targets
GET /eve/latest/build
GET /frontier/latest/build
GET /frontier/latest/res
GET /eve/<exact-build>/res/<path>
GET /eve/<build>/res/resfiles
GET /eve/<build>/resfiles
GET /netease/<exact-build>/app/<path>
GET /ccp/<build>/<topic>[/<path>]
GET /ccp/<build>/resources[/<path>]
GET /eve/<build>/resource[/<path>]
GET /eve/<build>/billboards
GET /eve/<build>/nebulas
GET /eve/<build>/cubes
GET /eve/<build>/sof/hulls/<hull>/respathinserts
POST /eve/<build>/sof/hulls/<hull>/respathinserts/<insert>/resolve
GET /eve/latest/sde
GET /eve/<sde-build>/sde/<table>?limit=100&offset=0
GET /eve/<sde-build>/sde/<table>/<id>
GET /eve/<sde-build>/sde/<table>?query=<text>
GET /eve/<sde-build>/sde/<table>?field=groupID&value=25
GET /eve/<sde-build>/sde/skins?field=types&contains=587
GET /eve/<sde-build>/sde/resolve?typeID=587&skinID=<skin-id>
GET /eve/<build>/character
GET /eve/<build>/character/types/<typeID>?lod=<lod>
GET /eve/<build>/character/parts/<partID>?lod=<lod>
GET /eve/<build>/character/lookup?name=<name>
GET /eve/<build>/character/search?name=<name>
GET /eve/<build>/character/resolve?name=<name>&lod=<lod>
GET /eve/<build>/character/<category>?lod=<lod>
GET /eve/<build>/character/lod/<lod>/types/<typeID>
GET /eve/<build>/character/lod/<lod>/parts/<partID>
GET /eve/<build>/character/lod/<lod>/resolve?name=<name>
GET /eve/<build>/character/lod/<lod>/<category>
GET /eve/<sde-build>/skin
GET /eve/<sde-build>/skin/<section>
GET /eve/<sde-build>/skin/<section>/<id>
GET /eve/<sde-build>/skinr
GET /eve/<sde-build>/skinr/<section>
GET /eve/<sde-build>/skinr/<section>/<id>
GET /eve/<sde-build>/weapons
GET /eve/<sde-build>/weapons/lookup?name=<name>
GET /eve/<sde-build>/weapons/search?name=<name>
GET /eve/<sde-build>/weapons/types/<weapon-typeID>
GET /eve/<sde-build>/weapons/types/<weapon-typeID>/ammunition
GET /eve/<sde-build>/weapons/types/<weapon-typeID>/ammunition/<ammunition-typeID>
GET /eve/<sde-build>/weapons/ammunition/<ammunition-typeID>
GET /eve/<sde-build>/weapons/projectiles[/<graphicID>]
GET /eve/<sde-build>/weapons/groups[/<groupID>]
```

An `app` or `res` topic without a path resolves the build and returns its exact
resource URL template. With a path it returns the validated indexed bytes.
Appending `?format=json` to a `.black` resource path (e.g.
`GET /eve/<exact-build>/res/dx9/model/spaceobjectfactory/hulls/<hull>.black?format=json`)
returns the resource already converted to public payload JSON via the `black`
module instead of raw bytes; any other extension with `format=json` returns
`415`. This shares the `black` module's single-schema-snapshot caveat above —
converting a resource from a build far from the snapshot's source tree can
fail or silently misread fields. The expanded
`/games/{game}/providers/{provider}/builds/{build}` build route is retained as
a compatibility alias.

The character root returns the prepared runtime-shaped library. A
`types/<typeID>` lookup is deterministic. `lookup?name=<name>` and
`search?name=<name>` mirror the skin identity endpoints and return candidate
lists containing `typeID` and the Carbon-owned `partID`; the latter folds
punctuation and spacing. `resolve?name=<name>` is the unambiguous convenience
lookup. The JavaScript library API exposes the corresponding `LookupName()`,
`SearchName()`, and `ResolveName()` methods. Category paths include descendant
categories. Lookup candidates are unranked exact identities; `typeID` is
optional and `partID` is always present. Use `parts/<partID>` to select a
candidate that has no `typeID` or whose name is ambiguous. Character part
responses include an atomic `lodBundle` when
either `?lod=<lod>` or the leading
`lod/<lod>/...` form is used; specifying both with different values is invalid.
The root library additionally includes prepared `recipeLinks`; graph hydration
and strict/diagnostic recipe resolution remain owned by `runtime-character`.

Carbon-owned character fields retain the established camelCase vocabulary,
including capitalized identity suffixes such as `typeID`. Embedded third-party
records and authored map keys are preserved rather than recursively re-keyed.
Any ESI-shaped representation belongs in an explicit adapter.

The `ccp/<build>` route is the preferred compact EVE CCP API root. Browser
clients may map `api:/` to `/ccp/<build>/` and `res:/` to
`/ccp/<build>/resources/`. Its `resources`
subtree is the EVE `res:/` HTTP root: files return
their validated bytes and directories return their JSON description with
immediate children. The target-oriented `eve/<build>/resource` route exposes
the same directory-description operation. Directories include
their immediate file and directory children, so callers can browse a narrow
part of the composed exact-build resource view without downloading its full
index. For example, `/ccp/<build>/resources/texture/sprite/banners` lists the
authored horizontal-banner directory. The billboard, nebula, and cube routes
return sorted arrays of complete `res:/` paths. The cube catalog
contains the base, blur, and reflection variants used by nebula declarations.
The SOF respath
insert GET route returns names proven by matching base and inserted hull
material maps; faction `_fn` hulls also inherit the corresponding `_t1`
answers. The resolve POST accepts `{ "paths": [...] }` and returns a positional
array of normalized paths. For each caller-supplied hull or shared-resource
path, it inserts the selected name as both the parent folder and the final
filename component before the texture suffix, returns that candidate only when
it exists in the composed index, and otherwise returns the original path.
`effect` and `effects` folders are intentionally left unchanged. Response
headers expose the exact resolved build even when the request used `latest`.

`/res/resfiles` (also `/resfiles`) temporarily returns the complete sorted
`res:/` path list for legacy clients. It is a migration endpoint, not the
preferred long-term SOF API. Current ccpwgl no longer requests it. New
consumers should use the resource-directory, billboard/cube, and
hull-respath-insert answers instead. The raw CCP resource index remains
available through the ordinary app-resource route as
`/app/resfileindex.txt`; no second resfileindex representation is defined.

The built-in Frontier profile uses the `stillness` client. Its public build
metadata and exact app manifest use the same resolver interface as EVE. When
CCP marks app-side index payloads as protected, full `ReadIndexes`/`Open`
operations require a caller-supplied authenticated Fetch implementation.

An SDE `latest` reference resolves independently against CCP's SDE channel, so
it may differ from the latest app/res build. By default the service only opens
prepared databases. Pass `--sde-auto-prepare` to download and build a missing
database on its first request.

The `skin` and `skinr` routes use that same exact SDE source. A full-library
response has the same structure as the generated file; for example,
`/eve/<build>/skin/skins/5` returns the same value as
`skinLibrary.skins[5]`, and `/eve/<build>/skinr/components/53` returns
`skinrLibrary.components[53]`. Unknown sections or IDs return `404`.

The `weapons` root likewise matches `weapons_v1.json`. `types/<typeID>` returns
the exact `library.types[typeID]` record. Each weapon carries the CCP-authored
`graphicFile` and a lowercase `resPath` with the obsolete `.red` extension
changed to the indexed `.black` resource. Its `chargeGroupIDs`, optional
`chargeSize`, and `ammunitionTypeIDs` come from dogma rather than market-name
guessing. The nested ammunition routes return only records compatible with
that weapon. Ammunition graphics are labelled by role; missile ammunition
normally resolves to an impact graph. `projectiles` is therefore a separate
catalog of official launcher `EveMissile` graphics and is deliberately not
silently joined to ammunition TypeIDs by filename convention. Name lookup is
weapon-discovery-only: exact weapon names return their TypeID candidate, while
authored inventory-group and market-group names expand to every descendant
weapon TypeID option. It is not a general TypeID/name service; ammunition names
and unrelated inventory names belong behind ESI. All subsequent resolution
remains ID-based. Weapon records retain `marketGroupID` as an external join key,
but the weapon library does not republish market-group records; the ESI-facing
facade owns that API.

```powershell
npm run service -- --cache <cache> --data <persistent-data>
```

## EVE SDE and SOF graph output

Prepare the current official EVE SDE once into the shared cache:

```powershell
npm run prepare:sde -- --cache <cache>
```

For a pinned build, pass `--build <exact-build>`. The command writes
`custom/games/eve/providers/ccp/builds/<build>/sde_v1.sqlite`, containing every
JSONL table in that archive plus exact source provenance and row counts. The
import is transactional: an invalid replacement leaves the prior database
intact.

Build both offline skin catalogs from the prepared database:

```powershell
npm run build:skins -- --cache <cache> --build <exact-build>
```

Build the offline weapon catalog from the same prepared database:

```powershell
npm run build:weapons -- --cache <cache> --build <exact-build>
```

`--build latest` is supported and resolves once to the exact SDE build. Add
`--auto-prepare` when the command may download and prepare a missing database.
Each command output has both `.json` and `.json.gz` forms, and the gzip form
decodes byte-for-byte to the JSON artifact. The SKIN file exposes `skins`, `skinMaterials`, `skinMaterialSets`,
`skinLicenses`, `typesToSkins`, `skinMaterialsToTypes`, and
`skinsToLicenses`. The SKINR file exposes component, slot, and ship-tree maps,
plus the SKINR-owned `typesToSlotConfigurations` relation, normalized point
values, tier thresholds, texture address modes, and component-license joins.
It does not copy full ESI type records. Official `.red` and texture paths are
preserved as authored.

Library callers can keep latest-build policy separate from exact acquisition:

```js
const archive = new CjsSdeArchive();
const latest = await archive.ResolveLatest();
const database = await archive.PrepareDatabase({
  ...latest,
  databasePath: "<cache database path>",
});
const types = database.Table("types");
const rifter = await types.Get(587);
const frigates = await types.Find("groupID", 25);
const prepared = await database.LoadTables([
  "types",
  "graphics",
  "skins",
  "skinMaterials",
  "skinLicenses",
  "materialSets",
  "graphicMaterialSets",
]);
const sde = new CjsSde(prepared);
```

Fetched archives, SQLite files, WAL files, indexes, and cache output are
game-derived artifacts and must not be committed. Only deliberately selected,
compact internal library JSON outputs belong in source control.

```js
const core = new CjsToolCore({ sde, sof });
const dna = core.ResolveDna({ typeID: 587, skinID: 1234 });

// Recommended: plain model values — the same JSON-compatible graph a hydrated
// root's GetValues({ refs: true, typeTags: true }) returns. Nested values with
// `_type` on polymorphic nodes and `_id`/`_ref` only for shared identity.
// Hydrate with `EveShip2.from(values)` (or the `_type`-selected class) against
// the runtime-trinity registry.
const values = core.BuildSofValues(dna);

// Compatibility/diagnostic: the explicit carbon.document node table, for graph
// tooling that genuinely needs detached nodes, fragment import, or lossless
// unknown fields.
const document = core.BuildSofDocument(dna);
```

The SDE subpath also exposes the joins directly:

```js
const candidates = sde.LookupName("Rifter");
const normalizedCandidates = sde.SearchName("test-skin");
const type = sde.ResolveType(587);
const graphicDna = sde.ResolveGraphicDna(type.graphicID);
const skinDna = sde.ResolveSkinDna(1234, 587);
```

`LookupName()` retains every deterministic candidate. `ResolveName()` and
name-based `ResolveDna()` reject ambiguous names. A bare SkinID resolves when
its eligible TypeIDs collapse to one GraphicID; otherwise the caller must also
provide a TypeID.

`SearchName()` and `ResolveSearchName()` are the explicit punctuation/spacing
normalization path. They fold separators such as spaces, hyphens, and
underscores but retain every resulting candidate and still reject ambiguity.

`BuildSofValues` hydrates a fresh runtime-trinity graph internally and exports
it, so it needs the `runtime-trinity` dependency (registered lazily, or inject
`options.sofRegistry`). `BuildSofDocument` returns the complete `runtime-sof`
`carbon.document` without touching `runtime-trinity`; it is the specialized
graph/diagnostic path, not the default tool boundary.

## Commands

```powershell
npm run start -- --target:eve --build:latest
npm run start -- --target:frontier --build:latest
npm run service -- --cache <cache>
npm run service -- --cache <cache> --data <persistent-data>
npm run service -- --cache <cache> --sde-auto-prepare
npm run prepare:sde -- --cache <cache> [--build <exact-build>]
npm run build:audio -- --index <resfileindex.txt> --cache <cache> --soundbanksinfo <file-or-res-path> --out <library.json> --target <eve|frontier> --build <build> [--enrichment <audio-metadata.json>] [--event-media]
npm run build:character -- --index <resfileindex.txt> --cache <cache> --out <library.json> --target eve --build <build>
npm run build:skins -- --cache <cache> --build <build|latest> [--auto-prepare]
npm run build:weapons -- --cache <cache> --build <build|latest> [--auto-prepare]
npm run catalog:shader -- --index <resfileindex.txt> --shader-target frontier-webgl2 --build <build> --out <catalog.json>
npm run export:character -- <catalogs.json> --out <library.json>
npm run check
```

The baseline check is offline. Index tests inject fetch implementations and use
synthetic records; private game data, credentials, an installed client, and a
GUI are not required.

## Safety and provenance

The repository contains code and synthetic fixtures only. Caches, persistent
local overlays, fetched EVE indexes/payloads, and generated game-derived
outputs are ignored by Git and must not be committed. CarbonEngine, Fenris
Creations (CCP Games), Twitch, and Kick names and API terms are used solely for
interoperability and provenance context. This project is not affiliated with or
endorsed by those organizations. See `LICENSE` and `NOTICE`.
