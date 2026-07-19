import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    CjsSde,
    CjsSdeArchive,
    CjsSdeDatabase,
    CjsSdeRepository,
    CJS_SDE_PREPARED_TABLES
} from "../src/sde/index.js";
import { CjsToolCache } from "../src/cache/index.js";

test("resolves latest once and prepares exact-build CjsSde tables", async () =>
{
    const archiveBytes = CreatePreparedArchive();
    const requests = [];
    const source = new CjsSdeArchive({
        fetch: async url =>
        {
            requests.push(String(url));

            if (String(url).endsWith("latest.jsonl"))
            {
                return new Response(
                    `${JSON.stringify({
                        _key: "sde",
                        buildNumber: 3435006,
                        releaseDate: "2026-07-15T11:05:50Z"
                    })}\n`
                );
            }

            return new Response(archiveBytes);
        }
    });
    const latest = await source.ResolveLatest();
    const prepared = await source.Prepare(latest);
    const sde = new CjsSde(prepared);

    assert.equal(latest.build, 3435006);
    assert.equal(prepared.schema, "carbon.sde.prepared");
    assert.equal(prepared.version, 1);
    assert.equal(prepared.build, 3435006);
    assert.equal(prepared.releaseDate, "2026-07-15T11:05:50Z");
    assert.deepEqual(Object.keys(prepared.types), [ "587", "588" ]);
    assert.deepEqual(Object.keys(prepared.materialSets), []);
    assert.deepEqual(CJS_SDE_PREPARED_TABLES, [
        "types",
        "graphics",
        "skins",
        "skinMaterials",
        "skinLicenses",
        "materialSets",
        "graphicMaterialSets"
    ]);
    assert.equal(
        sde.ResolveDna({ typeID: 587, skinID: 9001 }),
        "rifter:angel:minmatar:pattern?stripes;red;black"
    );
    assert.deepEqual(requests, [
        "https://developers.eveonline.com/static-data/tranquility/latest.jsonl",
        "https://developers.eveonline.com/static-data/tranquility/"
            + "eve-online-static-data-3435006-jsonl.zip"
    ]);
});

test("requires exact builds and complete identity tables", async () =>
{
    const source = new CjsSdeArchive({
        fetch: async () => new Response(CreateZip({
            "types.jsonl": JsonLines([ { _key: 1 } ])
        }))
    });

    await assert.rejects(() => source.Prepare({ build: "latest" }), /Invalid exact SDE build/);
    await assert.rejects(
        () => source.Prepare({ build: 1 }),
        /missing required tables: graphics, skins, skinMaterials, skinLicenses, graphicMaterialSets/
    );
});

test("stores every archive table behind generic SQLite wrappers", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-sde-database-"));
    const databasePath = path.join(directory, "eve.sqlite");

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));

    const archive = new CjsSdeArchive();
    const database = await archive.WriteDatabase(CreateZip({
        "sde/_sde.jsonl": JsonLines([ { _key: "version", value: 1 } ]),
        "sde/dogmaAttributes.jsonl": JsonLines([
            { _key: 20, name: { en: "Mass multiplier" }, defaultValue: 1 },
        ]),
        "sde/types.jsonl": JsonLines([
            { _key: 10, name: { en: "Rifter" }, groupID: 25, tags: [ "frigate" ] },
            { _key: 2, name: { en: "Tempest" }, groupID: 26 },
        ]),
    }), {
        build: 3435006,
        releaseDate: "2026-07-15T11:05:50Z",
        source: "synthetic://eve-sde",
        databasePath,
    });

    try
    {
        const description = await database.Describe();
        const types = database.Table("types");

        assert.equal(description.schema, "carbon.sde.sqlite");
        assert.equal(description.target, "eve");
        assert.equal(description.build, 3435006);
        assert.deepEqual(description.tables, [
            { name: "_sde", rowCount: 1 },
            { name: "dogmaAttributes", rowCount: 1 },
            { name: "types", rowCount: 2 },
        ]);
        assert.equal(await types.Count(), 2);
        assert.deepEqual((await types.List()).map(row => row.id), [ "2", "10" ]);
        assert.equal((await types.Get(10)).payload.name.en, "Rifter");
        assert.deepEqual((await types.Search("rifter")).map(row => row.id), [ "10" ]);
        assert.deepEqual((await types.Find("groupID", 25)).map(row => row.id), [ "10" ]);
        assert.deepEqual(
            (await types.Find("tags", "frigate", { contains: true })).map(row => row.id),
            [ "10" ],
        );
        await assert.rejects(() => types.Find("not-valid!", 1), /Invalid SDE field path/);
        assert.deepEqual(Object.keys((await database.LoadTables([ "types" ])).types), [
            "2",
            "10",
        ]);

        await assert.rejects(
            () => database.Import(CreateZip({
                "sde/not-a-table.jsonl": JsonLines([ { _key: 1 } ]),
            }), { build: 3435007 }),
            /Invalid SDE table name/,
        );
        assert.equal(await types.Count(), 2);
    }
    finally
    {
        await database.Close();
    }

    const reopened = await CjsSdeDatabase.open(databasePath);

    try
    {
        assert.equal((await reopened.GetMetadata()).build, 3435006);
        assert.equal((await reopened.Table("dogmaAttributes").Get(20)).payload.defaultValue, 1);
    }
    finally
    {
        await reopened.Close();
    }
});

test("publishes a fresh SDE database only after a successful import", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-sde-atomic-"));
    const databasePath = path.join(directory, "eve.sqlite");
    const archive = new CjsSdeArchive();

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));

    await assert.rejects(
        () => archive.WriteDatabase(Buffer.from("not-a-zip"), {
            build: 3435006,
            databasePath,
        }),
        /invalid signature/u,
    );
    await assert.rejects(() => fs.promises.access(databasePath), { code: "ENOENT" });

    fs.writeFileSync(databasePath, "poisoned");

    const database = await archive.WriteDatabase(CreateZip({
        "sde/types.jsonl": JsonLines([ { _key: 587, name: { en: "Rifter" } } ]),
    }), {
        build: 3435006,
        source: "synthetic://eve-sde",
        databasePath,
    });

    try
    {
        assert.equal((await database.GetMetadata()).build, 3435006);
        assert.equal((await database.Table("types").Get(587)).payload.name.en, "Rifter");
    }
    finally
    {
        await database.Close();
    }
});

test("auto-prepares over an invalid cached SDE database", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-sde-recovery-"));
    const cache = new CjsToolCache(directory);
    const databasePath = cache.GetCustomPath({
        game: "Eve",
        provider: "ccp",
        build: 3435006,
        name: "sde",
        version: "v1",
        extension: "sqlite",
    });
    let preparations = 0;

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.writeFileSync(databasePath, "poisoned");

    const repository = new CjsSdeRepository({
        cache,
        autoPrepare: true,
        archive: {
            async PrepareDatabase(options)
            {
                preparations += 1;

                return new CjsSdeArchive().WriteDatabase(CreateZip({
                    "sde/types.jsonl": JsonLines([
                        { _key: 587, name: { en: "Rifter" } },
                    ]),
                }), {
                    ...options,
                    source: "synthetic://eve-sde",
                });
            },
        },
    });

    try
    {
        const source = await repository.OpenTarget("eve", "3435006");

        assert.equal(preparations, 1);
        assert.equal((await source.Table("types").Get(587)).payload.name.en, "Rifter");
    }
    finally
    {
        await repository.Close();
    }
});

test("resolves EVE SDE latest independently and rejects unsupported targets", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-sde-repository-"));
    const cache = new CjsToolCache(directory);
    const databasePath = cache.GetCustomPath({
        game: "Eve",
        provider: "ccp",
        build: 3435006,
        name: "sde",
        version: "v1",
        extension: "sqlite",
    });
    const writer = await new CjsSdeArchive().WriteDatabase(CreateZip({
        "sde/types.jsonl": JsonLines([ { _key: 587, name: { en: "Rifter" } } ]),
    }), {
        build: 3435006,
        source: "synthetic://eve-sde",
        databasePath,
    });

    await writer.Close();
    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));

    let latestRequests = 0;
    const repository = new CjsSdeRepository({
        cache,
        archive: {
            async ResolveLatest()
            {
                latestRequests += 1;
                return {
                    build: 3435006,
                    releaseDate: "2026-07-15T11:05:50Z",
                    source: "synthetic://latest",
                };
            },
        },
    });

    try
    {
        const source = await repository.OpenTarget("eve", "latest");

        assert.equal(source.build, "3435006");
        assert.equal((await source.Table("types").Get(587)).payload.name.en, "Rifter");
        assert.deepEqual(await source.LookupName("Rifter"), [ {
            kind: "type",
            typeID: "587",
            skinID: null,
        } ]);
        assert.equal(latestRequests, 1);
        await assert.rejects(
            () => repository.OpenTarget("frontier", "latest"),
            /not available for target frontier/,
        );
    }
    finally
    {
        await repository.Close();
    }
});

test("SDE preparation CLI documents its exact-build cache artifact", () =>
{
    const result = spawnSync(process.execPath, [ "bin/cjs-sde-prepare.js", "--help" ], {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /cjs-sde-prepare/);
    assert.match(result.stdout, /exact numeric build/);
    assert.match(
        result.stdout,
        /custom\/games\/eve\/providers\/ccp\/builds\/<build>\/sde_<version>\.sqlite/,
    );
});

test("SDE preparation CLI writes every table to a loadable exact-build database", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-sde-prepare-"));

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));

    const source = `data:application/zip;base64,${CreatePreparedArchive().toString("base64")}`;
    const result = spawnSync(process.execPath, [
        "bin/cjs-sde-prepare.js",
        "--build",
        "3435006",
        "--cache",
        directory,
        "--source",
        source
    ], {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);

    const summary = JSON.parse(result.stdout);
    const database = await CjsSdeDatabase.open(summary.outputPath);
    let prepared;

    try
    {
        prepared = await database.LoadTables(CJS_SDE_PREPARED_TABLES);
    }
    finally
    {
        await database.Close();
    }

    assert.equal(summary.build, 3435006);
    assert.equal(summary.tables.types, 2);
    assert.equal(summary.tables.ignored, 1);
    assert.equal(summary.schema, "carbon.sde.sqlite");
    assert.equal(new CjsSde(prepared).ResolveTypeDna(587), "rifter:minmatar:minmatar");
});

function JsonLines(records)
{
    return `${records.map(record => JSON.stringify(record)).join("\n")}\n`;
}

function CreatePreparedArchive()
{
    return CreateZip({
        "sde/types.jsonl": JsonLines([
            { _key: 588, name: { en: "Rifter Alias" }, graphicID: 42 },
            { _key: 587, name: { en: "Rifter" }, graphicID: 42 }
        ]),
        "sde/graphics.jsonl": JsonLines([
            {
                _key: 42,
                sofHullName: "rifter",
                sofFactionName: "minmatar",
                sofRaceName: "minmatar"
            }
        ]),
        "sde/skins.jsonl": JsonLines([
            { _key: 9001, internalName: "Test Skin", skinMaterialID: 7001 }
        ]),
        "sde/skinMaterials.jsonl": JsonLines([
            { _key: 7001, materialSetID: 5001 }
        ]),
        "sde/skinLicenses.jsonl": JsonLines([
            { _key: 8001, skinID: 9001, typeID: 587 }
        ]),
        "sde/graphicMaterialSets.jsonl": JsonLines([
            {
                _key: 5001,
                sofFactionName: "angel",
                sofPatternName: "stripes",
                custommaterial1: "red",
                custommaterial2: "black"
            }
        ]),
        "sde/ignored.jsonl": JsonLines([ { _key: 1 } ])
    });
}

function CreateZip(entries)
{
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const [ name, content ] of Object.entries(entries))
    {
        const nameBytes = Buffer.from(name, "utf8");
        const bytes = Buffer.from(content, "utf8");
        const checksum = Crc32(bytes);
        const local = Buffer.alloc(30);

        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(bytes.length, 18);
        local.writeUInt32LE(bytes.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        localParts.push(local, nameBytes, bytes);

        const central = Buffer.alloc(46);

        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(bytes.length, 20);
        central.writeUInt32LE(bytes.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, nameBytes);
        offset += local.length + nameBytes.length + bytes.length;
    }

    const central = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    const count = Object.keys(entries).length;

    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(count, 8);
    end.writeUInt16LE(count, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([ ...localParts, central, end ]);
}

function Crc32(bytes)
{
    let value = 0xffffffff;

    for (const byte of bytes)
    {
        value ^= byte;

        for (let bit = 0; bit < 8; bit++)
        {
            value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
        }
    }

    const result = (value ^ 0xffffffff) >>> 0;

    return result;
}
