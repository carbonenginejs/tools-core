# Local HTTP route reference

Status: Stable  
Scope: `@carbonenginejs/tools-core/proxy`  
Audience: Local service and browser integrators  
Summary: Lists the implemented exact-build query, resource, and generated-library route families.

## Target and resource routes

```text
GET /targets
GET /eve/latest/build
GET /frontier/latest/build
GET /frontier/latest/res
GET /eve/<exact-build>/res/<path>
GET /eve/<build>/res/resfiles
GET /eve/<build>/resfiles
GET /netease/<exact-build>/app/<path>
GET /ccp/<build>/<topic>[/<path>]
GET /ccp/<build>/resources[/<path>]
GET /eve/<build>/resource[/<path>]
```

An `app` or `res` topic without a path returns the exact resource URL template.
With a path it returns checksum-validated indexed bytes. `?format=json` on a
`.black` resource returns public payload JSON; other extensions return `415`.

The `/ccp/<build>/resources/` subtree is the EVE `res:/` HTTP root. A file
returns bytes and a directory returns its immediate `{ name, path, type }`
children. `/res/resfiles` and `/resfiles` remain compatibility endpoints for
legacy clients; new consumers should use directory and specialized answers.

## Audio media routes

```text
GET  /eve/<build>/audio/id/<mediaID>
HEAD /eve/<build>/audio/id/<mediaID>
GET  /eve/<build>/audio/path/<encoded-audio-path>
HEAD /eve/<build>/audio/path/<encoded-audio-path>
```

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

## SDE routes

```text
GET /eve/latest/sde
GET /eve/<sde-build>/sde/<table>?limit=100&offset=0
GET /eve/<sde-build>/sde/<table>/<id>
GET /eve/<sde-build>/sde/<table>?query=<text>
GET /eve/<sde-build>/sde/<table>?field=groupID&value=25
GET /eve/<sde-build>/sde/skins?field=types&contains=587
GET /eve/<sde-build>/sde/resolve?typeID=587&skinID=<skin-id>
```

SDE `latest` resolves independently from app/resource `latest`. The service
normally requires a prepared database; `--sde-auto-prepare` permits on-demand
preparation.

## Character routes

```text
GET /eve/<build>/character
GET /eve/<build>/character/types/<typeID>?lod=<lod>
GET /eve/<build>/character/parts/<partID>?lod=<lod>
GET /eve/<build>/character/lookup?name=<name>
GET /eve/<build>/character/search?name=<name>
GET /eve/<build>/character/resolve?name=<name>&lod=<lod>
GET /eve/<build>/character/<category>?lod=<lod>
GET /eve/<build>/character/lod/<lod>/types/<typeID>
GET /eve/<build>/character/lod/<lod>/parts/<partID>
GET /eve/<build>/character/lod/<lod>/resolve?name=<name>
GET /eve/<build>/character/lod/<lod>/<category>
```

`lookup` retains every exact candidate; `search` folds punctuation and spacing;
`resolve` requires an unambiguous result. `partID` is always present while
`typeID` remains optional. A selected LOD returns the atomic prepared bundle.

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
or market-name guessing. Projectile graphics remain a separate official
launcher catalog.

## SOF routes

When the embedding application injects a prepared facade:

```text
POST /v1/sof/values
POST /v1/sof/document
```

Values are the recommended JSON-compatible model graph. The explicit
`carbon.document` route is for diagnostics and graph tooling.

## Related documentation

- [Run the local service](../guides/local-service.md)
- [Cache and persistent overlays](../concepts/cache-and-overlays.md)
