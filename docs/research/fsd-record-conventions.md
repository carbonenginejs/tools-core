# How the client stores a static-data record

Status: Experimental
Scope: The conventions every EVE static-data dataset follows, whoever publishes it
Audience: Anyone reading a client dataset or reproducing the official export
Summary: Records the container families, what the 32-byte header actually contains, the label-versus-inline-text rule, and the exporter normalisations - all measured, all publisher-independent.

## Why this page is here and not in a consumer

Everything below is a property of the EVE client and of CCP's exporter, so it
holds for any publisher and any tool. It was written down inside the NetEase
export tool first, which meant a reader of CCP data had no reason to find it.

The rule the current owners follow: **a byte-layout fact belongs to runtime-resource's FSD schema;
a fact about one export belongs to that export's tool.**

## The client is not one data format

`res:/staticdata/` holds several unrelated container families, and the split does
not follow the extension:

| Extension | Container | Count (NetEase / CCP) |
| --- | --- | ---: |
| `.fsdbinary` | FSD, 32-byte header, layout defined outside the file | 209 / 149 |
| `.static` | SQLite 3, or a length-prefixed pickle - see below | 45 / 45 |
| `.pickle` | Python pickle | 3 / 3 |
| `.schema` | schema companions to six of the `.static` files | 6 / 6 |

`.static` is the one that misleads. Counted over the 45 files:

- **14 are SQLite 3.** First sixteen bytes are `SQLite format 3\0`, with
  `cache(key, value, time)` and `indexes(key, value)`, and each `cache.value` is
  a plain JSON document.
- **25 are a length-prefixed protocol-0 pickle carrying their own schema.** The
  first key is `valueTypes`, and the pickle *is* the layout: `attributes`,
  `type`, `size`, `offset`, `localizationID`, `constantAttributeOffsets`,
  `attributesWithVariableOffsets`, `endOfFixedSizeData`. Nothing has to be
  derived for these the way an `.fsdbinary` layout does.
- **6 carry a separate `.schema` sibling** and are binary against it.

Only `.fsdbinary` is this package's own format.

## The 32-byte header is two identities and a length

Bytes 0–24 read as one schema identity, and bytes 24–32 are the payload length.
The identity is two concatenated values:

- **bytes 0–16** — the **layout** hash;
- **bytes 16–24** — a **content** digest, which changes whenever the data does.

Evidence: across eleven datasets compared between two builds, bytes 0–16 were
identical in every case and bytes 16–24 differed in every case — except
`paints.fsdbinary`, byte-identical on both and therefore matching on all 24.

So a **32-character identity pins the layout** and keeps a reader working after
the data changes; a **48-character identity additionally pins one build's
contents** and expires when that data changes. Pin 32 unless there is a stated
reason not to.

### Layouts are usually shared between publishers, and not always

This page previously said, flatly, that NetEase and CCP share FSD layouts and
that a layout derived from Tranquility decodes the Serenity file of the same
name. That is the common case and it is **not a rule**. Measured 2026-08-16 at
CCP 3466501, Serenity 3466054 and Infinity 3466057:

| Dataset | CCP | Serenity | Infinity |
| --- | --- | --- | --- |
| `schools.fsdbinary` | `7bbbd5ec…` | `f5d3c551…` | `f5d3c551…` |
| `dynamicitemattributes.fsdbinary` | `b88a1388…` | `66b83f30…` | `91d35e9e…` |

Forced past the identity check, CCP's layout walks off the end of both NetEase
files immediately, so these are real layout differences rather than a renamed
identity.

**A reader that decodes CCP is not thereby proven against NetEase.** Only running
it says. Treat a cross-publisher decode as a claim to test, not an assumption.

### One layout can carry two identities

The converse also happens, so a mismatch is not proof of a different shape.
Infinity's `dogmaeffects.fsdbinary` reads `3f128288…` where CCP and Serenity read
`b7107f57…`, and every offset, every presence bit and the modifier entry are the
same. A schema may list `acceptedSchemaIDs` for this, and should say what was
measured to justify each one.

## Every FSD dataset ships a loader

Layouts do not have to be guessed. The **app** index — not the res index —
carries one `app:/bin64/<Dataset>Loader.pyd` per `.fsdbinary`, on both
publishers: 209 loaders for 209 NetEase datasets, 149 for 149 CCP datasets,
matching one-to-one.

The loaders are read as **inert bytes and strings only**. They are never
imported, executed, or committed. See
[deriving a dataset layout](deriving-fsd-layouts.md) for what the string run does and
does not prove.

## Text is either user data or art data, and they are stored differently

The container tells you which, by how it stores the string. The rule holds across
every dataset measured:

| Kind | Stored as | Localised | Examples |
| --- | --- | --- | --- |
| **User data** — what a player reads | a label identifier | yes, per language | `types.nameID`, `groups.nameID`, `marketGroups.nameID` and `descriptionID`, `skinMaterials.displayName` |
| **Art data** — what an artist authored | inline text | no, English only | `graphicMaterialSets.description`, and the `material1..4`, `custommaterial1..2`, `sofPatternName` and `resPathInsert` strings beside it |

Verified 2026-08-15 by walking type 587 across all three publishers: every
identifier and every number is identical, the user-facing text resolves to
Chinese on both Chinese clients, and `graphicMaterialSets.description` stays
English on all three — "Valklear Glory (Minmatar Hulls)", which names the hull
set it was authored for rather than anything a player sees.

**This predicts which fields are safe as join keys.** Art data is stable across
publishers and languages, so it joins reliably but says nothing a player would
recognise. User data needs a language chosen before it can be compared at all.

### The two can collide under one name

A record may carry both an inline string and a label whose resolved text the
export publishes under the *inline* string's name. Two measured cases:

- `npcCorporationDivisions` — the client's inline `description` is what the
  export publishes as `displayName`, and the export's `description` is the
  resolved `descriptionID`;
- `skillPlans` — the client's inline `name` is the export's `internalName`, and
  the export's `name` is the resolved `nameID`.

A projection that passes the inline field through unchanged publishes the wrong
one of the pair, and nothing fails.

## The exporter's normalisations

`name` and `description` are joins rather than columns: the record stores
`nameID` and `descriptionID`, and the strings live in
`res:/localizationfsd/localization_fsd_<language>.pickle`. The export publishes
them as objects keyed by language, using `en` rather than the `en-us` in the file
name.

Reproducing the export means reproducing these, each measured against CCP build
`3466501` rather than assumed:

- **CRLF becomes LF.** 16,125 of 34,299 English descriptions differ from the
  export by nothing else. Two `dogmaUnits` descriptions differ by nothing else
  either, which is how the rule was first noticed.
- **Trailing whitespace is trimmed.** Fifteen English names carry a trailing
  space the export drops.
- **Blank labels are omitted**, not emitted as `""` — 377 types.
- **Identifiers are numbers.** `UINT_32_IDENTIFIER` decodes to a string,
  correctly, because an identifier is a key; the export publishes numbers.
- **A widened float32 is rounded to six decimal places.** 0.7 arrives as
  0.699999988079071. Six places rather than the shortest round-tripping decimal:
  the shortest form is right for small values and wrong for large ones, where the
  export publishes the single's exact value, `149599993856`.
- **An empty list, an empty map and an absent one are the same statement**, and
  the exporter makes it by saying nothing.
- **Unguarded numerics are dropped when zero**, because the record always stores
  them. Presence-guarded fields are the opposite: `metaLevel` is published as `0`
  whenever its bit is set, so there the bit is the fact.
- **A row's fields are ordered alphabetically**, with the record key first.
- **Omission-when-zero is per field, not a general rule.** Of the celestial
  statistics only `massGas`, `orbitPeriod`, `orbitRadius` and `surfaceGravity`
  are dropped when zero — every omission of those is a zero and every zero of
  those is omitted, across 453,000 celestials — while `eccentricity`, `pressure`
  and `rotationRate` publish tens of thousands of zeros. Measure the field; do
  not generalise from a sibling.

### A presence bit is not export presence

A field can be present-and-empty, and the exporter drops an empty value exactly
as it drops an absent one. `expertSystems.associatedShipTypes` splits 47/8
present to absent where the export shows 43/12: four records carry the bit and
hold an empty list. `stationOperations.stationTypes` does the same on 8 records.

Decode the value and check it. Do not predict the export from the bit.

## Joining on English names: safe on published types, not in general

Some records are grouped with no identifier relationship between them, so the
English name is the only available join key. Two facts decide whether that is
safe, both measured at build `3466501`:

| Population | Types with a name | Distinct names | Names shared by more than one type |
| --- | ---: | ---: | ---: |
| all types | 52,863 | 50,640 | **1,011**, covering 3,234 types |
| `published: true` only | 26,992 | 26,976 | **12** |

**Restrict a name join to published types.** Across the whole table the
collisions are severe — "Deathless Circle Data Fragment" is 229 distinct types,
"Partially Corrupted Cryschip" 120 — and a join on a non-unique key silently
multiplies rows rather than failing.

The twelve exceptions still need handling, and **nine of them are SKINs**:
*Badger Wiyrkomi SKIN* (36333, 60106), *Brutix Serpentis SKIN* (39584, 42177),
*Catalyst Serpentis SKIN* (39585, 42162), *Scythe Glacial Drift SKIN* (44169,
46893), *Stabber Glacial Drift SKIN* (44171, 46894), plus *Spiked Quafe*,
*Tengu Ultra Jungle*, three festival crates — *Festival Skill Points and
Snowballs Crate* is six types — *Minmatar Liberation Day Apparel Crate* and
*Enforcer - Frigate Crate*. SKIN names are exactly the territory SKINR work joins
on, so this is not a theoretical tail.

**Normalise the key through the localisation table's own normalisation**, never
by hand: fifteen names carry a trailing space and an unnormalised key misses them
silently. Case-and-whitespace folding is *not* worth it — it collapses only four
further names across the whole table, buying almost nothing while risking
conflation.

## Related

- [deriving a dataset layout](deriving-fsd-layouts.md) — the method and its traps
- [where an export table lives in the client](static-data-sources.md) — the
  datasets whose file is not named after them
- The reviewed runtime readers under
  `@carbonenginejs/runtime-resource/formats/fsd/64/readers` define what each
  reader pins and what was verified.
