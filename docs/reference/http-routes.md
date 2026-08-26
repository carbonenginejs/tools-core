# Local HTTP route reference

Status: Stable  
Scope: `@carbonenginejs/tools-core/proxy`  
Audience: Local service and browser integrators  
Summary: Lists the implemented exact-build query, resource, and generated-library route families.

## Build references

**`latest` is not one answer.** This service serves two independently published
bodies of data, and they carry different build numbers:

| Facet | What it is | Serves |
| --- | --- | --- |
| `resources` | the client build the target reports; the file index is keyed by it | `res`, `app`, `resources`, `sof`, `audio`, `character`, `resfiles`, `billboards`, `cubes`, `nebulas` |
| `sde` | the newest SDE, published on its own schedule | `sde`, `icons`, `map`, `skin`, `skinr`, `weapons`, `dogma`, `industry`, `fitting`, `skills` |

The SDE normally trails the client build for a window after each patch, so for
part of most days these are different numbers. `/<target>/<ref>/build` reports
both:

```json
{
  "buildRef": "latest",
  "build": "<resource-build>",
  "builds": { "resources": "<resource-build>", "sde": "<sde-build>" }
}
```

Resolve once, then address every later request by the exact number for the
facet that serves it. An exact build is immutable and cacheable; `latest`
moves. `build` stays equal to `builds.resources` for existing consumers.

**Do not carry a build across facets.** The two numbers are indistinguishable
once a caller holds one, and this service will not stop you:

- an SDE build on a resource route acquires a whole second client build —
  another file index, another `data.black`, another SOF catalog, all cold,
  beside the warm one a build away;
- a client build on an SDE route goes looking for an SDE that may not exist.

There is deliberately no build reference that collapses the two into a single
number. Any such alias has to pick a loser, and pinning resources to the SDE
build causes exactly the second-catalog problem it would be avoiding. New facets
are added to `builds`; consumers pick from it.

### How the pair is chosen

One rule decides every case: **the SDE is never newer than the resource build.**

Pinning names the target version, and the other side is chosen to satisfy that.
Trailing is the safe direction — an older SDE can only omit things, while one
from ahead names types whose resources do not exist yet, so a lookup resolves
and the model behind it 404s. That reads as a broken resource rather than a
mismatched pair, which is why it is worth ruling out structurally.

So `builds.sde` is clamped to `builds.resources`, and a pinned build is reported
for both facets. Send it to both: whether an SDE exists for that exact build
is not the caller's problem. Asking the SDE for a build means "the SDE at or
below it" — the repository probes that build and, when there is no SDE of its
own, trails to the newest prepared one at or below it, naming the build that
actually answered (`source: "newest-prepared-fallback"`). SDEs are published
far less often than client builds, so this is the steady state rather than an
error path.

The reason the rule is enforced by clamping rather than by searching: a specific
build can be probed on either side, but **the set of build numbers that exist
cannot be enumerated** on either side. There is no "next known build after N" to
walk to. Handing the ceiling to the side that can probe is what replaces the
walk. An SDE build is also not guaranteed a resource index — an SDE may be
built at a number that was never publicly released — so nothing here assumes the
two sets coincide.

### Which facet to pin

Pin the facet that caps your answer, and ignore the other one:

- **Resources only** — rendering stored DNA, fetching bytes, reading a SOF
  catalog. Take `builds.resources`. The SDE is irrelevant, so a stale one
  costs nothing.
- **SDE only** — a name or type lookup that goes no further. Ask the `sde` route
  directly; it resolves the newest SDE on its own terms and is free to lead
  the client build, because nothing is being paired.
- **SDE, then the resources it names** — a type or skin lookup whose result is
  then rendered. Pin `builds.sde` for *both*. The SDE is the ceiling: the
  answer can only name what the SDE knows, so a newer file index cannot make
  it fresher, and pairing one in means rendering a build-old answer against
  resources it was not written for.

That last case needs one guard, because an SDE's build may have shipped no
file index: try the resource half at `builds.sde`, and fall forward to
`builds.resources` if it is not there. Forward is the safe direction — later
resources are a superset — and `builds.resources` is the only later build
anyone can name, since build numbers cannot be enumerated.

`builds.sde` is `null` only when there is genuinely nothing to name: no SDE
service is configured, or the SDE channel is unreachable and nothing is
prepared to fall back to. The resource facet is still reported.

## Target and resource routes

```text
GET /targets
GET /eve/latest/build
GET /frontier/latest/build
GET /frontier/latest/res
GET /eve/<exact-build>/res/<path>
GET /eve/<build>/res/resfiles
GET /eve/<build>/resfiles
GET /eve/metadata
GET /serenity/<exact-build>/app/<path>
GET /eve/<build>/<topic>[/<path>]
GET /eve/<build>/resources[/<path>]
GET /eve/<build>/resource[/<path>]
```

**A target is the address.** `provider`, `game` and `client` are things a target
*has*: who controls the data, what groups it, and what produces a build number.

Two provider-shaped routes were removed on 2026-08-15 —
`/games/<game>/providers/<provider>/clients` and
`/games/<game>/providers/<provider>/builds/<build>`. They needed two keys to
reach one answer and separated the four targets only by accident: Eve+ccp,
Frontier+ccp, Eve+serenity and Eve+infinity happen to be distinct pairs, nothing
enforced that they would stay so, and a duplicate target id already throws. Use
`/<target>/metadata` and `/<target>/<build>/build`.

**`/ccp/<build>/…` is also gone**, along with the `ccp → eve` alias behind it. A
provider is not an address: the `ccp` provider covers Frontier as well as EVE, so
the alias only ever meant `eve` by convention. Use `/eve/<build>/…`.

### Describing a target

`/<target>/metadata` answers what a target is, and which build each of its
clients is currently on:

```json
{
  "target": "serenity",
  "provider": "serenity",
  "game": "Eve",
  "clients": [ { "id": "serenity", "token": "SERENITY", "build": "<resource-build>", "error": null } ]
}
```

An unknown target is `404`.

**`clients` is always an array**, including for the providers that publish
exactly one — `serenity`, `infinity`, and `ccp` under `Frontier`. A shape that
collapsed to a bare object for those would make every caller handle two shapes,
and the single-client case is the common one, so it is also the one that would
go untested.

A client that fails to resolve carries its own `error` and a `null` build
instead of failing the request, because a provider is often asked about
precisely when one of its clients is unreachable. An unknown target is `404`.

This is the route that turns a **client name** into a **build number**, and
that is all a client name is for. Everything downstream should carry the
resolved number: a client name and `latest` answer "which build" at the moment
they are asked and mean something different later, so anything stored or cached
under one cannot be matched back to the data it was built from.

An `app` or `res` topic without a path returns the exact resource URL template.
With a path it returns checksum-validated indexed bytes. `?format=json` on a
`.black` resource returns public payload JSON; other extensions return `415`.

The `/<target>/<build>/resources/` subtree is the EVE `res:/` HTTP root. A file
returns bytes and a directory returns its immediate `{ name, path, type }`
children. `/res/resfiles` and `/resfiles` remain compatibility endpoints for
legacy clients; new consumers should use directory and specialized answers.

## Audio media routes

```text
GET  /eve/<build>/audio/id/<mediaID>
HEAD /eve/<build>/audio/id/<mediaID>
GET  /eve/<build>/audio/path/<encoded-audio-path>
HEAD /eve/<build>/audio/path/<encoded-audio-path>
GET  /eve/<build>/audio/library
HEAD /eve/<build>/audio/library
```

The library route returns the prepared exact-build audio library document as
canonical JSON (`library.json` is an accepted alias spelling). It answers with
a weak ETag derived from the document's `generatedAt` and honors
`If-None-Match` with `304`. Serving the document is one of the three sourcing
paths for generated artifacts: clients may equally build it themselves or read
a locally published copy.

Audio routes answer from the prepared exact-build audio library; a missing
library is built automatically from the build's own indexed inputs on its
first request (`--no-audio-auto-prepare` disables this). The repository passes
its validated index/cache source into the runtime audio raw-resource builder and
stores `library.GetValues()`; the HTTP layer does not implement a second join.

The ID route resolves one canonical positive decimal media ID through the
prepared exact-build audio library. Compatible prepared/converted media wins
by default, followed by loose discrete media and then an embedded bank member.
`Accept` overrides that source order and `Accept-Language` influences localized
source selection. A requested language with no matching or neutral source
returns `406`; successful localized answers report the selected tag through
`Content-Language`. Unknown representations remain `application/octet-stream`.

The path route performs one case-insensitive exact reverse lookup against
registered library paths. Encode the complete canonical path as one URL-path
value, for example:

```js
const path = encodeURIComponent("res:/audio/media/123.wem");
const response = await fetch(`${baseUrl}/eve/123456/audio/path/${path}`);
```

It never accepts an arbitrary filesystem path, storage key, or remote URL.
When the selected ID is embedded in a bank, the ID response contains only that
member window; the exact bank remains separately available only through its
registered path.

Both route families accept one standard `Range: bytes=...` header. ID ranges
are relative to the logical sample, while path ranges are relative to the
exact file. Successful ranges return `206`, `Content-Range`, and
`Accept-Ranges: bytes`; invalid or multiple ranges return `416`.

### Optional neutral music routes

```text
GET  /eve/<build>/audio/music
HEAD /eve/<build>/audio/music
GET  /eve/<build>/audio/music/library
HEAD /eve/<build>/audio/music/library
GET  /eve/<build>/audio/music/playlists/<playlistID>
HEAD /eve/<build>/audio/music/playlists/<playlistID>
GET  /eve/<build>/audio/music/playlists/<playlistID>/songs/<songID>
HEAD /eve/<build>/audio/music/playlists/<playlistID>/songs/<songID>
```

The root returns music-library identity plus playlist IDs, names, authors,
versions, total song counts, currently available song counts, and playlist
URLs. A playlist response returns its songs with absolute service URLs and an
`available` flag. A missing local song therefore stays visible as unavailable
without advertising a successful playback endpoint.

The `/library` response is a directly installable
`carbonenginejs.musicLibrary` document. Its absolute song URLs point at the
service, pin the resolved exact build even when the request used a friendly
build reference, and currently unavailable songs are omitted.

Song `GET` and `HEAD` are restricted to members of the configured,
catalog validated by the runtime audio layer. The route never accepts an arbitrary
filesystem path. Successful song responses expose playlist/song IDs, media
type, byte length, ETag, and standard single-range support.

The command-line service enables these endpoints only when both
`--music-library <catalog.json>` and `--music-directory <root>` are supplied.
Under the directory, an explicit safe relative song `path` wins; otherwise
the service looks for `<playlistID>/<songID>.<extension>`.

## Derived resource answers

```text
GET  /eve/<build>/billboards
GET  /eve/<build>/nebulas
GET  /eve/<build>/cubes
GET  /eve/<build>/sof/hulls/<hull>/respathinserts
POST /eve/<build>/sof/hulls/<hull>/respathinserts/<insert>/resolve
```

The resolve request accepts `{ "paths": [...] }` and returns a positional
array. It inserts only candidates present in the composed exact-build resource
view and otherwise returns the original path.

## GPU-free SOF routes

The command-line service opens the selected exact resource build and gives the
runtime SOF layer the complete composed `res:/` file list. Its default lazy
mode boots `res:/dx9/model/spaceobjectfactory/generic.black`, enumerates
collection names from the index without decoding them, and loads individual
named Black records when a route needs them. Pass `--sof-full` to fetch and
decode `res:/dx9/model/spaceobjectfactory/data.black` when the build is opened.

```text
GET /eve/<build>/sof/hulls
GET /eve/<build>/sof/factions
GET /eve/<build>/sof/races
GET /eve/<build>/sof/materials
GET /eve/<build>/sof/layouts
GET /eve/<build>/sof/patterns

GET /eve/<build>/sof/hulls/<hull>
GET /eve/<build>/sof/hulls/<hull>/patterns/
GET /eve/<build>/sof/factions/<faction>
GET /eve/<build>/sof/races/<race>
GET /eve/<build>/sof/materials/<material>
GET /eve/<build>/sof/layouts/<layout>
GET /eve/<build>/sof/patterns/<pattern>/hulls/<hull>
GET /eve/<build>/sof/dna/<dna>
GET /eve/<build>/sof/dna/<dna>/expanded
GET /eve/<build>/sof/dna/<dna>/visibilityGroups
```

Collections are sorted unique canonical lowercase names. Detail lookups are
case-insensitive and return the runtime SOF layer's detached catalog record
directly in JSON-compatible form. The combined runtime SOF layer owns the
conversion of nested Maps, Sets, typed arrays, and model values; tools-core does
not define a second catalog shape. The pattern/hull route returns only that one
runtime SOF pattern application. The hull/patterns route returns the sorted
canonical names of patterns with a runtime SOF application for that hull. In
lazy mode that one relation requires reading the indexed pattern records; use
`--sof-full` for workloads that repeatedly scan whole catalogs. A known hull
without applications returns `[]`; an unknown hull returns `404`.

The DNA route returns the runtime SOF layer's plain **model-values graph**: one nested,
JSON-compatible value carrying `_type` on polymorphic nodes and `_id`/`_ref`
only where topology demands shared identity. A consumer rebuilds it directly
with `RootClass.from(values)`.

The `/expanded` suffix returns the same wrapper-free values shape with the
registered runtime Trinity and audio class defaults filled in. Tools-core loads
those class families, then asks the runtime SOF projection for
`populateDefaults: true`; it does not maintain a second defaults algorithm. The
plain-data operation uses `CjsSchema.applyDefaults`: constructors are used only
to discover a class's cached field-initializer defaults, and the authored graph
is never hydrated or initialized. Authored properties win, collections replace
their defaults, structs merge, and `_id`/`_ref` are preserved. The unsuffixed
route remains the canonical sparse SOF answer.

The former `/document` suffix is intentionally not exposed. Document-building
APIs remain internal compatibility/diagnostic surfaces while their non-HTTP
consumers migrate; HTTP consumers receive only model values.

The selector is a path segment rather than a `?format=` query for a concrete
reason: a DNA command separator may be sent either as a literal `?` or as `%3F`,
and the service treats a literal `?` after `/sof/dna/` as part of the DNA rather
than discarding it as an HTTP query. A query parameter here would be read as DNA
and the lookup would fail.

The sparse values route loads no graph classes. The `/expanded` route lazily
loads both runtime Trinity and runtime audio class families because SOF names
`AudEmitter` in `TriObserverLocal.observer`. Those subpaths are data-only and
create no AudioContext, but every emitted `_type` must resolve; unknown fragment
types fail explicitly.

The `visibilityGroups` route reports how the DNA's faction gates the selected
hulls' attachment sets: the groups the faction `declared`, the groups the hulls
`authored`, the resulting `visible` and `hidden` names, and one record per
gated set. It answers which sets a build emits without building the object.

Friendly builds resolve through the normal target index policy. Response
headers report the selected exact numeric build, and the decoded catalog is
reused by exact target/build identity. Missing records or unbuildable
selections return `404`, malformed paths or DNA return `400`, and catalog/DNA
routes return `501` only when the SOF service is not configured.

## SDE routes

```text
GET /eve/latest/sde
GET /eve/<sde-build>/sde/<table>?limit=100&offset=0
GET /eve/<sde-build>/sde/<table>/<id>
GET /eve/<sde-build>/sde/<table>?query=<text>
GET /eve/<sde-build>/sde/<table>?field=groupID&value=25
GET /eve/<sde-build>/sde/skins?field=types&contains=587
GET /serenity/latest/sde[/<table>[/<id>]]
GET /infinity/latest/sde[/<table>[/<id>]]
```

These routes read the SDE's tables as they were published. They are
**inspection**: a way to reach the ninety-odd tables nothing has wrapped yet,
and a way to check a composed answer against its source. They are not the
supported consumer surface, because language resolution, per-world labels,
derivations and sidecars all live in the composed topics, and those are exactly
what a table read leaves a consumer to get wrong. Reaching for `sde/*` in a
product means an endpoint is missing.

## Icon routes

```text
GET /<target>/<sde-build>/icons
GET /<target>/<sde-build>/icons/<iconID>
```

The collection is keyed by icon identifier; detail returns the same record:

```json
{
  "iconID": 355,
  "resPath": "res:/ui/texture/icons/13_64_10.png"
}
```

`resPath` is lower-case and always has an explicit extension. Existing
extensions such as `.jpg` are retained; a source path with no extension denotes
a PNG. Consumers fetch it through the ordinary resource route.

This is not a duplicate of CCP's image service. That service accepts a
`typeID` at `types/<typeID>/icon`; an SDE `iconID` identifies a UI/category icon
and has no image-service category. Raw source spelling remains available from
`sde/icons` for inspection.

## DNA routes

```text
GET /eve/<sde-build>/dna/resolve?typeID=587&skinID=<skin-id>
GET /eve/<sde-build>/dna/resolve?name=<type-name>
GET /eve/<sde-build>/dna/search?q=<term>&limit=40
```

Neither is a table lookup, which is why neither lives under `sde` — they were
there until 2026-08-17 and moved out unaliased.

`dna/resolve` answers type + skin -> DNA. `dna/search` is the inverse, and takes
a whole DNA, a partial one, or any single part of one — a hull, faction, race,
pattern, material or insert:

```jsonc
{
  "target": "eve", "build": "<sde-build>", "query": "ab1_t1",
  "total": 68, "truncated": false,
  "matches": [
    { "base": "ab1_t1:amarrbase:amarr", "mesh": null, "pattern": null,
      "resPathInsert": null, "typeID": 642, "skinID": null,
      "dna": "ab1_t1:amarrbase:amarr", "exact": true, "extra": 0, "matched": 0 }
  ]
}
```

The query goes in `q` rather than the path because a DNA carries `:` and `;`,
which a path would force every caller to encode. `total` is the count before
`limit`, so a caller can tell a page from the whole answer.

A DNA is matched as a record, not a string: only the first three segments are
positional, the clauses may appear in any order, and ranking prefers exact
record matches before partial matches. `BuildDnaIndex` owns the stored index
shape and `QueryDnaIndex` owns this matching contract.

SDE `latest` resolves independently from app/resource `latest`, and **an SDE is
never guaranteed to match the current client build**, because the two are
published on unrelated schedules. Treat an SDE answer as reference data keyed by
its own SDE build, never as an attribute of the resource build, and never put
the `build` field of an SDE response onto a resource route. Resolve both facets
once from `/<target>/latest/build`. See [Build references](#build-references).

Serenity and Infinity use their own generated SDEs. They never answer from the
EVE SDE as an implicit provider fallback; when a target has no prepared source,
the request fails rather than returning another world's data.

Preparation is therefore forward-looking with a staleness fallback. A missing
SDE is prepared on its first request by default (`--no-sde-auto-prepare`
disables this), and when a newer one cannot be acquired the service answers from
the **newest prepared SDE it has** rather than failing, because a stale SDE is
the expected steady state and an older one generally cannot be re-acquired.
Response headers report the SDE build that actually answered, so a consumer can
always tell which one it is reading. A richer surface for reporting
resource-build/SDE-build divergence is planned but not yet specified.

## Skill plan route

```
GET  /<target>/<build>/skills/plan?skills=20531,11207
POST /<target>/<build>/skills/plan     { "skills": [ 20531, 11207 ] }
```

### Planning from skills rather than from a thing

`skills/types/{id}` answers *what does this hull need*. This answers *what do
these skills need*, which is the question a training plan actually starts from,
and it takes several at once because the useful answer is one plan rather than
several lists to reconcile.

**Identifiers only — no levels in.** A skill's prerequisites are fixed on the
skill and do not change with the level being trained to, so a level in the
request could only ever be ignored. The older `id:level` spelling is still
parsed and the level discarded, so a stale caller keeps working.

POST exists because a plan assembled from a fitting carries dozens of ids,
which is more than a query string should hold.

### Two answers, because one screen needs both

**`outline`** is one line per edge, depth-first, **with repeats**. That is what
the in-game requirement panel draws: a skill appears once per parent that
demands it, so Spaceship Command can appear five times at I through V, and
`depth` is the indent. The repetition is the explanation of *why* each
requirement is there, and collapsing it would remove exactly that.

**`skills`** is the same graph collapsed — one entry per skill, keyed by id, at
the **highest level any path demands**. This is what a training plan and a
skill-point total need. Taking the first level found instead of the highest
produces a plan that does not actually unlock the thing.

```json
"3327": {
  "level": 5, "depth": 3, "requested": false,
  "requiredBy": [ 3328, 3332, 3336, 20342, 33097 ],
  "name": { "text": "Spaceship Command", "language": "en" }
}
```

`requiredBy` is **plural** because this is a graph, not a tree: one ordinary
plan has a single skill required by five different parents, and a singular
field would keep one and silently lose four.

Keys are in trainable order — deepest first, since a prerequisite is deeper
than the thing it unlocks — so following them top to bottom never reaches a
skill whose own requirements are still untrained.

### Levels are data, not inference

The level on each requirement is a `requiredSkillNLevel` attribute, one of six
pairs whose ids run 182–184 and then 1285–1290. The numbering looks regular for
the first three and is not, which is the specific mistake this service exists
to prevent — so the level is returned rather than left to the caller.

This route needs no authorization and reads no character. It is the published
requirement, not anybody's progress, so it answers on every target including
those with no ESI at all.
## Type routes

```
GET /<target>/<build>/types                       what this answer is built from
GET /<target>/<build>/types/<typeID>              one composed type
GET /<target>/<build>/types/<typeID>/variations   the family it belongs to
GET /<target>/<build>/types/<typeID>/traits       its skill and role bonuses
GET /<target>/<build>/types/<typeID>/mastery      what each mastery level needs
```

A **composed** answer, not a table row. `sde/types/{id}` returns the published
row inside a `payload` wrapper and goes on meaning exactly that — the SDE's own
data and nothing else. This route is the identity plus the fields the SDE does
not carry.

That separation is the point rather than a detail. Some of what this route
returns is a reading of ours rather than a published row, and putting such a
reading inside a route that says *here is the SDE row* would make it
indistinguishable from published data, in the place a consumer is least likely
to look.

```json
{
  "typeID": 28661,
  "name":        { "text": "Kronos", "language": "en" },
  "groupID": 900, "volume": 486000, "published": true,
  "manufacturers": [ 1000109 ],
  "manufacturerNames": { "1000109": { "text": "Duvolle Laboratories", "language": "en" } },
  "quote":       { "text": "Unparalleled innovation has led to undeniable strength.", "language": "en" },
  "quoteAuthor": { "text": "Joroutte Duvolle", "language": "en" }
}
```

`?lang=` picks the language, and every resolved value reports the language it
actually got. It never assumes English: a zh-primary target carries `zh` and no
`en` at all, so an `en`-only reader would report every type as nameless.

### Absent, empty, and present are three different answers

| returned | means |
| --- | --- |
| field absent | there is no reading for this type |
| `"manufacturers": []` | the source says this type has none |
| a value | the source's answer |

A few hundred of some fifty thousand types carry `manufacturers`, so **absent is
the ordinary case**, and a field with no reading is omitted rather than
defaulted to `null` or `[]`. Defaulting on the way out would erase the only
distinction a consumer needs. What to show for an absent field is the
consumer's decision, not this route's.

### Names sit beside identifiers, never instead of them

`manufacturers` stays identifiers because it is many-to-one and the identifier
is the join key into `npcCorporations`. `manufacturerNames` is added because
**corporation names are per-world**: a target's own labels are the only correct
labels for that target, so another world's English is the wrong world's name on
a zh-primary target rather than a better one. This route knows which world it is
serving; a consumer joining by hand would have to fetch `npcCorporations` per
target and get the language rule right in every consumer, forever — and a
mistake there looks like a wrong manufacturer rather than a wrong lookup.

The same rule adds the taxonomy: `groupName`, `metaGroupName`, `factionName`
and `raceName` sit beside their identifiers, and `categoryID`/`categoryName`
come from the **group**, because that is where the SDE puts them. The
category is what answers *is this a ship*, which is the question a consumer
otherwise reaches for a raw table to settle — and having settled it, reaches for
three more to put words on the answer.

`graphics` maps a role to a **loadable** path — `model` and `iconFolder` — with
`graphicID` kept as the provenance pointer, the same shape the map topic uses.
The SDE names a `.red` container that the resource route does not serve, so
reading the raw graphics row hands a consumer an address that 404s.

### Variations

```json
{
  "typeID": 12032, "parentTypeID": 602,
  "variations": [
    { "typeID": 602, "name": { "text": "Kestrel", "language": "en" },
      "groupID": 25, "groupName": { "text": "Frigate", "language": "en" }, "categoryID": 6 },
    { "typeID": 12032, "name": { "text": "Manticore", "language": "en" },
      "groupID": 834, "groupName": { "text": "Stealth Bomber", "language": "en" }, "categoryID": 6 }
  ]
}
```

The SDE models this with a single upward pointer: a variation names its
parent and the parent names nobody. So the answer is **anchored on the parent**
and includes it — a caller asking about a Tech II hull means "what else is this
ship", not "what descends from this exact row", and asking about either member
returns the same family.

Unpublished rows are dropped. They are the SDE's record of things removed
from the game, and listing one beside current hulls presents something nobody
can fly as a choice.

Faction hulls are **not** variations here, because the SDE does not say they
are: a navy frigate carries no `variationParentTypeID` at all. That is the
published model, not an omission this route makes.

### Traits

`skillBonuses` groups by the skill each bonus scales with, `roleBonuses` are the
hull's own. Every bonus keeps the **number apart from the sentence** —

```jsonc
{ "bonus": 7.5, "unitID": 105, "unit": { "text": "%", "language": "en" },
  "importance": 1,
  "text": { "text": "bonus to <a href=showinfo:3307>Large Hybrid Turret</a> tracking speed",
            "language": "en" } }
```

— because that is how the SDE stores it, and joining them into one string is
a presentation decision this layer does not get to make for everybody. The unit
is looked up rather than assumed: consumers all special-case `105` because
nothing told them what else exists.

**The markup is deliberate.** `<a href=showinfo:…>` names the thing a bonus
applies to and is the only machine-readable part of a human sentence. A consumer
that cannot render links strips it; one that can, resolves it.

Bonuses come ordered by the SDE's own `importance`, which is not their array
order. A type with no bonus row answers with empty lists — most things in the
game have no traits, and that is not a failure.

### Mastery

The three-table join — masteries name certificates, certificates name skills,
and each certificate states a different required level per tier — with the
**highest requirement across a tier's certificates** winning.

```jsonc
{ "typeID": 641, "complete": true,
  "levels": [ { "level": 1, "certificateCount": 8,
                "requirements": [ { "typeID": 3426, "level": 3,
                                    "name": { "text": "CPU Management", "language": "en" } } ] } ] }
```

`complete` is part of the answer because the failure is silent in the worst
direction: an unreadable certificate drops its requirements, and a requirement
set that lost members looks *easier* — which reads as a mastery already
achieved. An incomplete join therefore answers `complete: false` with no levels
at all, rather than a shorter list that looks like an answer.

`level` is one-based here and zero-based in the SDE. Converting once means
one place gets it wrong instead of every consumer.

### What it deliberately does not include

`dogma`, `industry` and `skills` are their own routes. They are expensive, they
are separate answers, and a panel wants them separately anyway — folding them
in would make every type lookup pay for all three.

### Where the extra fields come from

Two sources, in order: **the SDE, then a sidecar beside it, then silence.**
An SDE that carries these fields itself wins, because it is the target's own
data. Otherwise the answer comes from a file next to the database named
`typeExtras_v1.json`, stamped with its target and build, following the same path
rule as every other derived artifact.

This package only ever **consumes** that file. How it is produced is not its
concern, and keeping it that way is deliberate: the moment this route knows how
the artifact is made, it acquires an opinion about tooling it should not have.
A build with no such file simply answers without those fields.
## Map routes

New Eden as addressable documents: regions, constellations, systems, and the
celestials inside them.

```text
GET /eve/<sde-build>/map
GET /eve/<sde-build>/map/search?q=<text>&kind=<kind>&limit=25
GET /eve/<sde-build>/map/regions
GET /eve/<sde-build>/map/regions/<regionID>
GET /eve/<sde-build>/map/regions/<regionID>/constellations
GET /eve/<sde-build>/map/constellations/<constellationID>
GET /eve/<sde-build>/map/constellations/<constellationID>/systems
GET /eve/<sde-build>/map/systems/<systemID>
GET /eve/<sde-build>/map/systems/<systemID>/celestials?kind=planet,moon
GET /eve/<sde-build>/map/systems/<systemID>/{stars|planets|moons|belts|stations|stargates}
GET /eve/<sde-build>/map/celestials/<celestialID>
```

`jumpgates` is accepted as an alias for `stargates`. Every entity is addressable
by its own id; the nested forms are for navigation and are never required to
reach a record.

### Ids do not tell you what a thing is

`mapStars`, `mapPlanets`, `mapMoons` and `mapAsteroidBelts` all occupy the
40000000 range and interleave — 40000002 is a planet, 40000003 a belt, 40000004
a moon. `map/celestials/<id>` probes the tables rather than reading the range,
and anything deciding a kind from an id is guessing.

### Vectors are arrays

Positions are `[x, y, z]` and rotations are `[x, y, z, w]`, not `{x, y, z}`
objects, so they can be handed straight to gl-matrix or a typed array with no
conversion pass. The component order, the forward and up axes and the handedness
are declared once in each answer's `frame` block rather than repeated as key
names on every vector — which is what keeps the compact form self-describing.

The star is always at `[0, 0, 0]`. The SDE omits its position entirely
because it *is* the system origin, and that is measured rather than assumed:
across all 68023 planets the distance from the origin matches the planet's own
published `orbitRadius` to within 0.0001%. The map supplies it so no consumer
has to carry that special case.

### One shape for every graphic

Anything with artwork carries `graphicID` as the provenance pointer and a
`graphics` object mapping a role to a **loadable** path:

| Entity | Roles |
| --- | --- |
| region / constellation / system nebula | `scene` |
| star | `model` |
| planet, moon | `model`, `shaderPreset`, `heightMap1`, `heightMap2` |
| belt, station, stargate | `model` |

Paths are rewritten to the form the resource route actually serves: `.red`
becomes `.black`, and case is normalised. The SDE names the legacy `.red`
container, which is not served — emitting it verbatim hands the consumer an
address that 404s and makes a naming problem look like a missing asset. Only the
container extension is touched; a `.dds` or `.gr2` is already the served name.

The unmodified SDE string is deliberately not duplicated into the answer.
`graphicID` points at it, and `GET /{target}/{build}/sde/graphics/{id}` returns
it exactly as published.

### The nebula is on every level

The background belongs to the region, but every level of the answer carries it
resolved — region, constellation, system, a system's celestials, and search
results — so drawing a system never costs three requests. Below the region it is
stamped `fromRegionID`, because a system does not author a backdrop and a
consumer that thinks otherwise will build a control that cannot work.

### Positions, and the float32 problem

EVE positions are float64 metres and renderers are float32. Every answer that
carries a position also carries a `frame` block declaring what the numbers mean.
Nothing is rounded on the way out.

Measured in one prepared SDE, comparing the float32 quantum at each magnitude
against the size of the object being positioned:

| Frame | Median error | Objects smaller than their own error |
| --- | --- | --- |
| Galactic (system positions) | 3.4e10 m | everything — 115 light-seconds |
| System-relative, moons | 2.6e5 m | none: 0 of 344457 fall inside their planet |
| System-relative, stations | 6.6e4 m | 91.2% — a station is ~10 km |
| System-relative, stargates | 2.6e5 m | 99.8% — a gate is ~2.5 km |
| Parent-relative (`localPosition`) | 1.3e-1 m | 0.02% of stations |

Three rules follow:

- **Never send a system's own `position` to a renderer.** It is galactic, for
  map layout and for the stargate orientation rule.
- **System-relative placement is sound between bodies.** The moon-inside-its-
  planet failure does not occur anywhere in the cluster.
- **Use `localPosition` for anything built.** Relative to its parent, a
  station's error drops from 65 km to 12 cm. Each celestial reports its parent
  as `orbit: { id, kind }`.

Stargates carry no `orbitID` — not one of the 13978 — so they cannot be made
parent-relative, and a consumer that flies to one must re-origin on the camera.

### What is computed rather than published

| Field | Rule |
| --- | --- |
| Celestial `name` | The SDE ships none for planets, moons, belts, stations, stars or gates. Composed the way the game presents them: `Jita IV - Moon 4 - Caldari Navy Assembly Plant`. |
| Stargate `direction` / `rotation` | A gate faces its destination *system*. Not published anywhere; reported with `orientationRule` so a computed orientation is distinguishable from a read one. `direction` is convention-free, `rotation` assumes +Z forward, +Y up, right-handed. |
| `scene.sun.color` | Blackbody colour from the star's temperature, via the Planckian locus. Linear RGB, not gamma encoded. |
| `scene.sun.intensity` | A presentation curve — the fourth root of luminosity over the cluster median — not a physical quantity. Raw `luminosity` is reported beside it. |
| `scene.nebula.scenePath` | The region's `nebulaID` graphic, `.red` rewritten to `.black` and lower-cased. `graphicFile` keeps the SDE's own string. |
| `scene.postProcess` | Always `null`. Nothing in the SDE or in any nebula scene names a post process for a location; environment volumes placed in space carry it instead, and those are not part of the SDE. `null` means "choose one", and is not a gap to be filled with a guess. |

Names, orientations and the search index come from the `mapIndex` derivation.
`GET /map` reports whether it is present and whether it is `degraded` — the
degraded path rebuilds in memory without `mapMoons`, which names stations one
level coarser. Materialise it for a database already on disk with:

```sh
node bin/cjs-sde-prepare.js --build <build> --refresh
```

which recomputes derivations and query indexes without re-acquiring the archive.

## Dogma routes

What a type's attributes are, and what they become once skills are applied.

```text
GET  /<target>/<sde-build>/dogma
GET  /<target>/<sde-build>/dogma/types/<typeID>?sections=fitting&lang=en
POST /<target>/<sde-build>/dogma/evaluate
```

The `GET` form evaluates the published hull with no skills, so it is cacheable
by URL alone. The `POST` form takes a profile. It is a `POST` because a complete
skill map does not fit a query string, and it mutates nothing: the same body
always answers the same way for a given build.

```jsonc
{
  "typeID": 12743,
  "profile": {
    "mode": "none | manual | automatic",
    "skills": [ { "typeID": 3426, "level": 5 } ]
  },
  "sections": [ "fitting" ]
}
```

The answer separates what was published from what was computed, and says who
did the computing:

```jsonc
{
  "target": "eve", "provider": "ccp", "build": "<sde-build>",
  "typeID": 12743,
  "name": { "text": "Viator", "language": "en" },
  "profile": { "mode": "manual", "skillCount": 2, "skillHash": "…" },
  "base":      { "cpuOutput": 250,   "powerOutput": 135 },
  "effective": { "cpuOutput": 312.5, "powerOutput": 168.75 },
  "applied": [
    { "attribute": "cpuOutput", "operation": "postPercent", "amount": 25,
      "effectID": 397, "sourceTypeID": 3426, "sourceLevel": 5,
      "from": 250, "to": 312.5 }
  ],
  "unsupportedEffects": [],
  "unavailableAttributes": []
}
```

### The three modes are provenance, not arithmetic

`none`, `manual` and `automatic` compute identically for identical skill maps.
The mode records where the levels came from — nothing supplied, a user's choice,
or a character an application backend authorized — and is echoed back untouched.
A failed automatic lookup must never be re-sent as `none`: it would produce a
correct zero-skill answer that a UI would then present as the pilot's own.

Character identity is deliberately absent. Two pilots with the same relevant
skills produce the same numbers, so the cache key is the skill hash and no
personal identifier enters the computation.

### What is evaluated, and what is refused

`sections` names what to evaluate. An unknown section is a `400`, never an empty
result.

| section | what it covers |
| --- | --- |
| `fitting` | an empty hull's capacity: CPU, power grid, calibration, the four slot counts, turret and launcher hardpoints, drone capacity and bandwidth |
| `defense` | shield, armor and structure hitpoints with **all twelve resonances** — survivability is not readable one layer at a time |
| `capacitor` | capacity and recharge |
| `navigation` | velocity, inertia, warp speed |
| `targeting` | range, locked targets, signature, scan resolution, the four sensor strengths |
| `drones` | capacity and bandwidth |
| `skillRequirements` | the six published requirement pairs |

Sections exist so a caller asks for **what it will display**: evaluating
everything a hull has would apply modifiers nobody reads.

`skillRequirements` is a fallback for a target with no skills service. Where
`skills/types/{id}` exists it is the better answer — it resolves the whole
closure, and these six pairs are only its first level.

This is a **bare hull**. Modules, charges, rigs, subsystems, implants, boosters,
fleet effects, heat and stacking penalties are not applied. A modifier that
would need them is reported in `unsupportedEffects` with a reason rather than
skipped, so nothing silently goes missing:

| Reason | Meaning |
| --- | --- |
| `requires-fitted-items` | a location modifier — real, but it acts on modules a bare hull does not have |
| `unknown-operation` | an opcode outside the published table |
| `unknown-modifier-function` | a modifier function this SDE uses and this service does not implement |

`unavailableAttributes` is the matching statement for inputs: an attribute
absent from this SDE, or present with no published value.

### Attributes are resolved by name, never by number

`cpuOutput` is attribute 48 in all three current SDEs, and this service still
looks it up by name on every build. Hard-coded IDs are the likeliest thing to be
quietly wrong on a target nobody checked, and the three targets carry genuinely
different data — Infinity has roughly twice the dogma effects Eve does.

For the same reason nothing here assumes English. Serenity and Infinity carry
`zh` and no `en` at all, so `name` reports the language it actually used.

### English on the zh-primary targets

`?lang=en` answers from the target's **own** English table:

```jsonc
"name": {
  "text": "Viator", "language": "en",
  "source": "published",              // published | crosswalk | manual
  "evidence": null
}
```

The Chinese is not discarded — it stays on the row (`name.zh`), which is where a
UI should read it. `evidence`, `referenceBuild` and the nested `local` object
belonged to the crosswalk below and are absent from a published name, because a
name taken from the target's own table crosses nothing.

**The crosswalk is retired as a naming path, and kept as evidence.** A
zh-primary target writes its own English, and it deliberately differs from a
reference target's, so a borrowed name was never wrong so much as the wrong
world's — the same class of mistake as `latest` resolving across two worlds. The
rule that follows is short: **for a given target, we serve that target's own
labels and reconcile them against nothing**, neither against a reference
target's English nor against the target's own Chinese, even where a target's own
two languages disagree with each other.

### The crosswalk, as evidence

Identity is corroborated, not assumed. Where two targets independently give the
same ID the same Chinese name, no inference was made at all, and `evidence`
records what a crossed name rests on:

| `evidence` | Meaning |
| --- | --- |
| `chinese-identical` | both sources name this ID identically in Chinese |
| `local-rename` | same ID and same structure, renamed for the local target |
| `id-only` | shared ID, and no Chinese on the reference side to compare |

`local-rename` is systematic rather than random: the object is the same and the
local name is deliberately different, which is what `local` is there for, and a
UI showing the crossed English for one of these should say whose name it is.
Where structure disagrees the name is **refused**, because a reused identifier
is the one thing that would produce a confidently wrong name.

### The gap, and the two ways it is filled

Some types exist only on a zh-primary target, so no English exists anywhere to
borrow: 1995 published types on Serenity and 6299 on Infinity, 27% of them
shared. Two sources cover those, and `source` always says which:

| `source` | What it is |
| --- | --- |
| `manual` | written by hand in `src/localisation/en.json`, keyed by type ID |
| `ai` | machine-composed, and the lowest authority here |

A hand-written name always wins. Where neither exists the answer is an honest
`null` with the Chinese name beside it.

```sh
node bin/cjs-localisation-gaps.js --target infinity --format groups
node bin/cjs-localisation-gaps.js --target serenity --format template > gaps.json
```

`groups` shows where the work is concentrated — on Serenity, 782 of the 1995 are
boosters and 155 are permanent SKINs, so whole families can be named at once.
`template` emits a fill-in file the manual reader accepts as-is. The gap list
deliberately ignores guessed names: a machine reading does not retire the need
for a real one.

### Guessed names, and why they are worth having

`bin/cjs-localisation-guess.js` composes English for those types out of a
reference target's own translations, rather than translating from scratch. Most
of what a zh-primary target adds is built from vocabulary the reference target
already names:

```text
加达里海军霍克比尔级 翻新组件  ->  Caldari Navy Hookbill Refurbishment Component
国庆限定 '硬壳' 药剂 A型       ->  National Day Limited 'Hardshell' Booster Type A
```

Two dictionaries drive it. The reference target's own `zh`→`en` gives 49212
pairs; a second is built from the *local* SDE's Chinese mapped through shared
type IDs, which is what catches a hull the local target renamed — the reference
writes the Vindicator 惩戒者级 where the local target writes 惩戒级, so anything
named after that hull matches only the second. A small hand-written vocabulary
covers the words the reference target never had a reason to name (`翻新组件`,
season passes, celebration boosters), chosen by measured frequency rather than
intuition.

Measured over all 8275 gaps: **65.1% compose with nothing left untranslated**,
28.0% are partial, and 6.8% are refused outright. A partial keeps the
untranslated Chinese in place rather than dropping it, so a reader can see which
part is a guess — usually an event or codename where leaving it is better than
inventing one. `confidence` reports `composed` or `partial`.

This is a **cross-target pass and cannot run during import**, because it needs
the reference target's SDE as well as the one being named, and the import path
only sees the database it just wrote. It writes an `englishNames` derivation artifact beside
that build's database, under the same version-token rule as every other
derivation, so it is invalidated the same way and a build without one simply
serves no guessed names.

```sh
node bin/cjs-localisation-guess.js --target serenity --target infinity --write
```

Run it without `--write` to review a vocabulary change before it lands.

## Industry routes

The public, base recipe for one type.

```text
GET /<target>/<sde-build>/industry/types/<typeID>?lang=en
```

```jsonc
{
  "target": "eve", "provider": "ccp", "build": "<sde-build>",
  "type": { "typeID": 12743, "name": { "text": "Viator", "language": "en" } },
  "blueprint": {
    "typeID": 12744,
    "activities": [ "copying", "invention", "manufacturing", "research_material" ],
    "manufacturing": { "time": 0, "materials": [], "products": [], "skills": [] }
  },
  "reprocessedMaterials": [],
  "unsupportedSections": []
}
```

### Two material lists that are never the same list

`manufacturing.materials` is what you supply to **build** one.
`reprocessedMaterials` is what you get back when one is **reprocessed**, which
is what the in-game reprocessing panel shows. They overlap enough to look
interchangeable and are never equal, so neither is derived from the other.

How they differ depends on the tech level, which is why no rule should be
inferred from one example. In one prepared SDE the T2 Viator reprocesses
into its manufacturing inputs at identical quantities, minus the T1 hull it was
built from and the R.A.M. consumed; the T1 Rifter keeps every material but
returns fewer of each — 32000 Tritanium in, 13333 out.

### It needs no authorization, and ESI cannot replace it

This is the recipe, not anybody's blueprint, so it is public. A pilot's owned
copies, their material and time efficiency, facility and rig bonuses, the system
cost index and taxes are later inputs applied *to* this answer and must never
overwrite it. ESI has no endpoint for the static recipe at all — its blueprint
endpoints return owned instances — which is why the SDE is required here.

A type that exists but cannot be built answers `blueprint: null` with a reason
in `unsupportedSections`; only an unknown type is a `404`.

## Skills routes

What a thing needs trained, and what a skill opens up. Published data, so no
authorization — and it works on the zh-primary targets, which have no ESI at all.

```text
GET /<target>/<sde-build>/skills/types/<typeID>?lang=en
GET /<target>/<sde-build>/skills/<skillTypeID>?lang=en
```

`skills/types/{id}` answers `required` (what is written on the type),
`closure` (everything reachable, shallowest first) and `masteries`.
`skills/{id}` answers a skill's `rank`, its own prerequisites, and `unlocks`.

### The closure is the part worth having

The SDE states requirements as six attribute pairs on the type, and a skill
has prerequisites of its own, so the direct list is never the training plan. A
Viator asks for Gallente Hauler V and Transport Ships I; behind those sit
Spaceship Command III and Industry V, which nothing on the hull mentions.

**The closure keeps the highest level any path demands.** Two routes to the same
skill at III and V mean V, and reporting the first found would produce a plan
that does not unlock the hull.

### Why the pairing cannot be computed

The attribute IDs look regular and are not: `requiredSkill1..3` are 182–184 with
levels at 277–279, but the fourth is 1285 with its level at **1286**, while the
fifth is 1289 with its level at **1287**. Anything assuming a fixed offset
mispairs the last three silently. They are resolved by name here for that reason.

A requirement with no level is level I — the SDE omits the value rather than
writing 1.

`unlocks` is the reverse direction, which the SDE does not publish at all: it
costs one pass over `typeDogma` (26828 rows) and is held per open build.
Unpublished types are excluded, so a retired duplicate cannot appear as
something a skill unlocks.

## Fitting routes

Pasted fits in, one normalized loadout out.

```text
GET  /<target>/<sde-build>/fitting
POST /<target>/<sde-build>/fitting/parse?lang=en
```

`POST` because a fit is pasted: EFT is multi-line and a chat link carries angle
brackets, neither of which belongs in a query string. It stores nothing — the
same text always parses the same way for a given build.

```jsonc
{ "text": "[Rifter, My Fit]\n\nDamage Control II\n…" }   // EFT, DNA, or a chat link
{ "fitting": { "ship_type_id": 587, "items": [ … ] } }   // an ESI saved fitting
```

Both forms answer the same record, plus every wire form beside it, so a caller
that pasted EFT can hand back a chat link without a second call:

```jsonc
{
  "target": "eve", "build": "<sde-build>",
  "source": { "kind": "eft", "fittingID": null },
  "name": "My Fit", "shipTypeID": 587, "shipName": "Rifter",
  "items": [
    { "typeID": 2913, "name": "425mm AutoCannon II", "quantity": 1,
      "flag": "HiSlot0", "slot": "high", "position": 0, "fitted": true,
      "category": "module" }
  ],
  "formats": { "dna": "587:2913;2:…::", "chatLink": "<url=fitting:…>My Fit</url>", "eft": "[Rifter, My Fit]\n…" }
}
```

### Slot comes from the type, never from the text

`dogmaEffects` names the slot: `loPower`, `medPower`, `hiPower`, `rigSlot`,
`subSystem`, `serviceSlot`. Those are resolved by name, not by the IDs they
happen to hold, for the same reason dogma attributes are.

That is not a preference, it is forced. **Fitting DNA does not delimit its
sections**: the published grammar reads
`SHIP ':' HIGHS ':' MEDS ':' LOWS ':' RIGS ':' CHARGES`, but each of those is
itself a `:`-separated list, so a reader cannot tell where one ends — a real
string is a flat run of `id;quantity` groups. EFT has no positions at all.

Two more traps worth stating, both met in practice:

- **EFT section order is low, medium, high** — not the order the fitting window
  draws. Drones and cargo are separated by *two* blank lines, everything else by
  one.
- **Tech III subsystems are category 32, not 7.** Anything deciding "is this
  fittable" by `categoryID === 7` silently drops every subsystem on a Loki or
  Tengu. Rigs *are* category 7 despite having their own slot, so the category
  cannot decide the slot either.

An `_` after a module ID means unfitted; charges are always unfitted. A charge
or drone that arrived from EFT looking fitted is corrected by its category, and
`fitted: false` items carry `DroneBay`, `FighterBay` or `Cargo`.

Names resolve per language with an English fallback, over **published types
only**. In one prepared SDE, 26976 of 26992 published names are unique,
and the 12 duplicates are SKINs, crates and a drink — nothing fittable.
Excluding unpublished types is what removes the other ~1000 collisions, mostly
retired duplicates like the `OLD Loki …` subsystems.

Malformed input is a `400`, never an empty fit — a fitting that silently loses
its modules looks exactly like a valid fit of a bare hull.

### ESI fittings keep the pilot's own positions

An ESI record is the only source that states where a module actually sat, so its
`flag` is authority and `HiSlot3` stays position 3. Pasted text has no positions,
so those are assigned in encounter order and mean "the nth module written", never
"the slot the pilot used".

## Authenticated ESI routes

```text
GET /v1/auth/esi/status
GET /v1/auth/esi/login
GET /v1/auth/esi/callback
GET /v1/auth/esi/skinr
GET /v1/auth/esi/fittings
```

These are **not** `/<target>/<build>/` routes: they belong to the single stored
operator grant, not to a build. The service is loopback-only and holds one
token; it is not a multi-user authorization server, and a deployed multi-user
product needs its own per-user token custody rather than this.

`GET /v1/auth/esi/fittings` lists the saved fittings of the **stored token's
own** character. A supplied `characterID` is ignored — the character comes from
the token, which is what stops the route becoming an authorization bypass.

| Status | Meaning |
| --- | --- |
| `501` | no `CJS_ESI_CLIENT_ID`, so SSO is unconfigured |
| `401` | no stored token — run `npm run login:eve` |
| `409` | a token stored before character capture; sign in again |
| `403` | the grant does not cover `esi-fittings.read_fittings.v1` |
| `502` | ESI answered, and it was not a refusal |
| `200` | `{ characterId, characterName, fittings: [ … ] }` |

The `403` is worth its own status: adding a scope to `CJS_ESI_SCOPES` does not
upgrade an existing refresh token, so a grant issued earlier keeps working for
everything except the new endpoint. Told only "upstream failed", an operator
retries forever instead of authorizing again.

No response carries an access or refresh token, and there is a test asserting
the bytes.

## Character routes

```text
GET /eve/<build>/character
GET /eve/<build>/character/library.json
```

Both routes return the same complete schema-v10 model-shaped document. The
`@carbonenginejs/runtime/character` owns hydration, document lookup, and graph
relationships. The HTTP adapter does not expose the retired inferred
part/name/category/LOD query surface.

## SKIN and SKINR routes

```text
GET /eve/<sde-build>/skin
GET /eve/<sde-build>/skin/<section>
GET /eve/<sde-build>/skin/<section>/<id>
GET /eve/<sde-build>/skinr
GET /eve/<sde-build>/skinr/<section>
GET /eve/<sde-build>/skinr/<section>/<id>
```

Whole-library and section responses use the same canonical records as the
offline generated JSON.

## Weapon routes

```text
GET /eve/<sde-build>/weapons
GET /eve/<sde-build>/weapons/lookup?name=<name>
GET /eve/<sde-build>/weapons/search?name=<name>
GET /eve/<sde-build>/weapons/types/<weapon-typeID>
GET /eve/<sde-build>/weapons/types/<weapon-typeID>/ammunition
GET /eve/<sde-build>/weapons/types/<weapon-typeID>/ammunition/<ammunition-typeID>
GET /eve/<sde-build>/weapons/ammunition/<ammunition-typeID>
GET /eve/<sde-build>/weapons/projectiles[/<graphicID>]
GET /eve/<sde-build>/weapons/groups[/<groupID>]
```

Ammunition compatibility comes from dogma charge groups and size, not filename
or market-name guessing. Weapon records expose `slot` as the runtime collection
name (`turrets`, `xlTurrets`, `launchers`, `bombs`, `atomics`, or `chains`) and
retain `iconID`, meta/tech fields, and the explicit `published` state.

Projectile graphics remain a separate official launcher catalog. Each
ammunition record names its `projectileGraphicID` when its authored impact
graphic shares the projectile's resource folder; projectile records carry the
matching ammunition identifiers and a source-derived display name.

## Related documentation

- [Run the local service](../guides/local-service.md)
- [Cache and persistent overlays](../concepts/cache-and-overlays.md)
