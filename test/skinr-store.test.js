import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsToolSkinrStore, SKINR_TARGET } from "../src/skin/index.js";


function openStore(context)
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-skinr-"));
    const store = CjsToolSkinrStore.open({ dataRoot: directory });

    context.after(() =>
    {
        store.Close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    return store;
}

// The RAW ESI shape, because that is what the store keeps. The pattern
// generator reads `ship_type_id` and `layout.pattern_blend_mode`, and the
// custom-mask reader reads `projection.slot1` — normalizing is precisely the act
// of replacing those, so the normalized form cannot be the record.
const DESIGN = {
    id: "abc-123",
    name: "Test Design",
    line: "Test Line",
    creator_id: 90000001,
    ship_type_id: 587,
    tier: { level: 4 },
    layout: {
        pattern_blend_mode: "normal",
        slots: [ { id: 1, configuration: { nanocoating: { id: 67890 } } } ],
    },
};

function listing(id, price, state = "listed")
{
    return { id, skinrId: "abc-123", sellerId: 90000001, quantity: 1, state, price, created: "2026-08-01T00:00:00Z" };
}


test("a design keeps when it was first seen across re-harvests", context =>
{
    const store = openStore(context);

    store.PutDesign(DESIGN, "2026-08-17T10:00:00Z");
    store.PutDesign({ ...DESIGN, name: "Renamed" }, "2026-08-18T10:00:00Z");

    const design = store.GetDesign("abc-123");

    // The newer read wins for the payload - it is the better evidence - but
    // when we first saw it is ours to remember and cannot be re-derived.
    assert.equal(design.name, "Renamed");
    assert.equal(design.firstSeen, "2026-08-17T10:00:00Z");
    assert.equal(design.lastSeen, "2026-08-18T10:00:00Z");

    assert.equal(store.GetDesign("never-harvested"), null);
    assert.deepEqual(store.ListDesignsForShip(587).map(entry => entry.id), [ "abc-123" ]);

    // The reading is available, and so is the evidence. The pattern generator
    // takes the second one and cannot use the first.
    assert.equal(design.tierLevel, 4);
    assert.equal(design.slots[0].componentId, 67890);

    const raw = store.GetDesignPayload("abc-123");

    assert.equal(raw.ship_type_id, 587);
    assert.equal(raw.layout.pattern_blend_mode, "normal");
    assert.equal(raw.layout.slots[0].configuration.nanocoating.id, 67890);
    assert.equal(store.GetDesignPayload("never-harvested"), null);
});

test("listings are a log: the same listing twice is two rows", context =>
{
    const store = openStore(context);

    store.AppendListings([ listing("l1", { kind: "isk", value: 1000 }) ], "2026-08-17T10:00:00Z");
    store.AppendListings([ listing("l1", { kind: "isk", value: 900 }) ], "2026-08-18T10:00:00Z");

    const history = store.ListingHistory("l1");

    // Two observations, oldest first. A store that overwrote would have lost
    // the price change entirely, and the change is the only thing a price
    // history can be built from.
    assert.equal(history.length, 2);
    assert.deepEqual(history.map(entry => entry.price.value), [ 1000, 900 ]);
    assert.equal(history[0].observedAt, "2026-08-17T10:00:00Z");
});

test("re-recording one page does not double count", context =>
{
    const store = openStore(context);
    const page = [ listing("l1", { kind: "isk", value: 1000 }), listing("l2", { kind: "plex", value: 500 }) ];

    assert.equal(store.AppendListings(page, "2026-08-17T10:00:00Z"), 2);
    // A retried page after a network failure is the ordinary case, and it must
    // not turn one observation into two.
    assert.equal(store.AppendListings(page, "2026-08-17T10:00:00Z"), 0);
    assert.equal(store.Describe().observations, 2);
});

test("the current hub is a projection: one row per listing, its newest", context =>
{
    const store = openStore(context);

    store.AppendListings([
        listing("l1", { kind: "isk", value: 1000 }),
        listing("l2", { kind: "plex", value: 500 }),
    ], "2026-08-17T10:00:00Z");
    store.AppendListings([ listing("l1", { kind: "isk", value: 900 }, "sold_out") ], "2026-08-18T10:00:00Z");

    const latest = store.ListLatestListings();

    assert.equal(latest.length, 2, "two listings, not three observations");

    const first = latest.find(entry => entry.id === "l1");

    assert.equal(first.state, "sold_out");
    assert.equal(first.price.value, 900);

    // l2 was not in the second page. That is not evidence it was removed - a
    // page we did not fetch looks exactly the same - so its last observation
    // stands.
    assert.equal(latest.find(entry => entry.id === "l2").state, "listed");
});

test("a seeded random sort is one shuffle, readable in pages", context =>
{
    const store = openStore(context);
    const page = [];

    for (let i = 0; i < 40; i++) page.push(listing(`l${i}`, { kind: "isk", value: 1000 + i }));
    store.PutDesign(DESIGN, "2026-08-17T10:00:00Z");
    store.AppendListings(page, "2026-08-17T10:00:00Z");

    const ids = options => store.ListCards({ limit: 100, sort: "random", ...options }).cards.map(card => card.listingId);
    const first = ids({ seed: 7 });

    // Stable: the same seed is the same order, which is what lets a consumer
    // read it in pages at all.
    assert.deepEqual(ids({ seed: 7 }), first);

    // Paging it must produce the whole list once, in that order. This is the
    // property SQLite's random() does not have, and the reason the seed exists.
    const paged = [
        ...store.ListCards({ limit: 15, offset: 0, sort: "random", seed: 7 }).cards,
        ...store.ListCards({ limit: 15, offset: 15, sort: "random", seed: 7 }).cards,
        ...store.ListCards({ limit: 15, offset: 30, sort: "random", seed: 7 }).cards
    ].map(card => card.listingId);

    assert.deepEqual(paged, first);
    assert.equal(new Set(paged).size, page.length, "every listing once");

    // And it is a shuffle, not the default order under another name.
    assert.notDeepEqual(first, ids({ seed: 8 }));
    assert.notDeepEqual(first, store.ListCards({ limit: 100 }).cards.map(card => card.listingId));
});

test("every sort key reads in either direction", context =>
{
    const store = openStore(context);

    store.PutDesign({ ...DESIGN, id: "d1", name: "Alpha", tier: { level: 2 } }, "2026-08-17T10:00:00Z");
    store.PutDesign({ ...DESIGN, id: "d2", name: "Beta", tier: { level: 9 } }, "2026-08-17T10:00:00Z");
    store.AppendListings([
        { ...listing("l1", { kind: "isk", value: 100 }), skinrId: "d1" },
        { ...listing("l2", { kind: "isk", value: 900 }), skinrId: "d2" }
    ], "2026-08-17T10:00:00Z");

    const ids = options => store.ListCards({ limit: 10, ...options }).cards.map(card => card.listingId);

    // The key's own order is what asking for the key means.
    assert.deepEqual(ids({ sort: "price" }), [ "l1", "l2" ]);
    assert.deepEqual(ids({ sort: "tier" }), [ "l2", "l1" ], "tier reads highest first");

    // A stated direction is the COLUMN's: DESC on tier is 18 down to 1
    // whichever way tier reads by default, which is what somebody pressing it
    // is asking for.
    assert.deepEqual(ids({ sort: "price", direction: "desc" }), [ "l2", "l1" ]);
    assert.deepEqual(ids({ sort: "tier", direction: "asc" }), [ "l1", "l2" ]);
    assert.deepEqual(ids({ sort: "tier", direction: "desc" }), [ "l2", "l1" ]);
    assert.deepEqual(ids({ sort: "name", direction: "desc" }), [ "l2", "l1" ]);

    // Asking for the natural direction explicitly changes nothing.
    assert.deepEqual(ids({ sort: "price", direction: "asc" }), ids({ sort: "price" }));
    assert.deepEqual(ids({ sort: "tier", direction: "desc" }), ids({ sort: "tier" }));

    // The old spelling still answers, because links to it exist.
    assert.deepEqual(ids({ sort: "price-desc" }), [ "l2", "l1" ]);
});

test("a target with no SKINR is refused rather than answered empty", context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-skinr-"));

    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    // An empty store would state that serenity has no SKINR designs. It has no
    // SKINR at all, which is a different answer.
    assert.throws(
        () => CjsToolSkinrStore.open({ dataRoot: directory, target: "serenity" }),
        /does not exist for target serenity/u
    );
    assert.equal(SKINR_TARGET, "eve");
});

test("it refuses a database that is not a SKINR store", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-skinr-"));
    const file = path.join(directory, "not-skinr.sqlite");

    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    const impostor = CjsToolSkinrStore.open({ file });

    impostor.Close();

    // Rewrite the schema stamp the way another tool's database would carry its
    // own, and check the store notices rather than adding its tables to it.
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(file);

    raw.prepare("UPDATE skinr_meta SET value = 'carbon.sde.sqlite' WHERE key = 'schema'").run();
    raw.close();

    assert.throws(() => CjsToolSkinrStore.open({ file }), /Not a SKINR store/u);
});

test("the store is durable data, not build-scoped cache", context =>
{
    const store = openStore(context);
    const described = store.Describe();

    // No build in the path: a design is not a client-build artifact, and a
    // per-build layout would store the same design once per build and lose the
    // observations whenever a build was pruned.
    assert.equal(/[\\/]builds[\\/]/u.test(described.file), false);
    assert.match(described.file, /skinr[\\/]eve[\\/]skinr_v1\.sqlite$/u);
    assert.equal(described.schema, "carbon.skinr.sqlite");
    assert.equal(described.designs, 0);
});
