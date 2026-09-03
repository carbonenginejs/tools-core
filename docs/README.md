# Tools-core documentation

Status: Evolving  
Scope: `@carbonenginejs/tools-core`  
Audience: Users, integrators, contributors, and maintainers  
Summary: Entry point for the Node toolchain, generated-library, and local-service documentation.

## Purpose

`@carbonenginejs/tools-core` acquires exact-build inputs, validates and caches
payloads, builds deterministic libraries, and optionally exposes those results
through local Node services.

## Use this package when

Use tools-core for Node-side preparation, build orchestration, persistent
caches, or local HTTP services that require credentials and server policy. Browser clients and remote readers belong in
`@carbonenginejs/runtime/tools`; runtime graph and domain behavior remain in
their owning runtime subpaths.

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
          +------> local HTTP services
                             |
                             v
                runtime/tools and applications
```

## Start here

- [Architecture and boundaries](architecture.md)
- [Roadmap and hardening work](roadmap.md)
- [Public API and subpaths](reference/api.md)
- [Class catalogs](reference/classes/README.md)
- [Build generated libraries](guides/generated-libraries.md)
- [Build a profile-driven SDE](guides/sde-builds.md)
- [Prepare exact-build cache inputs](guides/prefetch.md)
- [Build a SOF bundle](guides/sof-bundles.md)
- [Run the local service](guides/local-service.md)
- [Release this package](guides/releasing.md) — **read before pushing**: this
  repository is public and its history accumulates while pushing is paused

## Documentation map

- [Cache and persistent overlays](concepts/cache-and-overlays.md)
- [Exact-build cache prefetch](guides/prefetch.md)
- [Profile-driven SDE builds](guides/sde-builds.md)
- [Local HTTP route reference](reference/http-routes.md)
- [Maintained class catalogs](reference/classes/README.md)

The adjacent JSON files under `protocols/` are published conformance fixtures
and are replayed by package tests.
