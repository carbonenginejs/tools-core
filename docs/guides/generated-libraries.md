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
npm run build:audio -- --index <resfileindex.txt> --cache <cache> --soundbanksinfo <file-or-res-path> --target <eve|frontier> --build <build> [--out <library.json>] [--enrichment <audio-metadata.json>] [--event-media] [--music] [--language <bcp47-tag>]
npm run build:character -- --index <resfileindex.txt> --cache <cache> --out <library.json> --target eve --build <build>
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

When `--out` is omitted, the audio builder installs `audio_v2.json` and its
deterministic gzip sibling into the shared exact-build custom cache. That is
the preferred location used by `CjsToolAudioRepository` and the local audio
HTTP routes. The repository still opens an existing `audio_v1.json` when v2 is
not prepared; v1 documents are not rewritten. An explicit `--out` remains
available for distribution builds and other application-owned publication.

Audio builds join SoundbanksInfo, indexed audio paths, and an optional
plain-JSON enrichment. Schema v2 identifies every bank by its
`bankID:languageID` pair, so language variants no longer collapse to one
basename. It keeps the canonical BCP-47 `language` separately from the
SoundbanksInfo `authoredLanguage`; repeated loose or embedded media IDs retain
their source variants. `eventMedia` and `embeddedMedia` are added only when
event-media construction is requested; without them the result is a source
catalog rather than a complete event-to-playable-media index. Embedded items
are classified as `wem`, `midi`, `plugin`, or `unknown` from their bank bytes.

SoundbanksInfo remains the public primary metadata source. A caller may decode
`audiometadata.fsdbinary` with the private `tool-fsd` reader, convert its three
maps (`Events`, `SoundBanks`, and `WemFileIDs`) to plain JSON, and pass that
file through `--enrichment`. Tools-core does not import the private reader;
the enrichment adds culling, stop-relation, and essential flags without
changing acquisition ownership.

Localized HIRC objects reuse IDs, so one event graph cannot safely union every
language. `--language` selects the event graph language and is recorded as
`eventMediaLanguage`; it defaults to `en-us`. All bank and media source
variants remain in the v2 catalog, while each `eventMedia` entry contains only
IDs from the selected language plus shared non-localized banks.

`--music` implies event-media construction and reads each cached bank once. It
requires `common.bnk`, `music.bnk`, and `music_essential.bnk`, then adds the
dynamic `music` graph to the same v2 document. The graph contains music nodes,
play and stop event targets, and switch/state setter actions. Its HIRC payload
decoding is delegated to `@carbonenginejs/runtime-resource`; tools-core owns
the deterministic artifact assembly and rejects parse failures, missing child
nodes, and missing track media before replacing either JSON artifact.

`CjsToolAudio` is the target-aware public front door, while
`CjsToolAudioBuilder` permits unscoped synthetic/intermediate values.
`CjsToolAudioRepository` opens the prepared document and exact indexed build
together; `CjsToolAudioSource` accepts v1 and v2, validates the v2 music
contract, and resolves prepared or loose media and embedded bank windows
without making the HTTP adapter understand WEM or BNK codecs.

Character builds preserve CarbonEngineJS part identity, selectable type
identity, categories, authoring data, and atomic LOD bundles. Prepared
`recipeLinks` keep each preset entry explicitly resolved, ambiguous, or
unresolved; the compiler never guesses one candidate from an ambiguous
authored selection.

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
