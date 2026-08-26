# Run the local tools service

Status: Stable  
Scope: `@carbonenginejs/tools-core/proxy` and the `cjs-tools-service` command  
Audience: Local application and Blender integrators  
Summary: Starts and consumes the loopback query, resource, and generated-library service.

## Start the service

```powershell
npm run service -- --cache <cache> --data <persistent-data>
```

The launcher binds to loopback, selects an available port by default, and
writes one JSON bootstrap record to stdout. The record contains only listener,
cache, data, protocol, and capability information; it never contains
credentials.

To require a prepared cache before readiness:

```powershell
npm run service -- --prefetch audio --target eve --build latest
```

Requested profiles finish before the listener is created or bound. Failure
therefore produces no bootstrap record and no transient listening service. The
prefetch report is written to stderr and included in the successful bootstrap
record. See [Prepare exact-build cache inputs](prefetch.md) for profile,
concurrency, refresh, bounded-fetch limits, and cache-boundary details.

SOF loading is lazy by default. Opening one exact build reads `generic.black`;
DNA and detail routes then fetch only the named hull, faction, race, material,
pattern, and layout records they require. Use the monolithic path for bulk
catalog work:

```powershell
npm run service -- --sof-full
```

That flag decodes `data.black` when the build is first opened. The bootstrap
record reports the active choice as `sofLoadMode`.

## Route families

The canonical route shape is `/{target}/{build}/{topic}[/{path}]`. Important
groups are:

| Route | Result |
| --- | --- |
| `/targets` | Audited target and capability list |
| `/{target}/metadata` | What a target is — provider, game, and each client's current build |
| `/{target}/latest/build` | Exact current app/resource build |
| `/{target}/{build}/app/<path>` | Validated app-index bytes |
| `/{target}/{build}/res/<path>` | Validated resource bytes |
| `/{target}/{build}/audio/library.json` | Complete schema-v2 audio-library document |
| `/{target}/{build}/audio/id/<mediaID>` | Selected logical sample bytes |
| `/{target}/{build}/audio/path/<encoded-audio-path>` | One exact registered audio file |
| `/{target}/{build}/audio/music` | Optional playlist summaries and music endpoints |
| `/{target}/{build}/audio/music/library` | Installable available-song music library |
| `/{target}/{build}/resources[/<path>]` | EVE `res:/` file or immediate directory listing |
| `/eve/{build}/sde/<table>[/<id>]` | Prepared SDE table reads — inspection, not a consumer surface |
| `/eve/{build}/dna/resolve?typeID=&skinID=` | A type and skin to the SOF DNA they produce |
| `/eve/{build}/dna/search?q=<term>` | A DNA, or any part of one, to the ships and skins that produce it |
| `/eve/{build}/character[/library.json]` | Complete schema-v10 character library |
| `/eve/{build}/skin[...]` | SKIN library sections |
| `/eve/{build}/skinr[...]` | SKINR library sections |
| `/eve/{build}/weapons[...]` | Weapon, ammunition, projectile, and group queries |
| `/eve/{build}/sof/{catalog}[...]` | GPU-free runtime SOF catalog collections and details |
| `/eve/{build}/sof/dna/<dna>` | GPU-free runtime SOF model-values graph |
| `/eve/{build}/sof/dna/<dna>/expanded` | The same model-values graph with registered Trinity/audio defaults filled in |

Specialized billboard, nebula, cube, and hull resource-path-insert routes
provide derived answers that are not plain directory enumeration. Response
headers expose the exact resolved build even when the request uses `latest`.
The target/build SOF routes use the same exact resource source and pass the
complete resource-file list to the runtime SOF layer for resPathInsert
existence checks. Lazy mode enumerates collection names from that immutable
index without decoding their records. It loads `generic.black` once per
retained build and grows the runtime catalog only when a detail or DNA answer
needs more data. `--sof-full` instead decodes `data.black` once up front.

See the [local HTTP route reference](../reference/http-routes.md) for the
complete implemented route families and query semantics.

Appending `?format=json` to a `.black` resource returns public payload JSON
through the checked-in Black schema snapshot. A materially different client
build can fail or be misread if its binary layout has drifted from that
snapshot.

## Browser access

JSON, resource-byte, and audio-byte responses include browser CORS headers and
support private-network preflight. Audio responses support `HEAD`,
`If-None-Match`, representation negotiation, and a single standard byte range.
The existing local routes are read-only and unauthenticated, so the default
listener remains loopback-only.

An optional neutral music library may be mounted explicitly:

```sh
npm run service -- \
  --music-library path/to/music-library.json \
  --music-directory path/to/music-cache
```

This adds playlist summaries, per-playlist availability, and song byte
endpoints under `/{target}/{build}/audio/music`. The `/library` child returns
a runtime audio music library containing only currently available songs and
absolute service-owned URLs, so a browser application on another origin may
install it without rewriting song paths. Only songs named by the validated
source catalog are reachable.

The authenticated realtime service is a separate composition described in
[Host realtime services](realtime-service.md). Webhook endpoints do not use
browser CORS or local realtime capabilities.

## Current limitations

The checked-in service does not enable the authenticated realtime host. Audio
routes require a prepared exact-build `audio_v2.json`. Current generated
libraries describe loose WEMs, banks, optional embedded media, the authored
SFX graph when built with `--sfx`, and the dynamic music graph when built with
`--music`. Automatic preparation includes authored SFX and adds music whenever
the required banks are indexed. Prepared or converted source variants become
selectable when their descriptors are present.

The service does not inspect an installed game client's cache. Optional
prefetch uses only its configured tools cache and validates every cache hit
through the normal exact-build index source.

Generated artifacts are prepared on their first request by default: a missing
EVE SDE downloads and prepares itself, and a missing audio library builds from
the exact build's own indexed inputs through the runtime audio resource builder.
A missing character library follows the same runtime character builder path
when its required indexed cFSD inputs are available. Pass `--no-sde-auto-prepare` or
`--no-audio-auto-prepare` to require deliberate preparation instead.

An SDE `latest` reference resolves independently from the app/resource build,
and the SDE is never guaranteed to match the current remote game build; when a
newer SDE cannot be acquired the service answers from the newest prepared
database it has. See the SDE section of the local HTTP route reference.
