import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolHttpProxy } from "../src/proxy/index.js";

/**
 * The dogma and industry routes over a real loopback server.
 *
 * The service suites cover the arithmetic; this covers the wire: which verb
 * carries a profile, what a bad request answers, and that a numeric build
 * reaches the response. The SDE is a hand-written fake rather than a database,
 * because none of that depends on SQLite.
 */

const TABLES = {
    types: {
        1000: { groupID: 25, name: { en: "Test Hull" } },
        3426: { groupID: 273, name: { en: "CPU Management" } }
    },
    typeDogma: {
        1000: { dogmaAttributes: [ { attributeID: 48, value: 250 } ], dogmaEffects: [] },
        3426: {
            dogmaAttributes: [ { attributeID: 280, value: 0 }, { attributeID: 424, value: 5 } ],
            dogmaEffects: [ { effectID: 368 }, { effectID: 397 } ]
        }
    },
    dogmaAttributes: {
        48: { name: "cpuOutput", defaultValue: 0 },
        280: { name: "skillLevel", defaultValue: 0 },
        424: { name: "cpuOutputBonus2", defaultValue: 0 }
    },
    dogmaEffects: {
        368: {
            name: "cpuBonusPerLevel",
            modifierInfo: [ { domain: "itemID", func: "ItemModifier", modifiedAttributeID: 424, modifyingAttributeID: 280, operation: 0 } ]
        },
        397: {
            name: "cpuOutputBonus",
            modifierInfo: [ { domain: "shipID", func: "ItemModifier", modifiedAttributeID: 48, modifyingAttributeID: 424, operation: 6 } ]
        }
    },
    blueprints: {
        1001: {
            blueprintTypeID: 1001,
            activities: {
                manufacturing: {
                    time: 600,
                    materials: [ { typeID: 2000, quantity: 100 } ],
                    products: [ { typeID: 1000, quantity: 1 } ]
                }
            }
        }
    },
    typeMaterials: {
        1000: { materials: [ { materialTypeID: 2000, quantity: 90 } ] }
    }
};

function CreateSource()
{
    return {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        // The exact numeric build, as `latest` would have resolved to. Every
        // answer has to carry it back.
        build: "3466501",
        Table(name)
        {
            const rows = TABLES[name] ?? {};

            return {
                name,
                async Get(id)
                {
                    const row = rows[String(id)];

                    return row ? { table: name, id: Number(id), payload: { _key: Number(id), ...row } } : null;
                },
                async List({ limit = 100, offset = 0 } = {})
                {
                    return Object.entries(rows)
                        .slice(offset, offset + limit)
                        .map(([ id, row ]) => ({ table: name, id: Number(id), payload: { _key: Number(id), ...row } }));
                },
                async Count()
                {
                    return Object.keys(rows).length;
                }
            };
        },
        async LoadTables() {},
        DatabaseFile: () => null,
        async Describe()
        {
            return { target: "eve", build: "3466501", tables: [] };
        }
    };
}

async function Serve(context)
{
    const source = CreateSource();
    const proxy = new CjsToolHttpProxy({
        sde: {
            async OpenTarget()
            {
                return source;
            }
        }
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    context.after(() => new Promise(resolve => server.close(resolve)));

    return `http://127.0.0.1:${server.address().port}`;
}

test("GET evaluates the published hull and POST evaluates it with skills", async context =>
{
    const root = await Serve(context);

    const bare = await fetch(`${root}/eve/latest/dogma/types/1000`);
    const published = await bare.json();

    assert.equal(bare.status, 200);
    assert.equal(published.base.cpuOutput, 250);
    assert.equal(published.effective.cpuOutput, 250);
    assert.equal(published.profile.mode, "none");
    assert.equal(published.build, "3466501");

    const trained = await fetch(`${root}/eve/latest/dogma/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            typeID: 1000,
            profile: { mode: "automatic", skills: [ { typeID: 3426, level: 5 } ] }
        })
    });
    const evaluated = await trained.json();

    assert.equal(trained.status, 200);
    assert.equal(evaluated.effective.cpuOutput, 312.5);
    assert.equal(evaluated.base.cpuOutput, 250);
    assert.equal(evaluated.profile.mode, "automatic");
    assert.equal(evaluated.applied[0].effect, "cpuOutputBonus");
});

test("a malformed profile is the caller's error, not a server error", async context =>
{
    const root = await Serve(context);

    const bad = await fetch(`${root}/eve/latest/dogma/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typeID: 1000, profile: { mode: "manual", skills: [ { typeID: 3426, level: 9 } ] } })
    });

    assert.equal(bad.status, 400);

    const unknownSection = await fetch(`${root}/eve/latest/dogma/types/1000?sections=teleportation`);

    assert.equal(unknownSection.status, 400);

    const missing = await fetch(`${root}/eve/latest/dogma/types/999999`);

    assert.equal(missing.status, 404);

    const notARoute = await fetch(`${root}/eve/latest/dogma/pilots/1`);

    assert.equal(notARoute.status, 404);
});

test("the industry route answers the public recipe", async context =>
{
    const root = await Serve(context);
    const response = await fetch(`${root}/eve/latest/industry/types/1000`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.blueprint.typeID, 1001);
    assert.equal(body.blueprint.manufacturing.materials[0].quantity, 100);
    assert.equal(body.reprocessedMaterials[0].quantity, 90);
    assert.equal(body.build, "3466501");

    const missing = await fetch(`${root}/eve/latest/industry/types/999999`);

    assert.equal(missing.status, 404);

    const notARoute = await fetch(`${root}/eve/latest/industry/blueprints/1001`);

    assert.equal(notARoute.status, 404);
});

test("both topics report 501 when no SDE is configured", async context =>
{
    // Some service, just not the SDE: the proxy refuses to start with none at
    // all, and this test is about the topic being unavailable rather than the
    // server being unconfigured.
    const proxy = new CjsToolHttpProxy({ audio: { async OpenTarget() { return null; } } });
    const server = proxy.CreateServer();

    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    context.after(() => new Promise(resolve => server.close(resolve)));

    const root = `http://127.0.0.1:${server.address().port}`;

    assert.equal((await fetch(`${root}/eve/latest/dogma/types/1000`)).status, 501);
    assert.equal((await fetch(`${root}/eve/latest/industry/types/1000`)).status, 501);
    assert.equal(proxy.capabilities.dogma, false);
    assert.equal(proxy.capabilities.industry, false);
});
