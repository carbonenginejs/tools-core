# Build a SOF bundle

Status: Stable  
Scope: `@carbonenginejs/tools-core/sof` and the `cjs-sof-bundle` command  
Audience: Tool authors and Blender add-on users  
Summary: Writes one DNA's GPU-free document, geometry, and decoded textures as a self-contained directory.

## Purpose

Some consumers cannot run Carbon: they have no SOF/DNA implementation, no
Node runtime at import time, and no BC7/BC5 texture decoder. The Blender
add-ons are the current example. A SOF bundle gives them everything one DNA
needs as ordinary files, without duplicating SOF semantics outside Node.

A bundle contains:

```text
bundle.json      manifest: schema, target, provider, build, dna, resource map
document.json    runtime SOF's GPU-free carbon.document
geometry/...     every referenced geometry resource, unchanged
textures/...     every referenced texture, decoded to PNG by default
```

Paths under `geometry/` and `textures/` mirror the original `res:/` layout, so
the manifest's `resources` map is the only lookup a consumer needs.

## Build one

```sh
npx cjs-sof-bundle --dna cf1_t1:caldaribase:caldari --out ./cf1_t1
```

Options:

- `--target`, `--build`, `--client` select the exact index identity; the build
  defaults to `latest` and resolves once through the normal target policy.
- `--cache <directory>` points at an existing shared cache, for example the
  Blender add-on's cache root, so nothing is downloaded twice.
- `--raw-textures` copies DDS payloads unchanged instead of decoding them.

## Texture conversion

DDS payloads are decoded through `@carbonenginejs/runtime/resource`'s software decoder and
written as 8-bit RGBA PNG. Two-channel BC5/`ATI2` normal maps store only X and
Y, so their Z is reconstructed as `sqrt(1 - x² - y²)` during conversion;
without that step a generic image consumer reads a zero blue channel.

Conversion exists because consumers differ in what they can read. Blender 5.0,
for example, decodes DXT and BC5 DDS itself but not BC7 (`DX10` header,
dxgiFormat 98). Use `--raw-textures` when the consumer has its own decoder.

A texture the decoder cannot read is written in its original form and recorded
in the manifest's `missing` list, together with any resource the exact build
did not provide. A bundle therefore always reports what it could not include.

## Programmatic use

```js
import { CjsToolIndex } from "@carbonenginejs/tools-core/index";
import { CjsToolSofBundle, CjsToolSofRepository } from "@carbonenginejs/tools-core/sof";

const source = await new CjsToolIndex().OpenTarget("eve", "latest");
const catalog = await new CjsToolSofRepository().OpenSource(source);
const bundle = new CjsToolSofBundle({ writeFile: async (relative, bytes) => { /* ... */ } });

const manifest = await bundle.Write({ catalog, source, dna: "cf1_t1:caldaribase:caldari" });
```

`writeFile` receives bundle-relative paths, so callers choose the destination:
a directory, an archive, or an in-memory store.

The repository defaults to lazy SOF loading. A one-DNA bundle therefore reads
`generic.black` and that DNA's named catalog closure instead of decoding the
whole `data.black`. Pass `{ loadMode: "full" }` to
`CjsToolSofRepository` only for a process that will scan many unrelated DNA.

## Related documentation

- [Public API and subpaths](../reference/api.md)
- [Local HTTP route reference](../reference/http-routes.md)
- [Prepare exact-build cache inputs](prefetch.md)
