import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsToolCache } from "../src/cache/index.js";
import {
    CjsToolSdeBuild,
    CjsToolSdeBuildProfile,
    CjsToolSdeBuildProfileRegistry,
    CjsToolSdeTables,
} from "../src/sde/index.js";

function CreateProfile(target, value)
{
    return new CjsToolSdeBuildProfile({
        target,
        game: "Eve",
        provider: "netease",
        sources: [ { table: "types", path: `${target}.fsdbinary`, container: "fsdbinary", required: true } ],
        readers: { types: Object.freeze({ kind: target }) },
        projectors: { types: records => ({ ...records, profileValue: value }) },
    });
}

test("built-in Serenity and Infinity profiles share metadata but not identity", () =>
{
    const profiles = new CjsToolSdeBuildProfileRegistry();
    const serenity = profiles.Get("serenity");
    const infinity = profiles.Get("infinity");

    assert.equal(serenity.provider, "netease");
    assert.equal(infinity.provider, "netease");
    assert.notEqual(serenity, infinity);
    assert.notEqual(serenity.GetSource("types"), infinity.GetSource("types"));
    assert.notEqual(serenity.GetReader("types"), infinity.GetReader("types"));
});

test("target profiles can select different sources, readers, and projections", () =>
{
    const serenity = CreateProfile("serenity", "serenity-output");
    const infinity = CreateProfile("infinity", "infinity-output");

    assert.equal(serenity.GetSource("types").path, "serenity.fsdbinary");
    assert.equal(infinity.GetReader("types").kind, "infinity");
    assert.equal(serenity.Project("types", { 1: {} }).profileValue, "serenity-output");
    assert.equal(infinity.Project("types", { 1: {} }).profileValue, "infinity-output");
});

test("generic builds use target-rooted cache identity and retain provider metadata", async () =>
{
    const cache = new CjsToolCache(fs.mkdtempSync(path.join(os.tmpdir(), "cjs-sde-profile-")));
    const written = [];
    const database = {
        async ImportTables(tables, metadata)
        {
            written.push({ tables, metadata });
            return metadata;
        },
    };
    const paths = [];

    for (const target of [ "serenity", "infinity" ])
    {
        const profile = CreateProfile(target, target);
        const tables = new CjsToolSdeTables(profile, { build: 3466057 });

        tables.AddDecodedTable("types", profile.Project("types", { 1: { _key: 1 } }));

        const build = new CjsToolSdeBuild(tables, { target, client: target });

        paths.push(cache.GetCustomPath(build.CachePathKey()));
        await build.WriteTo(database);
    }

    assert.notEqual(paths[0], paths[1]);
    assert.match(paths[0], /custom[\\/]targets[\\/]serenity[\\/]builds[\\/]3466057/u);
    assert.match(paths[1], /custom[\\/]targets[\\/]infinity[\\/]builds[\\/]3466057/u);
    assert.deepEqual(written.map(call => call.metadata.provider), [ "netease", "netease" ]);
    assert.deepEqual(written.map(call => call.metadata.target), [ "serenity", "infinity" ]);
});

test("the generic core accepts a future EVE profile without a provider branch", async () =>
{
    const profile = new CjsToolSdeBuildProfile({
        target: "eve",
        game: "Eve",
        provider: "ccp",
        sources: [ { table: "types", path: "types.yaml", container: "archive", required: true } ],
        projectors: { types: records => records },
    });
    const tables = new CjsToolSdeTables(profile, { build: "3466501" });
    let metadata;

    tables.AddDecodedTable("types", { 1: { _key: 1 } });

    await new CjsToolSdeBuild(tables).WriteTo({
        async ImportTables(_tables, value)
        {
            metadata = value;
            return value;
        },
    });

    assert.equal(metadata.target, "eve");
    assert.equal(metadata.provider, "ccp");
});

test("profiles can publish registered named derivations through the shared path", async () =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-sde-derivation-"));
    const profile = new CjsToolSdeBuildProfile({
        target: "serenity",
        game: "Eve",
        provider: "netease",
        sources: [ { table: "types", path: "types.fsdbinary", container: "fsdbinary", required: true } ],
        derivations: [ {
            name: "typeExtras",
            Build: ({ marker }) => ({ types: { 1: { quote: { en: marker } } } }),
        } ],
    });
    const tables = new CjsToolSdeTables(profile, { build: 3466057 });
    const database = {
        filePath: path.join(directory, "sde_v1.sqlite"),
        async ImportTables(_tables, metadata)
        {
            return metadata;
        },
    };

    tables.AddDecodedTable("types", { 1: { _key: 1 } });
    await new CjsToolSdeBuild(tables, { context: { marker: "profile output" } })
        .WriteTo(database);

    const artifact = JSON.parse(fs.readFileSync(
        path.join(directory, "typeExtras_v1.json"),
        "utf8",
    ));

    assert.equal(artifact.target, "serenity");
    assert.equal(artifact.types[1].quote.en, "profile output");
});
