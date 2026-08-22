import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolIndex, CjsToolTargetRegistry } from "../src/index.js";

test("maps short public targets to internal source identities", () =>
{
    const targets = new CjsToolTargetRegistry();
    const eve = targets.Get("EVE");
    const frontier = targets.Get("frontier");
    const serenity = targets.Get("serenity");
    const infinity = targets.Get("infinity");

    assert.deepEqual(eve.toJSON(), {
        id: "eve",
        game: "Eve",
        provider: "ccp",
        client: "tranquility",
        libraries: [ "audio", "character", "shader", "skin", "skinr", "weapons" ],
        topics: [ "app", "icons", "map", "res", "sde", "skin", "skinr", "types", "weapons" ],
    });
    assert.equal(frontier.game, "Frontier");
    assert.equal(frontier.provider, "ccp");
    assert.equal(frontier.client, "stillness");
    assert.deepEqual(frontier.libraries, [ "audio", "shader" ]);
    assert.deepEqual(frontier.topics, [ "app", "res" ]);
    // Two Chinese targets share provider metadata but each names one client.
    // The single `netease` target they replace named none, so `latest` on it
    // resolved to whichever of two different games had the higher build.
    for (const [ target, id ] of [ [ serenity, "serenity" ], [ infinity, "infinity" ] ])
    {
        assert.equal(target.game, "Eve");
        assert.equal(target.provider, "netease");
        assert.equal(target.client, id);
        assert.deepEqual(target.overlaySources, [ {
            target: "eve",
            names: [ "legacy-gles" ],
        } ]);
        // The topics stand — they are what this target may serve once an
        // externally generated or custom SDE is supplied. What is gone is the
        // sources map, so `sde` now resolves to the target itself rather than
        // to EVE, and a request it cannot answer fails instead of being
        // answered by somebody else's data.
        assert.deepEqual(target.topics, [ "app", "icons", "map", "res", "sde", "skin", "skinr", "types", "weapons" ]);
        assert.deepEqual(target.topicSources, {});
        assert.equal(targets.ResolveTopicSource(id, "sde"), target);
    }
    assert.throws(
        () => targets.Resolve({ game: "Frontier", provider: "ccp" }),
        /requires target/,
    );
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
    assert.equal(targets.RequireTopic("eve", "icons").id, "eve");
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
