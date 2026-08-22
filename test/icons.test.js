import assert from "node:assert/strict";
import test from "node:test";

import {
    CjsToolHttpProxy,
    CjsToolIcons,
    NormalizeIconResourcePath,
} from "../src/index.js";

const ICONS = Object.freeze({
    355: Object.freeze({
        _key: 355,
        description: "Energy weapon",
        iconFile: "res:/UI/Texture/Icons/13_64_10",
    }),
    2070: Object.freeze({
        _key: 2070,
        iconFile: "res:/Texture/Landmark/A33colonialruins.jpg",
    }),
});

function CreateSource()
{
    return {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3475087",
        async LoadTables(names)
        {
            assert.deepEqual(names, [ "icons" ]);

            return { icons: ICONS };
        },
    };
}

test("normalizes SDE icon files into fetchable resource paths", async () =>
{
    const icons = new CjsToolIcons(CreateSource());

    assert.deepEqual(icons.Identity(), {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3475087",
    });
    assert.deepEqual(await icons.Get(355), {
        iconID: 355,
        description: "Energy weapon",
        resPath: "res:/ui/texture/icons/13_64_10.png",
    });
    assert.equal((await icons.Get(2070)).resPath,
        "res:/texture/landmark/a33colonialruins.jpg");
    assert.equal(await icons.Get(999), null);
    assert.throws(() => NormalizeIconResourcePath("../icon"), /must use res:\//u);
    assert.throws(() => NormalizeIconResourcePath("res:/ui/../icon"), /malformed/u);
});

test("serves icon collections and exact records through the public topic", async context =>
{
    const source = CreateSource();
    const proxy = new CjsToolHttpProxy({
        sde: {
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

    const root = `http://127.0.0.1:${server.address().port}/eve/latest/icons`;
    const collectionResponse = await fetch(root);
    const collection = await collectionResponse.json();
    const detailResponse = await fetch(`${root}/355`);

    assert.equal(collectionResponse.status, 200);
    assert.equal(collectionResponse.headers.get("x-carbon-answer"), "icons");
    assert.deepEqual(await detailResponse.json(), collection[355]);
    assert.equal((await fetch(`${root}/999`)).status, 404);
    assert.equal((await fetch(`${root}/invalid`)).status, 404);
    assert.equal((await fetch(`${root}/355/nested`)).status, 404);
});
