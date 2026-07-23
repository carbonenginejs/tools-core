# Tools-core documentation

Status: Evolving  
Scope: `@carbonenginejs/tools-core`  
Audience: Users, integrators, contributors, and maintainers  
Summary: Entry point for the Node toolchain, generated-library, local-service, and realtime documentation.

## Purpose

`@carbonenginejs/tools-core` acquires exact-build inputs, validates and caches
payloads, builds deterministic libraries, and optionally exposes those results
through local Node services.

## Use this package when

Use tools-core for Node-side preparation, build orchestration, persistent
caches, local HTTP/WebSocket services, or provider integrations that require
credentials and server policy. Browser clients and remote readers belong in
`@carbonenginejs/tools-browser`; runtime graph and domain behavior remain in
their owning `runtime-*` packages.

## Where it fits

Tools-core consumes public format and runtime boundaries to prepare artifacts.
It may serve browsers, Blender, local applications, and build systems, but
runtime packages never import it.

```text
format/runtime packages
          |
          v
      tools-core  ----> generated libraries and exact-build caches
          |
          +------> local HTTP, WebSocket, and webhook services
                             |
                             v
                tools-browser and applications
```

## Start here

- [Architecture and boundaries](architecture.md)
- [Public API and subpaths](reference/api.md)
- [Class catalogs](reference/classes/README.md)
- [Build generated libraries](guides/generated-libraries.md)
- [Prepare exact-build cache inputs](guides/prefetch.md)
- [Run the local service](guides/local-service.md)
- [Host realtime services](guides/realtime-service.md)
- [Configure Twitch and Kick](guides/provider-integrations.md)

## Documentation map

- [Cache and persistent overlays](concepts/cache-and-overlays.md)
- [Exact-build cache prefetch](guides/prefetch.md)
- [Chat and livestream source topology](concepts/chat-and-livestream-sources.md)
- [Local HTTP route reference](reference/http-routes.md)
- [Maintained class catalogs](reference/classes/README.md)
- [Future realtime operations](reference/realtime-operations.md)
- [Realtime protocol v1](protocols/realtime-v1.md)
- [Chat family contract v1](protocols/chat-v1.md)
- [Livestream family contract v1](protocols/livestream-v1.md)

The adjacent JSON files under `protocols/` are published conformance fixtures
and are replayed by package tests.
