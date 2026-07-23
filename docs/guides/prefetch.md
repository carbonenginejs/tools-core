# Prepare exact-build cache inputs

Status: Stable  
Scope: `@carbonenginejs/tools-core/prefetch` and the `cjs-tools-prefetch` command  
Audience: Tool authors, local-service operators, and generated-library maintainers  
Summary: Acquires an explicit resource set before a tool or local service starts.

## Purpose

Prefetch is a small orchestration layer over the existing exact-build index
source. It does not add a second downloader or cache format. It:

1. validates the requested profile names;
2. resolves the target's friendly build exactly once;
3. asks each profile for explicit `app:/` or `res:/` paths;
4. deduplicates those requirements while retaining profile provenance;
5. reads them through the normal index source with bounded concurrency.

The index source still owns payload lookup, size and MD5 validation, immutable
cache paths, refresh behavior, and persistent overlays.

## Command line

Prepare all indexed source files referenced by the exact-build audio library:

```powershell
npm run prefetch -- audio --target eve --build latest --cache <cache>
```

The equivalent named option is:

```powershell
cjs-tools-prefetch --profile audio --target eve --build latest
```

Use `--concurrency <1-64>` to change the default of four parallel reads.
`--refresh` bypasses valid cached payloads and replaces them from the immutable
source. The command writes one deterministic JSON report to stdout.

The standalone command uses an audio-safe five-minute request/body deadline
and 512 MiB per-resource ceiling. These are deliberately higher than the
general index source defaults because current exact-build banks can exceed
256 MiB. Override them with `--request-timeout-ms` and
`--max-payload-bytes`; both remain hard bounded-fetch limits rather than
unbounded reads.

The prepared audio library must already exist in the shared tools cache for the
resolved exact build. Audio prefetch includes every registered indexed loose
media and sound-bank path. It ignores `generated:/` converted outputs because
those are already prepared artifacts rather than app/resource acquisitions.

## Start the local service after preparation

```powershell
npm run service -- --prefetch audio --target eve --build latest
```

The service completes prefetch before it creates or binds its listener. A
missing profile, library, index entry, or invalid payload therefore prevents
readiness. Progress does not occupy stdout: the first stdout line remains the
service bootstrap record. The completed report is written to stderr and
included in that bootstrap record under `prefetch`.

Service-specific options are `--prefetch-concurrency` and
`--prefetch-refresh`. A bare `--prefetch` selects `audio`. When startup
prefetch is enabled, the service uses the same five-minute and 512 MiB
audio-safe bounds unless `--request-timeout-ms` or `--max-payload-bytes`
supplies an explicit limit. Without startup prefetch, the existing 30-second
and 256 MiB general defaults remain unchanged.

## Library API

```js
import { CjsToolAudioPrefetch } from "@carbonenginejs/tools-core/audio";
import { CjsToolPrefetch } from "@carbonenginejs/tools-core/prefetch";

const prefetch = new CjsToolPrefetch({
    indexes,
    profiles: [
        new CjsToolAudioPrefetch({ audio }),
    ],
});

const plan = await prefetch.Plan({
    target: "eve",
    build: "latest",
    profiles: [ "audio" ],
});

const report = await prefetch.Prefetch({
    target: "eve",
    build: "latest",
    profiles: [ "audio" ],
    concurrency: 4,
    onProgress(progress)
    {
        console.log(progress.completed, progress.total, progress.logicalPath);
    },
});
```

`Plan` is read-only apart from the profile reads required to discover its
paths. It returns an immutable exact-build identity and deterministic
requirements. `Prefetch` returns aggregate counts and byte length; callers
that need per-file status use the immutable progress callback.

## Adding a profile

A profile is an object with a stable lower-case `name` and an instance
`Resolve(context)` method. The context contains the resolved `target`, `game`,
`provider`, `buildRef`, exact numeric `build`, and `client`. `Resolve` returns
an array of exact logical paths or records:

```js
class CjsToolExamplePrefetch
{

    name = "example";

    async Resolve(context)
    {
        return [
            "res:/example/data.bin",
            {
                logicalPath: "app:/example/config.json",
                indexName: "appindex",
            },
        ];
    }

}
```

Profiles describe requirements; they do not fetch files. Wildcards, traversal,
and roots other than `app:/` and `res:/` are rejected. Requirements shared by
multiple profiles are fetched once.

## Boundaries

- `resfileindex_windows_prefetch.txt` remains a shader-specific source artifact.
  Generic profiles do not infer resource sets from it.
- Prefetch operates only through tools-core indexes and its configured shared
  cache. It never searches, reads, modifies, or manages an installed game
  client's cache.
- Files placed into the tools cache by an external provisioning step are not
  trusted implicitly. The normal index read validates their declared size and
  checksum before reporting a cache hit.
- Prefetch is not an HTTP endpoint. It is preparation work for a CLI process or
  service startup; applications continue to read through the existing route
  families.
