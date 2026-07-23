# Cache and persistent overlays

Status: Stable  
Scope: `@carbonenginejs/tools-core/cache` and `@carbonenginejs/tools-core/index`  
Audience: Integrators and build operators  
Summary: Defines exact-build cache identity, generated artifact locations, and overlay precedence.

## Cache layout

Exact-build indexes retain game and provider identity:

```text
<cache>/games/<game>/providers/<provider>/builds/<build>/indexes/<file-name>
```

Indexed payloads use the game-compatible content-addressed layout:

```text
<cache>/ResFiles/<shard>/<path-fnv1>_<md5>
```

Generated libraries and databases use:

```text
<cache>/custom/games/<game>/providers/<provider>/builds/<build>/<name>_<version>.<extension>
```

Examples include `character_v1.json`, `skin_v1.json`, `skinr_v1.json`,
`weapons_v1.json`, and `sde_v1.sqlite`. Existing installations may retain a
cache root directory named `tool-core`; that storage name is independent of
the `tools-core` package identity.

## Persistent overlays

Controlled local and remote overlay manifests live outside the disposable
cache:

```text
<data>/games/<target>/overlays/<name>/overlay.json
<data>/games/<target>/overlays/<name>/resfileindex.txt
<data>/games/<target>/overlays/<name>/res/<logical-path>
```

Resolution order is:

1. generated or override overlays;
2. the official exact-build index;
3. fallback overlays.

`local-exact` payloads mirror their public `res:/` path beneath the persistent
data root. `hash-safe` official and remote payloads retain checksums and may be
downloaded through the shared cache.

## Constraints

- Cache cleanup must not remove the persistent data root.
- Overlay records must use normal `res:/` paths; callers never receive an
  overlay name or storage hash.
- A local artifact must not replace an official source implicitly.
- Shader profiles remain separate namespaces such as `effect.gles2`,
  `effect.webgl2`, and `effect.webgpu`.
- Indexed payload size and MD5 are validated before a cache hit is returned.

## Publication safety

Cache directories, overlays, reports, SQLite files, and acquired payloads are
working data. They are ignored by Git and excluded from the npm package.
