# Data and build-tool class catalog

Status: Evolving
Scope: `@carbonenginejs/tools-core` schema, SDE, shader, skin, target, and weapon classes
Audience: Users, maintainers, and automated readers
Summary: Provides source-backed purpose descriptors for schema, data, build, target, and generated-library tooling.

<!-- class:CjsFormatCarbon -->
## `CjsFormatCarbon`

CarbonEngineJS-facing Carbon format profile.

- Export: `@carbonenginejs/tools-core/schema`
- Source: `src/schema/CjsFormatCarbon.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSde -->
## `CjsToolSde`

Thin in-memory join layer for prepared EVE SDE identity tables.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSde.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeArchive -->
## `CjsToolSdeArchive`

Acquires exact-build published JSONL archives and prepares CjsToolSde input tables.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSdeArchive.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeDatabase -->
## `CjsToolSdeDatabase`

Exact-build SQLite store for every table in an SDE.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSdeDatabase.js`
- Visibility: Public
- Kind: CarbonEngineJS
- Notes: `Import` writes the database from an official JSONL archive;
  `ImportTables` writes the same database from already-decoded tables, for a
  target with no published SDE. Both record the `target`, `game` and
  `provider` the data came from, defaulting to the official identity.

<!-- class:CjsToolSdeTable -->
## `CjsToolSdeTable`

Minimal paginated interface over one SDE table.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSdeDatabase.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeRepository -->
## `CjsToolSdeRepository`

Resolves target/build SDE requests to exact cached SQLite databases.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSdeRepository.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeDerivations -->
## `CjsToolSdeDerivations`

Tables computed from an SDE rather than shipped in one.

A derived table is a pure function of the rows an import just wrote, so it
belongs to the SDE rather than to its source: the register runs
after both `CjsToolSdeDatabase.Import` and `ImportTables` commit, which is the one
point both import paths traverse. Artifacts are written beside the `.sqlite` as
`<name>_v<version>.json`, never into `sde_rows`, where a computed table would be
indistinguishable from imported data. Adding one is an entry in the
register. Currently: the DNA reverse index.

- Exports: `RunDerivations`, `DerivationPath`, `ListDerivations`
- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSdeDerivations.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolMap -->
## `CjsToolMap`

Composes New Eden as addressable documents: regions, constellations, systems, and the celestials in them.

Served by `GET /{target}/{build}/map`.

Query-backed rather than library-backed, unlike `skin` and `weapons`: the map is
481000 celestials, so only the navigational tables and the computed `mapIndex`
are held in memory and the rest is answered from SQLite through the locality
indexes in `CjsToolSdeQueryIndexes`. Composes what the SDE does not ship —
celestial names, stargate orientation, and a per-system key light derived from
the star — and reports `postProcess` as `null` because nothing in the SDE names one.

Positions are float64 metres and every answer carries a `frame` declaring that.
`localPosition`, relative to the body a celestial orbits, is the float32-safe
form; see the route reference for the measured error at each scale.

- Exports: `CjsToolMap`, `CELESTIAL_TABLES`, `MAP_FRAME`
- Export: `@carbonenginejs/tools-core/map`
- Source: `src/map/CjsToolMap.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeDnaIndex -->
## `CjsToolSdeDnaIndex`

The inverse of DNA resolution: which ships and skins produce a given DNA, or any
part of one. Served by `GET /{target}/{build}/dna/search?q=`. The index shape and
matching rules are settled in the organization documentation,
`contracts/dna-reverse-index.md`.

- Exports: `BuildDnaIndex`, `QueryDnaIndex`, `SplitDna`
- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSdeDnaIndex.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeSource -->
## `CjsToolSdeSource`

Open exact-build SDE source used by service and direct callers.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSdeRepository.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolShaderTarget -->
## `CjsToolShaderTarget`

Immutable compiled-shader target over one public game target and profile.

- Export: `@carbonenginejs/tools-core/shader`
- Source: `src/shader/CjsToolShaderTarget.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolShaderTargetRegistry -->
## `CjsToolShaderTargetRegistry`

Immutable registry of audited compiled-shader targets.

- Export: `@carbonenginejs/tools-core/shader`
- Source: `src/shader/CjsToolShaderTargetRegistry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolShaderBuilder -->
## `CjsToolShaderBuilder`

Shared Node orchestration for independently importable shader builders.

- Source: `src/shader/CjsToolShaderBuilder.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsToolShaderBuilderWebgl -->
## `CjsToolShaderBuilderWebgl`

Node orchestration for browser-complete CEWG conversion.

- Export: `@carbonenginejs/tools-core/shader`
- Source: `src/shader/CjsToolShaderBuilderWebgl.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolShaderBuilderWebgpu -->
## `CjsToolShaderBuilderWebgpu`

Node orchestration for browser-complete CEWGPU conversion.

- Export: `@carbonenginejs/tools-core/shader`
- Source: `src/shader/CjsToolShaderBuilderWebgpu.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSkin -->
## `CjsToolSkin`

Front-facing exact-build builders for offline SKIN and SKINR libraries.

- Export: `@carbonenginejs/tools-core/skin`
- Source: `src/skin/CjsToolSkin.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSkinBuilder -->
## `CjsToolSkinBuilder`

Builds the deterministic offline library for developer-authored SKINs.

- Export: `@carbonenginejs/tools-core/skin`
- Source: `src/skin/CjsToolSkinBuilder.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSkinrBuilder -->
## `CjsToolSkinrBuilder`

Builds the deterministic offline library for player-authored SKINR data.

- Export: `@carbonenginejs/tools-core/skin`
- Source: `src/skin/CjsToolSkinrBuilder.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolTarget -->
## `CjsToolTarget`

Immutable public target alias over one internal game/provider identity.

- Export: `@carbonenginejs/tools-core/target`
- Source: `src/target/CjsToolTarget.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolTargetRegistry -->
## `CjsToolTargetRegistry`

Immutable registry for short public target aliases.

- Export: `@carbonenginejs/tools-core/target`
- Source: `src/target/CjsToolTargetRegistry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolWeapon -->
## `CjsToolWeapon`

Front-facing exact-build builder for the offline weapon library.

- Export: `@carbonenginejs/tools-core/weapon`
- Source: `src/weapon/CjsToolWeapon.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolWeaponBuilder -->
## `CjsToolWeaponBuilder`

Builds the deterministic SDE-backed weapon and ammunition library.

- Export: `@carbonenginejs/tools-core/weapon`
- Source: `src/weapon/CjsToolWeaponBuilder.js`
- Visibility: Public
- Kind: CarbonEngineJS
