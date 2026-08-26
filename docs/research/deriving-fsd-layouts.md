# Deriving a dataset layout

Status: Experimental
Scope: How a new `.fsdbinary` layout schema is worked out and proved
Audience: Maintainers adding an approved reader
Summary: Records the loader-plus-oracle method, the record sizes it has pinned so far, and why guessing offsets is unnecessary.

## First check the file is FSD at all

`res:/staticdata/` holds four unrelated container formats behind three
extensions, and only `.fsdbinary` is this package's. Of the rest: fourteen
`.static` files are SQLite, twenty-five are a length-prefixed pickle that
carries its own schema, and six pair a binary payload with a separate
`.schema`. An extension check is not a format check.

The [static-data source inventory](static-data-sources.md) identifies the
families and their owners. Read it before concluding a dataset cannot be read.

## The problem

An FSD container carries no schema. The header's first sixteen bytes identify a
layout without describing it, so a new dataset needs a hand-written schema
naming every field's offset, type, and presence bit. Guessing those from a hex
dump is slow and produces readers that are plausible rather than correct.

Two independent sources make the work verifiable instead.

## Source one: the loader names the fields

Every dataset ships one `app:/bin64/<Dataset>Loader.pyd` in the **app** index,
one-to-one with the `.fsdbinary` files. Its printable strings include the field
names, in a stable order. For `graphicMaterialSets` the run reads:

```text
colorPrimary_vector  colorHull_vector  colorWindow_vector  colorSecondary_vector
custommaterial1  custommaterial2  description  material1  material2  material3
material4  resPathInsert  sofFactionName  sofPatternName  sofRaceHint
colorHull  colorPrimary  colorSecondary  colorWindow
```

The loader is read as inert bytes and inspected for strings. It is never
imported, executed, committed, or redistributed.

Its Portable Executable structure can also be walked without executing it: the
`PyStructSequence_Field` arrays in `.data` yield nested value shapes directly,
which is how `graphicmaterialsets`' colours were confirmed as `{r, g, b, a}`.
Record fields themselves are exposed as a mapping built in code — the 32-byte
table is a `PyMethodDef` array of `get`/`has_key`/`items`/`keys`/`values`, in
every loader whose `.data` section has been walked so far — so **no offset table
has been found**, and the offsets have had to come from the oracle in every case.
That is a run of negative results across the loaders inspected, not a proof that
no such table can exist in one nobody has opened.

Importing a loader to introspect it live is not an option. It requires a 64-bit
Python 2.7 the loaders' ABI matches, and the only loader flavour shipped is
`app:/bin64/`. Do not install one and do not reach for the abandoned import
scripts if you find them: the field names come from strings and the offsets come
from the oracle.

### The loader's order is itself evidence

The string run is not just a set of names, it is a **sequence**, and the dogma
family showed that the sequence is load-bearing twice over:

- **Declaration order is offset order — within a storage class.** `dogmaEffects`
  lists `effectName`, `guid`, `modifierInfo`, `sfxName`, then fifteen
  identifiers, then eight booleans, and the solved offsets run 8, 16, 24, 32,
  40 … 96, 100 … 107 in exactly that order. But `ship_skin_design_components`
  is not one alphabetical run: its eight pointer fields come first, then its five
  four-byte scalars, then the embedded object and the boolean, alphabetical
  *inside each group*. Read as a single run, every scalar lands in the wrong
  place. A solved layout whose offsets disagree with the loader's order has a
  field misplaced — but check the grouping before concluding that.
- **Presence bits are assigned alphabetically among the optional fields.**
  `dogmaEffects`' sixteen bits map to its sixteen optional fields in alphabetical
  order, `descriptionID` at `0x1` through `trackingSpeedAttributeID` at `0x8000`,
  every one of them independently measured. `dogmaAttributes` and the
  `modifierInfo` entry follow the same rule.

That second point is what makes a field with no variation tractable. Fields that
are always present together cannot be told apart by measurement, and a field the
export never publishes cannot be measured at all — but both fall into place if
the ordering rule holds, and the rule can be corroborated on every bit in the
same file that *is* separable. State the assignment as inferred when you use it.

### Record the client's name, do not just transcribe it

The newer datasets name fields in **snake_case** and CCP's exporter camelCases
them, with one wrinkle: a trailing `id` segment becomes `ID`, so `type_id` is
published as `typeID` rather than `typeId`.

That conversion was done by hand across the SKINR schemas before it was written
down, and by hand it went wrong twice — once inconsistently (`typeID` here,
`typeListId` in the consuming package) and once substantively: a field named
`internal_name` was transcribed as `slotID` and documented as a repeated record
key, because `skinrSlots` and `skinrSlotNames` are one-to-one and its values
therefore equal the record key on all eight rows. **Only the loader's field list
distinguishes those two readings.**

So a schema field may record `sourceName`, the loader's own name for it. The
decoder then checks that the field name is the mechanical conversion of it, and
a deliberate departure — a label identifier the export republishes as resolved
text, `name` decoded as `nameID` — must declare `renamed: true`. The conversion
becomes checkable rather than a transcription nobody can audit, and the rule
lives in `CamelizeFieldName` rather than in whoever typed the schema.

## Source two: the official export is an oracle

For any dataset CCP also publishes, the prepared SDE database holds the decoded
truth: exact keys, field names, and values. A candidate layout is not argued
about — it is run against every record and compared.

This is what turns derivation into measurement. It also bounds the work: a
field whose decoded values match the export across thousands of records is
correct, and one that does not is not.

## Step one: pin the record size

The map header declares its own record count, and `MapEntries` walks buckets at
a stride of `recordSize`. A wrong stride still often produces the right count,
so the count alone does not identify the layout. The keys do: decode every
record's key at offset 0 and require the resulting set to be exactly the
oracle's.

Measured 2026-08-14 against CCP build `3466501`, sweeping 8…512 in steps of 4:

| Dataset | Record size | Records in client | In official export |
|---|---:|---:|---:|
| `graphicmaterialsets.fsdbinary` | 168 | 939 | 939 |
| `graphicids.fsdbinary` | 160 | 6,156 | 6,069 |
| `types.fsdbinary` | 152 | 52,863 | 52,863 |

Each size was the *only* candidate in its sweep, so these are identifications
rather than best guesses.

`graphicids` needed a looser test: the client carries 6,156 graphics and the
export publishes 6,069 of them, so exact set equality fails. Every published key
is present in the client file, which is the direction that matters — the export
is a subset, not a different dataset. Expect the same wherever a table is
filtered before publication, and do not treat the surplus as a decoding error.

## Step two: solve the fields

With the stride known, each named field is resolved by searching offsets and
types for the one whose decoded values match the oracle for every record. A
candidate is accepted only on unanimous agreement, and the search reports every
offset that qualifies rather than the first, because a lone match on a handful
of records is usually a coincidence — an early sweep "solved" a boolean at
offset 0, which is the key.

Two fields can also collide legitimately. `volume` and `packagedVolume` agree on
45,919 of 46,748 published records, so a sweep over all of them accepts the same
offset for both. Solving against the 829 records where they *differ* is what
separates them.

## Absence is encoded two different ways

Do not assume a presence bitmask. Both conventions appear:

- **`graphicmaterialsets`** carries a real mask: a `UINT_32` at offset 160 whose
  bits 0–14 map, in alphabetical field order, onto all fifteen fields.
- **`graphicids`** has no mask at all. An absent optional value is stored as an
  empty string or a zero identifier, and the official exporter drops empties.
  Every one of its 6,069 published records has a non-null pointer for every
  string field.

A reader should return what the file holds. A consumer matching the export's
shape drops the empties itself, because the file does not distinguish "absent"
from "empty".

## Solved layouts

Proved against CCP build `3466501` by decoding every record and comparing every
published value:

| Dataset | Record size | Result |
|---|---:|---|
| `graphicmaterialsets` | 168 | 11,281 values across 939 records, exact |
| `graphicids` | 160 | 42,483 values across 6,069 records, exact |
| `typedogma` | 24 | 26,828 records, both lists exact |
| `dogmaattributes` | 80 | 2,866 records, every published field exact |
| `dogmaeffects` | 112 | 3,417 records and 5,152 modifier entries, exact |
| `typematerials` | 32 | 47,051 material entries and 24 randomised, exact |
| `typelist` | 88 | 462 records, every list exact |
| `compressibletypes` | 8 | 212 records, exact |
| `controltowerresources` | 16 | 44 records and 339 entries, exact |
| `categories` | 40 | 48 records, exact |
| `groups` | 32 | 1,610 records, exact |
| `marketgroups` | 28 | 2,106 records, exact |
| `metagroups` | 48 | 13 records, exact |
| `ship_skin_design_components` | 112 | 544 records and 928 entries, exact |
| `ship_skin_design_component_categories` | 16 | 3 records, exact |
| `ship_skin_design_component_point_values` | 24 | 3 records, exact |
| `ship_skin_design_component_rarities` | 12 | 6 records, exact |
| `ship_skin_design_tier_thresholds` | 24 | 49 records, exact |
| `ship_cosmetic_slots` | 32 | 8 records, exact |
| `ship_cosmetic_slot_names` | 16 | 8 records, exact |
| `ship_cosmetic_slot_categories` | 16 | 3 records, exact |
| `ship_cosmetic_slot_configurations` | 48 | 4 records, exact |
| `iconids` | 32 | 4,658 records, exact |

Both readers then decode the NetEase build of the same file unchanged — 1,153
and 6,126 records respectively — which is the layout-hash claim above holding in
practice rather than in principle.

`types` (record size 152, 52,863 records) is **solved and shipped** as
`readers/schemas/types.json`, layout hash `4f25d0f64115864bd8c4f58da09c1758`.

Proved against CCP's published export at build **3466501** — the same build as
the file, so the oracle is exact rather than approximate: 52,863 records both
sides, and **zero mismatches** across `groupID`, `portionSize`, `basePrice`,
`capacity`, `mass`, `radius`, `volume`, `factionID`, `graphicID`, `iconID`,
`marketGroupID`, `metaGroupID`, `metaLevel`, `raceID`, `soundID`, `techLevel`,
`variationParentTypeID` and `published`.

- Offsets: `basePrice` 8, `capacity` 16, `mass` 32, `portionSize` 40,
  `radius` 48, `volume` 56, `descriptionID` 68, `factionID` 72, `graphicID` 80,
  `groupID` 84, `iconID` 88, `shipTreeGroupID` 92, `marketGroupID` 96,
  `metaGroupID` 100, `metaLevel` 104, `raceID` 116, `soundID` 120,
  `techLevel` 124, `nameID` 132, `variationParentTypeID` 136,
  `isDynamicType` byte 144 bit 0, `published` byte 145 bit 0, presence
  `UINT_32` at 148.
- **Presence masks, measured by implication rather than by correlation.**
  A bit guards a field only if the field is zero on *every* record where the
  bit is clear; a bit that merely correlates with "non-zero" proves nothing,
  and seven bits (0, 1, 11, 14, 15, 19, 23) are set on all 52,863 records and
  so can never pin anything. That gives: `descriptionID` `0x8`,
  `factionID` `0x20`, `graphicID` `0x40`, `iconID` `0x80`,
  `shipTreeGroupID` `0x200`, `marketGroupID` `0x400`, `metaGroupID` `0x1000`,
  `metaLevel` `0x2000`, `raceID` `0x40000`, `soundID` `0x100000`,
  `techLevel` `0x200000` — the eleven optional identifiers — plus
  `variationParentTypeID` `0x400000`. That last one had two candidates;
  `0x400000` is set on exactly 4,796 records, its own non-zero count, while
  `0x1000` is `metaGroupID`'s and merely a superset.
- `basePrice`, `capacity`, `mass`, `volume`, `radius`, `portionSize`, `nameID`
  and `groupID` carry **no** presence bit. Zero is a real value for them, which
  is also why a "non-zero means present" heuristic mis-pins them.
- Presence bits 2, 4, 8, 16, 17 and 24 are informative and unassigned. The
  fields they guard are in the record but absent from the export, so nothing
  independent proves their offsets. The remaining unmapped fields are *presumed*
  to sit behind these bits; that has not been verified and cannot be against
  this oracle, because the export publishes none of them.
- The FSD schema gained a `BOOLEAN` type for this, addressed by `offset` plus
  `bit`. Declaring the packed flags `UINT_8` would describe the byte rather
  than the field, hand a consumer `1` where it expects `true`, and silently
  fold in whatever else shares the byte.
- **`name` and `description` are not text.** They are localisation label
  identifiers: `nameID` is a `UINT_32` at offset **132** and `descriptionID` a
  `UINT_32` at offset **68**, the latter tracked by presence bit `0x08`. The
  official export publishes resolved strings per language, so reproducing its
  shape means resolving these through
  `res:/localizationfsd/localization_fsd_<language>.pickle`.
- Open: `packagedVolume` matches no float, integer or offset for the 829 records
  where it differs from `volume`, so it appears to be derived by the exporter
  rather than stored. `isRepackable` is not stored either, as far as the record
  shows — see below.

Two traps cost time here, both worth knowing before sweeping offsets.

A free-looking `UINT_32` is often the high half of a neighbouring `FLOAT_64`.
Offsets 12, 20, 36 and 60 each appear "non-zero for exactly the records that
publish `basePrice`, `capacity`, `mass` and `volume`" for precisely that reason.

Offset 24 also *looks* like `nameID` — non-zero and distinct for all 52,863
records — and is not. It was rejected only by resolving real label identifiers
out of the localisation table and looking for those exact numbers in the record,
which put them at 132. A field that is unique per record is a weak signal; a
field that resolves to the right string is proof.

## Four more layouts, solved by exhaustive search

`categories` (40), `groups` (32), `marketGroups` (28) and `metaGroups` (48) were
solved on 2026-08-15 and verified exact against CCP's export at build 3466501 —
48/48, 1,610/1,610, 2,106/2,106 and 13/13 on every published field.

The method scaled: rather than probing offsets by hand, a solver tests every
offset against every candidate type for every published value and accepts only
unanimous agreement. `groups`' eight fields fell out in one pass.

Three traps it exposed, all of which cost a wrong answer first:

- **`allowedMask` is the measured union, not the fields you mapped.** The
  presence word carries bits for data the client has and the export does not
  ship. `groups` reads `0x3f` — six bits, of which one (`iconID` 0x8) maps to a
  published field.
- **A field only ever published as `true` matches any always-set bit.**
  `isRepackable` appeared to solve to seven different bits; every one was set on
  all 52,863 records. Exhaustive search finds coincidences as readily as facts
  when the sample has no variation.
- **A small table cannot always split its presence bits.** `metaGroups`'
  `iconID` and `iconSuffix` are present together on every record of all three
  publishers — 41 in total — so nothing distinguishes bit 2 from bit 3. The
  reader documents the assignment as inferred and unobservable rather than
  proven.

## The dogma family: nested lists, and two fields the export never publishes

`typeDogma` (24), `dogmaAttributes` (80) and `dogmaEffects` (112) were solved on
2026-08-15 and verified exact against CCP's export at build 3466501 — 26,828
records on both of `typeDogma`'s lists, 2,866 `dogmaAttributes` records, and
3,417 `dogmaEffects` records carrying 5,152 modifier entries, with no field
disagreeing anywhere.

**A list is reached through its pointer's value.** `binary.ListEntries` takes the
relative offset stored *in* the pointer field, not the address of the field. Two
`typeDogma` verifications failed on that before the third read correctly.

**A list's item size cannot be solved from the entry count**, because the count
is stored, not derived — every candidate size returns the right number of
entries. Solve it from the item's *values* instead: `modifierInfo` fits 48 bytes
and nothing else, and running the field solver at 24, 32 and 40 returns nothing
at all rather than something wrong.

**An item can store its payload before its key.** `typeDogma`'s attribute entry
is `value` (FLOAT_64) at 0 and `attributeID` (UINT_32) at 8, which reads as a
mistake until you notice the double has to be aligned and the identifier does
not. The symptom of reading it the natural way round is the value `9e-322` —
which is the double whose bit pattern is the integer 182.

Two `dogmaEffects` fields cannot be solved against the export because the export
does not publish them, and both came from the loader instead:

- `sfxName`, a string at offset 32 whose only non-empty value is `"None"`,
  guarded by the one presence bit that mapped to nothing published;
- `effectID` at 64, which repeats the record key. `dogmaAttributes` stores its
  key twice the same way, at offset 24.

And one field is placed by the ordering rule alone: `disallowAutoRepeat` is
`false` on all 3,417 published records, so no measurement locates it. It is the
first of the loader's eight booleans, and byte 100 is the only free byte before
the seven that *are* pinned. The reader says so rather than implying it was
measured.

## `isRepackable`: searched exhaustively, still derived

The exhaustive solver was run against `types` and `groups` on 2026-08-15 and
found nothing, which upgrades the earlier conclusion from "appears derived" to
"is not stored in either record":

- no value bit in `types` varies with it, at any offset or bit;
- no presence bit governs its publication;
- no bit in the `groups` record predicts it across all 1,477 uniform groups;
- and it cannot be a pure group property regardless — **30 groups are mixed**,
  holding both repackable and non-repackable types.

`packagedVolume` is unsolved against every offset and type by the same search.

## Localisation is a protocol-0 pickle, and both publishers ship it

Ten files per build, `de es fr it ja ko ru zh en-us` plus `main`, and they are
genuinely Python pickles rather than FSD. Their header — `(S'en-us'\np1\n(dp` —
is **protocol 0**, which the reader in `@carbonenginejs/runtime/resource` already decodes. The
English file is 40 MB and the NetEase Chinese file 75 MB.

Entries read `I<id>\n(V<text>\nNN`, so an index can be built by scan without
materialising the graph. `CjsToolSdeLocalizationTable` does exactly that and nothing
else — it understands one pickle shape and refuses any other, which is what
keeps pickle/localisation policy outside the runtime FSD decoder rather than pulling it into a
file it only ever indexes.

Measured at build 3466501: the English table indexes **307,640 labels**, and
every one of the 52,863 `nameID` values and all 34,678 `descriptionID` values
resolves against it, with none missing. (An earlier build measured 34,299
`descriptionID` values; the count moves with the build, the coverage does not.)

**The export trims trailing whitespace and the client data does not.** Fifteen
of 52,863 resolved English names differ from the published export by exactly
one trailing space — "Corax Navy Issue Alliance Emblem " against "Corax Navy
Issue Alliance Emblem". The label table is right and the decode is right; the
difference is an exporter normalisation, so a consumer reproducing the export's
shape trims at the projection rather than in the reader.

The same identifiers resolve against the NetEase build's `zh` table, which is
how EVE China type names arrive in Chinese rather than being borrowed from
Tranquility. Type 587's description label `93841` reads "The Rifter is a very
powerful combat frigate…" on Tranquility and the Chinese equivalent on Serenity.

Beware comparing the raw pickle text: it escapes non-ASCII and newlines
(`–`, `\r
`), so a naive string comparison reports mismatches that are
purely encoding.

## `isRepackable` is not a bit in this record

The expectation that it is a stored boolean does not survive measurement. It is
published only as `true`, for 6,522 of 52,863 types, and every one of the 1,184
byte-and-bit positions in the record was tested against exactly that set. The
best single bit agrees on 93.33%, and it is the presence bit for
`variationParentTypeID` — a coincidence of counts, not a flag.

What the data does suggest is a rule rather than a field: grouping types by
`groupID`, **1,477 of 1,507 groups are uniform** — every member repackable or
none — with only 30 mixed. Either the exporter derives it, or another dataset
carries it. `compressibletypes.fsdbinary` and the dogma attributes are the
untested leads.

No schema is published for `types` until those close: a reader that is right
about twenty fields and guessing about four is worse than no reader, because its
output looks authoritative.

## A record is not always an object

Three shapes appear beyond "record of fields", and the loader announces each one:

- **A scalar-valued map.** `compressibletypes` is an eight-byte key and value
  with no record around it, and its loader names **no fields at all** — every
  other loader lists the record's fields between `_items_` and `__dir__`. Model
  it with the map descriptor's `value` rather than `fields`. The name the export
  gives that value (`compressedTypeID`) is the exporter's, not the file's.
- **A map-valued record.** `ship_skin_design_component_point_values` and
  `ship_skin_design_tier_thresholds` hold a nested sixteen-byte map header where
  fields would be, so their loaders also name nothing. CCP flattens the inner map
  to `_value: [{_key, _value}]`.
- **A list of bare identifiers.** `typelist`'s six include/exclude lists hold
  four-byte identifiers directly, not objects.

A loader with an empty `_items_` block is therefore information, not a failed
read: it says the record has no named fields, which narrows the shape to two.

## Sweep record counts before deriving anything

Every map declares its own record count at `rootOffset + 8`, so a count is
readable **without knowing the record size, the field layout, or anything else**.
All 149 `.fsdbinary` files on a build can be counted in one pass.

That is worth doing before any derivation, for two reasons. It identifies a
candidate file for a table whose row count you know — `iconids.fsdbinary` holds
exactly 4,658 records against CCP's `icons`, which is how that mapping was
found. And it *rules a file out* cheaply: no file on the build holds 52, 30, 17
or 423 records, which is how the four ship-tree tables were shown not to be
stored as their own map anywhere, after a filename search had already failed to
find them twice.

Do not search for a file by name. Enumerate every file the client ships,
subtract the ones already read, and look at what is left; the SKINR datasets
ship as `ship_skin_design_*` and `ship_cosmetic_*`, sharing no word with the
tables they answer, and `typeLists` reads `typelist` in the singular.

## Applying a layout to another publisher

Layout hashes are **usually** shared across publishers, so a schema derived from
a Tranquility build decodes the EVE China file of the same name. That is why the
work is done against the CCP file even when the target is NetEase: only CCP
publishes the oracle. See the NetEase target's own documentation for the
container-family split and the measurements behind it.

**Usually, not always.** Of ten datasets checked across Tranquility, Serenity and
Infinity on 2026-08-15, nine carried one identity and `dogmaeffects` did not:
Infinity reads `3f128288…` where the other two read `b7107f57…`. The reader
refused the file rather than misreading it, which is the point of pinning the
hash.

The layout behind the two identities is the same, measured over the 3,366
effects Infinity shares with CCP: every field solves to the identical offset, the
presence union is `0xffff` on both, the modifier entry is the same 48 bytes, and
3,349 modifier lists decode identically — the seventeen that differ are
well-formed decodes of different values. So a schema may list
`acceptedSchemaIDs` alongside its `schemaID`.

Do that only on measurement, and record what was measured. Loosening the check
generally would cost the protection everywhere else, which is the one thing
standing between a changed layout and a silently wrong decode.

## Related documentation

Read these two before deriving anything. The first tells you whether the dataset
you want is even in the file you are looking at; the second tells you what the
container and the exporter do to a record, which is most of what a derivation has
to account for.

- [Where an export table lives in the client](static-data-sources.md) — the
  datasets whose file is named nothing like the table
- [How the client stores a static-data record](fsd-record-conventions.md) — container
  families, the two-part header identity, label versus inline text, and every
  measured exporter normalisation

- [Documentation home](../README.md)
- [Architecture and boundaries](../architecture.md)
- The reviewed runtime readers ship from
  `@carbonenginejs/runtime/resource/formats/fsd/64/readers`.
