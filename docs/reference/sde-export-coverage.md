# Export coverage

Status: Experimental
Visibility: Public-safe donor package documentation
Scope: Which tables CCP's static data export publishes, and which the NetEase export generates
Audience: Anyone deciding what to build next, or checking whether a table can be sourced at all
Summary: Measures the gap between CCP's 101-table export and the seventy-six tables generated here, and records where the missing ones can be sourced from.

## The gap, measured

Against CCP build 3466501 and Serenity 3466054, on 2026-08-16:

| | tables | rows |
| --- | ---: | ---: |
| CCP's export | 101 | 675,872 |
| generated here | 76 | 628,113 (92.9%) |
| missing | 25 | 47,759 |

**25 missing is not 25 to build**, but the goal is parity: this export should
eventually match CCP's table for table. The order, set by the maintainer on
2026-08-15:

1. the tables the EVE SDE treats as compulsory, and the ones already consumed;
2. then **traits, dogma, manufacturing and ship trees**;
3. then the remaining optional tables.

So `dungeons`, `missions`, `npcCharacters` and `accountingEntryTypes` are in
the count and near the back of the queue rather than out of scope.

## Parity with what is actually consumed

101 tables is the eventual goal. The earlier count of 102 included `_sde`, the
export's own metadata row, which is not a data table.

The nearer question is whether an export generated here can drive the consumers
`tools-core` already has, and that set is much smaller: **23 tables across four
consumers**. As of 2026-08-16 **every one of them is generated** except
`materialSets`.

| Consumer | Tables | Status |
| --- | ---: | --- |
| SKIN library | 5 | complete |
| Weapon library | 5 | complete |
| SDE archive and DNA index | 8 | complete but for `materialSets` |
| SKINR library | 15 | complete |

`materialSets` is not a gap. No client ships it, CCP's export publishes it with
zero rows, and the archive already treats it as optional.
`graphicMaterialSets` holds the material definitions. The
[generated-library guide](../guides/generated-libraries.md) documents that
public package contract.

**The SKINR library was the one consumer a generated export could not drive**,
and it is no longer blocked: `shipTreeElements`, `shipTreeFactions`,
`shipTreeGroups` and `typeElements` were located and are now generated.

The oddity that made them a blocker is still there and is still worth someone's
attention: **nothing anywhere reads those four tables.** The builder maps them,
validates them against each other, writes them into its output, and no consumer
touches that output. They were required only because `mapRecords` throws on an
absent table, which reads as unintended rather than decided — `materialSets` and
`groups` are already optional for the same reason. That is a small question for
whoever owns `tools-core/src/skin`, and it is no longer urgent.
## What is generated (76)

The [76-table catalogue and CCP row counts](https://github.com/carbonenginejs/tools-core/blob/6b3253224513cbecaebb4f207c08a9d58fc0e3e0/docs/reference/sde-export-coverage.md#what-is-generated-76)
remain in Git history. Counts here describe the dated comparison above, not a
new qualification of current exports; CCP row counts are not generated-output
counts where a deliberate departure is recorded below.

**Fifty of these were checked against CCP's export row by row and match
exactly**, at build 3466501. Twenty-four on 2026-08-15 — the `.fsdbinary` tables
then generated, 5,152 modifier entries included, plus `blueprints` and the four
`industry*` tables through the `.static` path. Twenty-six more on 2026-08-16: the
nineteen corporation, dogma, agent and school tables, whose 1,542 rows and 14,099
published fields reproduce the export exactly; and the seven from
`infobubbles.static` and `certificates.static`, whose 1,789 rows do the same.

Two rows in that last group are deliberate departures rather than failures, and
both are in the export's favour: `typeElements` publishes 467 rows where CCP
publishes 423, and one `typeBonus` entry carries an `isPositive` that CCP omits
once in 266. Both are argued where they are implemented.

The check is available for free, which is why it is worth insisting on: run the
reader and the projection over **CCP's own** client files and compare against
CCP's published rows, field for field. Nothing comparable exists for the NetEase
output, so agreement on CCP's data is the whole basis for trusting it.

**Three were not checked that way**: `skins`, `skinMaterials` and
`skinLicenses` go into the export as the client's own JSON without a projection,
and no row-level comparison against CCP's published versions of those tables has
been run here.

### Two tables do not generate on NetEase, because the layout diverged

A layout is a fact about one publisher's file, and until 2026-08-16 every layout
derived here happened to be shared by all three. Two are not. Measured at CCP
3466501, Serenity 3466054 and Infinity 3466057:

| Table | Publisher | Layout | Records | Bytes |
| --- | --- | --- | ---: | ---: |
| `schools` | CCP | `7bbbd5ec…` | 23 | 2,680 |
| `schools` | Serenity | `f5d3c551…` | 15 | 1,332 |
| `schools` | Infinity | `f5d3c551…` | 15 | 1,332 |
| `dynamicItemAttributes` | CCP | `b88a1388…` | 413 | 121,752 |
| `dynamicItemAttributes` | Serenity | `66b83f30…` | 450 | 147,864 |
| `dynamicItemAttributes` | Infinity | `91d35e9e…` | 450 | 147,864 |

The CCP layout does not merely mismatch on identity — forced past the identity
check it walks off the end of the input immediately on both files, so these are
real layout changes rather than the renamed-identity case that
`dogmaeffects.fsdbinary` shows on Infinity.

**Two derivations close both tables on both worlds, not four.** The measurements
narrow it that far:

- The two NetEase `schools.fsdbinary` files are **byte-identical** — same length,
  same identity, not one differing byte. One layout, one dataset, both worlds.
- The two NetEase `dynamicItemAttributes.fsdbinary` files are the **same length**
  with the **same record count** and differ in only 960 bytes, beginning in the
  header. That is the renamed-identity pattern with different data, not a
  different shape, so one layout should accept both identities — which
  `acceptedSchemaIDs` already supports.

The obstacle is the oracle, not the layout. CCP's export is what proves a
candidate layout, and NetEase publishes none, so a derivation here has to lean on
the loader's own field-name strings plus cross-reference checks — every
`attributeID` resolving in `dogmaAttributes`, every `nameID` resolving in the
NetEase localisation table. Fetching the CCP build that shares the NetEase layout
would supply a real oracle, but it needs an exact published build number; two
guessed ones returned 404.

Meanwhile the build reports each as `SKIPPED` with both identities and carries
on, rather than failing the export — the other seventy-four tables are
unaffected, and an export missing one table beats no export.

The general lesson is worth more than the two tables: **a 32-character identity
pins a layout, not a publisher**, and a reader that decodes CCP is not thereby
proven against NetEase. Only running it says.
## Still missing (25)

The dated backlog has mixed tractability: some have a same-named
client file and need only a layout derived, some are known to live inside a
container under another name, and a few have no located source at all.

| Table | Rows |
| --- | ---: |
| `planetResources` | 25,798 |
| `npcCharacters` | 11,393 |
| `npcStations` | 5,210 |
| `missions` | 2,892 |
| `dungeons` | 1,409 |
| `notificationTypes` | 297 |
| `accountingEntryTypes` | 177 |
| `appliedProximityEffects` | 118 |
| `militaryCampaignObjectives` | 109 |
| `systemWideEffects` | 95 |
| `planetSchematics` | 68 |
| `sovereigntyUpgrades` | 49 |
| `characterTitles` | 43 |
| `archetypes` | 34 |
| `proximityTrap` | 24 |
| `skinrSlotsToMaterials` | 16 |
| `translationLanguages` | 8 |
| `characterAttributes` | 5 |
| `militaryCampaigns` | 4 |
| `linkWithShip` | 3 |
| `mercenaryTacticalOperations` | 3 |
| `freelanceJobSchemas` | 1 |
| `metenoxMoonDrill` | 1 |
| `stationStandingsRestrictions` | 1 |
| `systemDbuffEmitters` | 1 |

Deriving these is a solved tools-core procedure rather than a research problem;
the accepted JSON-shaped layout lands on its namespaced runtime resource FSD
schema class after the evidence and wrong-answer traps have been checked.

## Completed projections and source discovery

The earlier certificates projection task and sourceless ship-tree/traits/mastery
lists are superseded by this page's 2026-08-16 record: all seven tables from
`infobubbles.static` and `certificates.static` are generated. The
[source-mapping owner](../research/static-data-sources.md#one-file-several-tables)
records their keys and counts, the Expert Systems reason for retaining all 467
`typeElements` rows, and the [failed filename/count search](../research/static-data-sources.md#what-the-search-that-failed-actually-proved).
No same-named file does not prove absence; a dataset may be nested or derived.
The still-missing table list above remains the backlog for this dated record.

Its dated no-same-named-file findings are: `planetResources`, `npcStations`,
`notificationTypes`, `appliedProximityEffects`, `militaryCampaignObjectives`,
`systemWideEffects`, `planetSchematics`, `sovereigntyUpgrades`,
`characterTitles`, `proximityTrap`, `translationLanguages`,
`characterAttributes`, `militaryCampaigns`, `linkWithShip`,
`mercenaryTacticalOperations`, `freelanceJobSchemas`, `metenoxMoonDrill` and
`systemDbuffEmitters`. Their row counts remain in the backlog above.

All three `.static` families were read as of 2026-08-16. Runtime owns container
decoding; [record conventions](../research/fsd-record-conventions.md#the-client-is-not-one-data-format)
owns the taxonomy. Layout derivation, once a source is located, follows the
[tools-core procedure](../research/deriving-fsd-layouts.md); accepted byte-layout
facts belong on the namespaced runtime FSD schema after its evidence and
wrong-answer checks, not in another export catalogue.

## The map tables are generated — all nine of them

**Nine of nine, 2026-08-16.** `mapRegions`, `mapConstellations` and
`mapSolarSystems` come from the `.schema`-sibling containers; `mapPlanets`,
`mapMoons`, `mapAsteroidBelts`, `mapStars`, `mapStargates` and
`mapSecondarySuns` come from `solarsystemcontent.static`, which nests them three
deep — system, planet, then moons and belts beneath each planet.

Verified against CCP's export on CCP's own files. **Every field of every row is
exact**, on 68,407 planets, 344,457 moons, 40,928 asteroid belts, 8,089 stars,
13,978 stargates and 1,038 secondary suns, with two named exceptions below.

`mapSolarSystems` is now complete too: the topology flags, `radius`,
`luminosity`, `starID`, `visualEffect`, the anchoring rules and `factionID` all
come from this container, which is where they were stored all along.

### The two columns not generated, and why

**`mapSolarSystems.position2D`** (5,485 rows). Not in any container read here.
It is a flattened map projection, and nothing found so far holds it.

**`orbitIndex` on moons and asteroid belts.** The export publishes it on every
one; nothing in the container reproduces it. Identifier order and orbital radius
give *identical* answers as each other and neither matches — so whatever CCP
sorted by is not in this file. Identifier order would be right for 99.9% of moons
and only 83% of belts, and a column quietly wrong on about 7,400 rows is worse
than one that is absent. Same call as `factionID` before its real source turned
up; **do not re-derive this without a new input.**

### Rules measured while doing it

[Exporter normalisations](../research/fsd-record-conventions.md#the-exporters-normalisations)
owns the measured per-field zero-omission rule across 453,000 celestials and
six-decimal rounding. Without position rounding about one celestial in ten
differs in its last digits; do not mistake that for a decoding fault.

The export-specific selection remains: a star's statistics keep `life` and
drop `locked` and `radius` — opposite to other celestials. An asteroid belt
has no `pressure` column and takes its `radius` from its statistics.

## The three worlds really do differ, and now it is measured

Answering a Serenity question about space with Tranquility's map is not stale, it
is false. This used to be an argument from file sizes; the containers are read
now, so it is a count. Serenity build 3466054 and Infinity 3466057 against CCP
3466501:

| | regions | constellations | systems |
| --- | ---: | ---: | ---: |
| Tranquility | 114 | 1,184 | 8,490 |
| Serenity | 116 | 1,194 | 8,590 |
| Infinity | 117 | 1,195 | 8,630 |

The relationship is strictly nested: **every Tranquility key is present on both
Chinese worlds, and every Serenity key is present on Infinity.** Nothing is
removed, only added — 100 extra systems on Serenity and 140 on Infinity, of
which 40 are Infinity's alone.

The extra regions name what the additions are: `15000001` and `15000002`
(索拉弗雷尔实验室) on both, and `15000003` (乱斗竞技场) on Infinity only. They are
instanced or arena space rather than a different shape of the same universe,
which is why the counts grow and never shrink.

Do not read that nesting as permission to substitute one for another. It holds
for record *identity*; whether the shared records carry the same values has not
been checked field by field, and the two Chinese worlds run on one server while
being different worlds.

## Related documentation

- [building exact-target SDEs](../guides/sde-builds.md)
