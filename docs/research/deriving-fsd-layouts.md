# Deriving a dataset layout

Status: Experimental
Scope: Deriving and proving modern cFSD dataset schemas
Audience: Maintainers adding an approved reader
Summary: Uses inert loader inspection and an exact-build export oracle to distinguish measured layouts from inferred fields.

## First check the file is FSD at all

An extension is not a format check: see the
[container families](fsd-record-conventions.md#the-client-is-not-one-data-format).
For nonmatching filenames and nested tables, use the
source mappings (`CJS_TOOL_SDE_CLIENT_SOURCES`). Runtime owns reviewed decoding;
tools-core owns evidence-producing inspection and export projections.

## The problem

An FSD container carries no schema. Its first sixteen header bytes identify the
layout without describing field offsets, types or presence bits. A new layout
needs an explicit reviewed schema, not plausible offsets from a hex dump.

The [historical derivation record](https://github.com/carbonenginejs/tools-core/blob/6b3253224513cbecaebb4f207c08a9d58fc0e3e0/docs/research/deriving-fsd-layouts.md)
retains the August 2026 CCP build 3466501 sweeps, solved-layout catalogue, offsets,
masks, value censuses and cross-publisher experiments. They qualify those
measurements, not today's build or every field in a shipped reader.

## Source one: the loader names the fields

The **app** index carries the dataset's
`app:/bin64/<Dataset>Loader.pyd`. Inspect it as inert bytes and strings only:
never import, execute, commit or redistribute the module. Do not install the
ABI-matched 64-bit Python 2.7 or revive abandoned live-import scripts. Field names
come from inspection; offsets are checked against the oracle.

Printable field-name runs retain order. PE `PyStructSequence_Field` arrays can
reveal nested shapes, such as material colours. In inspected loaders, record
fields were exposed by code and the apparent 32-byte table was `PyMethodDef`,
not an offset table. **No offset table was found in that inspected set**;
this does not prove none exists in an uninspected loader.

### The loader's order is itself evidence

Declaration order follows offsets **within a storage class**, not necessarily
one alphabetical run. Pointer fields, four-byte scalars, embedded objects and
booleans can form separate groups. Check grouping before declaring a mismatch.

Measured dogma presence bits follow alphabetical order among optional fields.
That can inform an assignment when two fields always occur together or the
export never publishes a field, but state the result as **inferred**, not
measured. Corroborate the ordering on separable fields in the same file.

### Record the client's name

Newer loader names use snake_case; the export camelCases them, with trailing
`id` becoming `ID`. A schema field may record `sourceName` so validation can
check the conversion. A deliberate departure, such as a label exposed as `nameID`
instead of resolved `name`, declares `renamed: true`.

Do not derive a field's identity from equal values alone: SKINR `internal_name`
was mistaken for `slotID` because both equalled the key on every sampled row.
Only the loader's field list distinguished them. The mechanical naming rule
belongs in `CamelizeFieldName`, not manual transcription.

## Source two: the official export is an oracle

Where CCP publishes a dataset, use its exact-build export keys and values as
independent evidence. Compare every published record and field, not a sample
that merely looks right. Unpublished fields require other evidence; the export
cannot prove them.

## Step one: pin the record size

`MapEntries` walks buckets at `recordSize`. A wrong stride can still yield the
stored count, so solve against **keys**, not count alone. Require exact key-set
agreement when the export is complete. A filtered export may instead be a
subset: every published key must occur in the client, and surplus client rows
are not automatically decoding errors. The historical `graphicids` sweep
demonstrates that distinction.

The original stride sweep decoded each record's key at offset 0 and identified
the size only when exactly one candidate matched.

## Step two: solve the fields

Search candidate offsets and types against every relevant oracle value. Accept
only unanimous agreement and report **all** matching candidates, not the first.
Use records where correlated fields differ to separate them: `volume` and
`packagedVolume` agreed on 45,919 of 46,748 published records in the original
sweep; the 829 differing records were the discriminating set.

Three false proofs to avoid:

- A free-looking `UINT_32` can be the high half of a neighbouring
  `FLOAT_64`, correlating perfectly with its presence.
- An always-true field can match every always-set bit. Exhaustive search cannot
  create variation the data lacks.
- A unique nonzero value is not proof of a label identifier. Resolve actual
  localisation identifiers and match those values independently.

## Presence and projection are separate

A mask is not universal: `graphicmaterialsets` uses one; `graphicids` stores
empty strings or zero identifiers instead. Return what the file holds; export
omission and normalisation belong in the projection.

A candidate presence bit must imply the measured absence condition on **every**
record where it is clear; correlation with nonzero values is insufficient.
Invariant bits cannot distinguish fields. Zero remains a real value for
unguarded numerics, not a generic absence signal.

`allowedMask` is the measured union of bits, not just mapped fields: client
records can contain data omitted from the export. Small samples can leave
assignments inseparable: `metaGroups.iconID` and `iconSuffix` occurred together
on all 41 records across the inspected publishers, so bits 2/3 remained inferred
and unobservable.

Model a packed flag as `BOOLEAN` with offset and bit, not `UINT_8`: the latter
describes the whole byte and can include other flags. For export-specific
omission, presence-with-empty values and text conversion, follow
[record conventions](fsd-record-conventions.md#the-exporters-normalisations).

## Nested values and record shapes

- A list is reached through the relative offset **stored in its pointer**, not
  the pointer field's address.
- Entry count cannot prove list item size: the count is stored. Solve size from
  item values; the dogma modifier sweep distinguished 48 bytes from 24/32/40 this way.
- Payload can precede the key for alignment: `typeDogma` stores its double
  before the attribute identifier. Reading the identifier as a double produced
  `9e-322`, not meaningful data.
- Loader inspection can identify unpublished fields (`sfxName`, repeated
  `effectID`); constant fields placed by order alone
  (`disallowAutoRepeat`) must remain explicitly inferred.

Not every map value is an object of fields:

- `compressibletypes` has scalar values: describe `value`, not `fields`.
- SKINR point-value and tier-threshold records contain nested maps; the export
  flattens these into `_value: [{_key, _value}]`.
- `typelist` lists hold bare identifiers, not objects.

An empty loader `_items_` block is evidence for a scalar/map-valued shape,
not proof inspection failed.

## Localisation

The protocol-0 localisation pickle is separate from FSD. Its label identifiers
must be resolved in the chosen target and language; do not borrow Tranquility
text for a NetEase export. `CjsToolSdeLocalizationTable` indexes one specific
pickle shape and rejects others rather than making the FSD decoder own
localisation policy.

Compare decoded text, not raw pickle escape spelling. Trim/normalise only at
the [export projection boundary](fsd-record-conventions.md#the-exporters-normalisations).
The historical receipt's inline newline-escape example is malformed (an escape
followed by a physical line break); it is not a trustworthy spelling example.
The encoding warning remains valid; the intended corrupted spelling is not guessed.

## Open findings and current reader ownership

The following are historical findings, **not closed by retiring the audit**:

- Open: `packagedVolume` matches no float, integer or offset for the 829 records
  where it differs from `volume`, so it appears to be derived by the exporter
  rather than stored. `isRepackable` is not stored either, as far as the record
  shows — see below.

The 2026-08-15 search found no matching value bit, publication bit or pure group
rule in `types`/`groups`. Of 1,507 groups, 1,477 were uniform and 30 mixed; the
best single type bit was merely correlated, not a flag.

`packagedVolume` is unsolved against every offset and type by the same search.

Either the exporter derives it, or another dataset
carries it. `compressibletypes.fsdbinary` and the dogma attributes are the
untested leads.

The original unassigned-bit qualification was:

> Presence bits 2, 4, 8, 16, 17 and 24 are informative and unassigned. The
> fields they guard are in the record but absent from the export, so nothing
> independent proves their offsets. The remaining unmapped fields are *presumed*
> to sit behind these bits; that has not been verified and cannot be against
> this oracle, because the export publishes none of them.

This is not today's field inventory. `CjsFsd64SchemaTypes.getFsdSchema()`
now defines the reviewed runtime layout, including the quote fields. Their
bit 16/17 assignment remains inferred because the fields always occur together;
bits 2/4/8/24 remain unassigned. See the
[reader source](https://github.com/carbonenginejs/runtime/blob/main/src/resource/formats/fsd/64/readers/CjsFsd64SchemaTypes.js)
and [dataset-layout API](https://github.com/carbonenginejs/runtime/blob/main/docs/resource/formats/fsd.md#dataset-layouts).
The old `readers/schemas/types.json` path and “no schema is published until those
close” gate are superseded, **not evidence those derivation questions were solved**.

## Discovery and cross-publisher reuse

A map count at `rootOffset + 8` can be read without its field layout or record
size. Use it to locate candidate files, but a file-level count misses tables
nested inside a container. Enumerate before deriving; the
`CJS_TOOL_SDE_CLIENT_SOURCES` JSDoc (`src/sde/build/defaultClientSdeSources.js`) records those traps.

Layout hashes are commonly shared, not guaranteed identical across publishers.
Refuse an unaccepted identity. Add `acceptedSchemaIDs` only after measuring
equivalent offsets, presence and nested values; record the evidence. A mismatch
can mean either different layouts or equivalent layouts with different IDs.
The [publisher comparison](fsd-record-conventions.md#layouts-are-usually-shared-between-publishers-and-not-always)
owns the counterexamples; the pinned receipt retains the detailed dogma experiment.

## Related documentation

- [Documentation home](../README.md)
- [Architecture and boundaries](../architecture.md)
- Reviewed schemas: `@carbonenginejs/runtime/resource/formats/fsd/64/readers`
