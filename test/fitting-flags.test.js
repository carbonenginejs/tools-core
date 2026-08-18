import assert from "node:assert/strict";
import test from "node:test";

import {
    DescribeFlags,
    FITTING_FLAGS,
    FLAG_SOURCES,
    FlagByID,
    FlagByName,
    FlagForSlot,
    ReadFlag
} from "../src/fitting/index.js";

/**
 * The flag vocabulary.
 *
 * This is the one table in the fitting path that is not read from anywhere, so
 * the tests are mostly about honesty: the names claim ESI as their source, the
 * numbers claim only us, and the entries we have no number for say so rather
 * than carrying a plausible zero.
 */

test("slot flags round-trip through their name", () =>
{
    for (const [ slot, sample ] of [
        [ "high", "HiSlot0" ],
        [ "medium", "MedSlot3" ],
        [ "low", "LoSlot7" ],
        [ "rig", "RigSlot2" ],
        [ "subsystem", "SubSystemSlot1" ],
        [ "service", "ServiceSlot0" ]
    ])
    {
        const read = ReadFlag(sample);

        assert.equal(read.slot, slot, sample);
        assert.equal(FlagForSlot(slot, read.position), sample);
    }
});

test("a bay is not a slot, which is what unfitted means", () =>
{
    for (const name of [ "Cargo", "DroneBay", "FighterBay", "FighterTube3", "Implant" ])
    {
        assert.equal(ReadFlag(name), null, name);
        assert.equal(FlagByName(name).slot, null);
    }

    assert.equal(FlagByName("DroneBay").kind, "drone");
    assert.equal(FlagByName("FighterTube3").kind, "fighter");
});

test("a position past the indexed range still reads as its slot", () =>
{
    // No hull has a ninth high slot today. If one appears, the name is formed
    // the same way, and guessing a different spelling would be worse.
    const read = ReadFlag("HiSlot9");

    assert.deepEqual(read, { slot: "high", position: 9 });
    assert.equal(FlagByName("HiSlot9"), null, "not in the table, but still readable");
});

test("an unknown flag is null rather than a guessed slot", () =>
{
    for (const name of [ "", null, "Wallet", "CorpSAG3", "HiSlot", "HiSlotX" ])
    {
        assert.equal(ReadFlag(name), null, String(name));
    }
});

test("names claim ESI; numbers claim only us", () =>
{
    for (const flag of FITTING_FLAGS)
    {
        assert.equal(flag.source, FLAG_SOURCES.esi, `${flag.name} name source`);

        if (flag.flagID === null) assert.equal(flag.flagIDSource, null);
        else assert.equal(flag.flagIDSource, FLAG_SOURCES.manual, `${flag.name} id source`);
    }
});

test("the numbers we do carry are unique and reachable", () =>
{
    const seen = new Set();

    for (const flag of FITTING_FLAGS)
    {
        if (flag.flagID === null) continue;

        assert.ok(!seen.has(flag.flagID), `duplicate flagID ${flag.flagID} on ${flag.name}`);
        seen.add(flag.flagID);
        assert.equal(FlagByID(flag.flagID).name, flag.name);
    }

    // The ranges that are recorded, spot-checked at their edges.
    assert.equal(FlagByID(11).name, "LoSlot0");
    assert.equal(FlagByID(27).name, "HiSlot0");
    assert.equal(FlagByID(87).name, "DroneBay");
    assert.equal(FlagByID(999), null);
});

test("what has no number says so, rather than carrying a zero", () =>
{
    const described = DescribeFlags();

    assert.equal(described.flagIDs.verified, false);
    assert.ok(described.flagIDs.missing.includes("ServiceSlot0"));
    assert.ok(described.flagIDs.known > 0);

    // Every service slot is name-only, and none of them pretends otherwise.
    for (const flag of FITTING_FLAGS.filter(entry => entry.slot === "service"))
    {
        assert.equal(flag.flagID, null);
    }
});
