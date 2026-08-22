# Profile-driven SDE builds

Status: Evolving
Scope: `@carbonenginejs/tools-core/sde`
Audience: Tool authors and maintainers
Summary: Builds an exact-target SDE from client resources without coupling the builder to a publisher.

## Identity

Target is the sole operational identity. A build profile is selected by target,
and generated artifacts remain rooted at:

```text
custom/targets/<target>/builds/<build>/sde_v1.sqlite
```

Game and provider are emitted as provenance metadata. Serenity and Infinity are
separate profiles and paths while both record `provider: "netease"`.

## Command

```sh
cjs-sde-build --target serenity --build latest
cjs-sde-build --target infinity --build 3466057 --out ./infinity.sqlite
```

The command resolves a friendly build once, reads containers through
runtime-resource, applies the selected profile's projections, writes through
`CjsToolSdeDatabase.ImportTables`, and publishes registered named derivations.

## API

```js
import {
    CjsToolSdeBuild,
    CjsToolSdeBuildProfile,
    CjsToolSdeTables,
} from "@carbonenginejs/tools-core/sde";
```

A profile supplies source mappings, reader selections, projections,
required-table policy, and named derivations. The generic classes do not branch
on NetEase or CCP, so a future `target: "eve"`, `provider: "ccp"` profile uses
the same path.

Modern FSD/cFSD decoding belongs to
`@carbonenginejs/runtime-resource/formats/fsd/64`. Tools-core's `./fsd` subpath
only provides read-only structural inspection and generator-side research.
