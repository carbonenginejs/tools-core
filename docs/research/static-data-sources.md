# Where an export table lives in the client

Status: Experimental
Scope: Which client file and which key inside it holds each static-data export table
Audience: Anyone looking for a dataset, in any consumer, for any publisher
Summary: Records the datasets whose client file is not named after the table, so nobody searches by filename for them again.

## Why this page exists

A search by filename finds most datasets and quietly fails on the rest, because
the client's name for a dataset is frequently not the export's. Every entry
below cost someone a search that concluded "no client file exists" — one of them
concluded that in writing, twice.

This is a property of the EVE client, not of any one publisher or consumer, so
it lives here rather than in whichever tool needed it first.

**Rule of thumb: do not search by filename.** Enumerate every file the client
ships, subtract the ones already read, and look at what is left.

## One file, one table, different name

| Export table | Client file |
| --- | --- |
| `icons` | `iconids.fsdbinary` |
| `typeLists` | `typelist.fsdbinary` — singular |
| `skinrComponents` | `ship_skin_design_components.fsdbinary` |
| `skinrComponentCategories` | `ship_skin_design_component_categories.fsdbinary` |
| `skinrComponentPointValues` | `ship_skin_design_component_point_values.fsdbinary` |
| `skinrComponentRarities` | `ship_skin_design_component_rarities.fsdbinary` |
| `skinrTierThresholds` | `ship_skin_design_tier_thresholds.fsdbinary` |
| `skinrSlots` | `ship_cosmetic_slots.fsdbinary` |
| `skinrSlotNames` | `ship_cosmetic_slot_names.fsdbinary` |
| `skinrSlotCategories` | `ship_cosmetic_slot_categories.fsdbinary` |
| `skinrSlotConfigurations` | `ship_cosmetic_slot_configurations.fsdbinary` |

## One file, several tables

These are the ones a filename search cannot find at all, because the file
answers to none of the table names it holds.

`res:/staticdata/infobubbles.static` — SQLite, one `cache` row per dataset.
Found 2026-08-16, after the ship-tree family had been recorded as sourceless.

| Export table | Cache key | Rows (CCP 3466501) |
| --- | --- | ---: |
| `typeBonus` | `infoBubbleTypeBonuses` | 652 |
| `typeElements` | `infoBubbleTypeElements` | 467 in the client, 423 published |
| `shipTreeGroups` | `infoBubbleGroups` | 52 |
| `shipTreeElements` | `infoBubbleElements` | 30 |
| `shipTreeFactions` | `infoBubbleFactions` | 17 |

`res:/staticdata/certificates.static` — a length-prefixed pickle carrying its own
schema, with two top-level keys.

| Export table | Key | Rows (CCP 3466501) |
| --- | --- | ---: |
| `certificates` | `certificates` | 139 |
| `masteries` | `masteries` | 476 |

The naming is the whole lesson: the client calls the Ship Tree an *info bubble*,
and `masteries` is filed under certificates because a mastery is a set of them.
Neither is discoverable from the export's vocabulary.

## `typeElements` publishes fewer rows than the client holds

The client carries 467 records; CCP's export publishes 423. The 44 it drops are
**Expert Systems**: all 44 sit in category 2100, and exactly one of the 423 CCP
keeps does too — type 57199, which looks like an oversight rather than a rule.

So the filter is "exclude Expert Systems", accurate to one record in 467. It is
recorded here as a fact about CCP's export, not as a rule to apply: Expert
Systems are real client data and a consumer may well want them.

## What the search that failed actually proved

Recorded because the negative results are reusable, and because they are what
makes the positive result above trustworthy rather than lucky.

Searched 2026-08-15 across both publishers' full app and res indexes: nothing
named trait, bonus, mastery or shiptree exists in `res:/staticdata/`, and no such
loader exists in `app:/bin64/`. The only `*Tree*` loader in the client is
`skillTreeGroupsLoader.pyd`, whose dataset holds 3 records in 220 bytes against
`shipTreeGroups`' 52.

A record-count sweep then closed the obvious remaining route. Every `.fsdbinary`
map declares its own count in its header, so all 149 were read without solving
anything, and the 14 SQLite `.static` files were counted directly. **No file held
52, 30, 17 or 423 records.**

That sweep was sound and its conclusion was still wrong, for one reason worth
remembering: it counted *files*, and these datasets are not files. They are rows
inside one. A count sweep can only find a dataset that occupies a container of
its own.

## Related

- [deriving a dataset layout](deriving-fsd-layouts.md) — the method, once the file is
  found
- `../reference/sde-export-coverage.md` — which tables the client profiles
  generates today
