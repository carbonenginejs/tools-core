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

Record **one digest per input file**, and recompute only the outputs whose
inputs moved:

```json
{
  "schema": "carbonenginejs.characterLibrary",
  "schemaVersion": 9,
  "sourceTarget": "eve",
  "sourceGame": "Eve",
  "sourceProvider": "ccp",
  "sourceBuild": "3458726",
  "inputs": {
    "res:/path/to/a.red": "sha256:...",
    "res:/path/to/b.red": "sha256:..."
  }
}
```

The builder's own version belongs in the stamp too, because a change to the
builder invalidates every output regardless of whether any input moved. Keep it
separate from the file map so it is obvious which of the two forced the work.

**The index already answers this.** The resfileindex carries a path, size and
checksum per file, so the set of files that changed between two builds is a diff
of index rows - no file reads at all. That diff is the work list. A build bump
with no relevant rows changed is a no-op, which is the common case and currently
the one that costs the most.

A combined digest, if you want one, is derived from the file map as a fast
"nothing at all changed" short-circuit. It is never the primary record: on a
mismatch it tells you only that *something* moved, which is exactly the state
that makes people delete the cache and rebuild everything.

## Hashing cost is not uniform

**Character is cheap and changes rarely.** The inputs are SDE records and
authored definitions - small, and read in full during a build anyway. Hash them
per file. Most builds should touch none of them and do no work at all.

**Audio is expensive and mostly static.** Soundbanks approach 400 MiB, and
reading one to decide whether to re-read it defeats the purpose entirely. Never
hash bank bytes for staleness: take the checksum the index already records.

The general rule: **hash the manifest, not the payload**, wherever the manifest
is authoritative. Fall back to hashing bytes only where nothing upstream records
what those bytes are - and treat that as a gap in the index rather than a normal
mode of operation.

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
