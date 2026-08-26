# @carbonenginejs/tools-core

Node.js tooling for exact-build acquisition, shared caches, deterministic
libraries, local services, and realtime provider integrations.

Use tools-core when a build or application needs Node filesystems, persistent
caches, credentials, servers, command-line orchestration, or generated
artifacts. Browser clients belong in `@carbonenginejs/runtime/tools`; runtime
code never imports this package.

## Install

```sh
npm install @carbonenginejs/tools-core
```

Node.js 18 or newer is required.

## Quick start

```js
import { CjsToolIndex } from "@carbonenginejs/tools-core/index";

const source = await new CjsToolIndex().Open({
    target: "eve",
    build: "latest",
});

const resolved = source.Resolve(
    "res:/dx9/model/spaceobjectfactory/data.red",
);

console.log(resolved);
```

Friendly build names resolve once; subsequent reads retain the exact target and
numeric build. Provider and game are provenance metadata. Indexed payloads are
checked against declared size and MD5 before they are returned or cached.

## What it owns

- app/resource index acquisition and the shared exact-build cache;
- profile-driven exact-build cache preparation before tools or services start;
- prepared SDE databases, composed icon resource paths, and Node-side
  orchestration/publication of deterministic audio, character, SKIN, SKINR,
  weapon, and shader outputs;
- self-contained SOF bundles for consumers without Carbon or a DDS decoder;
- schema scanning and class-emission tooling;
- optional loopback HTTP, authenticated realtime, WebSocket, webhook, and
  filesystem-watch services;
- Twitch and Kick server-side integrations.

Each area is independently importable through a documented package subpath.
The runtime audio and character layers own their raw-resource build algorithms;
tools-core supplies target-selected exact-build bytes and persists their
`GetValues()` output. The character subpath also gathers optional prepared
model-shaped JSON records and
materializes sparse part-source authoring into complete effective metadata and
exact resource-candidate inventories, while
`@carbonenginejs/runtime/character` owns the
combined schema-v10 model and hydration contract. Decoded character definitions
are retained losslessly; typed catalogs are additive indexes.

## Documentation

- [Package documentation](docs/README.md)
- [Architecture and boundaries](docs/architecture.md)
- [Public API and subpaths](docs/reference/api.md)
- [Build generated libraries](docs/guides/generated-libraries.md)
- [Build a profile-driven SDE](docs/guides/sde-builds.md)
- [Prepare exact-build cache inputs](docs/guides/prefetch.md)
- [Build a SOF bundle](docs/guides/sof-bundles.md)
- [Run the local service](docs/guides/local-service.md)
- [Host realtime services](docs/guides/realtime-service.md)
- [Configure Twitch and Kick](docs/guides/provider-integrations.md)
- [Chat and livestream source topology](docs/concepts/chat-and-livestream-sources.md)
- [Realtime protocol v1](docs/protocols/realtime-v1.md)
- [Chat family contract v1](docs/protocols/chat-v1.md)
- [Livestream family contract v1](docs/protocols/livestream-v1.md)

## Development

```sh
npm run check
```

The baseline check is offline and uses synthetic fixtures or injected network
implementations. Acquired data, caches, reports, SQLite files, credentials, and
private work material must not be committed or published.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE). CarbonEngine, Fenris Creations
(CCP Games), Twitch, and Kick names and API terms are used solely for
interoperability and provenance. This project is not affiliated with or
endorsed by those organizations.
