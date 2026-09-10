# NetEase client data and export boundaries

Status: Experimental
Scope: Exact-target Serenity and Infinity exports
Audience: Maintainers building or extending client-data exports
Summary: Routes current build decisions and preserves the qualifications from the NetEase comparison.

## Target and layout identity

Serenity and Infinity carry different worlds, not interchangeable builds of one
dataset. Use the [target-selected build profile](../guides/sde-builds.md#identity);
provider metadata does not choose the build or output identity.

Reviewed decoding belongs to
`@carbonenginejs/runtime/resource/formats/fsd/64`; tools-core owns inspection,
projection and build orchestration. Shared filenames do not prove shared layouts:
`schools` and `dynamicItemAttributes` were measured counterexamples. Verify a
layout before accepting another target's identity.

## Disposition of the original questions

- **Whether the export is produced by the existing archive path under a second
  acquisition source, or by a separate builder emitting the same database shape.**
  The [profile-driven builder](../guides/sde-builds.md#command) writes through
  canonical `CjsToolSdeDatabase.ImportTables`; its
  [profile API](../guides/sde-builds.md#api) supplies target-specific inputs.
- **Whether the three FSD layouts are authored by hand or generated from the
  loader modules.** Reviewed schemas are derived from
  [inert loader inspection and oracle comparisons](deriving-fsd-layouts.md#source-one-the-loader-names-the-fields),
  not by executing the loaders. This describes the implemented approach, not a
  prohibition on future automation.
- **What `materialSets` should be for a target that has no source for it.**
  It is [optional for preparation](../guides/generated-libraries.md#javascript-composition).
  Absence must not block the shared preparation path; this does not require an
  invented empty table or substitution with `graphicMaterialSets`.

## Historical evidence and acquisition caveats

The [2026-08-14 comparison](https://github.com/carbonenginejs/tools-core/blob/6b3253224513cbecaebb4f207c08a9d58fc0e3e0/docs/research/client-static-data.md)
preserves Serenity `3466054`, Infinity `3466057` and Tranquility `3466501`
counts, sampled differences, visibility observations and the 52,863-record
projection check. These are dated measurements, **not current export qualification**.
Its provider-wide “latest selects Infinity” statements describe the old routing;
follow the target-selected build guide above.

The acquisition constraints recorded there remain relevant to interpreting the
receipt: fetch results carried bytes and `cachePath` so SQLite could open the
cached file; path matching enumerated `res:` only, while app entries required the
raw index graph; NetEase composed the prefetch index before the main index.
The historical radius/two-exception comparison is not a fresh claim about today's
projection. Full measurements and their limits remain in the pinned receipt.

The [type projection](../../src/sde/build/projectTypes.js) deliberately excludes
`packagedVolume` and `isRepackable` rather than guessing their values.
