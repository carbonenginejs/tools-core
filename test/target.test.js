import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolIndex, CjsToolTargetRegistry } from "../src/index.js";

test("maps short public targets to internal source identities", () =>
{
    const targets = new CjsToolTargetRegistry();
    const eve = targets.Get("EVE");
    const frontier = targets.Get("frontier");
    const netease = targets.Get("netease");

    assert.deepEqual(eve.toJSON(), {
        id: "eve",
        game: "Eve",
        provider: "ccp",
        client: "tranquility",
        libraries: [ "audio", "character", "shader", "skin", "skinr", "weapons" ],
        topics: [ "app", "res", "sde", "skin", "skinr", "weapons" ],
    });
    assert.equal(frontier.game, "Frontier");
    assert.equal(frontier.provider, "ccp");
    assert.equal(frontier.client, "stillness");
    assert.deepEqual(frontier.libraries, [ "audio", "shader" ]);
    assert.deepEqual(frontier.topics, [ "app", "res" ]);
    assert.equal(netease.game, "Eve");
    assert.equal(netease.provider, "netease");
    assert.equal(targets.Find("frontier", "ccp"), frontier);
});

test("keeps unaudited library targets disabled", () =>
{
    const targets = new CjsToolTargetRegistry();

    assert.equal(targets.RequireLibrary("eve", "audio").id, "eve");
    assert.equal(targets.RequireLibrary("frontier", "audio").id, "frontier");
    assert.equal(targets.RequireLibrary("frontier", "shader").id, "frontier");
    assert.equal(targets.RequireLibrary("eve", "shader").id, "eve");
    assert.equal(targets.RequireLibrary("eve", "character").id, "eve");
    assert.equal(targets.RequireLibrary("eve", "skin").id, "eve");
    assert.equal(targets.RequireLibrary("eve", "skinr").id, "eve");
    assert.equal(targets.RequireLibrary("eve", "weapons").id, "eve");
    assert.equal(targets.RequireTopic("eve", "sde").id, "eve");
    assert.equal(targets.RequireTopic("eve", "skin").id, "eve");
    assert.equal(targets.RequireTopic("eve", "skinr").id, "eve");
    assert.equal(targets.RequireTopic("eve", "weapons").id, "eve");
    assert.throws(
        () => targets.RequireLibrary("frontier", "character"),
        /does not support target frontier/,
    );
    assert.throws(
        () => targets.RequireTopic("frontier", "sde"),
        /not available for target frontier/,
    );
    assert.throws(
        () => targets.Resolve({ target: "eve", game: "Frontier", provider: "ccp" }),
        /does not use game Frontier/,
    );
});

test("creates exact internal options without losing the public target", () =>
{
    const target = new CjsToolTargetRegistry().Get("frontier");

    assert.deepEqual(target.CreateIndexOptions({ build: 3438337 }), {
        target: "frontier",
        game: "Frontier",
        provider: "ccp",
        build: "3438337",
        client: "stillness",
    });
});

test("CjsToolIndex validates target identity on its generic front door", async () =>
{
    const indexes = new CjsToolIndex({
        cache: null,
        fetch: async () =>
        {
            throw new Error("Exact build resolution must not fetch");
        },
    });
    const frontier = await indexes.ResolveBuild({
        target: "frontier",
        build: "3438337",
    });

    assert.equal(frontier.target, "frontier");
    assert.equal(frontier.game, "Frontier");
    assert.equal(frontier.provider, "ccp");
    assert.equal(frontier.client, "stillness");
    await assert.rejects(
        () => indexes.ResolveBuild({
            target: "frontier",
            game: "Eve",
            build: "3438337",
        }),
        /does not use game Eve/,
    );
});
