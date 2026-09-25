# Telling Frontier's own content from EVE carryover

Status: Method
Visibility: Internal
Scope: Identifying which Frontier types and assets are Frontier's own
Audience: Anyone browsing, cataloguing or previewing Frontier content
Summary: 91% of Frontier's types came from EVE; a four-stage filter reaches 99.7% purity, and the tests that look obvious mostly do not work.

## The problem

Frontier's static data carries most of EVE's. Browsing by name, category or the
`published` flag surfaces mostly EVE content, and `published` does not
discriminate: it is set on carryover too.

Ground truth used throughout: a Frontier type is EVE-derived if its **id or its
name** exists in EVE's types. By that measure, of 32,627 Frontier types,
**29,766 are EVE-derived and 2,861 are Frontier's own** (8.8%).

## The filter

Each stage measured against that ground truth, on Frontier build 3512930
against EVE 3503375.

| stage | frontier / total | purity |
| --- | --- | --- |
| all types | 2,861 / 32,627 | 8.8% |
| 1. `id > 70000` | 2,852 / 2,911 | 98.0% |
| 2. drop hulls starting `ph_` | 2,745 / 2,804 | 97.9% |
| 3. drop exact EVE names | 2,745 / 2,752 | **99.7%** |
| 4. drop decorated EVE names | 2,745 / 2,752 | 99.7% |

Stage 4 strips a leading non-alphanumeric run before comparing: Frontier
carries 169 names led by `♦` (U+2666), 151 of which are EVE names underneath
(`♦ Apocalypse`). It changes nothing today because all 151 EVE-named ones sit
below the id boundary (the three above it are not EVE names), and it is kept as
insurance rather than as a fix.

Stage 2 answers a different question from the others - "is there anything to
look at" rather than "is this Frontier's". It removes 107 Frontier rows and no
EVE rows, because stage 1 has already taken the carryover. Keep it for a
browser of models; drop it for a catalogue of what Frontier has.

The seven survivors are EVE items above `id > 70000`, five of them on the
`beacon` hull; one (70774) sits below Frontier's own block at 71,495.

## Why the id boundary is a heuristic, not a rule

Frontier's own allocation starts at **71,495** (`Ratcatcher`). The evidence is a
24,288-id gap below it among Frontier-own ids - the next largest gap there is
2,915 - with nine `TestAsset_*` rows at 47,066-47,207 from an earlier
experiment. Including that window costs 239-268 false positives and, after
stage 2, recovers none of the nine (all sit on `ph_prop_sphere_gen_01v01`), so
it is not worth it.

**This describes which slice was forked, not a property of the id space.** EVE's
own type ids run to 371,027 and it has 12,449 at or above 70,000; Frontier
simply carries few of them. The 59 EVE items already above `id > 70000` (39
above 71,495) are the rule decaying in real time; most match by name under a new
Frontier id (`150mm Railgun I` 72740, `Afterburner` 82299, `Beacon` 91602,
`Cargo Container` 95315). Re-derive the boundary from the gap rather than
hardcoding it, and keep the name test, which does not decay.

## The placeholder signal

Frontier kept EVE's type rows and repointed them at placeholder geometry.
`ph_*` hulls carry **5,841 types, 51.6% of everything with a SOF hull**:

| hull | types |
| --- | --- |
| `ph_prop_sphere_gen_01v01` | 5,174 |
| `ship_data_corv_01` (not `ph_`, but used the same way) | 3,638 |
| `ph_prop_cube_gen_01v01` | 554 |

Of the 5,725 EVE-derived types on a `ph_` hull, 101 are published. This is the
mechanism behind "most of Frontier looks like EVE": the rows came across, the
art did not.

## Tests that do not work

**File content hashes, as evidence of origin.** The `resfileindex.txt` md5 is
the hash of the original file, so a differing md5 is a real content difference -
but it does not tell you whether an asset came from EVE. Frontier migrated
geometry from `.gr2` to `.cmf`, so geometry never matches, and it also
re-encoded many textures: `beacon`'s hull references the same nine resource
paths as EVE's (identical once `.gr2` becomes `.cmf`), yet 7 of its 8
non-geometry files have different md5s. Across the 50 shared hulls, path sets
match for 46, while 160 of 407 non-geometry files differ and only 18 hulls have
every texture identical. So: path sets say "came from EVE"; md5s say "not
necessarily the same bytes". Measured against Frontier 3474408, the nearest
build whose resfileindex is on disk; 3512930's is not.

**Asset presence.** EVE ships no Frontier content, so a shared asset did come
from EVE - but presence proves nothing about use. Of the 50 hull `.black` files
in both clients (the `graphics` table's `sofHullName` shares only 25 names),
**35 are referenced by no Frontier type at all**, and across all fifty only
three published Frontier-own types use one. The client ships a great deal it
does not use.

**`marketGroupID`.** 99.3% precise inside the published set (Debris 99014 and
Power Generator 95318 are the exceptions) and 8.9% across all types. The
published set was doing the work.

**`published` alone.** 77% precise and **19% recall** - it misses 2,321 of
Frontier's own types, including 1,689 with a graphic and 1,332 with a SOF hull.
It answers "what does the game sell", not "what is Frontier's".

**Single-language names.** Frontier authors in English only; EVE carryover
arrived with English and Chinese names. 99.1% precise within the published set, but
54% across all types, because EVE has thousands of its own untranslated items
(skill point packs, tournament ships). Sound only in combination with
`published`.
