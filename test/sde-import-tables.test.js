import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsToolSde, CjsToolSdeDatabase, CjsToolSdeSource } from "../src/sde/index.js";

test("service bulk views retain only English while stored SDE translations remain available", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-sde-english-"));
    const file = path.join(directory, "sde.sqlite");
    const database = await CjsToolSdeDatabase.create(file);
    context.after(async () =>
    {
        await database.Close();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const record = {
        name: { en: "Rifter", zh: "Chinese name", de: "German name" },
        description: { en: "English description", zh: "Chinese description" },
        displayName: { en: "English display", fr: "French display" },
        quote: { en: "English quote", ja: "Japanese quote" },
        quoteAuthor: { en: "English author", ko: "Korean author" },
        graphicID: 1,
        groupID: 25,
        published: true,
        attributes: { zh: 12, en: 34 },
        nested: [ { name: { en: "Nested English", ru: "Nested Russian" } } ],
    };
    await database.ImportTables({ types: {
        1: record,
        2: { name: { zh: "No English" }, description: null },
        3: { name: "Plain name", description: [ "Unlocalized array" ] },
    }, graphics: { 1: { sofHullName: "rifter", sofFactionName: "minmatarbase", sofRaceName: "minmatar" } } }, { build: 1 });
    const source = new CjsToolSdeSource(database, { target: "eve", build: "1" });
    const loaded = await source.LoadTables([ "types", "missing" ]);
    assert.deepEqual(loaded.types[1], {
        ...record,
        name: { en: "Rifter" },
        description: { en: "English description" },
        displayName: { en: "English display" },
        quote: { en: "English quote" },
        quoteAuthor: { en: "English author" },
        nested: [ { name: { en: "Nested English" } } ],
    });
    assert.deepEqual(loaded.types[2], { name: {}, description: null });
    assert.deepEqual(loaded.types[3], { name: "Plain name", description: [ "Unlocalized array" ] });
    assert.deepEqual(loaded.missing, {});
    assert.equal((await source.Resolve({ typeID: 1 })).dna, "rifter:minmatarbase:minmatar");
    assert.deepEqual((await source.Table("types").Get("1")).payload, record);
    assert.deepEqual((await database.LoadTables([ "types" ])).types[1], record);
});

function CreateDatabasePath()
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-sde-tables-"));

    return path.join(directory, "sde_v1.sqlite");
}

const TABLES = Object.freeze({
    skins: {
        11542: { internalName: "Muninn Aurora Universalis", skinMaterialID: 2572, types: [ 12015 ] },
        11543: { internalName: "Rifter Aurora Universalis", skinMaterialID: 2573, types: [ 587 ] }
    },
    skinMaterials: {
        2572: { skinMaterialID: 2572, materialSetID: 449 }
    }
});

test("imports decoded tables into the same database an archive would write", async () =>
{
    const filePath = CreateDatabasePath();
    const database = await CjsToolSdeDatabase.create(filePath);
    const result = await database.ImportTables(TABLES, { build: 3466057 });

    assert.deepEqual(result.tables.map(table => table.name), [ "skinMaterials", "skins" ]);
    assert.deepEqual(result.tables.map(table => table.rowCount), [ 1, 2 ]);
    assert.equal(result.build, 3466057);

    await database.Close();

    const reopened = await CjsToolSdeDatabase.open(filePath);
    const described = await reopened.Describe();

    assert.equal(described.schema, "carbon.sde.sqlite");
    assert.equal(described.build, 3466057);
    assert.deepEqual(described.tables.map(table => table.name), [ "skinMaterials", "skins" ]);

    const row = await reopened.Table("skins").Get("11542");

    assert.equal(row.payload.skinMaterialID, 2572);

    const loaded = await reopened.LoadTables([ "skins", "skinMaterials" ]);
    const sde = new CjsToolSde(loaded);

    assert.equal(sde.GetSkin(11542).internalName, "Muninn Aurora Universalis");
    assert.deepEqual([ ...sde.GetSkinTypeIDs(11542) ], [ "12015" ]);

    await reopened.Close();
});

test("records the identity a non-official SDE came from", async () =>
{
    const filePath = CreateDatabasePath();
    const database = await CjsToolSdeDatabase.create(filePath);

    await database.ImportTables(TABLES, {
        build: 3466057,
        target: "netease",
        game: "Eve",
        provider: "netease",
        source: { kind: "client-static-data" }
    });
    await database.Close();

    const reopened = await CjsToolSdeDatabase.open(filePath);
    const metadata = await reopened.GetMetadata();

    assert.equal(metadata.target, "netease");
    assert.equal(metadata.provider, "netease");
    assert.equal(metadata.game, "Eve");
    assert.equal(metadata.source.kind, "client-static-data");

    await reopened.Close();
});

test("defaults to the official identity when none is given", async () =>
{
    const filePath = CreateDatabasePath();
    const database = await CjsToolSdeDatabase.create(filePath);
    const result = await database.ImportTables(TABLES, { build: 3466057 });

    assert.equal(result.target, "eve");
    assert.equal(result.provider, "ccp");
    assert.equal(result.game, "Eve");

    await database.Close();
});

test("searchable names come from the same fields as an archive import", async () =>
{
    const filePath = CreateDatabasePath();
    const database = await CjsToolSdeDatabase.create(filePath);

    await database.ImportTables(TABLES, { build: 3466057 });

    const hits = await database.Table("skins").Search("muninn aurora");

    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, "11542");

    await database.Close();
});

test("rejects an empty import, a bad table name, and a non-object record", async () =>
{
    const filePath = CreateDatabasePath();
    const database = await CjsToolSdeDatabase.create(filePath);

    await assert.rejects(() => database.ImportTables({}, { build: 3466057 }));
    await assert.rejects(() => database.ImportTables(null, { build: 3466057 }));
    await assert.rejects(
        () => database.ImportTables({ "bad name": { 1: {} } }, { build: 3466057 })
    );
    await assert.rejects(
        () => database.ImportTables({ skins: { 1: "not a record" } }, { build: 3466057 })
    );

    await database.Close();
});

test("a failed import leaves the previous contents intact", async () =>
{
    const filePath = CreateDatabasePath();
    const database = await CjsToolSdeDatabase.create(filePath);

    await database.ImportTables(TABLES, { build: 3466057 });
    await assert.rejects(
        () => database.ImportTables({ skins: { 1: "not a record" } }, { build: 3466058 })
    );

    const described = await database.Describe();

    assert.equal(described.build, 3466057);
    assert.deepEqual(described.tables.map(table => table.name), [ "skinMaterials", "skins" ]);

    await database.Close();
});
