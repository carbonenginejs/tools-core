# @carbonenginejs/tools-core

`@carbonenginejs/tools-core` is the consolidated Node.js toolchain for
CarbonEngineJS. It provides independently importable modules for remote index
acquisition, one shared cache, prepared SDE identity joins, character-library
generation, SOF JSON graph construction, and optional local HTTP access.

This is tooling, not a browser runtime. Runtime packages never import it.

## Modules

```js
import { CjsToolCore } from "@carbonenginejs/tools-core";
import {
  CjsToolAudio,
  CjsToolAudioBuilder,
} from "@carbonenginejs/tools-core/audio";
import { CjsToolBlack } from "@carbonenginejs/tools-core/black";
import { CjsToolCache } from "@carbonenginejs/tools-core/cache";
import {
  CjsToolCharacter,
  CjsToolCharacterAssembler,
  CjsToolCharacterCompiler,
  CjsToolCharacterNormalizer,
  CjsToolCharacterSerializer,
} from "@carbonenginejs/tools-core/character";
import {
  CjsIndexOverlayStore,
  CjsToolIndex,
} from "@carbonenginejs/tools-core/index";
import {
  CjsSde,
  CjsSdeArchive,
  CjsSdeDatabase,
  CjsSdeRepository,
} from "@carbonenginejs/tools-core/sde";
import { CjsToolTargetRegistry } from "@carbonenginejs/tools-core/target";
import {
  CjsShaderTargetRegistry,
  CjsToolWebglBuilder,
  CjsToolWebgpuBuilder,
} from "@carbonenginejs/tools-core/shader";
import { CjsToolHttpProxy } from "@carbonenginejs/tools-core/proxy";
import { normalizeExactBuild } from "@carbonenginejs/tools-core/utils";
```

- `index` reads CCP-compatible app/res indexes for the `Eve` and `Frontier`
  game classifications, composes target-specific resource overlays, and
  retrieves validated bytes.
- `cache` owns the shared index, payload, and generated-output layout.
- `utils` owns shared low-level build, object, URL, response, byte-validation,
  freezing, and buffer operations used across the tool modules.
- `sde` acquires exact-build official JSONL archives and stores every table in
  one generic SQLite database. Minimal wrappers provide catalog, count, ID,
  pagination, and search access without requiring one class per table. The
  existing in-memory identity view still joins type, graphic, skin, and
  material-set records into SOF DNA.
- `black` reads `.black` resources (fetched through an `index` source) into
  public payload JSON via `@carbonenginejs/runtime-resource`'s `CjsBlackFormat`.
  It reads against **one checked-in schema snapshot**
  (`runtime-resource/src/formats/black/core/black-schema-v1-*.json`, generated
  from a `scripts/carbon-blue/convert.cjs --emit-schema` scan of a Carbon
  source tree) — there is no per-EVE-build schema selection. Requests against
  resources from a materially older or newer client build than the snapshot's
  source tree can fail to parse or silently misread fields if the binary
  layout drifted. Carbon-authored per-build schema versioning is possible
  (the scanner already emits build-scoped output) but intentionally not built;
  keep the snapshot reasonably current by re-running the scan instead.
- `audio` builds deterministic audio-library JSON from SoundbanksInfo,
  resfileindex records, and an optional plain-JSON metadata overlay.
  `CjsToolAudio` is the target-aware front door; `CjsToolAudioBuilder` exposes
  its stateless build, index parsing, and event-media table operations.
- `character` builds deterministic character-library JSON from prepared source
  files. `CjsToolCharacter` is its target-aware front door; the assembler,
  compiler, normalizer, and serializer expose focused stateless operations as
  static methods.
- `shader` catalogs exact provider/build-scoped source and compiled profile
  paths and provides independent WebGL/WebGPU Node builders. The format
  packages remain responsible for browser-safe whole-effect conversion.
- `proxy` is a small optional Node HTTP adapter over the core API.
- the root facade composes SDE identity resolution with `runtime-sof`'s
  device-free graph output. Plain model values (`BuildSofValues`) are the
  recommended boundary; the `carbon.document` node table remains available as
  an explicit compatibility/diagnostic format (`BuildSofDocument`).

## Target-specific library builders

Library builders are target-specific. A compatible app/res index format does
not mean that EVE, Frontier, and NetEase library inputs or outputs are
interchangeable. Every build must identify its target, provider, and exact
source build, and every input supplied to that build must come from the same
target/build. A builder must explicitly add support for a target before its
output is advertised for that target.

Shader builders must additionally declare their output profile. Profile
directories keep compiled effects disjoint: the current legacy runtime rewrites
`effect/**/*.fx` to `effect.gles2/**/*.sm_<quality>`. The shader builders use
the descriptive `effect.webgl2` and `effect.webgpu` profile names. CEWG and
CEWGPU are package formats, not public resource profiles. tools-core catalogs
the exact paths a builder emits and delegates conversion to the corresponding
format package.

At present, audio is enabled for `eve` and `frontier`; character is enabled
only for `eve`. `netease` library builders and Frontier character builds remain
disabled until each input contract has been audited.

The official downloadable SDE topic is enabled only for `eve`. Frontier has
client static-data resources and separate public data interfaces, but it is not
advertised as an EVE-style SDE target.

Current target identities are:

```text
eve       -> game Eve, provider ccp
frontier  -> game Frontier, provider ccp
netease   -> game Eve, provider netease
```

The audited Frontier WebGL2 shader target is `frontier-webgl2`. It maps exact
build `.sm_hi` resources from `res:/graphics/effect.dx11/...` to CEWG packages
at `res:/graphics/effect.webgl2/...`, preserving the managed path and quality
suffix. Its exact Frontier build catalog is separate from EVE's build-specific
WebGL2 catalog and does not alter EVE shader resolution.

```js
const shaderTarget = new CjsShaderTargetRegistry().Get("frontier-webgl2");
const catalog = shaderTarget.CreateCatalog([
  "res:/graphics/effect.dx11/managed/space/characters/standardpbr.sm_hi",
], { build: 3438337 });
```

`CreateCatalog` plans explicitly asserted source paths. Builders consuming an
opened resource index should use `CreateCatalogFromResolutions` instead; it
rejects mixed targets, games, providers, and builds before any output is
cataloged.

EVE additionally exposes `eve-webgl2` for `.sm_hi` and `.sm_depth` DX11
sources, and the incremental `eve-webgpu` target for qualified `.sm_hi` DX11
SM5.0 sources. WebGPU does not automatically substitute DX12 SM5.1 input. The
EVE WebGPU target records native comparison as pending audit. No Frontier
WebGPU target is registered yet; when its corpus is audited, its target policy
must require `native-hlslcc` qualification.

An offline resfileindex can be turned into the same deterministic source
inventory without fetching or converting payloads:

```powershell
npm run catalog:shader -- --index <resfileindex.txt> --shader-target frontier-webgl2 --build <exact-build> --out <catalog.json>
```

### Shader builds

The WebGL and WebGPU builders resolve `latest` once to an exact build, verify
the indexed size and MD5 of every `.sm_*` source, call the latest installed
format package's `buildEffect`/`inspect` APIs, stage an immutable report, and
optionally install a persistent resource overlay.

```powershell
npm run build:shader:webgl -- --shader-target eve-webgl2 --build latest --out <output>
npm run build:shader:webgpu -- --shader-target eve-webgpu --build latest --out <output>
```

Both commands accept repeated `--source` and `--quality` selections, a JSON
`--source-manifest` or `--conversion-policy`, bounded `--concurrency`,
`--qualification package|structural|native-hlslcc`,
`--dry-run`/`--catalog-only`, and `--diagnostic`. A command may strengthen but
not weaken its target's minimum qualification policy. For native qualification,
tools-core coordinates a format-owned qualifier and requires explicit HLSLcc
comparison evidence in the report; executable discovery and comparison logic
remain outside tools-core.

Outputs and overlays are immutable by default. An identical report is reused
safely. Agents may pass `--overwrite` or `--force` to transactionally replace
an unrelated output directory, `--replace-overlay` to transactionally replace
an existing named overlay, and `--no-reuse` to reject even an identical prior
output. These flags never authorize replacement of source `.sm_*` files.

Each shader CLI writes a complete JSONL event stream under `<out>/logs` by
default and prints lifecycle events plus periodic progress to stderr. Use
`--log <file>` to select the durable log, `--log-interval <count>` to control
console progress, and `--error-report <file>` to select the structured failure
report. Per-source failures include the logical paths, status, duration, and
normalized error; a failed run retains its deterministic build report inside
the error report even though staging is rolled back.

## Cache layout

Exact-build indexes include game and provider identity:

```text
<cache>/games/<game>/providers/<provider>/builds/<build>/indexes/<file-name>
```

Indexed payloads use the game-compatible content-addressed layout:

```text
<cache>/ResFiles/8f/8f44ee1a9a017bf2_<md5>
```

CCP and NetEase payloads can coexist because the storage name includes the
lowercase resource-path FNV-1 hash and content MD5. Game/provider/build
identity remains in cached index metadata. Generated outputs and databases use:

```text
<cache>/custom/games/<game>/providers/<provider>/builds/<build>/{name}_{version}.{extension}
```

For example:
`custom/games/eve/providers/ccp/builds/3435006/character_v1.json`.
The full EVE database is
`custom/games/eve/providers/ccp/builds/3435006/sde_v1.sqlite`.

Existing installations may still use a cache root directory named
`tool-core`. That directory name is retained as the v1 on-disk compatibility
location; it is independent of the `tools-core` package identity.

## Persistent resource overlays

Target-specific resource overlays use resfileindex-compatible records without
changing ccpwgl resource paths. They live under a separate persistent root:

```text
<data>/games/<target>/overlays/<name>/overlay.json
<data>/games/<target>/overlays/<name>/resfileindex.txt
<data>/games/<target>/overlays/<name>/res/<logical-path>
```

This directory is not the shared cache and must not be removed by cache
cleanups. It is also ignored by Git because preserved game payloads and local
manifests are not package source. The resolver uses the small part of the old
resource artifact model needed here:

- `local-exact` artifacts mirror their public `res:/` logical paths under
  `<data>` and read checksum-validated payloads directly from that dedicated
  location. Their identity is the controlled target/overlay/path, not a hash;
- `hash-safe` official and remote artifacts retain indexed checksums and may
  download validated payloads through the disposable shared cache.

Shader conversion remains an explicit CLI/library operation. tools-core does
not expose request-triggered conversion queues or derived-artifact state in the
HTTP service.

Resolution checks generated/override overlays first, then the official index,
then fallback overlays. An explicit `indexName` still selects one official or
overlay index. The local EVE store currently preserves the legacy GLES2 shader
set as additive `local-exact` files. ccpwgl rewrites authored
`res:/graphics/effect/**/*.fx` paths to the selected profile and quality, such
as `res:/graphics/effect.gles2/**/*.sm_hi`; those rewritten paths are the ones
inserted into the resource view. Requests use ordinary paths such as
`/eve/latest/res/graphics/effect.gles2/...`; callers never see the overlay name
or a content-addressed hash. The store also registers
Incarna/walking-in-stations assets as a remote fallback. Future compiled shader
outputs should use their builder-selected profile paths, preferably
`res:/graphics/effect.webgl2/...` or `res:/graphics/effect.webgpu/...`, rather
than a shared `res:/synthetic` namespace.

The local EVE store also contains the existing 62-package CEWG v1 corpus under
the public `effect.webgl2` profile: 34 `.sm_hi` and 28 `.sm_depth` resources,
available only for DX11 source build 3430261. Each package's embedded source
path supplied its managed subdirectory and quality suffix; only the profile
segment changed from `effect.dx11` to `effect.webgl2`. CEWG remains the package
format and never appears as the public resource profile.

## Local service

`cjs-tools-service` starts a loopback-only, bearer-authenticated HTTP service
for desktop clients such as Blender. It selects an available port by default
and writes one JSON bootstrap record to stdout containing the port, token,
protocol version, cache directory, persistent data directory, and enabled
capabilities.

The service exposes versioned health, exact resource resolution, validated
resource fetch-to-cache endpoints, and generic EVE SDE reads. SOF composition
is available through `CjsToolHttpProxy` when the caller injects a fully
prepared core facade: `/v1/sof/values` (capability `sofValues`, recommended)
returns plain model values, and `/v1/sof/document` (capability `sofDocument`,
compatibility/diagnostic) returns the explicit `carbon.document`. The
standalone launcher does not claim SOF capabilities until that exact-build
runtime bootstrap is configured.

The canonical public route shape is:

```text
/{target}/{build}/{topic}[/{path}]
```

Implemented target routes include:

```text
GET /targets
GET /eve/latest/build
GET /frontier/latest/build
GET /frontier/latest/res
GET /eve/<exact-build>/res/<path>
GET /netease/<exact-build>/app/<path>
GET /eve/<build>/billboards
GET /eve/<build>/nebulas
GET /eve/<build>/cubes
GET /eve/<build>/sof/hulls/<hull>/respathinserts
POST /eve/<build>/sof/hulls/<hull>/respathinserts/<insert>/resolve
GET /eve/latest/sde
GET /eve/<sde-build>/sde/<table>?limit=100&offset=0
GET /eve/<sde-build>/sde/<table>/<id>
GET /eve/<sde-build>/sde/<table>?query=<text>
GET /eve/<sde-build>/sde/<table>?field=groupID&value=25
GET /eve/<sde-build>/sde/skins?field=types&contains=587
GET /eve/<sde-build>/sde/resolve?typeID=587&skinID=<skin-id>
```

An `app` or `res` topic without a path resolves the build and returns its exact
resource URL template. With a path it returns the validated indexed bytes.
Appending `?format=json` to a `.black` resource path (e.g.
`GET /eve/<exact-build>/res/dx9/model/spaceobjectfactory/hulls/<hull>.black?format=json`)
returns the resource already converted to public payload JSON via the `black`
module instead of raw bytes; any other extension with `format=json` returns
`415`. This shares the `black` module's single-schema-snapshot caveat above —
converting a resource from a build far from the snapshot's source tree can
fail or silently misread fields. The expanded
`/games/{game}/providers/{provider}/builds/{build}` build route is retained as
a compatibility alias.

The billboard, nebula, and cube routes return sorted arrays of complete
`res:/` paths from the composed exact-build resource view. The SOF respath
insert GET route returns names proven by matching base and inserted hull
material maps; faction `_fn` hulls also inherit the corresponding `_t1`
answers. The resolve POST accepts `{ "paths": [...] }` and returns a positional
array of normalized paths. For each caller-supplied hull or shared-resource
path, it inserts the selected name as both the parent folder and the final
filename component before the texture suffix, returns that candidate only when
it exists in the composed index, and otherwise returns the original path.
`effect` and `effects` folders are intentionally left unchanged. Response
headers expose the exact resolved build even when the request used `latest`.

The built-in Frontier profile uses the `stillness` client. Its public build
metadata and exact app manifest use the same resolver interface as EVE. When
CCP marks app-side index payloads as protected, full `ReadIndexes`/`Open`
operations require a caller-supplied authenticated Fetch implementation.

An SDE `latest` reference resolves independently against CCP's SDE channel, so
it may differ from the latest app/res build. By default the service only opens
prepared databases. Pass `--sde-auto-prepare` to download and build a missing
database on its first request.

```powershell
npm run service -- --cache <cache> --data <persistent-data>
```

## EVE SDE and SOF graph output

Prepare the current official EVE SDE once into the shared cache:

```powershell
npm run prepare:sde -- --cache <cache>
```

For a pinned build, pass `--build <exact-build>`. The command writes
`custom/games/eve/providers/ccp/builds/<build>/sde_v1.sqlite`, containing every
JSONL table in that archive plus exact source provenance and row counts. The
import is transactional: an invalid replacement leaves the prior database
intact.

Library callers can keep latest-build policy separate from exact acquisition:

```js
const archive = new CjsSdeArchive();
const latest = await archive.ResolveLatest();
const database = await archive.PrepareDatabase({
  ...latest,
  databasePath: "<cache database path>",
});
const types = database.Table("types");
const rifter = await types.Get(587);
const frigates = await types.Find("groupID", 25);
const prepared = await database.LoadTables([
  "types",
  "graphics",
  "skins",
  "skinMaterials",
  "skinLicenses",
  "materialSets",
  "graphicMaterialSets",
]);
const sde = new CjsSde(prepared);
```

Fetched archives, SQLite files, WAL files, indexes, and cache output are
game-derived artifacts and must not be committed. Only deliberately selected,
compact internal library JSON outputs belong in source control.

```js
const core = new CjsToolCore({ sde, sof });
const dna = core.ResolveDna({ typeID: 587, skinID: 1234 });

// Recommended: plain model values — the same JSON-compatible graph a hydrated
// root's GetValues({ refs: true, typeTags: true }) returns. Nested values with
// `_type` on polymorphic nodes and `_id`/`_ref` only for shared identity.
// Hydrate with `EveShip2.from(values)` (or the `_type`-selected class) against
// the runtime-trinity registry.
const values = core.BuildSofValues(dna);

// Compatibility/diagnostic: the explicit carbon.document node table, for graph
// tooling that genuinely needs detached nodes, fragment import, or lossless
// unknown fields.
const document = core.BuildSofDocument(dna);
```

The SDE subpath also exposes the joins directly:

```js
const candidates = sde.LookupName("Rifter");
const normalizedCandidates = sde.SearchName("test-skin");
const type = sde.ResolveType(587);
const graphicDna = sde.ResolveGraphicDna(type.graphicID);
const skinDna = sde.ResolveSkinDna(1234, 587);
```

`LookupName()` retains every deterministic candidate. `ResolveName()` and
name-based `ResolveDna()` reject ambiguous names. A bare SkinID resolves when
its eligible TypeIDs collapse to one GraphicID; otherwise the caller must also
provide a TypeID.

`SearchName()` and `ResolveSearchName()` are the explicit punctuation/spacing
normalization path. They fold separators such as spaces, hyphens, and
underscores but retain every resulting candidate and still reject ambiguity.

`BuildSofValues` hydrates a fresh runtime-trinity graph internally and exports
it, so it needs the `runtime-trinity` dependency (registered lazily, or inject
`options.sofRegistry`). `BuildSofDocument` returns the complete `runtime-sof`
`carbon.document` without touching `runtime-trinity`; it is the specialized
graph/diagnostic path, not the default tool boundary.

## Commands

```powershell
npm run start -- --target:eve --build:latest
npm run start -- --target:frontier --build:latest
npm run service -- --cache <cache>
npm run service -- --cache <cache> --data <persistent-data>
npm run service -- --cache <cache> --sde-auto-prepare
npm run prepare:sde -- --cache <cache> [--build <exact-build>]
npm run build:audio -- --index <resfileindex.txt> --cache <cache> --soundbanksinfo <file-or-res-path> --out <library.json> --target <eve|frontier> --build <build> [--enrichment <audio-metadata.json>]
npm run build:character -- --index <resfileindex.txt> --cache <cache> --out <library.json> --target eve --build <build>
npm run catalog:shader -- --index <resfileindex.txt> --shader-target frontier-webgl2 --build <build> --out <catalog.json>
npm run export:character -- <catalogs.json> --out <library.json>
npm run check
```

The baseline check is offline. Index tests inject fetch implementations and use
synthetic records; private game data, credentials, an installed client, and a
GUI are not required.

## Safety and provenance

The repository contains code and synthetic fixtures only. Caches, persistent
local overlays, fetched EVE indexes/payloads, and generated game-derived
outputs are ignored by Git and must not be committed. CarbonEngine and Fenris
Creations (CCP Games) are named for interoperability and provenance context;
this project is not affiliated with or endorsed by them. See `LICENSE` and
`NOTICE`.
