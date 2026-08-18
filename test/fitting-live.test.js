import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { CjsSdeDatabase } from "../src/sde/index.js";
import { CjsToolFitting } from "../src/fitting/CjsToolFitting.js";

/**
 * The resolver against a real SDE.
 *
 * The codec suite proves the formats with a fixture resolver, which cannot show
 * that a real module resolves to the slot the game puts it in - the fixture
 * was written from the same reading of the data. This drives the actual SDE.
 *
 * Skipped when no prepared database is on this machine; preparing one has a
 * network in it and the baseline suite stays offline.
 */

const CACHE_ROOT = process.env.CJS_TOOL_CACHE
    ? path.join(process.env.CJS_TOOL_CACHE, "tool-core")
    : path.resolve(process.cwd(), "..", ".cache", "tool-core");

/**
 * Real types, chosen so each slot and category is covered once.
 *
 * These are stable, long-lived items rather than anything seasonal. If one is
 * ever moved this should fail loudly - that is the point of testing against the
 * real SDE rather than a copy of it.
 */
const KNOWN = Object.freeze([
    { typeID: 2913, name: "425mm AutoCannon II", slot: "high", category: "module" },
    { typeID: 12058, name: "10MN Afterburner II", slot: "medium", category: "module" },
    { typeID: 2048, name: "Damage Control II", slot: "low", category: "module" },
    { typeID: 31105, name: "Small Auxiliary Thrusters I", slot: "rig", category: "module" },
    // Category 32, not 7. Anything filtering on "module" drops it.
    { typeID: 45595, name: "Loki Defensive - Covert Reconfiguration", slot: "subsystem", category: "subsystem" },
    { typeID: 2456, name: "Hobgoblin II", slot: null, category: "drone" },
    { typeID: 12773, name: "Barrage M", slot: null, category: "charge" },
    { typeID: 23061, name: "Einherji I", slot: null, category: "fighter" },
    { typeID: 587, name: "Rifter", slot: null, category: "ship" }
]);

function FindDatabase(target)
{
    const root = path.join(CACHE_ROOT, "custom", "targets", target, "builds");

    if (!fs.existsSync(root)) return null;

    for (const build of fs.readdirSync(root)
        .filter(entry => /^\d+$/u.test(entry))
        .sort((left, right) => Number(right) - Number(left)))
    {
        const filePath = path.join(root, build, "sde_v1.sqlite");

        if (fs.existsSync(filePath)) return { build, filePath };
    }

    return null;
}

const found = FindDatabase("eve");
const skip = found ? false : `no prepared eve database under ${CACHE_ROOT}`;

async function Open()
{
    const database = await CjsSdeDatabase.open(found.filePath, { readOnly: true });

    return {
        database,
        fitting: new CjsToolFitting({
            target: "eve",
            game: "Eve",
            provider: "ccp",
            build: found.build,
            Table: name => database.Table(name)
        })
    };
}

test("every slot and category resolves from the SDE", { skip }, async () =>
{
    const { database, fitting } = await Open();

    for (const expected of KNOWN)
    {
        const byName = await fitting.Resolve(expected.name);

        assert.equal(byName?.typeID, expected.typeID, `${expected.name} resolves by name`);

        const classified = await fitting.Classify(expected.typeID);

        assert.equal(classified.slot, expected.slot, `${expected.name} slot`);
        assert.equal(classified.category, expected.category, `${expected.name} category`);
        assert.equal(classified.name, expected.name);
    }

    await database.Close();
});

test("a real EFT paste becomes a fit, and comes back as a link", { skip }, async () =>
{
    const { database, fitting } = await Open();
    const text = [
        "[Rifter, Live Test]",
        "",
        "Damage Control II",
        "",
        "10MN Afterburner II",
        "",
        "425mm AutoCannon II",
        "425mm AutoCannon II",
        "",
        "Small Auxiliary Thrusters I",
        "",
        "",
        "Hobgoblin II x2",
        "Barrage M x1000"
    ].join("\n");

    const parsed = await fitting.Parse(text);

    assert.equal(parsed.shipTypeID, 587);
    assert.equal(parsed.shipName, "Rifter");
    assert.equal(parsed.name, "Live Test");
    assert.equal(parsed.build, found.build);

    const high = parsed.items.filter(item => item.slot === "high");

    assert.equal(high.length, 2);
    assert.deepEqual(high.map(item => item.flag), [ "HiSlot0", "HiSlot1" ]);

    // The two that are not fitted, decided by their own category rather than by
    // where the text put them.
    const drone = parsed.items.find(item => item.typeID === 2456);
    const ammo = parsed.items.find(item => item.typeID === 12773);

    assert.equal(drone.flag, "DroneBay");
    assert.equal(drone.fitted, false);
    assert.equal(ammo.flag, "Cargo");
    assert.equal(ammo.quantity, 1000);

    assert.match(parsed.formats.chatLink, /^<url=fitting:587:/u);
    assert.match(parsed.formats.dna, /^587:/u);

    // Round trip through the emitted DNA.
    const again = await fitting.Parse(parsed.formats.dna);

    assert.equal(again.items.length, parsed.items.length);
    assert.equal(again.shipTypeID, 587);

    await database.Close();
});

test("an ESI fitting keeps the pilot's own slot positions", { skip }, async () =>
{
    const { database, fitting } = await Open();
    const parsed = await fitting.FromEsi({
        fitting_id: 1234,
        name: "Saved",
        ship_type_id: 587,
        items: [
            // Position 3 is the pilot's, and nothing may renumber it: ESI is the
            // only source that states where a module actually sat.
            { type_id: 2913, flag: "HiSlot3", quantity: 1 },
            { type_id: 2048, flag: "LoSlot0", quantity: 1 },
            { type_id: 12773, flag: "Cargo", quantity: 500 }
        ]
    });

    const gun = parsed.items.find(item => item.typeID === 2913);

    assert.equal(parsed.source.kind, "esi");
    assert.equal(parsed.source.fittingID, 1234);
    assert.equal(gun.slot, "high");
    assert.equal(gun.position, 3);
    assert.equal(gun.flag, "HiSlot3");
    assert.equal(gun.name, "425mm AutoCannon II");
    assert.equal(parsed.items.find(item => item.typeID === 12773).fitted, false);

    await database.Close();
});

test("an unpublished duplicate name cannot shadow a real type", { skip }, async () =>
{
    const { database, fitting } = await Open();

    // The index carries published types only. Retired duplicates - the "OLD
    // Loki ..." subsystems and similar - are exactly the collisions that would
    // otherwise resolve a fit to a type nobody can fit.
    const resolved = await fitting.Resolve("Loki Defensive - Covert Reconfiguration");
    const classified = await fitting.Classify(resolved.typeID);

    assert.equal(classified.slot, "subsystem");

    await database.Close();
});

test("skills: a real hull's requirements expand to their full closure", { skip }, async () =>
{
    const { database } = await Open();
    const { CjsToolSkills } = await import("../src/skills/index.js");
    const skills = new CjsToolSkills({
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: found.build,
        Table: name => database.Table(name)
    });

    const viator = await skills.Requirements(12743);

    assert.deepEqual(
        viator.required.map(entry => [ entry.name.text, entry.level ]),
        [ [ "Gallente Hauler", 5 ], [ "Transport Ships", 1 ] ]
    );

    // The closure reaches what the direct list does not say: Gallente Hauler
    // needs Spaceship Command III, Transport Ships needs Industry V.
    const closure = new Map(viator.closure.map(entry => [ entry.name.text, entry.level ]));

    assert.equal(closure.get("Spaceship Command"), 3);
    assert.equal(closure.get("Industry"), 5);
    assert.equal(viator.masteries.length, 5);

    const hauler = await skills.Skill(3340);

    assert.equal(hauler.rank, 4);
    assert.ok(hauler.unlocks.length > 0, "a skill with no unlocks would mean the reverse index is empty");

    await database.Close();
});
