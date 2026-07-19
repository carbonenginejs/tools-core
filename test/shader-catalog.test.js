import assert from "node:assert/strict";
import test from "node:test";

import { buildShaderTargetCatalog, CjsIndexEntry } from "../src/index.js";

test("builds a deterministic Frontier high-tier shader source inventory", () =>
{
    const catalog = buildShaderTargetCatalog({
        shaderTarget: "frontier-webgl2",
        build: 3438337,
        generatedAt: "2026-07-19T00:00:00Z",
        indexEntries: [
            new CjsIndexEntry({
                logicalPath: "res:/graphics/effect.dx11/managed/space/characters/standardpbr.sm_hi",
                location: "90/source",
                checksum: "1a846e224f05d7ae9e8d33e9d054c1cc",
                uncompressedSize: 526654,
                compressedSize: 61005,
            }),
            new CjsIndexEntry({
                logicalPath: "res:/graphics/effect.dx11/managed/space/characters/standardpbr.sm_depth",
                location: "91/depth",
            }),
            new CjsIndexEntry({
                logicalPath: "res:/graphics/texture/not-a-shader.dds",
                location: "92/texture",
            }),
        ],
    });

    assert.equal(catalog.schema, "carbon.shader-target-catalog");
    assert.equal(catalog.version, 1);
    assert.equal(catalog.status, "source-inventory");
    assert.equal(catalog.generatedAt, "2026-07-19T00:00:00.000Z");
    assert.equal(catalog.sourceCount, 1);
    assert.deepEqual(catalog.entries[0], {
        sourcePath: "res:/graphics/effect.dx11/managed/space/characters/standardpbr.sm_hi",
        plannedOutputPath: "res:/graphics/effect.webgl2/managed/space/characters/standardpbr.sm_hi",
        storagePath: "90/source",
        checksum: "1a846e224f05d7ae9e8d33e9d054c1cc",
        uncompressedSize: 526654,
        compressedSize: 61005,
    });
});

test("shader catalog fails when its index has no audited target sources", () =>
{
    assert.throws(
        () => buildShaderTargetCatalog({
            shaderTarget: "frontier-webgl2",
            build: 3438337,
            indexEntries: [ new CjsIndexEntry({
                logicalPath: "res:/graphics/effect.dx11/utility/textureviewer.sm_depth",
                location: "90/depth",
            }) ],
        }),
        /no matching source resources/,
    );
});
