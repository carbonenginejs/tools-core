# What the NetEase clients carry

Status: Experimental
Visibility: Public-safe donor package documentation
Scope: How Serenity and Infinity differ from each other and from Tranquility, and what that means for an export
Audience: Maintainers building or extending the NetEase export
Summary: Records that the publisher ships two different worlds rather than one dataset at two builds, measures how far their data diverges from CCP's, and keeps the acquisition notes an export depends on.

## The conventions themselves are not here

How a static-data record is stored — the container families, what the 32-byte
header contains, when text is a label and when it is inline, and every
normalisation the exporter applies — is a property of the EVE client rather than
of this tool. The ownership is split deliberately:

- `runtime-resource/formats/fsd/64` owns reviewed decoding layouts;
- tools-core owns layout derivation and evidence-producing inspection; and
- organization static-data research owns cross-target record conventions and
  source relationships.

Read those owners first. This page holds only what is true of NetEase in
particular. One claim moved out of here was also corrected on the way: NetEase
and CCP share most FSD layouts but not all of them, and `schools` and
`dynamicItemAttributes` are the measured exceptions.

## The publisher has two clients, and they are different worlds

NetEase publishes **Serenity** and **Infinity**. They are two different worlds
on the same server — confirmed by the maintainer on 2026-08-14 — so they are
different data, not one dataset at two builds. Measured the same day:

| | Serenity `3466054` | Infinity `3466057` |
|---|---:|---:|
| `res:` entries | 128,555 | 129,656 |
| `res:/staticdata/` entries | 223 | 263 |
| `.fsdbinary` datasets | 169 | 209 |
| skins | 7,019 | 7,054 |
| skin materials | 976 | 1,013 |
| skin licences | 11,846 | 11,882 |

Every file sampled differs in bytes between them, including `regions.static`,
`systems.static` and `constellations.static` — Serenity's regions file is the
larger of the two while its systems and constellations are smaller. That is
different space, not a stale copy. The forty extra `staticdata` datasets are
Infinity's alone: gacha, battlepass, monetization, brawl, ship adaption and
world tasks.

**An export therefore belongs to a client, not to the publisher.** Resolving
`latest` for the provider selects the highest build across *all* of its clients,
which is currently Infinity, so a build that does not name its client silently
gets Infinity data.

## Evidence baseline

Every count below is a live measurement taken on 2026-08-14 through the
tools-core composed index. Unless stated otherwise the NetEase figures are the
**Infinity** client at build `3466057`, and the CCP figures are Tranquility at
build `3466501`, given as context rather than as a target.

## The data genuinely diverges

Serenity is not a stale copy of Tranquility, so answering a Serenity question
with a CCP export gives wrong answers rather than merely old ones. Skin `11542`
(*Muninn Aurora Universalis*) is published with `visibleSerenity: true` on
NetEase and `visibleSerenity: false` on CCP, in the same field of the same
record. In the NetEase build, **934 skins are visible on Serenity and not on
Tranquility**. Row counts differ in the same direction:

| Dataset | NetEase | CCP |
|---:|---:|---:|
| `skins.static` | 7,054 | 6,995 |
| `skinmaterials.static` | 1,013 | 863 |
| `skinlicenses.static` | 11,882 | 11,824 |

NetEase also ships 61 `.fsdbinary` datasets CCP does not (gacha, battlepass,
monetization, brawl, ship adaption, world tasks, amplification, face verify,
mobile bind), and lacks exactly one that CCP ships: `paperdolls.fsdbinary`. The
non-FSD `staticdata` entries are an identical set on both.

The `indexes` table names the fields the client itself expects to search on.
For `skins.static` these are `CCP`, `SERENITY`, `TRANQUILITY`,
`isStructureSkin`, `skinMaterialID` and `typeID` — so server visibility is a
first-class lookup in the client, not an afterthought.

## Verification

Verified across all 52,863 records: every field the projection emits matches the
published export, with two understood exceptions. It emits `radius` on 37,261
records the export omits — no presence bit governs that, so the exporter selects
it by a rule the record does not carry — and two types whose description label
resolves to an unresolved placeholder in the client itself. It does **not** emit
`packagedVolume` or `isRepackable`: the export publishes both, the record stores
neither, and a guess is indistinguishable from a measurement downstream.

## Acquisition notes

These belong to tools-core, and are recorded here only because an export
depends on them:

- A fetch resolves to an object carrying both the bytes and a local
  `cachePath`. The path is what lets SQLite open a `.static` file without a
  temporary copy.
- Path matching enumerates `res:` only. App entries need the raw index graph.
- NetEase composes two res indexes, a prefetch index followed by the main one.
- Resolving `latest` for the NetEase provider picks the highest build across
  *all* of its clients, which currently means `infinity` rather than
  `serenity`. Always name the client: the two are different games, so this is
  not a tie-break between equivalent builds.

## What is not yet decided

- Whether the export is produced by the existing archive path under a second
  acquisition source, or by a separate builder emitting the same database shape.
- Whether the three FSD layouts are authored by hand or generated from the
  loader modules.
- What `materialSets` should be for a target that has no source for it.
