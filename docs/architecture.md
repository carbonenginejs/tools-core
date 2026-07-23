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

- provider/build resolution and validated app/resource index acquisition;
- the shared exact-build cache and persistent resource overlays;
- prepared EVE Static Data Export (SDE) databases and deterministic library
  builders;
- schema scanning and class-emission tooling;
- Node HTTP, WebSocket, webhook, credential, filesystem-watch, and command-line
  orchestration;
- composition of public runtime APIs into offline artifacts.

Tools-core does not own:

- browser clients or browser-safe remote readers, which belong in
  `@carbonenginejs/tools-browser`;
- runtime graph classes and domain behavior, which belong in `runtime-*`;
- format decoding or shader compilation algorithms, which remain in their
  owning format/runtime packages;
- application authentication flows, credential persistence, UI, rendering, or
  provider account policy.

## Dependency direction

```text
core and format packages
          |
          v
domain runtime packages
          |
          v
      tools-core
          |
          +----> generated JSON/gzip/SQLite and resource overlays
          |
          +----> Node service transports
                           |
                           v
             tools-browser and applications
```

Runtime and engine packages must not import tools-core. Offline builders may
depend on browser-safe format APIs, but they coordinate rather than duplicate
decoding or conversion.

## Exact-build data path

Friendly build names such as `latest` are resolved once. Every subsequent
index, cache, builder, and response retains the exact target, provider, and
numeric build. Indexed bytes are checked against declared size and MD5 before
they are returned or published into the cache.

Generated libraries use CarbonEngineJS-owned camelCase fields with capitalized
identity suffixes such as `typeID` and `graphicID`. Provider-owned opaque
records retain their wire spelling.

## Service path

The legacy query/resource service and the authenticated realtime host are
separate compositions:

- `CjsToolHttpProxy` exposes exact-build query and byte routes.
- `CjsRealtimeHub` owns registered service lifecycles and protocol state.
- `CjsRealtimeHttpRouter` and `CjsRealtimeWebSocketGateway` expose the versioned
  realtime transport.
- `CjsToolServiceHost` composes those routes without choosing a listener.
- `CjsRealtimeServer` owns an optional standalone loopback listener.

Provider integrations authenticate and normalize upstream input before it
enters a service. Registered services receive canonical values, not raw sockets.

## Current limitations

The checked-in launcher does not enable the authenticated realtime host.
Browser-client protocol consumption remains in
tools-browser. Consolidating duplicated protocol primitives across the two
packages is follow-up work after tools-browser has a released semver boundary.
