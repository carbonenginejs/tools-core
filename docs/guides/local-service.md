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

## Route families

The canonical route shape is `/{target}/{build}/{topic}[/{path}]`. Important
groups are:

| Route | Result |
| --- | --- |
| `/targets` | Audited target and capability list |
| `/{target}/latest/build` | Exact current app/resource build |
| `/{target}/{build}/app/<path>` | Validated app-index bytes |
| `/{target}/{build}/res/<path>` | Validated resource bytes |
| `/{target}/{build}/audio/id/<mediaID>` | Selected logical sample bytes |
| `/{target}/{build}/audio/path/<encoded-audio-path>` | One exact registered audio file |
| `/ccp/{build}/resources[/<path>]` | EVE `res:/` file or immediate directory listing |
| `/eve/{build}/sde/<table>[/<id>]` | Prepared SDE table reads |
| `/eve/{build}/character[...]` | Character library and identity/LOD queries |
| `/eve/{build}/skin[...]` | SKIN library sections |
| `/eve/{build}/skinr[...]` | SKINR library sections |
| `/eve/{build}/weapons[...]` | Weapon, ammunition, projectile, and group queries |
| `/v1/sof/values` | Recommended plain SOF model values when configured |
| `/v1/sof/document` | Diagnostic `carbon.document` when configured |

Specialized billboard, nebula, cube, and hull resource-path-insert routes
provide derived answers that are not plain directory enumeration. Response
headers expose the exact resolved build even when the request uses `latest`.

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

The authenticated realtime service is a separate composition described in
[Host realtime services](realtime-service.md). Webhook endpoints do not use
browser CORS or local realtime capabilities.

## Current limitations

The checked-in service does not enable the authenticated realtime host. Audio
routes prefer a prepared exact-build `audio_v2.json` and fall back to a legacy
`audio_v1.json` when v2 has not been built. Current generated libraries
describe loose WEMs, banks, optional embedded media, and—when built with
`--music`—the dynamic music graph. Prepared or converted source variants become
selectable when their descriptors are present.

The service does not inspect an installed game client's cache. Optional
prefetch uses only its configured tools cache and validates every cache hit
through the normal exact-build index source.

An SDE `latest` reference resolves independently from the app/resource build.
Pass `--sde-auto-prepare` only when the service may download and prepare a
missing exact-build database.
