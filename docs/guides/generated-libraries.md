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

| Library | EVE | Frontier | NetEase |
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

## Library shapes

When `--out` is omitted, the audio and character builders install
`audio_v2.json` or `character_v5.json` and its deterministic gzip sibling into
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

Character builds require source-neutral JSON containing the twelve direct
document maps. A separate catalog-input manifest declares cached model-shaped
JSON records and exact part-source candidate arrays. Each profile names its
target document and indexed logical path; part sources name their record
identity, metadata relationship, and versioned configuration, geometry, and
texture candidates. Tools-core neither converts source-specific record shapes
nor infers records from filenames or folders. It copies declared JSON records,
preserves candidate order, checks candidates against the caller-selected
resource index, and delegates the combined schema-v5 document to
`@carbonenginejs/runtime-character/library-builder`.
The manifest is required by the command; use an empty JSON object when no
optional catalog records are available.

The gathered part-source records retain exact configuration, geometry, and
texture candidate paths. A caller can declare metadata-only sources even when
no selectable type names them. The producer does not select a model family,
pair detail levels, infer material or projection links, compile recipe
selections, or embed external asset bytes. The runtime library hydrates the
same combined JSON shape; configuration graphs, geometry, images, animations,
and effects remain resource-manager inputs.

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
]));
```

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
