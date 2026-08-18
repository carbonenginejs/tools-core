import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsSdeDatabase } from "../src/sde/index.js";
import { CjsToolIndustry } from "../src/industry/CjsToolIndustry.js";

function CreateDatabasePath()
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-industry-"));

    return path.join(directory, "sde_v1.sqlite");
}

/**
 * One buildable hull, one hull nobody can build, and one type with no material
 * composition at all.
 *
 * The manufacturing inputs and the reprocessing outputs are deliberately
 * different lists with a different item count, because the defect this service
 * exists to prevent is showing one in place of the other - and a fixture where
 * they matched would pass either way.
 */
const TABLES = Object.freeze({
    types: {
        1000: { _key: 1000, name: { en: "Test Hull" }, groupID: 25 },
        1001: { _key: 1001, name: { en: "Test Hull Blueprint" }, groupID: 105 },
        2000: { _key: 2000, name: { en: "Tritanium" }, groupID: 18 },
        2001: { _key: 2001, name: { en: "Pyerite" }, groupID: 18 },
        2002: { _key: 2002, name: { en: "Construction Blocks" }, groupID: 334 },
        3380: { _key: 3380, name: { en: "Industry" }, groupID: 268 },
        4000: { _key: 4000, name: { zh: "无蓝图" }, groupID: 25 },
        5000: { _key: 5000, name: { en: "Nothing Inside" }, groupID: 25 }
    },
    blueprints: {
        1001: {
            _key: 1001,
            blueprintTypeID: 1001,
            maxProductionLimit: 10,
            activities: {
                copying: { time: 480 },
                manufacturing: {
                    time: 6000,
                    materials: [ { typeID: 2000, quantity: 100 }, { typeID: 2001, quantity: 50 } ],
                    products: [ { typeID: 1000, quantity: 1 } ],
                    skills: [ { typeID: 3380, level: 1 } ]
                },
                research_material: { time: 210 }
            }
        }
    },
    typeMaterials: {
        1000: {
            _key: 1000,
            materials: [
                { materialTypeID: 2000, quantity: 90 },
                { materialTypeID: 2001, quantity: 45 },
                { materialTypeID: 2002, quantity: 3 }
            ]
        },
        4000: { _key: 4000, materials: [ { materialTypeID: 2000, quantity: 7 } ] }
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

test("a product resolves to the blueprint that makes it", async () =>
{
    const { database, source } = await OpenFixture();
    const industry = new CjsToolIndustry(source);
    const result = await industry.Type(1000);

    assert.equal(result.type.typeID, 1000);
    assert.equal(result.type.name.text, "Test Hull");
    assert.equal(result.blueprint.typeID, 1001);
    assert.equal(result.blueprint.name.text, "Test Hull Blueprint");
    assert.equal(result.blueprint.maxProductionLimit, 10);
    assert.equal(result.blueprint.manufacturing.time, 6000);
    assert.equal(result.build, "3466501");

    // Other activities are named without being described.
    assert.deepEqual(result.blueprint.activities, [ "copying", "manufacturing", "research_material" ]);

    await database.Close();
});

test("manufacturing inputs and reprocessed materials never merge", async () =>
{
    const { database, source } = await OpenFixture();
    const industry = new CjsToolIndustry(source);
    const result = await industry.Type(1000);

    assert.deepEqual(
        result.blueprint.manufacturing.materials.map(item => [ item.typeID, item.quantity ]),
        [ [ 2000, 100 ], [ 2001, 50 ] ]
    );
    assert.deepEqual(
        result.reprocessedMaterials.map(item => [ item.typeID, item.quantity ]),
        [ [ 2000, 90 ], [ 2001, 45 ], [ 2002, 3 ] ]
    );

    // The lists differ in length and in quantity: one is what it costs to
    // build, the other what it yields when reprocessed.
    assert.notEqual(result.blueprint.manufacturing.materials.length, result.reprocessedMaterials.length);

    await database.Close();
});

test("materials and skills are named through both key spellings the SDE uses", async () =>
{
    const { database, source } = await OpenFixture();
    const industry = new CjsToolIndustry(source);
    const result = await industry.Type(1000);

    // `typeID` in a blueprint recipe, `materialTypeID` in typeMaterials.
    assert.equal(result.blueprint.manufacturing.materials[0].name.text, "Tritanium");
    assert.equal(result.reprocessedMaterials[2].name.text, "Construction Blocks");
    assert.deepEqual(
        result.blueprint.manufacturing.skills.map(skill => [ skill.name.text, skill.level ]),
        [ [ "Industry", 1 ] ]
    );
    assert.deepEqual(
        result.blueprint.manufacturing.products.map(item => [ item.typeID, item.quantity ]),
        [ [ 1000, 1 ] ]
    );

    await database.Close();
});

test("a type nobody can build says so instead of inventing a blueprint", async () =>
{
    const { database, source } = await OpenFixture();
    const industry = new CjsToolIndustry(source);
    const result = await industry.Type(4000);

    assert.equal(result.blueprint, null);
    assert.deepEqual(result.unsupportedSections, [
        { section: "blueprint", reason: "no-blueprint-produces-this-type" }
    ]);

    // Still a real answer: it reprocesses even though it cannot be built.
    assert.equal(result.reprocessedMaterials.length, 1);
    assert.equal(result.type.name.text, "无蓝图");

    await database.Close();
});

test("a missing material composition is explicit, not an empty list", async () =>
{
    const { database, source } = await OpenFixture();
    const industry = new CjsToolIndustry(source);
    const result = await industry.Type(5000);

    assert.deepEqual(result.reprocessedMaterials, []);
    assert.ok(result.unsupportedSections.some(
        entry => entry.section === "reprocessedMaterials" && entry.reason === "type-has-no-material-composition"
    ));

    await database.Close();
});

test("an unknown type is null, so the route can answer 404", async () =>
{
    const { database, source } = await OpenFixture();
    const industry = new CjsToolIndustry(source);

    assert.equal(await industry.Type(999999), null);

    await database.Close();
});
