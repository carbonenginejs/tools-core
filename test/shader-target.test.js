import assert from "node:assert/strict";
import test from "node:test";

import { CjsShaderTargetRegistry } from "../src/index.js";

const StandardPbr = "res:/graphics/effect.dx11/managed/space/characters/standardpbr.sm_hi";

test("catalogs Frontier CEWG outputs under its WebGL2 profile and exact build", () =>
{
    const targets = new CjsShaderTargetRegistry();
    const target = targets.Get("frontier-webgl2");
    const catalog = target.CreateCatalog([ StandardPbr ], { build: 3438337 });

    assert.deepEqual(target.toJSON(), {
        id: "frontier-webgl2",
        target: "frontier",
        format: "CEWG",
        sourceProfile: "effect.dx11",
        outputProfile: "effect.webgl2",
        qualityTiers: [ "hi" ],
        overlay: "webgl2",
    });
    assert.deepEqual(catalog, {
        id: "frontier-webgl2",
        target: "frontier",
        game: "Frontier",
        provider: "ccp",
        client: "stillness",
        build: "3438337",
        format: "CEWG",
        sourceProfile: "effect.dx11",
        outputProfile: "effect.webgl2",
        overlay: "webgl2-3438337",
        entries: [ {
            sourcePath: StandardPbr,
            outputPath: "res:/graphics/effect.webgl2/managed/space/characters/standardpbr.sm_hi",
        } ],
    });
});

test("keeps Frontier shader targets separate from EVE and unaudited tiers", () =>
{
    const targets = new CjsShaderTargetRegistry();
    const target = targets.Get("frontier-webgl2");

    assert.equal(target.SupportsSourcePath(StandardPbr), true);
    assert.equal(target.SupportsSourcePath(StandardPbr.replace(".sm_hi", ".sm_depth")), false);
    assert.equal(targets.Find("frontier", "effect.webgl2"), target);
    assert.equal(targets.Find("eve", "effect.webgl2"), null);
    assert.throws(
        () => target.CreateCatalog([ StandardPbr ], { build: "latest" }),
        /requires an exact build/,
    );
});

test("catalogs only index resolutions from one exact Frontier build", () =>
{
    const target = new CjsShaderTargetRegistry().Get("frontier-webgl2");
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
