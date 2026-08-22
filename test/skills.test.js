import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsToolSdeDatabase } from "../src/sde/index.js";
import { CjsToolSkills } from "../src/skills/index.js";

function CreateDatabasePath()
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-skills-"));

    return path.join(directory, "sde_v1.sqlite");
}

/**
 * A three-deep requirement chain, one diamond, and a mastery.
 *
 * The diamond is the point: the hull needs skill 300 at I directly and at V
 * through another path, and a closure that reported I would produce a plan that
 * does not unlock the hull.
 *
 * Attribute IDs are the SDE's real ones, because the pairing is the thing
 * under test - `requiredSkill4` is 1285 with its level at 1286, while
 * `requiredSkill5` is 1289 with its level at 1287.
 */
const TABLES = Object.freeze({
    types: {
        1000: { _key: 1000, name: { en: "Test Hull" }, groupID: 25, published: true },
        100: { _key: 100, name: { en: "Skill Alpha" }, groupID: 257, published: true },
        200: { _key: 200, name: { en: "Skill Beta" }, groupID: 257, published: true },
        300: { _key: 300, name: { en: "Skill Gamma" }, groupID: 257, published: true },
        1500: { _key: 1500, name: { en: "Other Hull" }, groupID: 25, published: true },
        1600: { _key: 1600, name: { en: "Unpublished Hull" }, groupID: 25, published: false }
    },
    dogmaAttributes: {
        182: { _key: 182, name: "requiredSkill1" },
        183: { _key: 183, name: "requiredSkill2" },
        184: { _key: 184, name: "requiredSkill3" },
        275: { _key: 275, name: "skillTimeConstant" },
        277: { _key: 277, name: "requiredSkill1Level" },
        278: { _key: 278, name: "requiredSkill2Level" },
        279: { _key: 279, name: "requiredSkill3Level" },
        180: { _key: 180, name: "primaryAttribute" },
        181: { _key: 181, name: "secondaryAttribute" },
        1285: { _key: 1285, name: "requiredSkill4" },
        1286: { _key: 1286, name: "requiredSkill4Level" },
        1287: { _key: 1287, name: "requiredSkill5Level" },
        1289: { _key: 1289, name: "requiredSkill5" }
    },
    typeDogma: {
        1000: {
            _key: 1000,
            dogmaAttributes: [
                { attributeID: 182, value: 100 },
                { attributeID: 277, value: 5 },
                // Directly at I, and at V through Alpha. The closure must say V.
                { attributeID: 183, value: 300 },
                { attributeID: 278, value: 1 }
            ],
            dogmaEffects: []
        },
        100: {
            _key: 100,
            dogmaAttributes: [
                { attributeID: 275, value: 6 },
                { attributeID: 180, value: 165 },
                { attributeID: 181, value: 166 },
                { attributeID: 182, value: 200 },
                { attributeID: 277, value: 3 }
            ],
            dogmaEffects: []
        },
        200: {
            _key: 200,
            dogmaAttributes: [ { attributeID: 275, value: 3 }, { attributeID: 182, value: 300 }, { attributeID: 277, value: 5 } ],
            dogmaEffects: []
        },
        300: { _key: 300, dogmaAttributes: [ { attributeID: 275, value: 1 } ], dogmaEffects: [] },
        // Uses the fourth and fifth slots, whose attribute IDs are not adjacent.
        1500: {
            _key: 1500,
            dogmaAttributes: [
                { attributeID: 1285, value: 100 },
                { attributeID: 1286, value: 2 },
                { attributeID: 1289, value: 200 },
                { attributeID: 1287, value: 4 }
            ],
            dogmaEffects: []
        },
        1600: {
            _key: 1600,
            dogmaAttributes: [ { attributeID: 182, value: 300 }, { attributeID: 277, value: 1 } ],
            dogmaEffects: []
        }
    },
    masteries: {
        1000: {
            _key: 1000,
            _value: [
                { _key: 0, _value: [ 50 ] },
                { _key: 1, _value: [ 50, 64 ] }
            ]
        }
    },
    certificates: {
        50: { _key: 50, name: { en: "Small Energy Turret" }, groupID: 255 },
        64: { _key: 64, name: { en: "Medium Energy Turret" }, groupID: 255 }
    }
});

async function OpenFixture()
{
    const filePath = CreateDatabasePath();
    const database = await CjsToolSdeDatabase.create(filePath);

    await database.ImportTables(TABLES, { build: 3466501 });

    return {
        database,
        skills: new CjsToolSkills({
            target: "eve",
            game: "Eve",
            provider: "ccp",
            build: "3466501",
            Table: name => database.Table(name)
        })
    };
}

test("direct requirements come back in slot order, with names", async () =>
{
    const { database, skills } = await OpenFixture();
    const answer = await skills.Requirements(1000);

    assert.equal(answer.typeID, 1000);
    assert.deepEqual(
        answer.required.map(entry => [ entry.typeID, entry.level, entry.name.text ]),
        [ [ 100, 5, "Skill Alpha" ], [ 300, 1, "Skill Gamma" ] ]
    );

    await database.Close();
});

test("the closure keeps the highest level any path demands", async () =>
{
    const { database, skills } = await OpenFixture();
    const answer = await skills.Requirements(1000);
    const gamma = answer.closure.find(entry => entry.typeID === 300);

    // Directly at I; through Alpha -> Beta at V. Reporting I would give a plan
    // that does not unlock the hull.
    assert.equal(gamma.level, 5);

    assert.deepEqual(
        answer.closure.map(entry => entry.typeID).sort((left, right) => left - right),
        [ 100, 200, 300 ]
    );

    // Shallowest first, so a caller can train down the list.
    assert.equal(answer.closure[0].depth, 0);

    await database.Close();
});

test("the fourth to sixth slots pair correctly, where the IDs are not adjacent", async () =>
{
    const { database, skills } = await OpenFixture();
    const answer = await skills.Requirements(1500);

    // requiredSkill4 is 1285 and its level 1286; requiredSkill5 is 1289 with its
    // level at 1287. Anything assuming a fixed offset mispairs these.
    assert.deepEqual(
        answer.required.map(entry => [ entry.typeID, entry.level ]),
        [ [ 100, 2 ], [ 200, 4 ] ]
    );

    await database.Close();
});

test("a skill reports its rank and what it unlocks", async () =>
{
    const { database, skills } = await OpenFixture();
    const gamma = await skills.Skill(300);

    assert.equal(gamma.name.text, "Skill Gamma");
    assert.equal(gamma.rank, 1);
    assert.deepEqual(gamma.required, []);

    // Beta and the hull require it; the unpublished hull does not appear.
    assert.deepEqual(
        gamma.unlocks.map(entry => [ entry.typeID, entry.level ]),
        [ [ 200, 5 ], [ 1000, 1 ] ]
    );

    const alpha = await skills.Skill(100);

    assert.equal(alpha.rank, 6);
    assert.equal(alpha.primaryAttribute, 165);
    assert.deepEqual(alpha.required.map(entry => entry.typeID), [ 200 ]);

    await database.Close();
});

test("masteries come back by level, with certificate names", async () =>
{
    const { database, skills } = await OpenFixture();
    const answer = await skills.Requirements(1000);

    assert.deepEqual(answer.masteries.map(entry => entry.level), [ 0, 1 ]);
    assert.deepEqual(
        answer.masteries[1].certificates.map(entry => entry.name.text),
        [ "Small Energy Turret", "Medium Energy Turret" ]
    );

    await database.Close();
});

test("a type needing nothing is not the same as a type that does not exist", async () =>
{
    const { database, skills } = await OpenFixture();
    const none = await skills.Requirements(300);

    assert.deepEqual(none.required, []);
    assert.deepEqual(none.closure, []);
    assert.equal(await skills.Requirements(999999), null);
    assert.equal(await skills.Skill(999999), null);

    await database.Close();
});
