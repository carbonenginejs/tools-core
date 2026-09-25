# Frontier universe data: what exists and what is missing

Status: Experimental
Visibility: Internal
Scope: The Frontier SDE build profile and the map tables it does not yet produce
Audience: Anyone adding regions, constellations, systems, planets or stations to Frontier
Summary: Frontier's client ships every static-data file the universe tables are built from; only the build profile's source list is missing them.

## The question

skindr offers regions only for `eve`, `serenity` and `infinity`. Frontier is
excluded, and the assumption behind that was that the client has no map data.

It does.

## Frontier ships every universe source

Checked against `res:/staticdata/` on Frontier build 3512930 and EVE 3503375,
via the resource index. Every file the universe tables read is present in both:

| file | EVE | Frontier | Frontier size |
| --- | --- | --- | --- |
| `regions.static` | yes | yes | 157,937 |
| `constellations.static` | yes | yes | 308,534 |
| `systems.static` | yes | yes | 5,190,306 |
| `solarsystemcontent.static` | yes | yes | 91,588,128 |
| `landmarks.static` | yes | yes | 689 |
| `stationservices.fsdbinary` | yes | yes | — |
| `stationoperations.fsdbinary` | yes | yes | — |
| `factions.fsdbinary` | yes | yes | — |
| `races.fsdbinary` | yes | yes | — |

Frontier's regions, constellations and systems files are each substantially
LARGER than EVE's — its map is its own and bigger, not a subset. The matching
`regions.schema`, `constellations.schema` and `systems.schema` sidecars are
present, which is what the `schemabound` container needs;
`solarsystemcontent.static` is `embeddedschema` and needs no sidecar.

Frontier additionally ships `factionsowningsolarsystems.static`,
`universe_distances.fsdbinary`, `systemstate.fsdbinary` and
`starmapcache.pickle`, none of which any current table reads.

## Nothing new has to be written

The eleven universe sources in `CJS_TOOL_SDE_CLIENT_SOURCES`
(`src/sde/build/defaultClientSdeSources.js`) declare `container: "schemabound"`
or `"embeddedschema"` with `required: false`. They carry **no pinned reader
class** — unlike `types`, `graphics` or `typeDogma`, which are bound to
`CjsFsd64Schema*` readers pinned to a schema identity. The projection side is
shared too: `projectUniverse.js` turns the nested content container into its six
flat tables for every profile that asks for them.

So the gap is one list. `CJS_TOOL_SDE_FRONTIER_SOURCES`
(`src/sde/build/defaultSdeBuildProfiles.js`) declares seven sources — icons,
types, graphics, categories, groups, marketGroups, typeDogma — and none of the
map ones.

## Built, and what it took

Three changes, and one of them was a real gap rather than configuration.

`CJS_TOOL_SDE_FRONTIER_SOURCES` gained the map sources. The two `fsdbinary`
station tables also needed reader entries; the schema-driven map containers did
not, as predicted.

**Frontier declares a schema type the reader did not know: `typeListID`.** It is
in the embedded schema of `solarsystemcontent.static`, on the field
`constructableTypeListID`, in the same node shape as the `graphicID` beside it.
Tranquility has no such type, which is why it had never surfaced. It is now in
the identifier list in
`runtime/src/resource/formats/schemabound/core/schemaBoundValues.js`, which
honours whatever size the schema states rather than assuming one. **That fix
lives in the runtime package**, so tools-core only sees it once runtime is
published; it was verified here by overlaying the built `dist`.

`landmarks` was dropped: Frontier ships `landmarks.static` with no `.schema`
sidecar. `required: false` does not protect against that, because the schema
fetch throws before the optional path is reached. Worth treating as its own
defect.

## The result

| table | rows |
| --- | --- |
| mapRegions | 274 |
| mapConstellations | 2,163 |
| mapSolarSystems | 24,026 |
| mapPlanets | 83,130 |
| mapMoons | 148,167 |
| mapStars | 24,026 |
| mapStargates | 7,072 |
| mapAsteroidBelts | 0 |
| mapSecondarySuns | 0 |
| stationServices | 27 |
| stationOperations | 62 |

24,026 systems against Tranquility's 8,490. `mapStars` matching
`mapSolarSystems` exactly is the consistency check worth having. Belts and
secondary suns are zero, which reads as genuine rather than a decode failure:
the same container yielded planets and moons from the same pass.

The `map` topic is claimed in `defaultTargets.js` and answers 274 / 2,163 /
24,026 with 7,072 stargates and 114,228 names, `degraded: false` — the stored
`mapIndex` derivation is written, so stations orbiting moons take their moon's
name rather than their planet's.

## Still unverified

`projectUniverse.js` carries per-field rules derived by measurement against
Tranquility - which statistics are omitted when they round to zero, and so on.
The tables build and the counts are plausible, but no field-level comparison
against Frontier's own values has been made. Row counts are not field fidelity.

## Unrelated finding, same investigation

Production's Frontier SDE carries four tables — `types`, `graphics`,
`categories`, `groups` — where a locally generated one carries seven, including
`marketGroups` and `typeDogma`. **Both are labelled build 3512930.** The weapons
library requires `graphics, groups, marketGroups, typeDogma, types`, so
`/frontier/latest/weapons` answers 500 in production and 200 locally.

Regenerating an SDE under an unchanged build ref leaves no way for anything
downstream to notice the difference. That is worth a separate decision.
