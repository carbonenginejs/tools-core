# Build generated libraries

Status: Stable  
Scope: `@carbonenginejs/tools-core` library builders  
Audience: Build operators and Node.js integrators  
Summary: Explains exact-build library preparation, supported targets, outputs, and safety rules.

## Contract

Every build identifies one target, provider, and exact source build. A friendly
name such as `latest` resolves once before inputs are opened. Inputs from
different targets or builds must not be combined.

Current support is:

| Library | EVE | Frontier | Serenity / Infinity |
| --- | --- | --- | --- |
| Audio | Supported | Supported | Not audited |
| Character | Supported | Not audited | Not audited |
| SKIN/SKINR | Supported | Not audited | Not audited |
| Weapons | Supported | Not audited | Not audited |
| Official JSONL SDE | Supported | Not applicable | Not audited |

## Commands

```powershell
npm run prepare:sde -- --cache <cache> [--build <exact-build>]
npm run build:audio -- --index <resfileindex.txt> --cache <cache> --soundbanksinfo <file-or-res-path> --target <eve|frontier> --build <build> [--out <library.json>] [--enrichment <audio-metadata.json>] [--event-media] [--sfx] [--music] [--language <bcp47-tag>]
npm run build:character -- --documents <documents.json> --catalog-inputs <catalog-inputs.json> --index <resfileindex.txt> --cache <cache> --target eve --build <build> [--out <library.json>]
npm run build:skins -- --cache <cache> --build <build|latest> [--auto-prepare]
npm run build:weapons -- --cache <cache> --build <build|latest> [--auto-prepare]
npm run catalog:shader -- --index <resfileindex.txt> --shader-target frontier-webgl2 --build <build> --out <catalog.json>
npm run build:shader:webgl -- --shader-target eve-webgl2 --build latest --out <output>
npm run build:shader:webgpu -- --shader-target eve-webgpu --build latest --out <output>
```

The SDE import is transactional and stores every archive table in one
exact-build SQLite database. SKIN, SKINR, and weapon builders consume that
prepared database. Generated JSON libraries have deterministic gzip siblings
whose decompressed bytes equal the canonical JSON.

## Targets whose SDE you have to generate first

`eve` acquires its SDE, and `prepare:sde` fetches it. **`serenity` and
`infinity` have no published SDE**, so for those targets an SDE exists only
because someone generated one, and everything on this page then works the same
way against it. Generating one is not this package's job and belongs to the
tooling that owns it; this package consumes the result and asks nothing about
how it was produced.

Whatever produced it, write it into the shared cache and every command below
finds it:

```
<cache>/custom/targets/<target>/builds/<build>/sde_v1.sqlite
```

### Then the libraries

```powershell
npm run build:skins -- --target serenity
npm run build:weapons -- --target serenity
```

**Neither `--cache` nor `--build` is needed, and both are better left off.** The
cache root comes from `CJS_TOOL_CACHE` in `.env`, and the build is read from the
database the tool opens rather than asserted by the caller — so it cannot
disagree with the SDE it was built from. `--build latest` on a generated
target means *the newest SDE prepared on disk for this target*, not the newest
client build.

Audited for the generated-SDE targets as of 2026-08-16: **skin, skinr and
weapons**. `audio`, `character` and `shader` are not — none is SDE-backed, and
the character readers pin one build's contents. `defaultTargets.js` enforces
that, so an unaudited builder refuses rather than producing something plausible.

### When to run them

**When the artifact you need is not there.** These builders are not incremental:
each rebuilds and overwrites its output every time, so re-running is safe but not
free, and there is nothing to re-run after a build that already produced what you
want.

Derivations behave differently and more carefully. `prepare:sde` writes them
beside the database — `dnaIndex_v2.json` is the reverse lookup from a DNA string
back to its parts — and each one **declares the tables it needs and is skipped,
with a warning, when the SDE lacks them**. A partial SDE therefore degrades
to fewer derivations rather than failing, or writing an empty artifact over a
good one. `dnaIndex` needs `types`, `graphics`, `skins`, `skinMaterials` and
`skinLicenses`; `mapIndex` needs `mapSolarSystems` and `mapStargates`.

`npm run prepare:sde -- --refresh` recomputes derivations for a database already
on disk, rather than re-acquiring or regenerating the SDE.

### The one trap worth naming

**`--cache .cache` is not the cache root.** The root is `.cache/tool-core`, so a
plausible-looking argument silently builds a parallel empty tree, and the tool
then reports `No serenity SDE is prepared` — which reads as missing data rather
than a wrong path. Leaving `--cache` off avoids the whole class of mistake, which
is why the entry points read `.env`.

## Library shapes

When `--out` is omitted, the audio and character builders install
`audio_v2.json` or `character_v9.json` and its deterministic gzip sibling into
the shared exact-build custom cache. Those are the preferred locations used by
their repositories and local HTTP routes. An explicit `--out` remains
available for distribution builds and other application-owned publication.

Audio builds join SoundbanksInfo, indexed audio paths, and an optional
plain-JSON enrichment. Schema v2 identifies every bank by its
`bankID:languageID` pair, so language variants no longer collapse to one
basename. It keeps the canonical BCP-47 `language` separately from the
SoundbanksInfo `authoredLanguage`; repeated loose or embedded media IDs retain
their source variants. `eventMedia` and `embeddedMedia` are added only when
event-media, SFX, or music construction is requested; without them the result
is a source catalog rather than a complete event-to-playable-media index.
Embedded items are classified as `wem`, `midi`, `plugin`, or `unknown` from
their bank bytes.

SoundbanksInfo remains the public primary metadata source. Optional enrichment
accepts a caller-owned plain JSON document containing `Events`, `SoundBanks`,
and `WemFileIDs` maps. Tools-core does not acquire or decode private metadata
formats; enrichment only adds culling, stop-relation, and essential flags
without changing acquisition ownership.

The deterministic audio-library join is implemented by
`@carbonenginejs/runtime-audio/library-builder`. Tools-core supplies target validation,
exact-build acquisition, shared-cache reads, CLI output, and service routes
through its `CjsToolAudioBuilder` wrapper. Browser applications may call the
same optional builder with already acquired values and injected bank access,
or skip it by downloading the complete result.

Localized HIRC objects reuse IDs, so event-media and authored SFX graphs cannot
safely union every language. `--language` selects both graph inputs and is
recorded as `eventMediaLanguage`; it defaults to `en-us`. All bank and media
source variants remain in the v2 catalog, while graph references contain only
IDs from the selected language plus shared non-localized banks.

`--sfx` implies event-media construction and adds the conservative authored
SFX graph supported by runtime-audio. HIRC decoding remains owned by
runtime-resource; unsupported actions, continuous containers, transitions,
and unresolved partial-bank references are omitted whole rather than silently
approximated.

`--music` implies event-media construction and reads each cached bank once. It
requires `common.bnk`, `music.bnk`, and `music_essential.bnk`, then adds the
dynamic `music` graph to the same v2 document. The graph contains music nodes,
play and stop event targets, and switch/state setter actions. Its HIRC payload
decoding is delegated to `@carbonenginejs/runtime-resource`; tools-core owns
the cache read and transactional artifact replacement. The runtime-audio
builder rejects parse failures, missing child nodes, and missing track media
before either JSON artifact is replaced. `--sfx` and `--music` may be combined
in one complete library.

`CjsToolAudio` is the target-aware public front door, while
`CjsToolAudioBuilder` permits unscoped synthetic/intermediate values.
`CjsToolAudioRepository` opens the prepared document and exact indexed build
together; `CjsToolAudioSource` accepts schema v2, validates the music
contract, and resolves prepared or loose media and embedded bank windows
without making the HTTP adapter understand WEM or BNK codecs.

### Optional individual bank media

`CjsToolAudioRepository` accepts `materializeMedia: true`. During preparation
it copies each extractable embedded WEM window into the shared content-addressed
cache and installs a hash-safe exact-build `audio` resfileindex group. Generated
members use
`res:/audio/bnk/<bankID>/<languageID>/<mediaID>.wem`; the installed library
retains the original embedded-bank range as a fallback while preferring the
individual source. Non-WEM DIDX members remain embedded.

The generated group records source-bank paths, content addresses, identities,
and the media-generator version. A changed bank address or generator version
regenerates the affected group. Generated paths are fallback declarations and
cannot replace an official resource with the same path. The local service
exposes this opt-in as `--audio-individual-media`.

Character builds require source-neutral JSON containing the twelve direct
document maps. A separate catalog-input manifest can provide decoded
definition values, already model-shaped profiles, sparse part-source authoring
inventories, or a combination of those inputs. Decoded definitions are keyed
by their indexed logical paths. Every supplied decoded definition is retained
losslessly as JSON in `characterDefinitions`; the compiler fails rather than
silently dropping one. It additionally attempts to recognize exact three- and
four-value `.type` arrays and joins successful typed projections to the supplied
`characterResources` document. It reads no source bytes and does not know how
the JSON was decoded.

An exact `metadata.yaml` definition below a supported sex-specific character
root receives a second additive projection when its decoded JSON matches the
public character-part metadata fields. The original definition remains
unchanged, including the authored `dependantModifiers` spelling. The typed
`characterPartMetadata` record uses the runtime model's
`dependentModifiers` spelling, retains the strings in authored order, and
links to the exact baseline or ordinary `v<number>` owner folder. A metadata
folder that has no selectable `.type` becomes a metadata-only part source so
its indexed configuration, geometry, and texture candidates remain available.
An unknown or malformed metadata shape remains only in
`characterDefinitions` and is recorded as a non-fatal projection error.

The definition compiler retains the exact decoded value for every indexed
definition. Its typed `.type` projection retains the fourth value as `bloodlineIDs`
without assigning availability semantics. It keeps every exact definition
path and source folder, preserves separate sex-specific part sources when one
published resource path is shared, and inventories only direct source files
and ordinary `v<number>` child folders. Configuration, geometry, and image
paths remain unordered candidates: no model family, LOD selection, texture role, or
material meaning is inferred. A malformed, newly shaped, or conflicting
`.type` value remains in `characterDefinitions`; its optional typed projection
is omitted atomically and recorded in `projectionErrors` instead of aborting
the retained-source library.

Model-shaped profiles name their target document and indexed logical path;
part sources name their record identity, baseline metadata relationship, and
versioned configuration, geometry, and texture candidates. A version may omit
one of those candidate fields to inherit that role from the single
`resourceVersion: null` record; an explicit empty array means no candidates.
Version metadata uses the same field-presence rule. Duplicate resource-version
records reject. Tools-core materializes complete effective version records,
checks candidates against the caller-selected resource index, and decodes
available Black configurations to retain each unique authored mesh geometry
relationship as a model bundle. The bundle must point back into the same
version's retained geometry inventory; all candidates remain present. When the
paired configuration and geometry paths carry the same terminal `_lod<number>`
identity, the producer also retains that derived number with
`lodOrigin: "matching-terminal-lod"`. This labels a selectable relation without
choosing it or inventing a nearest-detail fallback. Matching normalized paired
resource stems are retained separately as `modelFamily`, with
`modelFamilyOrigin: "matching-paired-resource-stem"`; the producer still does
not choose among families. Tools-core then delegates
the combined schema-v10 document to
`@carbonenginejs/runtime-character/library-builder`.
The manifest is required by the command; use an empty JSON object when no
optional catalog records are available.

The build command also accepts an existing prepared character library as its
document input. It hydrates the existing graph, adds the gathered metadata
records through the library's ordinary mutation API, and serializes the same
graph at the current schema version. When no replacement `partSources`
manifest is supplied, the existing effective part-source records drive
texture-metadata gathering. This is the lossless schema migration path; it
does not recreate relationships or infer source definitions.

The gathered part-source records retain exact configuration, geometry, and
texture candidate paths plus effective metadata relationships. A caller can
declare metadata-only sources even when no selectable type names them. The
compiler also creates those sources for exact decoded `metadata.yaml` owner
folders. Schema v9 retains each dependency and occlusion string and adds an
ordered modifier-reference record beside it. An unsuffixed safe path can link
to a unique modifier location, an existing part source, or a source folder
proved by direct indexed candidates. Suffixed values remain opaque, and no
reference fabricates resource-version or rendering policy. The
producer does not select a model family,
infer material or projection links, compile recipe
selections, or embed external asset bytes. The runtime library hydrates the
same combined JSON shape; configuration graphs, geometry, images, animations,
and effects remain resource-manager inputs.

Programmatic callers may use
`CjsToolCharacterDefinitionCompiler.compile(index, { definitions,
characterResources })` directly. `definitions` is an ordinary JSON object
keyed by resource path; `characterResources` accepts either a keyed document
map or its record array. The result contains lossless `characterDefinitions`,
model-shaped `partTypes` and `partMetadata`, sparse `partSources`, and a report
listing retained, projected, unprojected, and dropped counts alongside
unlinked definitions, non-fatal typed `projectionErrors`, unresolved resource
paths, multi-source identities, multi-folder sources, projected metadata, and
exact candidate counts. Passing the same inputs to
`CjsToolCharacterCatalogGatherer.Gather()` also materializes the sparse
versions for immediate library building.

The gatherer examines the exact PNG representation for every `.dds` or `.png`
texture candidate. The command acquires a missing indexed PNG through
tools-core's normal exact-build resource source and validated shared `ResFiles`
cache; it does not add a character-specific downloader. `.dds` and `.png`
candidates share one extension-neutral metadata identity, and the corresponding
`.png` is inspected with runtime-resource's `CjsPngFormat.inspect`. Exact raw
`oFFs`/`pHYs` values and units are retained in `characterTextureMetadata`.
Normalized millionths values are additive and labelled experimental character
policy. The original DDS or PNG candidate is never removed or rewritten. A
PNG representation absent from the selected build remains explicit in the
build report; a failed indexed acquisition fails publication rather than
silently producing an incomplete metadata catalog.

Programmatic gatherers accept either an opened exact-build source exposing
`Fetch(path)` or a lazy source factory. Omitting it keeps the gatherer
cache-only for offline and synthetic builds; uncached PNGs are then reported
as cache misses instead of being invented or downloaded through another path.

SKIN and SKINR are separate exact-source libraries. SKIN owns developer-authored
skin/material/type relations; SKINR owns component, slot, ship-tree, and
slot-configuration relations. Neither republishes complete external type
records.

Weapon builds join weapon TypeIDs to graphics and resource paths, then use
dogma charge groups and sizes for ammunition compatibility. The official
launcher projectile catalog remains separate because filenames do not prove an
ammunition-to-projectile TypeID relation.

## JavaScript composition

```js
import { CjsSde, CjsSdeArchive } from "@carbonenginejs/tools-core/sde";

const archive = new CjsSdeArchive();
const exact = await archive.ResolveLatest();
const database = await archive.PrepareDatabase({
    ...exact,
    databasePath: "<cache database path>",
});
const sde = new CjsSde(await database.LoadTables([
    "types",
    "graphics",
    "skins",
    "skinMaterials",
    "skinLicenses",
    "materialSets",
    "graphicMaterialSets",
    "groups",
]));
```

`materialSets` and `groups` are **optional**: an SDE lacking either still
prepares rather than failing, because each is wanted by one consumer rather than
by the resolution everything shares. `groups` carries `categoryID`, which is what
separates a ship from its blueprints and from the NPC entities flying the same
hull.

The root `CjsToolCore` facade may then resolve identity to SOF DNA.
`BuildSofValues()` returns the recommended plain runtime model values;
`BuildSofDocument()` returns the explicit `carbon.document` node table for
diagnostic or graph tooling.

## Shader outputs

Shader builders catalog exact `.sm_*` sources, validate size and MD5, delegate
whole-effect conversion to the owning format package, and stage immutable
reports and overlays. Public output profiles are `effect.webgl2` and
`effect.webgpu`; CEWG and CEWGPU are package formats, not resource profiles.
Missing inputs remain missing and are never concealed by a legacy fallback.

## Reproducibility and safety

Fetched archives, SQLite/WAL files, indexes, generated reports, and game-derived
cache output must remain ignored. Only deliberately selected compact libraries
may be published. Supply a fixed `generatedAt` value when byte-for-byte audio
reproducibility is required.
