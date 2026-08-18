import assert from "node:assert/strict";
import test from "node:test";

import {
    FormatAll,
    FormatChatLink,
    FormatDna,
    FormatEft,
    ParseFitting
} from "../src/fitting/CjsToolFittingCodec.js";

/**
 * A resolver standing in for the SDE.
 *
 * Real type IDs would invite a reader to check them against a build and call
 * the test wrong when it is only different. What has to be real is the
 * behaviour: names resolve, and a type knows its own slot.
 */
const TYPES = Object.freeze({
    100: { name: "Test Frigate", slot: null, category: "ship" },
    200: { name: "Test AutoCannon II", slot: "high", category: "module" },
    201: { name: "Test Launcher II", slot: "high", category: "module" },
    300: { name: "Test Afterburner II", slot: "medium", category: "module" },
    400: { name: "Test Damage Control II", slot: "low", category: "module" },
    500: { name: "Test Rig I", slot: "rig", category: "module" },
    600: { name: "Test Subsystem", slot: "subsystem", category: "module" },
    700: { name: "Test Charge M", slot: null, category: "charge" },
    800: { name: "Test Drone II", slot: null, category: "drone" },
    900: { name: "Test Fighter", slot: null, category: "fighter" }
});

/** Items as a set, since order is a property of each format rather than the fit. */
function Items(fit)
{
    return fit.items
        .map(item => [ item.typeID, item.quantity, item.slot ])
        .sort((left, right) => left[0] - right[0]);
}

const RESOLVER = Object.freeze({
    async Resolve(name)
    {
        for (const [ id, type ] of Object.entries(TYPES))
        {
            if (type.name === name) return { typeID: Number(id), name };
        }

        return null;
    },
    async Classify(typeID)
    {
        const type = TYPES[typeID];

        return type ? { slot: type.slot, category: type.category, name: type.name } : null;
    }
});

test("EFT reads its published section order, low before high", async () =>
{
    // The order the format guide states, which is NOT the order the fitting
    // window draws. Slots come from the types, so this passes either way - what
    // it proves is that a real client paste is read correctly.
    const text = [
        "[Test Frigate, My Fit]",
        "",
        "Test Damage Control II",
        "",
        "Test Afterburner II",
        "",
        "Test AutoCannon II",
        "Test AutoCannon II",
        "",
        "Test Rig I",
        "",
        "",
        "Test Drone II x2",
        "Test Charge M x1000"
    ].join("\n");

    const fit = await ParseFitting(text, RESOLVER);

    assert.equal(fit.source.kind, "eft");
    assert.equal(fit.name, "My Fit");
    assert.equal(fit.shipTypeID, 100);
    assert.equal(fit.shipName, "Test Frigate");

    const high = fit.items.filter(item => item.slot === "high");

    assert.equal(high.length, 2);
    assert.deepEqual(high.map(item => item.flag), [ "HiSlot0", "HiSlot1" ]);
    assert.equal(fit.items.find(item => item.typeID === 400).flag, "LoSlot0");
    assert.equal(fit.items.find(item => item.typeID === 300).flag, "MedSlot0");
    assert.equal(fit.items.find(item => item.typeID === 500).flag, "RigSlot0");
});

test("what is not a module lands in the right bay whatever the text claimed", async () =>
{
    const fit = await ParseFitting([
        "[Test Frigate, Bays]",
        "",
        "Test Drone II x5",
        "Test Fighter x1",
        "Test Charge M x100"
    ].join("\n"), RESOLVER);

    const drone = fit.items.find(item => item.typeID === 800);
    const fighter = fit.items.find(item => item.typeID === 900);
    const charge = fit.items.find(item => item.typeID === 700);

    assert.deepEqual(
        [ drone.flag, fighter.flag, charge.flag ],
        [ "DroneBay", "FighterBay", "Cargo" ]
    );

    // EFT cannot say whether a line is fitted; the type can, and it wins.
    assert.equal(drone.fitted, false);
    assert.equal(charge.fitted, false);
    assert.equal(drone.quantity, 5);
});

test("EFT quantity, offline markers and empty slots are handled", async () =>
{
    const fit = await ParseFitting([
        "[Test Frigate, Edges]",
        "",
        "Test Damage Control II /offline",
        "[Empty High slot]",
        "Test Charge M x42"
    ].join("\n"), RESOLVER);

    assert.equal(fit.items.length, 2);
    assert.equal(fit.items[0].typeID, 400);
    assert.equal(fit.items[1].quantity, 42);
});

test("DNA reads a flat run of groups, because sections are not delimited", async () =>
{
    // The published grammar names five sections, but each is itself a
    // `:`-separated list, so the string cannot say where one ends. Slot comes
    // from the type. The trailing `::` is the terminator every real string has.
    const fit = await ParseFitting("100:200;2:300;1:400;1:700_;1000::", RESOLVER);

    assert.equal(fit.source.kind, "dna");
    assert.equal(fit.shipTypeID, 100);
    assert.deepEqual(
        fit.items.map(item => [ item.typeID, item.quantity, item.slot ]),
        [ [ 200, 2, "high" ], [ 300, 1, "medium" ], [ 400, 1, "low" ], [ 700, 1000, null ] ]
    );
});

test("an underscore means unfitted, and a charge is unfitted regardless", async () =>
{
    const fit = await ParseFitting("100:200_;1:700;500::", RESOLVER);
    const module = fit.items.find(item => item.typeID === 200);
    const charge = fit.items.find(item => item.typeID === 700);

    assert.equal(module.fitted, false);
    assert.equal(module.slot, null);
    assert.equal(module.flag, "Cargo");
    assert.equal(charge.fitted, false);
});

test("a chat link is DNA plus a name, and both survive", async () =>
{
    const fit = await ParseFitting("<url=fitting:100:200;1::>Deepflow Rift Dredger</url>", RESOLVER);

    assert.equal(fit.source.kind, "chatLink");
    assert.equal(fit.name, "Deepflow Rift Dredger");
    assert.equal(fit.shipTypeID, 100);
    assert.equal(fit.items[0].typeID, 200);
});

test("one record emits every wire form, and DNA round-trips", async () =>
{
    const fit = await ParseFitting([
        "[Test Frigate, Round Trip]",
        "",
        "Test Damage Control II",
        "",
        "Test AutoCannon II",
        "",
        "",
        "Test Drone II x2"
    ].join("\n"), RESOLVER);

    const all = FormatAll(fit);

    assert.equal(all.formats.dna, FormatDna(fit));
    assert.match(all.formats.chatLink, /^<url=fitting:100:/u);
    assert.match(all.formats.chatLink, />Round Trip<\/url>$/u);

    const again = await ParseFitting(all.formats.dna, RESOLVER);

    assert.equal(again.shipTypeID, fit.shipTypeID);

    // Membership round-trips; order does not, and must not be asserted. Each
    // format states its own section order - DNA writes high first, EFT writes
    // low first - so a fit that survived a round trip legitimately comes back
    // ordered differently. Nothing downstream may depend on item order.
    assert.deepEqual(Items(again), Items(fit));

    // And through the link form, which is the same DNA wrapped.
    const linked = await ParseFitting(FormatChatLink(fit), RESOLVER);

    assert.equal(linked.items.length, fit.items.length);
});

test("emitted EFT reads back to the same fit", async () =>
{
    const fit = await ParseFitting("100:200;1:300;1:400;1:800_;3::", RESOLVER);
    const text = FormatEft(fit);
    const again = await ParseFitting(text, RESOLVER);

    assert.deepEqual(Items(again), Items(fit));

    // Low first, as the format states.
    const lines = text.split("\n").filter(Boolean);

    assert.equal(lines[0], "[Test Frigate, Fitting]");
    assert.equal(lines[1], "Test Damage Control II");
});

test("unreadable input is refused rather than becoming an empty fit", async () =>
{
    await assert.rejects(() => ParseFitting("", RESOLVER), /empty/u);
    await assert.rejects(() => ParseFitting("just some words", RESOLVER), /header/u);
    await assert.rejects(
        () => ParseFitting("[Unknown Hull, x]\n\nTest Rig I", RESOLVER),
        /Unknown hull/u
    );
    await assert.rejects(
        () => ParseFitting("[Test Frigate, x]\n\nNot A Real Module", RESOLVER),
        /Unknown type/u
    );
    await assert.rejects(() => ParseFitting("0:200;1::", RESOLVER), /does not start with a ship/u);
});

test("an unnameable item is written visibly rather than dropped", async () =>
{
    const fit = await ParseFitting("100:200;1::", RESOLVER);

    fit.items.push({ typeID: 999999, name: null, quantity: 1, flag: "Cargo", slot: null, position: null, fitted: false, category: null });

    assert.match(FormatEft(fit), /<type 999999>/u);
});
