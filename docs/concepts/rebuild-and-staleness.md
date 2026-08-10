# Rebuild and staleness

Status: Evolving
Scope: Every generated library under `<cache>/custom/**` - character, audio, skin, skinr, weapons
Audience: Anyone changing a builder, a repository, or the service warm-up
Summary: States why a build number is the wrong rebuild trigger in both directions, what a provenance stamp must carry, and why a silent schema fallback is a defect rather than a convenience.

## The rule

**Rebuild a generated library when its inputs change, and not otherwise.**

Not when the build number moves. Not when the service restarts. Not on a timer.
The question a repository must be able to answer is "are the bytes I would
produce now the same as the bytes I have", and the only honest answer comes from
the inputs themselves.

## What we do today, and why it is wrong

`CjsToolCharacterRepository` keys a prepared library by
`game/provider/build/character/<schemaVersion>`, tries `v9`, then `v8`, then
`v7`, and validates only that the identity fields *inside* the artifact match
what was requested - target, game, provider, build. There is no hash of the
inputs, no mtime, and no record of what produced it.

The audio side hashes, but not for this: the `sha256` in `CjsToolAudioSource`
computes HTTP ETags for served media, and `CjsToolMusicSource` uses
`size + mtime` for the same purpose. Neither gates a rebuild.

So the effective cache key is **build number plus schema version**, which fails
in both directions:

- **Too weak.** Inputs can change under a fixed build - a corrected extractor, a
  re-run with different source data, a hand-fixed definition - and nothing
  notices. The stale artifact is served indefinitely because the build number
  did not move.
- **Too strong.** A build bump rebuilds everything, including the large majority
  that did not change. Character data in particular changes very rarely; most
  build bumps should produce a byte-identical character library and therefore no
  work at all.

Both failures are invisible. Neither produces an error.

## The unit is the file, not the build and not the library

A build bump changes a handful of files out of thousands. Everything else is
byte-identical to the build before it. So a per-library digest is barely better
than a build number: it answers "did anything change" with "yes", and the
builder then redoes all the work it just proved was unnecessary.

## Nothing needs hashing: the identity is already recorded

EVE resources are content addressed, and the address is the stored file name.
The authority is `cppctamber/eveResFileIndex`, `src/core/hash.js`:

```js
`${fnv164(prefixedResPath).substring(0, 2)}/${fnv164(prefixedResPath)}_${md5(contents)}`
```

- **FNV-1** (multiply then XOR - not FNV-1a), 64-bit, offset
  `0xcbf29ce484222325`, prime `0x100000001b3`, over the **prefixed** path
  (`res:/...`).
- The shard directory is the **first two characters of that same hash**, not a
  separate value.
- The second half is a plain md5 of the file contents, which the index also
  records as the entry's `checksum`.

`CjsIndexOverlayStore.validateContentAddress` checks that shape here.

### Known divergence

Our `fnv1` hashes **UTF-8 bytes** (`Buffer.from(value, "utf8")`); the authority
hashes **UTF-16 code units** (`str.charCodeAt(i)`). These agree for every ASCII
path and disagree for anything else:

```text
res:/textures/cafe.dds   be93fec578ac6c61   be93fec578ac6c61   same
res:/textures/café.dds   b69fd89d4e12f266   d18d3a77a39ffde5   DIFFER
```

Harmless while every res path is ASCII, and wrong the day one is not - our
validator would reject a correctly named resource. The authority is the game's
naming, so ours is the one that should change.

Comparing addresses is all staleness needs, and comparing is safe regardless:
two builds either carry the same address for a path or they do not. The formula
only matters where something **derives** an address rather than reading one.

So the content identity of every file is already written down, twice, before we
touch anything. **Do not compute digests.** A builder that hashes its inputs is
recomputing a number the index handed it, and for audio it is reading hundreds
of megabytes to derive a value that was already in the file name.

## Track builds, not libraries

The naive fix - each library recording a digest per input file - duplicates the
same bookkeeping into every builder, and each one recomputes it independently.

Retain the **resfileindex per build** instead. Then "what changed between build A
and build B" is a diff of two indexes by logical path and content address, and it
answers for every consumer at once. A library's work list is that diff filtered
to the paths it reads.

This belongs behind a small service rather than inside any one builder: it is the
same question for character, audio, skin, skinr and weapons, and the answer
depends only on the two indexes. A build bump where no relevant address changed
is then a no-op that costs one index comparison - which is the common case, and
currently the one that costs the most.

The builder's own version still belongs in each artifact, because a change to the
builder invalidates its output regardless of whether any input moved. Keep it
distinct from the input identity so it is obvious which of the two forced the
work.

### Service contract

Deliberately conservative. The service answers over a **span** of builds - from
the one an artifact was built against, to the one being requested - because a
consumer may be several builds behind:

- **Complete span, no relevant path changed** → reuse the artifact.
- **Any relevant path changed** → rebuild the affected output.
- **Any build or index missing anywhere in the span** → treat everything earlier
  as changed and rebuild.

The third rule is the one that earns the design. Absence must never present as
"unchanged": a gap in the retained indexes means we genuinely do not know what
happened across it, and the only honest answer is to rebuild. Anything softer -
skipping the missing build, interpolating from the ends - converts missing
evidence into a confident wrong answer, which is the failure this whole page is
about.

It also keeps the artifact small. The library records what it was built against;
the span reasoning lives in the service, so nothing has to embed a file list.

## Inputs the index does not cover

The index answers for anything under `res:`. It does not answer for the things
we author ourselves - definition files in `definitions/`, and the builders'
own source. Those need their own identity, and they are small enough that
hashing them costs nothing.

Keep the two apart in the stamp. A change to an authored definition and a change
to a game resource have different causes and different blast radii, and a single
merged digest makes them indistinguishable when something rebuilds unexpectedly.

## Silent fallbacks are defects

The `v9 → v8 → v7` walk returns an older schema when the newest is absent, and
reports success. If a v9 build failed or was never run, a caller receives v8 and
cannot tell.

A compatibility window is a legitimate design. Silence is not. Either:

- the window is deliberate, and the served version is reported to the caller so
  it can decide; or
- it is a bug that conceals a failed build, and the repository should fail.

This is the same failure shape as a slot-order fallback producing plausible but
wrong materials: the output looks like a result, so nothing downstream questions
it. See `docs/standards/enum-placement.md` in the org documentation repository
for the general treatment - a fallback that cannot be distinguished from success
is not a fallback, it is a silent wrong answer.

## Warm-up

The service warms **only what is already cached**. Warming must never trigger
remote acquisition: a cold checkout starting a service should not begin a large
download, and lazily preparing on first request already handles that case.

Warming from cache has a second benefit that is easy to miss. It reads what is
on disk rather than asking the channel what is newest, so it never resolves
`latest` - and `latest` is precisely the reference that cannot be cached, since
its meaning changes without any local state changing.

## Build references

Prefer an exact, tested build over `latest` wherever a reference is retained.
`latest` resolves differently on different days, which makes it unusable as a
cache key and unreproducible in a report. Resolve it once at the edge, retain
the exact numeric build, and key everything from that - `AGENTS.md` states this
as a repository boundary, and staleness is one of the reasons it exists.

## Checking

Whether a rebuild is actually avoided:

```sh
# Build twice; the second must do no work and must not rewrite the artifact.
npm run build:character
stat -c %Y "<cache>/custom/games/Eve/providers/ccp/builds/<build>/character_v9.json"
npm run build:character
stat -c %Y "<cache>/custom/games/Eve/providers/ccp/builds/<build>/character_v9.json"
```

An unchanged mtime is the property worth asserting in a test, because it is the
one that fails the moment a builder starts writing unconditionally.

The harder case is worth a test too, because it is the one this page exists for:
**build N+1 with no relevant file changed must reuse build N's work.** A
same-build rerun only proves the artifact is found; a next-build rerun proves the
staleness check is per file rather than per build. Constructing that fixture
needs two index snapshots differing in rows the library does not read.

## Related documentation

- [Cache and persistent overlays](cache-and-overlays.md) - where generated
  artifacts live and how overlays take precedence.
- [Generated libraries](../guides/generated-libraries.md) - what each library
  contains and how it is built.
