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

<!-- class:CjsSde -->
## `CjsSde`

Thin in-memory join layer for prepared EVE SDE identity tables.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsSde.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsSdeArchive -->
## `CjsSdeArchive`

Acquires exact-build CCP JSONL archives and prepares CjsSde input tables.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsSdeArchive.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsSdeDatabase -->
## `CjsSdeDatabase`

Exact-build SQLite store for every table in an official EVE SDE archive.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsSdeDatabase.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsSdeTable -->
## `CjsSdeTable`

Minimal paginated interface over one official EVE SDE table.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsSdeDatabase.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsSdeRepository -->
## `CjsSdeRepository`

Resolves target/build SDE requests to exact cached SQLite databases.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsSdeRepository.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsSdeSource -->
## `CjsSdeSource`

Open exact-build SDE source used by service and direct callers.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsSdeRepository.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsShaderTarget -->
## `CjsShaderTarget`

Immutable compiled-shader target over one public game target and profile.

- Export: `@carbonenginejs/tools-core/shader`
- Source: `src/shader/CjsShaderTarget.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsShaderTargetRegistry -->
## `CjsShaderTargetRegistry`

Immutable registry of audited compiled-shader targets.

- Export: `@carbonenginejs/tools-core/shader`
- Source: `src/shader/CjsShaderTargetRegistry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolShaderBuilder -->
## `CjsToolShaderBuilder`

Shared Node orchestration for independently importable shader builders.

- Source: `src/shader/CjsToolShaderBuilder.js`
- Visibility: Internal
- Kind: Internal implementation

<!-- class:CjsToolWebglBuilder -->
## `CjsToolWebglBuilder`

Node orchestration for browser-complete CEWG conversion.

- Export: `@carbonenginejs/tools-core/shader`
- Source: `src/shader/CjsToolWebglBuilder.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolWebgpuBuilder -->
## `CjsToolWebgpuBuilder`

Node orchestration for browser-complete CEWGPU conversion.

- Export: `@carbonenginejs/tools-core/shader`
- Source: `src/shader/CjsToolWebgpuBuilder.js`
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
