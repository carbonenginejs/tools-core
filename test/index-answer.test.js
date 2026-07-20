import assert from "node:assert/strict";
import test from "node:test";

import { CjsIndexAnswerCatalog, CjsToolHttpProxy } from "../src/index.js";

const Paths = Object.freeze([
    "res:/dx9/model/ship/amarr/battleship/ab1/ab1_t1_m.dds",
    "res:/dx9/model/ship/amarr/battleship/ab1/ab1_t1_n.dds",
    "res:/dx9/model/ship/amarr/battleship/ab1/igc/ab1_t1_igc_m.dds",
    "res:/dx9/model/ship/amarr/battleship/ab1/navy/ab1_t1_navy_m.dds",
    "res:/dx9/model/ship/amarr/battleship/ab1/wreck/ab1_t1_wreck_g.dds",
    "res:/dx9/scene/universe/amarr/amarr_cube.black",
    "res:/graphics/effect/example_m.dds",
    "res:/graphics/effect/navy/example_navy_m.dds",
    "res:/texture/environment/nebula/amarr_cube.dds",
    "res:/texture/environment/nebula/amarr_cube_blur.dds",
    "res:/texture/environment/nebula/amarr_cube_refl.png",
    "res:/texture/sprite/banners/corporation.png",
    "res:/texture/shared/ships/plates/shared_m.dds",
    "res:/texture/shared/ships/plates/navy/shared_navy_m.dds",
    "res:/video/billboards/quafe.webm",
]);
const SortedPaths = Object.freeze([ ...Paths ].sort((left, right) => left.localeCompare(right)));

test("derives build answers from one composed resource view", () =>
{
    const catalog = new CjsIndexAnswerCatalog(createSource());

    assert.equal(catalog.Has("RES:/VIDEO/BILLBOARDS/QUAFE.WEBM"), true);
    assert.deepEqual(catalog.ListResFiles(), SortedPaths);
    assert.deepEqual(catalog.ListBillboards(), [
        "res:/video/billboards/quafe.webm",
    ]);
    assert.deepEqual(catalog.DescribeResourcePath("texture/sprite/banners"), {
        name: "banners",
        path: "res:/texture/sprite/banners",
        type: "directory",
        children: [ {
            name: "corporation.png",
            path: "res:/texture/sprite/banners/corporation.png",
            type: "file",
        } ],
    });
    assert.deepEqual(catalog.DescribeResourcePath(
        "res:/texture/sprite/banners/corporation.png",
    ), {
        name: "corporation.png",
        path: "res:/texture/sprite/banners/corporation.png",
        type: "file",
    });
    assert.throws(
        () => catalog.DescribeResourcePath("texture/sprite/missing"),
        /not found/u,
    );
    assert.deepEqual(catalog.ListNebulas(), [
        "res:/dx9/scene/universe/amarr/amarr_cube.black",
    ]);
    assert.deepEqual(catalog.ListCubes(), [
        "res:/texture/environment/nebula/amarr_cube_blur.dds",
        "res:/texture/environment/nebula/amarr_cube_refl.png",
        "res:/texture/environment/nebula/amarr_cube.dds",
    ]);
    assert.deepEqual(catalog.ListHullResPathInserts("AB1_T1"), [ "igc", "navy" ]);
    assert.deepEqual(catalog.ListHullResPathInserts("ab1_fn"), [ "igc", "navy" ]);
    assert.deepEqual(catalog.ResolveHullResPathInserts("ab1_t1", "navy", [
        "RES:/DX9/MODEL/SHIP/AMARR/BATTLESHIP/AB1/AB1_T1_M.DDS",
        "res:/dx9/model/ship/amarr/battleship/ab1/ab1_t1_n.dds",
        "texture/shared/ships/plates/shared_m.dds",
        "res:/graphics/effect/example_m.dds",
    ]), [
        "res:/dx9/model/ship/amarr/battleship/ab1/navy/ab1_t1_navy_m.dds",
        "res:/dx9/model/ship/amarr/battleship/ab1/ab1_t1_n.dds",
        "res:/texture/shared/ships/plates/navy/shared_navy_m.dds",
        "res:/graphics/effect/example_m.dds",
    ]);
});

test("serves build answers with exact-build identity", async context =>
{
    let matchCount = 0;
    const source = createSource(() => matchCount++);
    const proxy = new CjsToolHttpProxy({
        indexes: {
            Open()
            {
                throw new Error("Generic index opening was not expected");
            },
            async OpenTarget(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "latest");
                return source;
            },
        },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const address = server.address();
    const root = `http://127.0.0.1:${address.port}/eve/latest`;
    const billboards = await fetch(`${root}/billboards`);
    const horizontalBanners = await fetch(
        `http://127.0.0.1:${address.port}/ccp/latest/resources/texture/sprite/banners`,
    );
    const nebulas = await fetch(`${root}/nebulas`);
    const cubes = await fetch(`${root}/cubes`);
    const resfiles = await fetch(`${root}/res/resfiles`);
    const inserts = await fetch(`${root}/sof/hulls/ab1_t1/respathinserts`);
    const resolved = await fetch(
        `${root}/sof/hulls/ab1_t1/respathinserts/navy/resolve`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                paths: [
                    "res:/dx9/model/ship/amarr/battleship/ab1/ab1_t1_m.dds",
                    "res:/texture/shared/ships/plates/shared_m.dds",
                    "res:/texture/shared/ships/plates/missing_m.dds",
                ],
            }),
        },
    );

    assert.deepEqual(await billboards.json(), [ "res:/video/billboards/quafe.webm" ]);
    assert.deepEqual(await horizontalBanners.json(), {
        name: "banners",
        path: "res:/texture/sprite/banners",
        type: "directory",
        children: [ {
            name: "corporation.png",
            path: "res:/texture/sprite/banners/corporation.png",
            type: "file",
        } ],
    });
    assert.deepEqual(await nebulas.json(), [
        "res:/dx9/scene/universe/amarr/amarr_cube.black",
    ]);
    assert.deepEqual(await cubes.json(), [
        "res:/texture/environment/nebula/amarr_cube_blur.dds",
        "res:/texture/environment/nebula/amarr_cube_refl.png",
        "res:/texture/environment/nebula/amarr_cube.dds",
    ]);
    assert.deepEqual(await resfiles.json(), SortedPaths);
    assert.deepEqual(await inserts.json(), [ "igc", "navy" ]);
    assert.deepEqual(await resolved.json(), [
        "res:/dx9/model/ship/amarr/battleship/ab1/navy/ab1_t1_navy_m.dds",
        "res:/texture/shared/ships/plates/navy/shared_navy_m.dds",
        "res:/texture/shared/ships/plates/missing_m.dds",
    ]);
    assert.equal(cubes.headers.get("x-carbon-answer"), "cubes");
    assert.equal(horizontalBanners.headers.get("x-carbon-answer"), "resource");
    assert.equal(cubes.headers.get("x-carbon-target"), "eve");
    assert.equal(cubes.headers.get("x-carbon-build"), "3436472");
    assert.equal(resfiles.headers.get("x-carbon-answer"), "resfiles");
    assert.equal(resolved.headers.get("x-carbon-answer"), "respathinserts-resolve");
    assert.equal(resolved.headers.get("x-carbon-sof-hull"), "ab1_t1");
    assert.equal(resolved.headers.get("x-carbon-respath-insert"), "navy");
    assert.equal(matchCount, 1);
});

test("returns original paths for inactive inserts and rejects malformed path requests", () =>
{
    const catalog = new CjsIndexAnswerCatalog(createSource());

    assert.deepEqual(catalog.ResolveHullResPathInserts("ab1_t1", "missing", [
        "res:/dx9/model/ship/amarr/battleship/ab1/ab1_t1_m.dds",
    ]), [
        "res:/dx9/model/ship/amarr/battleship/ab1/ab1_t1_m.dds",
    ]);
    assert.throws(
        () => catalog.ResolveHullResPathInserts("ab1_t1", "navy", {}),
        /must be an array/u,
    );
    assert.throws(
        () => catalog.ResolveHullResPathInserts("ab1_t1", "navy", [ "" ]),
        /index 0/u,
    );
});

function createSource(onMatch = () => {})
{
    return {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        buildRef: "latest",
        build: "3436472",
        client: "tranquility",
        Match(pattern, options)
        {
            assert.equal(pattern, "res:/**");
            assert.deepEqual(options, { root: "res" });
            onMatch();

            return Paths.map(logicalPath => ({ logicalPath }));
        },
    };
}
