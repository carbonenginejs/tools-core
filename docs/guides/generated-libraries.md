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
| Weapons | Supported | Visual turret catalog | Supported |
| Official JSONL SDE | Supported | Not applicable | Not audited |

## Commands

Frontier's client-generated SDE includes `marketGroups` and `typeDogma`.
Build it with `cjs-sde-build --target frontier --build <exact-build> --out <database>`
and place the database under that target/build's SDE cache before running
`build:weapons -- --target frontier --build <exact-build>`. Its visual catalog
selects published weapon/extractor Module groups with authored graphics;
market membership is optional. Projectile graphics and complete game fitting
restrictions are not inferred from EVE.

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

When `--out` is omitted, `build:audio` installs `audio_v2.json` and
`build:character` installs `character_v10.json`, each with its deterministic
gzip sibling, in the exact-build custom cache that their repositories and local
HTTP routes read. Pass `--out` for distribution builds. Each library is
described in the JSDoc of the classes that build and serve it:
`CjsAudioLibraryBuilder` (runtime), `CjsToolAudioRepository` and
`CjsToolAudioSource`; `CjsToolCharacterDefinitionCompiler` and
`CjsToolCharacterCatalogGatherer`; `CjsToolSkinBuilder`, `CjsToolSkinrBuilder`
and `CjsToolWeaponBuilder`.

## Reproducibility and safety

Fetched archives, SQLite/WAL files, indexes, generated reports, and game-derived
cache output must remain ignored. Only deliberately selected compact libraries
may be published. Supply a fixed `generatedAt` value when byte-for-byte audio
reproducibility is required.
