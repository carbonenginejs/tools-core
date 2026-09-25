# Data and build-tool class catalog

Status: Evolving
Scope: `@carbonenginejs/tools-core` icon, schema, SDE, shader, skin, target, and weapon classes
Audience: Users, maintainers, and automated readers
Summary: Provides source-backed purpose descriptors for schema, data, build, target, and generated-library tooling.

<!-- class:CjsToolEsiClient -->
## `CjsToolEsiClient`

Authenticated ESI reads for the tools service.

- Export: `@carbonenginejs/tools-core`
- Source: `src/auth/CjsToolEsiClient.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolEveSso -->
## `CjsToolEveSso`

EVE SSO OAuth v2, authorization code with PKCE.

- Export: `@carbonenginejs/tools-core`
- Source: `src/auth/CjsToolEveSso.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolTokenFile -->
## `CjsToolTokenFile`

File custody for one OAuth refresh token.

- Export: `@carbonenginejs/tools-core`
- Source: `src/auth/CjsToolTokenFile.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolBuildAuthority -->
## `CjsToolBuildAuthority`

Which builds exist, which one a caller is served, and therefore which ones the cache keeps.

- Export: `@carbonenginejs/tools-core`
- Source: `src/build/CjsToolBuildAuthority.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolBuildObservations -->
## `CjsToolBuildObservations`

Persists an append-only log of exact builds observed from each target and facet.

- Export: `@carbonenginejs/tools-core`
- Source: `src/build/CjsToolBuildObservations.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolBuildPolicy -->
## `CjsToolBuildPolicy`

Applies operator pins and holds to observed builds without performing discovery.

- Export: `@carbonenginejs/tools-core`
- Source: `src/build/CjsToolBuildPolicy.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolDogma -->
## `CjsToolDogma`

Evaluates exact-build hull dogma attributes against an explicit skill profile with modifier traces.

- Export: `@carbonenginejs/tools-core/dogma`
- Source: `src/dogma/CjsToolDogma.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolDogmaProfile -->
## `CjsToolDogmaProfile`

Normalizes skill levels and provenance into the deterministic input for Dogma evaluation.

- Export: `@carbonenginejs/tools-core/dogma`
- Source: `src/dogma/CjsToolDogmaProfile.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolFitting -->
## `CjsToolFitting`

Joins parsed fitting text to exact-build type, category, and slot-effect data.

- Export: `@carbonenginejs/tools-core/fitting`
- Source: `src/fitting/CjsToolFitting.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolFsdInspectReader -->
## `CjsToolFsdInspectReader`

Inspects an FSD container without claiming a complete record layout.

- Export: `@carbonenginejs/tools-core/fsd`
- Source: `src/fsd/CjsToolFsdInspectReader.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIcons -->
## `CjsToolIcons`

Composes SDE icon records into loadable resource addresses.

- Export: `@carbonenginejs/tools-core/icons`
- Source: `src/icons/CjsToolIcons.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolPublicEsi -->
## `CjsToolPublicEsi`

ESI reads that carry no token, for the routes that need none.

- Export: `@carbonenginejs/tools-core/identity`
- Source: `src/identity/CjsToolPublicEsi.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolPublicIdentity -->
## `CjsToolPublicIdentity`

Resolves and briefly caches public character, corporation, and alliance identity observations.

- Export: `@carbonenginejs/tools-core/identity`
- Source: `src/identity/CjsToolPublicIdentity.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolIndustry -->
## `CjsToolIndustry`

Separates exact-build manufacturing inputs from reprocessing outputs for an SDE type.

- Export: `@carbonenginejs/tools-core/industry`
- Source: `src/industry/CjsToolIndustry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolLocalisation -->
## `CjsToolLocalisation`

Corroborates missing English type names across structurally matching target records.

- Export: `@carbonenginejs/tools-core/localisation`
- Source: `src/localisation/CjsToolLocalisation.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolMap -->
## `CjsToolMap`

Composes map documents for one open SDE source.

- Export: `@carbonenginejs/tools-core/map`
- Source: `src/map/CjsToolMap.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolMarketEsi -->
## `CjsToolMarketEsi`

Reads bounded, paginated regional market orders and attaches exact observed provenance.

- Export: `@carbonenginejs/tools-core/market`
- Source: `src/market/CjsToolMarketEsi.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolPlexRate -->
## `CjsToolPlexRate`

Maintains a non-blocking observed PLEX-to-ISK reference from the global order book.

- Export: `@carbonenginejs/tools-core/market`
- Source: `src/market/CjsToolPlexRate.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsFormatCarbon -->
## `CjsFormatCarbon`

CarbonEngineJS-facing Carbon format profile.

- Export: `@carbonenginejs/tools-core/schema`
- Source: `src/schema/CjsFormatCarbon.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeBuild -->
## `CjsToolSdeBuild`

Writes one profile-assembled table set through the canonical SDE database.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeBuild.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeBuildProfile -->
## `CjsToolSdeBuildProfile`

Immutable policy for assembling one target's exact-build SDE.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeBuildProfile.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeBuildProfileRegistry -->
## `CjsToolSdeBuildProfileRegistry`

Target-keyed registry of SDE source and output profiles.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeBuildProfileRegistry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeLocalization -->
## `CjsToolSdeLocalization`

Builds deterministic localized values across configured language fallback chains.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeLocalization.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeLocalizationTable -->
## `CjsToolSdeLocalizationTable`

Indexes one client localization pickle.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeLocalizationTable.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeTables -->
## `CjsToolSdeTables`

Assembles decoded and projected SDE tables for one exact target build.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeTables.js`
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

Acquires exact-build JSONL archives and prepares CjsToolSde input tables.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSdeArchive.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeDatabase -->
## `CjsToolSdeDatabase`

Exact-build SQLite store for every table in an official EVE SDE archive.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSdeDatabase.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeTable -->
## `CjsToolSdeTable`

Minimal paginated interface over one official EVE SDE table.

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

<!-- class:CjsToolSdeSource -->
## `CjsToolSdeSource`

Open exact-build SDE source used by service and direct callers.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/CjsToolSdeRepository.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolShaderBuilder -->
## `CjsToolShaderBuilder`

Shared Node orchestration for independently importable shader builders.

- Source: `src/shader/CjsToolShaderBuilder.js`
- Visibility: Internal
- Kind: CarbonEngineJS

<!-- class:CjsToolShaderBuilderWebgl -->
## `CjsToolShaderBuilderWebgl`

Node orchestration for browser-complete WebGL effect conversion.

- Export: `@carbonenginejs/tools-core/shader`
- Source: `src/shader/CjsToolShaderBuilderWebgl.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolShaderBuilderWebgpu -->
## `CjsToolShaderBuilderWebgpu`

Node orchestration for browser-complete WebGPU effect conversion.

- Export: `@carbonenginejs/tools-core/shader`
- Source: `src/shader/CjsToolShaderBuilderWebgpu.js`
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

<!-- class:CjsToolSkills -->
## `CjsToolSkills`

Builds direct and transitive exact-build skill requirements from SDE attribute pairs.

- Export: `@carbonenginejs/tools-core/skills`
- Source: `src/skills/CjsToolSkills.js`
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

<!-- class:CjsToolSkinrDesigns -->
## `CjsToolSkinrDesigns`

Harvests public SKINR design and listing observations from scope-free ESI routes.

- Export: `@carbonenginejs/tools-core/skin`
- Source: `src/skin/CjsToolSkinrDesigns.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSkinrPattern -->
## `CjsToolSkinrPattern`

Builds the SOF pattern and DNA for a SKINR skin payload.

- Export: `@carbonenginejs/tools-core/skin`
- Source: `src/skin/CjsToolSkinrPattern.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSkinrStore -->
## `CjsToolSkinrStore`

Persists durable SKINR design and listing observations outside prepared SDE databases.

- Export: `@carbonenginejs/tools-core/skin`
- Source: `src/skin/CjsToolSkinrStore.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolTarget -->
## `CjsToolTarget`

Immutable public target identity with game/provider provenance metadata.

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

<!-- class:CjsToolTypes -->
## `CjsToolTypes`

Composes one type identity with derived fields that the published SDE does not carry.

- Source: `src/types/CjsToolTypes.js`
- Visibility: Internal
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
