import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolSkinrDesigns, SKINR_SLOT_KINDS, SKINR_PRICE_KINDS } from "../src/skin/index.js";


/**
 * A fake ESI client. Records the paths asked for, because half of what this
 * module does is build them.
 */
function makeEsi(responses)
{
    const asked = [];

    return {
        asked,
        async Get(path)
        {
            asked.push(path);
            const answer = responses[path];

            if (answer === undefined) throw new Error(`unexpected path ${path}`);

            return answer;
        },
    };
}

const DESIGN = {
    creator_id: 90000001,
    id: "abc-123",
    name: "Test Design",
    line: "Test Line",
    ship_type_id: 587,
    tier: { level: 2 },
    layout: {
        pattern_blend_mode: "subtract",
        slots: [
            { id: 1, configuration: { nanocoating: { id: 67890 } } },
            {
                id: 2,
                configuration: {
                    pattern: {
                        id: 11111,
                        configuration: {
                            mirrored: true,
                            projection: { slot1: true, slot2: false, slot3: true, slot4: false },
                            transform: {
                                position: { x: 1, y: 2, z: 3 },
                                rotation: { x: 0, y: 0, z: 0.5, w: 0.866 },
                                scaling: { x: 2, y: 2, z: 2 },
                            },
                        },
                    },
                },
            },
        ],
    },
};


test("a design normalizes into tagged slots, not a bag of optionals", async () =>
{
    const esi = makeEsi({ "/cosmetics/skinr/abc-123": DESIGN });
    const designs = new CjsToolSkinrDesigns({ esi });
    const design = await designs.GetSkinr("abc-123");

    assert.equal(esi.asked[0], "/cosmetics/skinr/abc-123");
    assert.equal(design.shipTypeId, 587);
    assert.equal(design.tierLevel, 2);
    assert.equal(design.patternBlendMode, "subtract");

    const [ nanocoating, pattern ] = design.slots;

    assert.equal(nanocoating.kind, SKINR_SLOT_KINDS.NANOCOATING);
    assert.equal(nanocoating.componentId, 67890);
    // The union arms are exclusive: a nanocoating slot carries no pattern data
    // at all, rather than pattern fields left undefined.
    assert.equal("transform" in nanocoating, false);

    assert.equal(pattern.kind, SKINR_SLOT_KINDS.PATTERN);
    assert.equal(pattern.mirrored, true);
    assert.deepEqual(pattern.projection, [ true, false, true, false ]);
    assert.deepEqual(pattern.transform.position, [ 1, 2, 3 ]);
    assert.deepEqual(pattern.transform.rotation, [ 0, 0, 0.5, 0.866 ]);
    assert.deepEqual(pattern.transform.scaling, [ 2, 2, 2 ]);
});

test("an unreadable slot is reported, not dropped", async () =>
{
    // A shape neither arm matches - a new component kind added inside the same
    // compatibility date. Dropping it would make a design look plain instead of
    // partly unread.
    const esi = makeEsi({
        "/cosmetics/skinr/x": {
            id: "x",
            layout: { pattern_blend_mode: "normal", slots: [ { id: 7, configuration: { hologram: { id: 1 } } } ] },
        },
    });

    const design = await new CjsToolSkinrDesigns({ esi }).GetSkinr("x");

    assert.equal(design.slots.length, 1);
    assert.equal(design.slots[0].kind, null);
    assert.deepEqual(design.slots[0].unread, { hologram: { id: 1 } });
});

test("ids are escaped, and an empty id is refused", async () =>
{
    const esi = makeEsi({ "/cosmetics/skinr/a%2Fb": { id: "a/b", layout: {} } });
    const designs = new CjsToolSkinrDesigns({ esi });

    await designs.GetSkinr("a/b");
    assert.equal(esi.asked[0], "/cosmetics/skinr/a%2Fb");

    await assert.rejects(() => designs.GetSkinr("  "), TypeError);
});

test("listings normalize their price union and keep timestamps verbatim", async () =>
{
    const esi = makeEsi({
        "/paragon-hub/skinr?limit=10": {
            cursor: { after: "next" },
            listings: [
                { id: "l1", skinr_id: "abc-123", seller_id: 90000001, quantity: 3, state: "listed", created: "2019-08-24T14:15:22Z", price: { isk: 1234.5 } },
                { id: "l2", skinr_id: "def-456", seller_id: 90000002, quantity: 1, state: "sold_out", price: { plex: 500 } },
                { id: "l3", skinr_id: "ghi-789", price: { credits: 5 } },
            ],
        },
    });

    const page = await new CjsToolSkinrDesigns({ esi }).ListParagonHub({ limit: 10 });

    assert.equal(page.cursor.after, "next");
    assert.equal(page.cursor.before, null, "an absent cursor end is null, not undefined");

    assert.deepEqual(page.listings[0].price, { kind: SKINR_PRICE_KINDS.ISK, value: 1234.5 });
    assert.deepEqual(page.listings[1].price, { kind: SKINR_PRICE_KINDS.PLEX, value: 500 });
    assert.deepEqual(page.listings[2].price, { kind: null, unread: { credits: 5 } });

    // Kept as sent. A stored observation should be what was observed, and
    // reserializing a Date does not round-trip to the same string.
    assert.equal(page.listings[0].created, "2019-08-24T14:15:22Z");
});

test("paging refuses both cursors, and clamps the limit", async () =>
{
    const designs = new CjsToolSkinrDesigns({ esi: makeEsi({}) });

    await assert.rejects(() => designs.ListParagonHub({ after: "1", before: "2" }), TypeError);

    assert.equal(CjsToolSkinrDesigns.normalizeLimit(5), 10);
    assert.equal(CjsToolSkinrDesigns.normalizeLimit(1000), 100);
    assert.equal(CjsToolSkinrDesigns.normalizeLimit(50), 50);
    assert.equal(CjsToolSkinrDesigns.normalizeLimit("nonsense"), 10);
});

test("the walk follows cursors, stops at the end, and cannot loop", async () =>
{
    // `before`, not `after`. Measured on the live service 2026-08-18: the hub is
    // ordered newest first, so `after` asks for listings newer than the newest
    // and answers empty on every page - which reads exactly like a hub one page
    // long, and silently harvested nothing.
    const esi = makeEsi({
        "/paragon-hub/skinr?limit=100": { cursor: { before: "p2" }, listings: [ { id: "a", skinr_id: "s1" } ] },
        "/paragon-hub/skinr?before=p2&limit=100": { cursor: {}, listings: [ { id: "b", skinr_id: "s2" } ] },
    });

    const pages = [];
    for await (const page of new CjsToolSkinrDesigns({ esi }).WalkParagonHub()) pages.push(page);

    assert.equal(pages.length, 2, "stops when the service reports no further cursor");
    assert.deepEqual([ ...CjsToolSkinrDesigns.collectSkinrIds(pages.flatMap(p => p.listings)) ], [ "s1", "s2" ]);

    // A cursor that does not advance would otherwise page forever.
    const stuck = makeEsi({
        "/paragon-hub/skinr?limit=100": { cursor: { before: null }, listings: [] },
    });
    const seen = [];
    for await (const page of new CjsToolSkinrDesigns({ esi: stuck }).WalkParagonHub()) seen.push(page);

    assert.equal(seen.length, 1, "a repeated cursor ends the walk");
});

test("design ids are deduplicated across sellers", () =>
{
    const ids = CjsToolSkinrDesigns.collectSkinrIds([
        { skinrId: "same" }, { skinrId: "same" }, { skinrId: "other" }, { skinrId: null },
    ]);

    assert.deepEqual([ ...ids ], [ "same", "other" ]);
});

test("it refuses an ESI client it cannot use", () =>
{
    assert.throws(() => new CjsToolSkinrDesigns({}), TypeError);
    assert.throws(() => new CjsToolSkinrDesigns({ esi: {} }), TypeError);
});
