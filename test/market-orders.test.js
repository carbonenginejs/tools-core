import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolMarket } from "../src/market/index.js";

/**
 * An ESI that answers pages from a fixture and counts the reads.
 *
 * The counting matters here: half the reason this class exists is that a
 * costing prices forty components whose parts repeat, and re-asking inside
 * ESI's own expiry cannot produce a newer answer.
 */
function Esi({ pages = [], history = [], expires = null, names = [] } = {})
{
    const reads = [];

    return {
        reads,
        async Read(path)
        {
            reads.push(path);

            const headers = new Map();

            if (expires) headers.set("expires", expires);

            if (path.includes("/history"))
            {
                return { body: history, headers, status: 200 };
            }

            const page = Number(new URL(path, "http://x").searchParams.get("page")) || 1;

            headers.set("x-pages", String(pages.length));

            return { body: pages[page - 1] ?? [], headers, status: 200 };
        },
        async Post(path, ids)
        {
            reads.push(path);

            return names.filter(entry => ids.includes(entry.id));
        },
    };
}

function Order(overrides = {})
{
    return {
        order_id: 1,
        type_id: 34,
        is_buy_order: false,
        price: 5.5,
        volume_remain: 100,
        volume_total: 200,
        min_volume: 1,
        range: "region",
        issued: "2026-08-20T00:00:00Z",
        duration: 90,
        location_id: 60003760,
        system_id: 30000142,
        ...overrides,
    };
}

/** An expiry far enough ahead that a test never races it. */
const SOON = new Date(Date.now() + 5 * 60 * 1000).toUTCString();

test("an order book is normalised, named, and dated", async () =>
{
    const market = new CjsToolMarket({
        esi: Esi({
            pages: [ [ Order(), Order({ order_id: 2, is_buy_order: true, price: 5 }) ] ],
            expires: SOON,
            names: [
                { id: 60003760, name: "Jita IV - Moon 4 - Caldari Navy Assembly Plant" },
                { id: 30000142, name: "Jita" },
            ],
        }),
    });
    const answer = await market.Orders({ regionID: 10000002, typeID: 34 });

    assert.equal(answer.orders.length, 2);
    assert.equal(answer.orders[0].side, "sell", "not is_buy_order: a flag named for one of its answers");
    assert.equal(answer.orders[1].side, "buy");
    assert.equal(answer.orders[0].systemName, "Jita");
    assert.ok(answer.observedAt);
});

test("issued plus duration is the expiry, and duration is in days", async () =>
{
    const market = new CjsToolMarket({
        esi: Esi({ pages: [ [ Order({ issued: "2026-08-20T00:00:00Z", duration: 3 }) ] ], expires: SOON }),
    });
    const { orders } = await market.Orders({ regionID: 10000002, typeID: 34 });

    assert.equal(orders[0].expiresAt, "2026-08-23T00:00:00.000Z");
});

test("the whole book is read, not the first page of it", async () =>
{
    // A page is a thousand rows and a popular type in The Forge is several.
    // Reading page one and stopping is a plausible answer that silently omits
    // most of the book.
    const full = Array.from({ length: 1000 }, (all, index) => Order({ order_id: index + 1 }));
    const market = new CjsToolMarket({
        esi: Esi({ pages: [ full, [ Order({ order_id: 1001 }) ] ], expires: SOON }),
    });
    const { orders } = await market.Orders({ regionID: 10000002, typeID: 34 });

    assert.equal(orders.length, 1001);
});

test("a short page ends the read whatever the header claimed", async () =>
{
    // ESI has reported a page count for the whole region rather than for the
    // filtered query, which would have this asking for pages that do not exist.
    const esi = Esi({ pages: [ [ Order() ], [ Order({ order_id: 2 }) ] ], expires: SOON });
    const market = new CjsToolMarket({ esi });
    const { orders } = await market.Orders({ regionID: 10000002, typeID: 34 });

    assert.equal(orders.length, 1);
    assert.equal(esi.reads.filter(path => path.includes("/orders")).length, 1);
});

test("an answer is held until ESI says it has expired", async () =>
{
    const esi = Esi({ pages: [ [ Order() ] ], expires: SOON });
    const market = new CjsToolMarket({ esi });

    await market.Orders({ regionID: 10000002, typeID: 34 });
    await market.Orders({ regionID: 10000002, typeID: 34 });

    assert.equal(esi.reads.filter(path => path.includes("/orders")).length, 1,
        "asking again cannot produce a newer answer: the same cached document comes back from CCP");
});

test("a different type is a different question", async () =>
{
    const esi = Esi({ pages: [ [ Order() ] ], expires: SOON });
    const market = new CjsToolMarket({ esi });

    await market.Orders({ regionID: 10000002, typeID: 34 });
    await market.Orders({ regionID: 10000002, typeID: 35 });

    assert.equal(esi.reads.filter(path => path.includes("/orders")).length, 2);
});

test("an expiry in the past is a clock disagreement, not an instruction", async () =>
{
    const esi = Esi({ pages: [ [ Order() ] ], expires: new Date(Date.now() - 60000).toUTCString() });
    const market = new CjsToolMarket({ esi });
    const answer = await market.Orders({ regionID: 10000002, typeID: 34 });

    // It falls back to a short life rather than re-asking on every request.
    assert.ok(Date.parse(answer.expiresAt) > Date.now());
});

test("a station nobody can name still has a price", async () =>
{
    // Player structures are not public. One unnamed station must not lose the
    // whole book.
    const esi = Esi({ pages: [ [ Order({ location_id: 1035466617946 }) ] ], expires: SOON });
    const market = new CjsToolMarket({ esi });
    const { orders } = await market.Orders({ regionID: 10000002, typeID: 34 });

    assert.equal(orders[0].price, 5.5);
    assert.equal(orders[0].locationName, null);
    assert.equal(esi.reads.some(path => path.includes("/universe/names")), true,
        "the system is still public and still named");
});

test("history is a different question from the book", async () =>
{
    const market = new CjsToolMarket({
        esi: Esi({
            history: [ { date: "2026-08-20", average: 5.4, highest: 6, lowest: 5, order_count: 12, volume: 900 } ],
            expires: SOON,
        }),
    });
    const answer = await market.History({ regionID: 10000002, typeID: 34 });

    assert.deepEqual(answer.history[0], {
        date: "2026-08-20", average: 5.4, high: 6, low: 5, orderCount: 12, volume: 900,
    });
});

test("a missing region or type is the caller's mistake", async () =>
{
    const market = new CjsToolMarket({ esi: Esi() });

    await assert.rejects(() => market.Orders({ typeID: 34 }), TypeError);
    await assert.rejects(() => market.Orders({ regionID: 10000002, typeID: "rifter" }), TypeError);
    await assert.rejects(() => market.Orders({ regionID: -1, typeID: 34 }), TypeError);
});

test("a failed read is not held", async () =>
{
    let asked = 0;
    const market = new CjsToolMarket({
        esi: {
            async Read()
            {
                asked++;

                if (asked === 1) throw new Error("upstream fell over");

                return { body: [ Order() ], headers: new Map([ [ "expires", SOON ] ]), status: 200 };
            },
        },
    });

    await assert.rejects(() => market.Orders({ regionID: 10000002, typeID: 34 }));

    const answer = await market.Orders({ regionID: 10000002, typeID: 34 });

    assert.equal(answer.orders.length, 1, "the next caller gets a real attempt");
});

test("the proxy serves the book, and says so when nothing is configured", async context =>
{
    const { CjsToolHttpProxy } = await import("../src/index.js");

    async function Serve(options)
    {
        const proxy = new CjsToolHttpProxy({ indexes: { Open() {} }, ...options });
        const server = proxy.CreateServer();

        await new Promise((resolve, reject) =>
        {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        context.after(() => new Promise(resolve => server.close(resolve)));

        return `http://127.0.0.1:${server.address().port}`;
    }

    const bare = await Serve({});

    assert.equal((await fetch(`${bare}/v1/market/orders?region=10000002&type=34`)).status, 501);

    const root = await Serve({
        market: new CjsToolMarket({ esi: Esi({ pages: [ [ Order() ] ], expires: SOON }) }),
    });

    const answer = await fetch(`${root}/v1/market/orders?region=10000002&type=34`);

    assert.equal(answer.status, 200);
    assert.match(answer.headers.get("cache-control") ?? "", /max-age=\d+/u,
        "cacheable until ESI's own expiry, which is the only honest number");
    assert.equal((await answer.json()).orders.length, 1);

    // A malformed ask is the caller's mistake, not an upstream failure.
    assert.equal((await fetch(`${root}/v1/market/orders?region=10000002`)).status, 400);
});
