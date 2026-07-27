import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import test from "node:test";

import {
    CjsToolSofBundle,
    EncodePng,
    RestoreNormalZ,
    SOF_BUNDLE_SCHEMA,
} from "../src/sof/index.js";

const DOCUMENT = {
    schema: "carbon.document",
    version: 1,
    roots: [ { name: "default", ref: { $ref: 3 } } ],
    nodes: [
        { id: 1, kind: "TriTextureParameter", fields: { name: "AlbedoMap", resourcePath: "res:/a/albedo.dds" } },
        { id: 2, kind: "Tr2Mesh", fields: { geometryResPath: "res:/a/hull.gr2" } },
        { id: 3, kind: "EveShip2", fields: { dna: "hull:faction:race", mesh: { $ref: 2 } } },
    ],
};

function CreateFixture({ fetchFailures = new Set() } = {})
{
    const written = new Map();
    const catalog = {
        target: "eve",
        provider: "ccp",
        build: "123456",
        BuildDocumentAsync: async () => DOCUMENT,
    };
    const source = {
        Fetch: async logicalPath =>
        {
            if (fetchFailures.has(logicalPath)) throw new Error("not indexed");

            return { bytes: new Uint8Array([ 1, 2, 3, 4 ]) };
        },
    };
    const bundle = new CjsToolSofBundle({
        writeFile: async (relative, bytes) => written.set(relative, bytes),
    });

    return { bundle, catalog, source, written };
}

test("writes the document, geometry, and raw textures with a manifest", async () =>
{
    const { bundle, catalog, source, written } = CreateFixture();
    const manifest = await bundle.Write({
        catalog,
        source,
        dna: "hull:faction:race",
        convertTextures: false,
    });

    assert.equal(manifest.schema, SOF_BUNDLE_SCHEMA);
    assert.equal(manifest.build, "123456");
    assert.equal(manifest.dna, "hull:faction:race");
    assert.deepEqual(manifest.missing, []);
    assert.equal(manifest.resources["res:/a/hull.gr2"], "geometry/a/hull.gr2");
    assert.equal(manifest.resources["res:/a/albedo.dds"], "textures/a/albedo.dds");
    assert.ok(written.has("document.json"));
    assert.ok(written.has("bundle.json"));
    assert.equal(JSON.parse(written.get("document.json").toString("utf8")).schema, "carbon.document");
});

test("records resources the exact build cannot provide", async () =>
{
    const { bundle, catalog, source, written } = CreateFixture({
        fetchFailures: new Set([ "res:/a/albedo.dds" ]),
    });
    const manifest = await bundle.Write({ catalog, source, dna: "hull:faction:race", convertTextures: false });

    assert.equal(manifest.resources["res:/a/albedo.dds"], undefined);
    assert.equal(manifest.missing.length, 1);
    assert.equal(manifest.missing[0].logicalPath, "res:/a/albedo.dds");
    assert.ok(written.has("geometry/a/hull.gr2"));
});

test("keeps an undecodable texture as its original payload", async () =>
{
    const { bundle, catalog, source, written } = CreateFixture();
    const failing = new CjsToolSofBundle({
        dds: {
            Inspect: () => ({ fourCc: "DXT1" }),
            Read: () =>
            {
                throw new Error("RGBA decode is not implemented for unknown");
            },
        },
        writeFile: async (relative, bytes) => written.set(relative, bytes),
    });
    const manifest = await failing.Write({ catalog, source, dna: "hull:faction:race" });

    assert.equal(manifest.resources["res:/a/albedo.dds"], "textures/a/albedo.dds");
    assert.match(manifest.missing[0].reason, /decode failed/u);
    assert.equal(bundle instanceof CjsToolSofBundle, true);
});

test("converts DDS payloads to PNG when a decoder is available", async () =>
{
    const written = new Map();
    const bundle = new CjsToolSofBundle({
        dds: {
            Inspect: () => ({ fourCc: "DX10", dxgiFormat: 98 }),
            Read: () => ({
                width: 2,
                height: 1,
                data: new Uint8Array([ 10, 20, 30, 255, 40, 50, 60, 255 ]),
            }),
        },
        writeFile: async (relative, bytes) => written.set(relative, bytes),
    });
    const { catalog, source } = CreateFixture();
    const manifest = await bundle.Write({ catalog, source, dna: "hull:faction:race" });

    assert.equal(manifest.resources["res:/a/albedo.dds"], "textures/a/albedo.dds.png");
    assert.equal(manifest.texturesConverted, true);

    const png = written.get("textures/a/albedo.dds.png");

    assert.deepEqual([ ...png.subarray(0, 8) ], [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]);
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), 2);
    assert.equal(png.readUInt32BE(20), 1);
});

test("reconstructs the Z channel of two-channel normal maps", () =>
{
    const pixels = Buffer.from([ 128, 128, 0, 0, 255, 128, 0, 0 ]);

    RestoreNormalZ(pixels);

    assert.ok(pixels[2] > 250, "a flat normal points straight out");
    assert.equal(pixels[3], 255);
    assert.ok(pixels[6] < 140, "a fully deflected normal has no remaining Z");
});

test("encodes PNG scanlines a standard decoder can read back", () =>
{
    const pixels = Buffer.from([ 1, 2, 3, 4, 5, 6, 7, 8 ]);
    const png = EncodePng(pixels, 2, 1);
    const start = png.indexOf(Buffer.from("IDAT", "ascii")) + 4;
    const length = png.readUInt32BE(start - 8);
    const raw = inflateSync(png.subarray(start, start + length));

    assert.equal(raw[0], 0, "each scanline uses filter type 0");
    assert.deepEqual([ ...raw.subarray(1) ], [ 1, 2, 3, 4, 5, 6, 7, 8 ]);
    assert.throws(() => EncodePng(pixels, 0, 1), /positive integer dimensions/u);
    assert.throws(() => EncodePng(pixels, 4, 4), /RGBA data/u);
});
