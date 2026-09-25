# Run the local tools service

Status: Stable  
Scope: `@carbonenginejs/tools-core/proxy` and the `cjs-tools-service` command  
Audience: Local application and Blender integrators  
Summary: Starts and consumes the loopback query, resource, and generated-library service.

## Start the service

```powershell
npm run service -- --cache <cache> --data <persistent-data>
```

The launcher binds to loopback on port 5510 by default (`--port 0` picks any
free port) and writes one JSON bootstrap record to stdout. The port is fixed
because EVE SSO matches its registered callback URL exactly.
`cjs-tools-service --help` lists every option. The record contains only listener,
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

The canonical shape is `/{target}/{build}/{topic}[/{path}]`. Use the
[HTTP reference](../reference/http-routes.md) for routes and query semantics:

- [Targets, builds and indexed resources](../reference/http-routes.md#target-and-resource-routes).
- [Audio media](../reference/http-routes.md#audio-media-routes), including the
  complete schema-v2 audio library, and
  [optional music](../reference/http-routes.md#optional-neutral-music-routes).
- [Derived resource answers](../reference/http-routes.md#derived-resource-answers)
  and [SOF catalogs/model values](../reference/http-routes.md#gpu-free-sof-routes).
- [SDE inspection](../reference/http-routes.md#sde-routes), not a consumer surface;
  [DNA resolution/search](../reference/http-routes.md#dna-routes).
- [Character](../reference/http-routes.md#character-routes),
  [SKIN/SKINR](../reference/http-routes.md#skin-and-skinr-routes) and
  [weapon](../reference/http-routes.md#weapon-routes) libraries.

Response headers expose the exact resolved build, including for `latest`.
The SOF reference owns lazy catalog growth and exact-build resource-list checks.

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

## Current limitations

Audio routes require a prepared exact-build `audio_v2.json`. Current generated
libraries describe loose WEMs, banks, optional embedded media, the authored
SFX graph when built with `--sfx`, and the dynamic music graph when built with
`--music`. Automatic preparation includes authored SFX and adds music whenever
the required banks are indexed. Prepared or converted source variants become
selectable when their descriptors are present.

The service does not inspect an installed game client's cache. It reads only
its configured tools cache, and trusts a payload already there without
re-hashing it; size and checksum are checked when tools-core downloads one.

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
