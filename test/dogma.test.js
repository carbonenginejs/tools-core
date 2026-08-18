import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsSdeDatabase } from "../src/sde/index.js";
import { CjsToolDogma, ReadName } from "../src/dogma/CjsToolDogma.js";
import { CjsToolDogmaProfile } from "../src/dogma/CjsToolDogmaProfile.js";
import { ApplyModifiers, DogmaOperation } from "../src/dogma/CjsToolDogmaOperations.js";

function CreateDatabasePath()
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-dogma-"));

    return path.join(directory, "sde_v1.sqlite");
}

/**
 * The CPU and power-grid chains, reproduced exactly as the live SDE shapes
 * them, on a hull that does not exist.
 *
 * Real attribute and effect IDs, invented types. The IDs have to be real
 * because the whole mechanism is IDs referring to each other; the hull does not,
 * and a fixture Viator would invite a reader to check its numbers against the
 * real SDE and call the test wrong when it is only different.
 */
const TABLES = Object.freeze({
    types: {
        1000: { _key: 1000, name: { en: "Test Hull" }, groupID: 25, published: true },
        3426: { _key: 3426, name: { en: "CPU Management" }, groupID: 273, published: true },
        3413: { _key: 3413, name: { en: "Power Grid Management" }, groupID: 273, published: true },
        3300: { _key: 3300, name: { zh: "只有中文" }, groupID: 273, published: true }
    },
    dogmaAttributes: {
        11: { _key: 11, name: "powerOutput", defaultValue: 0, highIsGood: true, unitID: 132 },
        12: { _key: 12, name: "lowSlots", defaultValue: 0, highIsGood: true },
        13: { _key: 13, name: "medSlots", defaultValue: 0, highIsGood: true },
        14: { _key: 14, name: "hiSlots", defaultValue: 0, highIsGood: true },
        48: { _key: 48, name: "cpuOutput", defaultValue: 0, highIsGood: true, unitID: 101 },
        101: { _key: 101, name: "launcherSlotsLeft", defaultValue: 0, highIsGood: true },
        102: { _key: 102, name: "turretSlotsLeft", defaultValue: 0, highIsGood: true },
        280: { _key: 280, name: "skillLevel", defaultValue: 0, highIsGood: true },
        283: { _key: 283, name: "droneCapacity", defaultValue: 0, highIsGood: true },
        313: { _key: 313, name: "powerEngineeringOutputBonus", defaultValue: 0, highIsGood: true },
        424: { _key: 424, name: "cpuOutputBonus2", defaultValue: 0, highIsGood: true },
        1132: { _key: 1132, name: "upgradeCapacity", defaultValue: 0, highIsGood: true },
        1137: { _key: 1137, name: "rigSlots", defaultValue: 0, highIsGood: true },
        1271: { _key: 1271, name: "droneBandwidth", defaultValue: 0, highIsGood: true }
    },
    dogmaEffects: {
        // The shared skill effect. Its modifiers reference attributes a skill
        // does not carry, and one uses an operation this evaluator does not
        // implement - both must be ignored without disturbing the level.
        132: {
            _key: 132, name: "skillEffect",
            modifierInfo: [
                { domain: "itemID", func: "ItemModifier", modifiedAttributeID: 280, modifyingAttributeID: 276, operation: 2 },
                { domain: "itemID", func: "ItemModifier", modifiedAttributeID: 280, modifyingAttributeID: 275, operation: 9 }
            ]
        },
        368: {
            _key: 368, name: "gallenteFrigateSkillBoostCpuOutputBonus",
            modifierInfo: [
                { domain: "itemID", func: "ItemModifier", modifiedAttributeID: 424, modifyingAttributeID: 280, operation: 0 }
            ]
        },
        397: {
            _key: 397, name: "electronicsCpuOutputBonusPostPercentCpuOutputLocationShipGroupComputer",
            modifierInfo: [
                { domain: "shipID", func: "ItemModifier", modifiedAttributeID: 48, modifyingAttributeID: 424, operation: 6 }
            ]
        },
        218: {
            _key: 218, name: "engineeringSkillBoostPowerOutputBonus",
            modifierInfo: [
                { domain: "itemID", func: "ItemModifier", modifiedAttributeID: 313, modifyingAttributeID: 280, operation: 0 }
            ]
        },
        490: {
            _key: 490, name: "engineeringPowerEngineeringOutputBonusPostPercentPowerOutputLocationShipGroupPowerCore",
            modifierInfo: [
                { domain: "shipID", func: "ItemModifier", modifiedAttributeID: 11, modifyingAttributeID: 313, operation: 6 }
            ]
        },
        // A location modifier aimed at a requested attribute: real, and out of
        // scope for a bare hull. It must be reported, never silently dropped.
        900: {
            _key: 900, name: "someModuleBonusRequiringSkill",
            modifierInfo: [
                { domain: "shipID", func: "LocationRequiredSkillModifier", modifiedAttributeID: 48, modifyingAttributeID: 424, operation: 6, skillTypeID: 3426 }
            ]
        },
        // An opcode outside the published table, aimed at a requested attribute.
        901: {
            _key: 901, name: "unknownOperationEffect",
            modifierInfo: [
                { domain: "shipID", func: "ItemModifier", modifiedAttributeID: 11, modifyingAttributeID: 313, operation: 77 }
            ]
        }
    },
    typeDogma: {
        1000: {
            _key: 1000,
            dogmaAttributes: [
                { attributeID: 48, value: 250 },
                { attributeID: 11, value: 135 },
                { attributeID: 1132, value: 400 },
                { attributeID: 14, value: 2 },
                { attributeID: 13, value: 3 },
                { attributeID: 12, value: 3 },
                { attributeID: 1137, value: 2 },
                { attributeID: 102, value: 1 },
                { attributeID: 101, value: 0 },
                { attributeID: 283, value: 0 },
                { attributeID: 1271, value: 0 }
            ],
            dogmaEffects: []
        },
        3426: {
            _key: 3426,
            dogmaAttributes: [ { attributeID: 280, value: 0 }, { attributeID: 424, value: 5 } ],
            dogmaEffects: [ { effectID: 132, isDefault: false }, { effectID: 368, isDefault: false }, { effectID: 397, isDefault: false } ]
        },
        3413: {
            _key: 3413,
            dogmaAttributes: [ { attributeID: 280, value: 0 }, { attributeID: 313, value: 5 } ],
            dogmaEffects: [ { effectID: 132, isDefault: false }, { effectID: 218, isDefault: false }, { effectID: 490, isDefault: false } ]
        },
        3300: {
            _key: 3300,
            dogmaAttributes: [ { attributeID: 280, value: 0 }, { attributeID: 424, value: 5 } ],
            dogmaEffects: [ { effectID: 900, isDefault: false }, { effectID: 901, isDefault: false }, { effectID: 368, isDefault: false } ]
        }
    }
});

async function OpenFixture()
{
    const filePath = CreateDatabasePath();
    const database = await CjsSdeDatabase.create(filePath);

    await database.ImportTables(TABLES, { build: 3466501 });

    return {
        database,
        source: {
            target: "eve",
            game: "Eve",
            provider: "ccp",
            build: "3466501",
            Table: name => database.Table(name),
            LoadTables: names => database.LoadTables(names),
            DatabaseFile: () => filePath
        }
    };
}

const ALL_FIVE = Object.freeze({
    mode: "manual",
    skills: [ { typeID: 3426, level: 5 }, { typeID: 3413, level: 5 } ]
});

test("no skills returns the published values unchanged", async () =>
{
    const { database, source } = await OpenFixture();
    const dogma = new CjsToolDogma(source);
    const result = await dogma.Evaluate(1000, { mode: "none" });

    assert.equal(result.base.cpuOutput, 250);
    assert.equal(result.base.powerOutput, 135);
    assert.deepEqual(result.effective, result.base);
    assert.equal(result.applied.length, 0);
    assert.equal(result.profile.mode, "none");
    assert.equal(result.profile.skillHash, "none");

    await database.Close();
});

test("level V fitting skills reproduce the client's numbers", async () =>
{
    const { database, source } = await OpenFixture();
    const dogma = new CjsToolDogma(source);
    const result = await dogma.Evaluate(1000, ALL_FIVE);

    // 250 x (1 + 5 x 5 / 100) and 135 x 1.25 - the two numbers the Fitting
    // panel shows for a Viator with both skills at V.
    assert.equal(result.effective.cpuOutput, 312.5);
    assert.equal(result.effective.powerOutput, 168.75);

    // Base is untouched, so a consumer can show both halves.
    assert.equal(result.base.cpuOutput, 250);
    assert.equal(result.base.powerOutput, 135);

    // Slots take no skill bonus and must not drift.
    assert.equal(result.effective.hiSlots, 2);
    assert.equal(result.effective.rigSlots, 2);

    const cpu = result.applied.find(entry => entry.attribute === "cpuOutput");

    assert.equal(cpu.operation, "postPercent");
    assert.equal(cpu.amount, 25);
    assert.equal(cpu.sourceTypeID, 3426);
    assert.equal(cpu.sourceLevel, 5);
    assert.equal(cpu.from, 250);
    assert.equal(cpu.to, 312.5);

    await database.Close();
});

test("each level adds exactly one step of the published per-level bonus", async () =>
{
    const { database, source } = await OpenFixture();
    const dogma = new CjsToolDogma(source);

    for (const level of [ 0, 1, 2, 3, 4, 5 ])
    {
        const result = await dogma.Evaluate(1000, {
            mode: "manual",
            skills: [ { typeID: 3426, level } ]
        });

        assert.equal(result.effective.cpuOutput, 250 * (1 + (0.05 * level)), `level ${level}`);
    }

    await database.Close();
});

test("manual and automatic profiles compute identically and stay distinguishable", async () =>
{
    const { database, source } = await OpenFixture();
    const dogma = new CjsToolDogma(source);

    const manual = await dogma.Evaluate(1000, { ...ALL_FIVE, mode: "manual" });
    const automatic = await dogma.Evaluate(1000, { ...ALL_FIVE, mode: "automatic" });

    assert.deepEqual(automatic.effective, manual.effective);
    assert.equal(automatic.profile.skillHash, manual.profile.skillHash);
    assert.notEqual(automatic.profile.mode, manual.profile.mode);

    await database.Close();
});

test("an effect that cannot apply to a bare hull is reported, not dropped", async () =>
{
    const { database, source } = await OpenFixture();
    const dogma = new CjsToolDogma(source);
    const result = await dogma.Evaluate(1000, {
        mode: "manual",
        skills: [ { typeID: 3300, level: 5 } ]
    });

    const reasons = result.unsupportedEffects.map(entry => entry.reason).sort();

    assert.deepEqual(reasons, [ "requires-fitted-items", "unknown-operation" ]);
    assert.equal(result.effective.cpuOutput, 250);
    assert.equal(result.effective.powerOutput, 135);

    const located = result.unsupportedEffects.find(entry => entry.reason === "requires-fitted-items");

    assert.equal(located.effectID, 900);
    assert.equal(located.attribute, "cpuOutput");
    assert.equal(located.sourceTypeID, 3300);

    await database.Close();
});

test("the shared skill effect cannot corrupt the supplied level", async () =>
{
    const { database, source } = await OpenFixture();
    const dogma = new CjsToolDogma(source);

    // Effect 132 adds attribute 276 onto skillLevel and applies an unimplemented
    // opcode to it. Neither may move the level, so the bonus stays 5 x level.
    const result = await dogma.Evaluate(1000, {
        mode: "manual",
        skills: [ { typeID: 3426, level: 3 } ]
    });

    assert.equal(result.effective.cpuOutput, 250 * 1.15);

    await database.Close();
});

test("a missing type is distinguishable from a hull with no statistics", async () =>
{
    const { database, source } = await OpenFixture();
    const dogma = new CjsToolDogma(source);

    assert.equal(await dogma.Evaluate(999999, { mode: "none" }), null);

    await database.Close();
});

test("profiles reject what would otherwise become a plausible wrong number", () =>
{
    assert.throws(() => CjsToolDogmaProfile.normalize({ mode: "guess" }), /mode must be one of/);
    assert.throws(
        () => CjsToolDogmaProfile.normalize({ mode: "manual", skills: [ { typeID: 3426, level: 7 } ] }),
        /level must be an integer/
    );
    assert.throws(
        () => CjsToolDogmaProfile.normalize({ mode: "manual", skills: [ { typeID: 3426, level: 5 }, { typeID: 3426, level: 4 } ] }),
        /repeats skill typeID/
    );
    assert.throws(
        () => CjsToolDogmaProfile.normalize({ mode: "manual", skills: [ { typeID: "abc", level: 1 } ] }),
        /typeID is not a positive integer/
    );
    assert.throws(
        () => CjsToolDogmaProfile.normalize({ mode: "none", skills: [ { typeID: 3426, level: 5 } ] }),
        /mode none must not supply skills/
    );
});

test("the skill hash is order independent and ignores untrained skills", () =>
{
    const one = CjsToolDogmaProfile.normalize({
        mode: "manual",
        skills: [ { typeID: 3413, level: 5 }, { typeID: 3426, level: 4 } ]
    });
    const two = CjsToolDogmaProfile.normalize({
        mode: "automatic",
        skills: [ { typeID: 3426, level: 4 }, { typeID: 3413, level: 5 }, { typeID: 9999, level: 0 } ]
    });

    assert.equal(one.skillHash, two.skillHash);
    assert.notEqual(one.skillHash, "none");
});

test("an unknown section is refused rather than quietly evaluating nothing", async () =>
{
    const { database, source } = await OpenFixture();
    const dogma = new CjsToolDogma(source);

    await assert.rejects(
        () => dogma.Evaluate(1000, { mode: "none" }, { sections: [ "warpSpeed" ] }),
        /Unknown dogma section/
    );

    await database.Close();
});

test("operations apply in published order, not in the order they arrive", () =>
{
    // modAdd before postPercent: (100 + 10) x 1.5, not 100 x 1.5 + 10.
    const result = ApplyModifiers(100, [
        { attributeID: 1, amount: 50, operation: 6, effectID: 2, sourceTypeID: 2 },
        { attributeID: 1, amount: 10, operation: 2, effectID: 1, sourceTypeID: 1 }
    ]);

    assert.equal(result.value, 165);
    assert.deepEqual(result.applied.map(entry => entry.operation), [ "modAdd", "postPercent" ]);
});

test("an unknown opcode has no operation rather than a guessed one", () =>
{
    assert.equal(DogmaOperation(6).name, "postPercent");
    assert.equal(DogmaOperation(0).name, "preMultiply");
    assert.equal(DogmaOperation(77), null);
    assert.equal(DogmaOperation(9), null);
});

test("names never assume English, because two targets do not have it", async () =>
{
    const { database, source } = await OpenFixture();
    const dogma = new CjsToolDogma(source);
    const chinese = await dogma.Evaluate(3300, { mode: "none" });

    assert.equal(chinese.name.text, "只有中文");
    assert.equal(chinese.name.language, "zh");

    assert.equal(ReadName({ en: "A", de: "B" }, "de").text, "B");
    assert.equal(ReadName({ en: "A", de: "B" }).language, "en");
    assert.equal(ReadName({ en: "A" }, "ru").language, "en");
    assert.equal(ReadName("plain").text, "plain");
    assert.equal(ReadName(null), null);

    await database.Close();
});
