# Rebuild and staleness

Status: Evolving
Scope: Every generated library under `<cache>/custom/**` - character, audio, skin, skinr, weapons
Audience: Anyone changing a builder, a repository, or the service warm-up
Summary: What this package's builders do today, why it is wrong, and what to change. The cross-package rules live in the organization documentation; this page is the local view.

## Where the rules live

The addressing format, the hash-safe/local-exact distinction and the service
contract are cross-package, and are owned by
`/docs/architecture/resource-addressing-and-staleness.md` in the organization
documentation repository. They were established during the 2026-07 index work
and recorded in `recovery/org-agents/AGENT-FACTS.md:1155-1167` - read the owning
page before treating anything here as new.

This page is the package-local view: what these builders do today and what to
change.

## The rule

**Rebuild a generated library when its inputs change, and not otherwise.**

Not when the build number moves. Not when the service restarts. Not on a timer.
The question a repository must be able to answer is "are the bytes I would
produce now the same as the bytes I have", and the only honest answer comes from
the inputs themselves.

## What we do today, and why it is wrong

`CjsToolCharacterRepository` keys a prepared library by
`game/provider/build/character/<schemaVersion>`, tries `v10`, then `v9`, then
`v8`, then `v7`, and validates only that the identity fields *inside* the artifact match
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

EVE resources are content addressed - the stored file name carries an FNV-1 hash
of the logical path and an md5 of the contents, and the index repeats that md5 as
the entry's `checksum`. The format, its verification and the one open question
about it are owned by
`/docs/architecture/resource-addressing-and-staleness.md`.

The consequence for builders here: **do not compute digests.** A builder that
hashes its inputs is recomputing a number the index handed it, and for audio it
is reading hundreds of megabytes to derive a value that was already in the file
name.

`CjsIndexOverlayStore.validateContentAddress` checks the shape;
`runtime-utils/resfile` derives and parses it.

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

### Pure builds only

The service compares **build indexes**, not composed views. Overlays are
excluded by design rather than handled carefully: they are a local composition
concern, they vary per machine, and including them would make the answer to
"did this change between two builds" depend on who is asking.

They also frequently cannot be compared at all. An overlay entry often carries
no content identity - a `legacy-gles` row is
`res:/graphics/...,graphics/...,,,`, a plain path with an empty checksum - so
nothing about that row changes when the file behind it changes.

**The distinction already exists in the code: `artifactKind`**, `hash-safe`
versus `local-exact`, set at `CjsIndex.js:223` and
`CjsIndexOverlayStore.js:496` and surfaced as the `x-carbon-artifact-kind`
response header. The ownership table is in
`/docs/architecture/resource-addressing-and-staleness.md`.

So the staleness service invents no predicate and sniffs no checksum columns: it
filters on `artifactKind === "hash-safe"` and treats everything else as changed.

Until internal indexes are written hash-safe throughout, that means running
against the **original shipped indexes**, which are hash-safe by construction.

So: diff pure builds, and treat anything an overlay supplies as changed. That is
the same rule as everywhere else here - **an input we cannot prove unchanged is
treated as changed** - and it is the correct answer rather than a limitation to
engineer around. The alternative is deciding a locally edited file is unchanged
because nothing recorded that it moved.

### The span is only what we kept

There is no authority to ask what a previous build contained. Old indexes are
not re-acquirable, so the span is bounded by **what this installation happens to
have retained**, and a gap in it is permanent - "missing, so rebuild" is a final
answer, not a retry that a later fetch could improve.

Two consequences worth stating, because they are easy to discover the expensive
way:

- **Retention is the mechanism.** Pruning old build indexes does not just save
  disk, it destroys the ability to prove anything was unchanged across the gap,
  and every consumer on the far side of it rebuilds from then on. They are small
  next to what they save.
- **A first run can prove nothing.** An installation with one retained index has
  no span, so everything rebuilds once. That is correct, and it is worth
  reporting as "no prior index" rather than as a cache miss, so nobody hunts for
  a bug in the comparison.

### Service contract

Deliberately conservative. The service answers over a **span** of builds - from
the one an artifact was built against, to the one being requested - because a
consumer may be several builds behind:

- **Complete span, no relevant path changed** → reuse the artifact.
- **Any relevant path changed** → rebuild the affected output.
- **Any build or index missing anywhere in the span** → treat everything earlier
  as changed and rebuild.
- **Any relevant path served by an overlay that is not hash-safe** → treat it as
  changed.

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

The `v10 → v9 → v8 → v7` walk returns an older schema when the newest is absent, and
reports success. If a v10 build failed or was never run, a caller receives v9 and
cannot tell.

A compatibility window is a legitimate design. Silence is not. Either:

- the window is deliberate, and the served version is reported to the caller so
  it can decide; or
- it is a bug that conceals a failed build, and the repository should fail.

This is the same failure shape as a slot-order fallback producing plausible but
wrong materials: the output looks like a result, so nothing downstream questions
it. A fallback that cannot be distinguished from success is not a fallback, it
is a silent wrong answer.

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
stat -c %Y "<cache>/custom/games/Eve/providers/ccp/builds/<build>/character_v10.json"
npm run build:character
stat -c %Y "<cache>/custom/games/Eve/providers/ccp/builds/<build>/character_v10.json"
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
