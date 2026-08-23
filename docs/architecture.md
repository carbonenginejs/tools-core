# Tools-core architecture

Status: Stable  
Scope: `@carbonenginejs/tools-core`  
Audience: Integrators, contributors, and maintainers  
Summary: Defines the package boundary, dependency direction, and major Node-owned subsystems.

## Purpose

Tools-core is the consolidated Node toolchain for CarbonEngineJS. Its modules
remain independently importable so acquisition, caches, generated libraries,
schema tooling, local services, and realtime integrations can be used without
constructing the root facade.

## Package boundary

Tools-core owns:

- target/build resolution and validated app/resource index acquisition;
- the shared exact-build cache and persistent resource overlays;
- prepared exact-build SDE databases, target-keyed SDE build profiles, and
  Node-side generated library acquisition, orchestration, and publication;
- schema scanning and class-emission tooling;
- Node HTTP, WebSocket, webhook, credential, filesystem-watch, and command-line
  orchestration;
- composition of public runtime APIs into offline artifacts.

Tools-core does not own:

- browser clients or browser-safe remote readers, which belong in
  `@carbonenginejs/tools-browser`;
- runtime-owned audio-library construction and raw-resource decoding, which
  tools-core calls with an injected exact-build index/cache source;
- runtime-owned character-library schema, hydration, and deterministic
  raw cFSD combination, which tools-core calls with an injected exact-build
  index/cache source plus optional gathered catalogs;
- runtime graph classes and domain behavior, which belong in `runtime-*`;
- format decoding or shader compilation algorithms, which remain in their
  owning format/runtime packages;
- application authentication flows, credential persistence, UI, rendering, or
  provider account policy.

## Dependency direction

```text
core, format, and domain runtime packages
                   |
                   v
               tools-core
                   |
                   +----> generated JSON/gzip/SQLite and resource overlays
                   |
                   +----> Node service transports and applications
```

Runtime and engine packages must not import tools-core. Tools-core calls
runtime-audio's builder with a Node byte source and serializes
`library.GetValues()`; it coordinates rather than duplicates joins, decoding,
or conversion. It applies the same boundary to runtime-character's
combined-library builder. Browser remote
clients remain optional consumers of the resulting service.

## Schema staging

Carbon schema and class generation writes to tools-core staging; the consuming
runtime reviews and installs accepted output. Family-qualified reviewed class
purposes live in the schema tool beside the emitter because they are
CarbonEngineJS metadata, not text extracted from Carbon declarations. The
schema carries an optional `purpose`, and generated class JSDoc plus
`@type.define` metadata use it verbatim after whitespace normalization. Unknown
classes retain the deterministic shape-hash fallback.

## Exact-build data path

Friendly build names such as `latest` are resolved once. Every subsequent
index, cache, builder, and response retains the exact target and numeric build.
Game and provider travel with results as provenance metadata; neither selects a
remote, cache tree, SDE profile, or output path. Indexed bytes are checked
against declared size and MD5 before they are returned or published into the
cache.

## SDE build profiles

`CjsToolSdeBuildProfile` supplies a target's source mappings, reviewed readers,
projections, required-table policy, and named derivations. The generic builder
contains no NetEase branch. Serenity and Infinity are separate profiles and
separate `targets/<target>/builds/<build>` artifact identities even though both
record `provider: "netease"`. A future EVE profile can use the same contract
with `target: "eve"` and `provider: "ccp"`.

Generated libraries use CarbonEngineJS-owned camelCase fields with capitalized
identity suffixes such as `typeID` and `graphicID`. Provider-owned opaque
records retain their wire spelling.

Raw `sde/*` routes retain published table values as source evidence. Composed
topics own consumer-facing normalization: the `icons` topic, for example,
turns the SDE's mixed-case `iconFile` into one explicit loadable `resPath`
without changing the underlying `sde/icons` answer.

## Service path

The legacy query/resource service and the authenticated realtime host are
separate compositions:

- `CjsToolHttpProxy` exposes exact-build query and byte routes.
- `CjsToolRealtimeHub` owns registered service lifecycles and protocol state.
- `CjsToolRealtimeHttpRouter` and `CjsToolRealtimeGatewayWebsocket` expose the versioned
  realtime transport.
- `CjsToolServiceHost` composes those routes without choosing a listener.
- `CjsToolRealtimeServer` owns an optional standalone loopback listener.

Provider integrations authenticate and normalize upstream input before it
enters a service. Registered services receive canonical values, not raw sockets.

## Current limitations

The checked-in launcher does not enable the authenticated realtime host.
Browser-client protocol consumption remains in
tools-browser. Consolidating duplicated protocol primitives across the two
packages is follow-up work after tools-browser has a released semver boundary.
