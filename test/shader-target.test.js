import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolShaderTarget, CjsToolShaderTargetRegistry } from "../src/index.js";

const StandardPbr = "res:/graphics/effect.dx11/managed/space/characters/standardpbr.sm_hi";

test("catalogs Frontier WebGL2 outputs under its profile and exact build", () =>
{
    const targets = new CjsToolShaderTargetRegistry();
    const target = targets.Get("frontier-webgl2");
    const catalog = target.CreateCatalog([ StandardPbr ], { build: 3438337 });

    assert.deepEqual(target.toJSON(), {
        id: "frontier-webgl2",
        target: "frontier",
        sourceProfile: "effect.dx11",
        outputProfile: "effect.webgl2",
        qualityTiers: [ "hi" ],
        sourceFamilies: [ "dx11-sm5.0" ],
        selectionPolicy: {
            sourceFamily: "dx11-sm5.0",
            permutationMode: "all",
        },
        qualificationPolicy: {
            level: "structural",
            nativeComparison: "not-applicable",
        },
        overlay: "webgl2",
    });
    assert.deepEqual(catalog, {
        id: "frontier-webgl2",
        target: "frontier",
        game: "Frontier",
        provider: "ccp",
        client: "stillness",
        build: "3438337",
        sourceProfile: "effect.dx11",
        outputProfile: "effect.webgl2",
        sourceFamilies: [ "dx11-sm5.0" ],
        selectionPolicy: {
            sourceFamily: "dx11-sm5.0",
            permutationMode: "all",
        },
        qualificationPolicy: {
            level: "structural",
            nativeComparison: "not-applicable",
        },
        overlay: "webgl2-3438337",
        entries: [ {
            sourcePath: StandardPbr,
            outputPath: "res:/graphics/effect.webgl2/managed/space/characters/standardpbr.sm_hi",
        } ],
    });
});

test("keeps Frontier shader targets separate from EVE and unaudited tiers", () =>
{
    const targets = new CjsToolShaderTargetRegistry();
    const target = targets.Get("frontier-webgl2");

    assert.equal(target.SupportsSourcePath(StandardPbr), true);
    assert.equal(target.SupportsSourcePath(StandardPbr.replace(".sm_hi", ".sm_depth")), false);
    assert.equal(targets.Find("frontier", "effect.webgl2"), target);
    assert.equal(targets.Find("eve", "effect.webgl2").id, "eve-webgl2");
    assert.throws(
        () => target.CreateCatalog([ StandardPbr ], { build: "latest" }),
        /requires an exact build/,
    );
});

test("catalogs WebGPU targets without weakening exact-build validation", () =>
{
    const target = new CjsToolShaderTargetRegistry().Get("eve-webgpu");
    const sourcePath = "res:/graphics/effect.dx11/managed/space/standard.sm_hi";
    const catalog = target.CreateCatalog([ sourcePath ], { build: 3430261 });

    assert.equal(target.outputProfile, "effect.webgpu");
    assert.equal(target.selectionPolicy.permutationMode, "selected");
    assert.deepEqual(target.qualificationPolicy, {
        level: "structural",
        nativeComparison: "pending-audit",
    });
    assert.equal(
        catalog.entries[0].outputPath,
        "res:/graphics/effect.webgpu/managed/space/standard.sm_hi",
    );
    assert.throws(() => target.CreateCatalog([ sourcePath ], { build: "latest" }), /exact build/u);
});

test("future Frontier WebGPU targets require format-owned native comparison", () =>
{
    const data = {
        id: "frontier-webgpu",
        target: "frontier",
        sourceProfile: "effect.dx11",
        outputProfile: "effect.webgpu",
        qualityTiers: [ "hi" ],
        sourceFamilies: [ "dx11-sm5.0" ],
        selectionPolicy: {
            sourceFamily: "dx11-sm5.0",
            permutationMode: "selected",
        },
        qualificationPolicy: {
            level: "structural",
            nativeComparison: "pending-audit",
        },
    };

    assert.throws(
        () => new CjsToolShaderTarget(data),
        /must require native HLSLcc comparison/u,
    );
    assert.equal(new CjsToolShaderTarget({
        ...data,
        qualificationPolicy: {
            level: "native-hlslcc",
            nativeComparison: "required",
        },
    }).qualificationPolicy.level, "native-hlslcc");
});

test("catalogs only index resolutions from one exact Frontier build", () =>
{
    const target = new CjsToolShaderTargetRegistry().Get("frontier-webgl2");
    const resolution = {
        target: "frontier",
        game: "Frontier",
        provider: "ccp",
        build: "3438337",
        logicalPath: StandardPbr,
    };
    const catalog = target.CreateCatalogFromResolutions([ resolution ]);

    assert.equal(catalog.build, "3438337");
    assert.equal(catalog.entries[0].sourcePath, StandardPbr);
    assert.throws(
        () => target.CreateCatalogFromResolutions([
            resolution,
            { ...resolution, build: "3438336", logicalPath: StandardPbr.replace("standardpbr", "other") }
        ]),
        /builds are mixed/,
    );
    assert.throws(
        () => target.CreateCatalogFromResolutions([ { ...resolution, target: "eve", game: "Eve" } ]),
        /does not match target frontier/,
    );
});
