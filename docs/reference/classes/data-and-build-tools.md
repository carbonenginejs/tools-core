# Data and build-tool class catalog

Status: Evolving
Scope: `@carbonenginejs/tools-core` icon, schema, SDE, shader, skin, target, and weapon classes
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

<!-- class:CjsToolSdeBuildProfile -->
## `CjsToolSdeBuildProfile`

Defines immutable target-specific source, reader, projection, completeness, and named-derivation policy for the generic SDE builder.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeBuildProfile.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeBuildProfileRegistry -->
## `CjsToolSdeBuildProfileRegistry`

Registers independent target-keyed SDE build profiles, including Serenity and Infinity records carrying the same NetEase provider metadata.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeBuildProfileRegistry.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeTables -->
## `CjsToolSdeTables`

Assembles exact-build tables while checking one profile's known and required table policy.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeTables.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeBuild -->
## `CjsToolSdeBuild`

Writes assembled tables through `CjsToolSdeDatabase.ImportTables` and publishes profile-selected named derivations.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeBuild.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolFsdInspectReader -->
## `CjsToolFsdInspectReader`

Inspects modern 64-bit FSD/cFSD container structure without owning runtime decoding or reviewed schemas.

- Export: `@carbonenginejs/tools-core/fsd`
- Source: `src/fsd/CjsToolFsdInspectReader.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeLocalization -->
## `CjsToolSdeLocalization`

Combines exact-language localization pickle tables for target-profile SDE projections.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeLocalization.js`
- Visibility: Public
- Kind: CarbonEngineJS

<!-- class:CjsToolSdeLocalizationTable -->
## `CjsToolSdeLocalizationTable`

Indexes one decoded protocol-0 localization table for label lookup during SDE assembly.

- Export: `@carbonenginejs/tools-core/sde`
- Source: `src/sde/build/CjsToolSdeLocalizationTable.js`
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

## SDE derivations

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

## SDE DNA index

The inverse of DNA resolution: which ships and skins produce a given DNA, or any
part of one. Served by `GET /{target}/{build}/dna/search?q=`. `BuildDnaIndex`
owns the stored index shape and `QueryDnaIndex` owns record matching and
ranking.

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

Immutable public target identity carrying game/provider provenance metadata.

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

<!-- class:CjsToolIcons -->
## `CjsToolIcons`

Composes SDE icon records into loadable resource addresses.

- Export: `@carbonenginejs/tools-core/icons`
- Source: `src/icons/CjsToolIcons.js`
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

<!-- class:CjsToolEsiClient -->
## `CjsToolEsiClient`

Performs bounded authenticated ESI reads with injected refresh-token custody.

- Export: `None`
- Source: `src/auth/CjsToolEsiClient.js`
- Visibility: Internal
- Kind: CarbonEngineJS

<!-- class:CjsToolEveSso -->
## `CjsToolEveSso`

Implements local EVE SSO authorization-code flow with PKCE and no token storage.

- Export: `None`
- Source: `src/auth/CjsToolEveSso.js`
- Visibility: Internal
- Kind: CarbonEngineJS

<!-- class:CjsToolTokenFile -->
## `CjsToolTokenFile`

Provides private-file custody and rotation for one ESI OAuth refresh token.

- Export: `None`
- Source: `src/auth/CjsToolTokenFile.js`
- Visibility: Internal
- Kind: CarbonEngineJS

<!-- class:CjsToolBuildAuthority -->
## `CjsToolBuildAuthority`

Combines observed upstream builds with operator policy to resolve one served exact build and its reason.

- Export: `None`
- Source: `src/build/CjsToolBuildAuthority.js`
- Visibility: Internal
- Kind: CarbonEngineJS

<!-- class:CjsToolBuildObservations -->
## `CjsToolBuildObservations`

Persists an append-only log of exact builds observed from each target and facet.

- Export: `None`
- Source: `src/build/CjsToolBuildObservations.js`
- Visibility: Internal
- Kind: CarbonEngineJS

<!-- class:CjsToolBuildPolicy -->
## `CjsToolBuildPolicy`

Applies operator pins and holds to observed builds without performing discovery.

- Export: `None`
- Source: `src/build/CjsToolBuildPolicy.js`
- Visibility: Internal
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

<!-- class:CjsToolPublicEsi -->
## `CjsToolPublicEsi`

Performs bounded unauthenticated ESI reads for routes that carry no scopes.

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

<!-- class:CjsToolSkills -->
## `CjsToolSkills`

Builds direct and transitive exact-build skill requirements from SDE attribute pairs.

- Export: `@carbonenginejs/tools-core/skills`
- Source: `src/skills/CjsToolSkills.js`
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

Projects one SKINR payload into plain SOF pattern and DNA data.

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

<!-- class:CjsToolTypes -->
## `CjsToolTypes`

Composes one type identity with derived fields that the published SDE does not carry.

- Export: `None`
- Source: `src/types/CjsToolTypes.js`
- Visibility: Internal
- Kind: CarbonEngineJS
