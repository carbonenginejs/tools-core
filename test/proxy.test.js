import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CjsCharacterLibrary } from "@carbonenginejs/runtime-character";
import {
    CjsIndexOverlayStore,
    CjsIndexProviderRegistry,
    CjsToolHttpProxy,
    CjsToolIndex,
    CjsToolTargetRegistry,
} from "../src/index.js";
import { CjsToolCharacter } from "../src/character/index.js";
import { CreateCharacterDocuments } from "./character-library-fixture.js";

const FixtureDirectory = path.dirname(fileURLToPath(import.meta.url));

test("serves health without the removed legacy SOF routes", async context =>
{
    const proxy = new CjsToolHttpProxy({
        indexes: {
            Open()
            {}
        }
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const address = server.address();
    const root = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${root}/v1/health`);

    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await health.json(), {
        ok: true,
        service: "@carbonenginejs/tools-core",
        protocol: "carbon.tools",
        protocolVersion: 1,
        capabilities: {
            resources: true,
            audio: false,
            character: false,
            sde: false,
            skin: false,
            skinr: false,
            weapons: false,
            sofCatalog: false,
        },
    });

    for (const route of [ "/v1/sof/values", "/v1/sof/document" ])
    {
        const response = await fetch(`${root}${route}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ dna: "rifter:minmatar:minmatar" })
        });

        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "Not found" });
    }
});

test("serves exact-build GPU-free SOF catalogs and DNA documents", async context =>
{
    let openTargetCount = 0;
    let openSofCount = 0;
    let valuesCount = 0;
    const builtDna = [];
    const source = {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        buildRef: "latest",
        build: "3435006",
        client: "tranquility",
        Match()
        {
            return [];
        },
        async Fetch()
        {
            throw new Error("Injected SOF catalog should not fetch directly");
        },
    };
    const catalog = {
        ...source,
        ListHulls: () => [ "ab1_t1", "zz1_t1" ],
        ListFactions: () => [ "amarrbase" ],
        ListRaces: () => [ "amarr" ],
        ListMaterials: () => [ "gold" ],
        ListLayouts: () => [ "antennae" ],
        ListPatterns: () => [ "alpha", "stripes" ],
        ListHullPatterns: hull => hull === "ab1_t1"
            ? [ "alpha", "stripes" ]
            : hull === "zz1_t1" ? [] : null,
        GetHull: name => name === "ab1_t1" ? { name: "ab1_t1" } : null,
        GetFaction: name => name === "amarrbase" ? { name: "amarrbase" } : null,
        GetRace: name => name === "amarr" ? { name: "amarr" } : null,
        GetMaterial: name => name === "gold"
            ? { name: "gold", parameters: { PaintColor: [1, 2, 3, 4] } }
            : null,
        GetLayout: name => name === "antennae" ? { name: "antennae" } : null,
        GetPatternHull(pattern, hull)
        {
            return pattern === "stripes" && hull === "ab1_t1"
                ? { layerAndProjection: [{ layer: { textureName: "PatternTex" } }] }
                : null;
        },
        InspectDna(dna)
        {
            if (dna.startsWith("missing:"))
            {
                return { buildable: false, valid: false, error: "unknown-hull" };
            }
            if (!dna.includes(":"))
            {
                return { buildable: false, valid: false, error: "not-enough-parts" };
            }
            return { buildable: true, valid: true, error: null };
        },
        GetDnaVisibilityGroups(dna)
        {
            if (dna.includes(":unbuildable")) return null;

            return {
                dna,
                declared: [ "primary" ],
                authored: [ "police", "primary" ],
                visible: [ "primary" ],
                hidden: [ "police" ],
                sets: [],
            };
        },
        async BuildDocumentAsync(dna)
        {
            builtDna.push(dna);
            if (dna.includes(":unbuildable")) return null;

            return { schema: "carbon.document", dna };
        },
        BuildValues()
        {
            valuesCount++;
            throw new Error("SOF values hydration was not expected");
        },
    };
    const proxy = new CjsToolHttpProxy({
        indexes: {
            Open() {},
            async ResolveTargetBuild(target, build)
            {
                assert.equal(target, "eve");
                assert.ok([ "latest", "3435006" ].includes(build));

                return {
                    target,
                    game: "Eve",
                    provider: "ccp",
                    buildRef: build,
                    build: "3435006",
                    client: "tranquility",
                    source: build === "latest" ? "latest-remote-metadata" : "exact",
                };
            },
            async OpenTarget(target, build, options)
            {
                assert.equal(target, "eve");
                assert.equal(build, "3435006");
                assert.deepEqual(options, { client: "tranquility" });
                openTargetCount++;

                return source;
            },
        },
        sof: {
            async OpenSource(received)
            {
                assert.equal(received, source);
                openSofCount++;

                return catalog;
            },
        },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const root = `http://127.0.0.1:${server.address().port}/eve/latest/sof`;
    const collections = {
        hulls: [ "ab1_t1", "zz1_t1" ],
        factions: [ "amarrbase" ],
        races: [ "amarr" ],
        materials: [ "gold" ],
        layouts: [ "antennae" ],
        patterns: [ "alpha", "stripes" ],
    };

    for (const [name, expected] of Object.entries(collections))
    {
        const response = await fetch(`${root}/${name}`);

        assert.equal(response.status, 200, name);
        assert.deepEqual(await response.json(), expected, name);
        assert.equal(response.headers.get("x-carbon-target"), "eve");
        assert.equal(response.headers.get("x-carbon-build"), "3435006");
    }

    assert.deepEqual(await (await fetch(`${root}/hulls/AB1_T1`)).json(), {
        name: "ab1_t1",
    });
    assert.deepEqual(await (await fetch(`${root}/factions/AMARRBASE`)).json(), {
        name: "amarrbase",
    });
    assert.deepEqual(await (await fetch(`${root}/races/AMARR`)).json(), {
        name: "amarr",
    });
    assert.deepEqual(await (await fetch(`${root}/materials/GOLD`)).json(), {
        name: "gold",
        parameters: { PaintColor: [1, 2, 3, 4] },
    });
    assert.deepEqual(await (await fetch(`${root}/layouts/ANTENNAE`)).json(), {
        name: "antennae",
    });
    assert.deepEqual(await (await fetch(
        `${root}/patterns/STRIPES/hulls/AB1_T1`,
    )).json(), {
        layerAndProjection: [{ layer: { textureName: "PatternTex" } }],
    });
    const hullPatterns = await fetch(`${root}/hulls/AB1_T1/patterns/`);
    assert.equal(hullPatterns.status, 200);
    assert.deepEqual(await hullPatterns.json(), [ "alpha", "stripes" ]);
    assert.equal(hullPatterns.headers.get("x-carbon-sof-hull"), "ab1_t1");
    assert.deepEqual(
        await (await fetch(`${root}/hulls/zz1_t1/patterns`)).json(),
        [],
    );

    const literalDna = "ab1_t1:amarrbase:amarr:pattern?stripes;none;none";
    const encodedDna = literalDna.replace("?", "%3F");
    const literal = await fetch(`${root}/dna/${literalDna}`);
    const encoded = await fetch(`${root}/dna/${encodedDna}`);

    assert.equal(literal.status, 200);
    assert.equal(encoded.status, 200);
    assert.equal((await literal.json()).schema, "carbon.document");
    assert.equal((await encoded.json()).schema, "carbon.document");
    assert.deepEqual(builtDna, [ literalDna, literalDna ]);
    assert.equal(valuesCount, 0);

    assert.equal((await fetch(`${root}/hulls/missing`)).status, 404);
    assert.equal((await fetch(`${root}/hulls/missing/patterns`)).status, 404);
    assert.equal((await fetch(
        `${root}/patterns/missing/hulls/ab1_t1`,
    )).status, 404);
    assert.equal((await fetch(
        `${root}/patterns/stripes/hulls/missing`,
    )).status, 404);
    assert.equal((await fetch(
        `${root}/dna/missing:amarrbase:amarr`,
    )).status, 404);
    assert.equal((await fetch(
        `${root}/dna/ab1_t1:amarrbase:unbuildable`,
    )).status, 404);
    const visibility = await fetch(`${root}/dna/ab1_t1:amarrbase:amarr/visibilityGroups`);

    assert.equal(visibility.status, 200);
    assert.deepEqual(await visibility.json(), {
        dna: "ab1_t1:amarrbase:amarr",
        declared: [ "primary" ],
        authored: [ "police", "primary" ],
        visible: [ "primary" ],
        hidden: [ "police" ],
        sets: [],
    });
    assert.equal(visibility.headers.get("x-carbon-build"), "3435006");
    assert.equal((await fetch(
        `${root}/dna/ab1_t1:amarrbase:unbuildable/visibilityGroups`,
    )).status, 404);
    assert.equal((await fetch(
        `${root}/dna/missing:amarrbase:amarr/visibilityGroups`,
    )).status, 404);
    assert.equal((await fetch(
        `${root}/dna/ab1_t1:amarrbase:amarr/unknownTopic`,
    )).status, 400);
    assert.equal((await fetch(`${root}/dna/malformed`)).status, 400);
    assert.equal((await fetch(`${root}/hulls/not%20safe`)).status, 400);
    assert.equal((await fetch(`${root}/patterns/stripes`)).status, 400);
    assert.equal((await fetch(`${root}/generic`)).status, 404);
    assert.equal(openTargetCount, 1);
    assert.equal(openSofCount, 1);
});

test("answers browser CORS preflight without an authentication contract", async context =>
{
    const proxy = new CjsToolHttpProxy({
        indexes: { Open() {} },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const address = server.address();
    const root = `http://127.0.0.1:${address.port}`;
    const preflight = await fetch(`${root}/eve/latest/skin`, {
        method: "OPTIONS",
        headers: {
            origin: "http://127.0.0.1:8080",
            "access-control-request-method": "GET",
            "access-control-request-headers": "content-type",
        },
    });

    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.equal(
        preflight.headers.get("access-control-allow-headers"),
        [
            "Accept",
            "Accept-Language",
            "Content-Type",
            "If-None-Match",
            "Range",
        ].join(", "),
    );
    assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
    assert.equal(await preflight.text(), "");

    const health = await fetch(`${root}/v1/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), "*");
});

test("serves exact EVE SDE catalogs, generic tables, and records", async context =>
{
    const row = Object.freeze({
        table: "types",
        id: "587",
        payload: { name: { en: "Rifter" }, graphicID: 42 },
    });
    const source = {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3435006",
        async Describe()
        {
            return {
                schema: "carbon.sde.sqlite",
                version: 1,
                target: "eve",
                game: "Eve",
                provider: "ccp",
                buildRef: "latest",
                build: "3435006",
                tables: [ { name: "types", rowCount: 1 } ],
            };
        },
        async Resolve(selection)
        {
            assert.deepEqual(selection, { typeID: "587" });
            return {
                typeID: "587",
                graphicID: "42",
                skinID: null,
                dna: "rifter:minmatar:minmatar",
            };
        },
        Table(name)
        {
            assert.equal(name, "types");

            return {
                name,
                async Count()
                {
                    return 1;
                },
                async Get(id)
                {
                    return String(id) === "587" ? row : null;
                },
                async List(options)
                {
                    assert.deepEqual(options, { limit: "1", offset: undefined });
                    return [ row ];
                },
                async Search(query, options)
                {
                    assert.equal(query, "rifter");
                    assert.deepEqual(options, { limit: undefined, offset: undefined });
                    return [ row ];
                },
                async Find(field, value, options)
                {
                    assert.equal(field, "groupID");
                    assert.equal(value, "25");
                    assert.deepEqual(options, {
                        limit: undefined,
                        offset: undefined,
                        contains: false,
                    });
                    return [ row ];
                },
            };
        },
    };
    const proxy = new CjsToolHttpProxy({
        sde: {
            async OpenTarget(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "latest");
                return source;
            },
        },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const address = server.address();
    const root = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${root}/v1/health`);

    assert.deepEqual((await health.json()).capabilities, {
        resources: false,
        audio: false,
        character: false,
        sde: true,
        skin: true,
        skinr: true,
        weapons: true,
        sofCatalog: false,
    });

    const catalog = await fetch(`${root}/eve/latest/sde`);

    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).tables[0].name, "types");

    const table = await fetch(`${root}/eve/latest/sde/types?limit=1`);

    assert.equal(table.status, 200);
    assert.deepEqual(await table.json(), {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3435006",
        table: "types",
        rowCount: 1,
        limit: 1,
        offset: 0,
        items: [ row ],
    });

    const record = await fetch(`${root}/eve/latest/sde/types/587`);

    assert.equal(record.status, 200);
    assert.equal((await record.json()).payload.name.en, "Rifter");

    const search = await fetch(`${root}/eve/latest/sde/types?query=rifter`);

    assert.equal(search.status, 200);
    assert.equal((await search.json()).items[0].id, "587");

    const filtered = await fetch(`${root}/eve/latest/sde/types?field=groupID&value=25`);
    const filteredBody = await filtered.json();

    assert.equal(filtered.status, 200);
    assert.deepEqual(filteredBody.filter, {
        field: "groupID",
        operator: "equals",
        value: "25",
    });
    assert.equal(filteredBody.items[0].id, "587");

    const resolved = await fetch(`${root}/eve/latest/sde/resolve?typeID=587`);

    assert.equal(resolved.status, 200);
    assert.equal((await resolved.json()).dna, "rifter:minmatar:minmatar");
});

test("serves the combined schema-v8 character document", async context =>
{
    const values = CjsToolCharacter.build(CreateCharacterDocuments(), {
        sourceTarget: "eve",
        sourceBuild: "3450001",
    });
    const installed = CjsCharacterLibrary.from(values);
    let exportCount = 0;
    const library = new Proxy(installed, {
        get(target, property)
        {
            if (property === "GetValues")
            {
                return (...args) =>
                {
                    exportCount++;
                    return target.GetValues(...args);
                };
            }

            return Reflect.get(target, property, target);
        },
    });
    const proxy = new CjsToolHttpProxy({
        characters: {
            async OpenTarget(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "3450001");

                return library;
            },
        },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const address = server.address();
    const root = `http://127.0.0.1:${address.port}/eve/3450001/character`;
    const health = await fetch(`http://127.0.0.1:${address.port}/v1/health`);

    assert.deepEqual((await health.json()).capabilities, {
        resources: false,
        audio: false,
        character: true,
        sde: false,
        skin: false,
        skinr: false,
        weapons: false,
        sofCatalog: false,
    });

    const response = await fetch(root);
    const alias = await fetch(`${root}/library.json`);
    const wholeLibrary = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-carbon-answer"), "character");
    assert.equal(response.headers.get("x-carbon-target"), "eve");
    assert.equal(response.headers.get("x-carbon-build"), "3450001");
    assert.equal(wholeLibrary.schemaVersion, 8);
    assert.equal(wholeLibrary.sourceTarget, "eve");
    assert.equal(wholeLibrary.documents.characterResources[0].typeID, "9001");
    assert.deepEqual(await alias.json(), wholeLibrary);
    assert.equal(exportCount, 2);
    const hydrated = CjsCharacterLibrary.from(wholeLibrary);

    hydrated.Reindex();
    assert.strictEqual(
        hydrated.Get("ancestries", 1).bloodlineID,
        hydrated.Get("bloodlines", 2)
    );
    assert.strictEqual(
        hydrated.Get("bloodlines", 2).raceID,
        hydrated.Get("races", 3)
    );
    assert.equal((await fetch(`${root}/types/9001`)).status, 404);
    assert.equal((await fetch(`${root}/lookup?name=Sample`)).status, 404);
    assert.equal((await fetch(`${root}/lod/0/hair`)).status, 404);
});

test("serves resource resolution and validated fetch-to-cache requests", async context =>
{
    const resolution = Object.freeze({
        provider: "ccp",
        build: "3435006",
        logicalPath: "res:/dx9/model/ship/test.gr2",
    });
    let openTargetCount = 0;
    const proxy = new CjsToolHttpProxy({
        indexes: {
            ListTargets()
            {
                return [
                    {
                        id: "eve",
                        game: "Eve",
                        provider: "ccp",
                        client: null,
                        libraries: [ "audio", "character" ],
                        topics: [ "app", "res", "sde" ],
                    },
                    {
                        id: "frontier",
                        game: "Frontier",
                        provider: "ccp",
                        client: "stillness",
                        libraries: [ "audio", "shader" ],
                        topics: [ "app", "res" ],
                    },
                ];
            },
            async ResolveTargetBuild(target, build)
            {
                assert.equal(target, "eve");
                assert.ok([ "latest", "3435006" ].includes(build));

                return {
                    target: "eve",
                    game: "Eve",
                    provider: "ccp",
                    buildRef: build,
                    build: "3435006",
                    client: "tranquility",
                    source: build === "latest" ? "latest-remote-metadata" : "exact",
                };
            },
            async OpenTarget(target, build, options)
            {
                assert.equal(target, "eve");
                assert.equal(build, "3435006");
                assert.deepEqual(options, { client: "tranquility" });
                openTargetCount++;

                return {
                    async Fetch(logicalPath, options)
                    {
                        assert.equal(logicalPath, "res:/dx9/model/ship/short.gr2");
                        assert.deepEqual(options, { indexName: undefined, refresh: false });

                        return {
                            resolution: {
                                target: "eve",
                                game: "Eve",
                                provider: "ccp",
                                build: "3435006",
                                logicalPath,
                                record: {
                                    checksum: "0123456789abcdef0123456789abcdef",
                                },
                            },
                            bytes: new TextEncoder().encode("short-resource"),
                        };
                    },
                };
            },
            async ResolveBuild(options)
            {
                assert.deepEqual(options, {
                    game: "eve",
                    provider: "ccp",
                    build: "latest",
                    client: undefined,
                });

                return {
                    game: "Eve",
                    provider: "ccp",
                    buildRef: "latest",
                    build: "3435006",
                    client: "tranquility",
                    source: "latest-remote-metadata",
                };
            },
            async Open(sourceOptions)
            {
                assert.deepEqual(sourceOptions, { provider: "ccp", build: "3435006" });

                return {
                    Resolve(logicalPath, options)
                    {
                        assert.equal(logicalPath, resolution.logicalPath);
                        assert.deepEqual(options, {});

                        return resolution;
                    },
                    async Fetch(logicalPath, options)
                    {
                        assert.equal(logicalPath, resolution.logicalPath);
                        assert.deepEqual(options, { refresh: false });

                        return {
                            resolution,
                            byteLength: 42,
                            cacheHit: true,
                            cachePath: "C:\\cache\\ResFiles\\aa\\content",
                        };
                    },
                };
            },
        },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const address = server.address();
    const root = `http://127.0.0.1:${address.port}`;
    const headers = {
        "content-type": "application/json",
    };
    const health = await fetch(`${root}/v1/health`, { headers });
    const healthBody = await health.json();

    assert.equal(health.status, 200);
    assert.deepEqual(healthBody.capabilities, {
        resources: true,
        audio: false,
        character: false,
        sde: false,
        skin: false,
        skinr: false,
        weapons: false,
        sofCatalog: false,
    });

    const targetResponse = await fetch(`${root}/targets`, { headers });

    assert.equal(targetResponse.status, 200);
    assert.deepEqual(await targetResponse.json(), {
        targets: [
            {
                id: "eve",
                game: "Eve",
                provider: "ccp",
                client: null,
                libraries: [ "audio", "character" ],
                topics: [ "app", "res", "sde" ],
            },
            {
                id: "frontier",
                game: "Frontier",
                provider: "ccp",
                client: "stillness",
                libraries: [ "audio", "shader" ],
                topics: [ "app", "res" ],
            },
        ],
    });

    const latest = await fetch(`${root}/games/eve/providers/ccp/builds/latest`, { headers });

    assert.equal(latest.status, 200);
    assert.deepEqual(await latest.json(), {
        game: "Eve",
        provider: "ccp",
        buildRef: "latest",
        build: "3435006",
        client: "tranquility",
        source: "latest-remote-metadata",
    });

    const shortLatest = await fetch(`${root}/eve/latest/build`, { headers });

    assert.equal(shortLatest.status, 200);
    assert.deepEqual(await shortLatest.json(), {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        buildRef: "latest",
        build: "3435006",
        client: "tranquility",
        source: "latest-remote-metadata",
    });

    const shortRes = await fetch(`${root}/eve/latest/res`, { headers });

    assert.equal(shortRes.status, 200);
    assert.deepEqual(await shortRes.json(), {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        buildRef: "latest",
        build: "3435006",
        client: "tranquility",
        source: "latest-remote-metadata",
        topic: "res",
        logicalRoot: "res:/",
        resourcePathTemplate: "/eve/3435006/res/{path}",
    });

    const shortResource = await fetch(
        `${root}/eve/3435006/res/dx9/model/ship/short.gr2`,
        { headers },
    );

    assert.equal(shortResource.status, 200);
    assert.equal(await shortResource.text(), "short-resource");
    assert.equal(shortResource.headers.get("x-carbon-target"), "eve");
    assert.equal(shortResource.headers.get("x-carbon-logical-path"), "res:/dx9/model/ship/short.gr2");
    assert.equal(
        shortResource.headers.get("cache-control"),
        "public, max-age=31536000, immutable",
    );
    assert.equal(shortResource.headers.get("etag"), '"0123456789abcdef0123456789abcdef"');

    const repeatedResource = await fetch(
        `${root}/eve/3435006/res/dx9/model/ship/short.gr2`,
        { headers },
    );

    assert.equal(repeatedResource.status, 200);
    assert.equal(await repeatedResource.text(), "short-resource");
    assert.equal(openTargetCount, 1);

    const source = { provider: "ccp", build: "3435006" };
    const resolved = await fetch(`${root}/v1/resources/resolve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ source, logicalPath: resolution.logicalPath }),
    });

    assert.equal(resolved.status, 200);
    assert.deepEqual(await resolved.json(), resolution);

    const friendlyBuild = await fetch(`${root}/v1/resources/resolve`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            source: { provider: "ccp", build: "latest" },
            logicalPath: resolution.logicalPath,
        }),
    });

    assert.equal(friendlyBuild.status, 400);
    assert.match((await friendlyBuild.json()).error, /exact numeric build/u);

    const fetched = await fetch(`${root}/v1/resources/fetch`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            source,
            logicalPath: resolution.logicalPath,
            options: { refresh: false },
        }),
    });

    assert.equal(fetched.status, 200);
    assert.deepEqual(await fetched.json(), {
        resolution,
        byteLength: 42,
        cacheHit: true,
        cachePath: "C:\\cache\\ResFiles\\aa\\content",
    });
});

test("serves NetEase SDE queries from the explicit EVE fallback identity", async context =>
{
    const source = {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3435006",
        Table(name)
        {
            assert.equal(name, "groups");

            return {
                name,
                async Count()
                {
                    return 2;
                },
                async Find(field, value, options)
                {
                    assert.equal(field, "categoryID");
                    assert.equal(value, "6");
                    assert.deepEqual(options, {
                        limit: "500",
                        offset: undefined,
                        contains: false,
                    });

                    return [ {
                        table: "groups",
                        id: "25",
                        payload: { name: { en: "Frigate" }, categoryID: 6 },
                    } ];
                },
            };
        },
    };
    const proxy = new CjsToolHttpProxy({
        sde: {
            async OpenTarget(target, build)
            {
                assert.equal(target, "netease");
                assert.equal(build, "latest");

                return source;
            },
        },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const response = await fetch(
        `http://127.0.0.1:${server.address().port}`
        + "/netease/latest/sde/groups?field=categoryID&limit=500&value=6",
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.target, "eve");
    assert.equal(body.provider, "ccp");
    assert.equal(body.build, "3435006");
    assert.equal(body.table, "groups");
    assert.equal(body.items[0].payload.name.en, "Frigate");
    assert.equal(response.headers.get("x-carbon-answer"), "sde");
    assert.equal(response.headers.get("x-carbon-target"), "eve");
    assert.equal(response.headers.get("x-carbon-provider"), "ccp");
    assert.equal(response.headers.get("x-carbon-build"), "3435006");
});

test("serves the shared browser shader overlay through NetEase resource endpoints", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-proxy-overlay-"));
    const sourceDirectory = path.join(directory, "source");
    const overlayStore = new CjsIndexOverlayStore(path.join(directory, "data.local"));
    const shaderPath = "graphics/effect.gles2/test.sm_hi";
    const shaderBytes = Buffer.from("legacy-gles");

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));
    await fs.mkdir(path.join(sourceDirectory, "shaders"), { recursive: true });
    await fs.writeFile(path.join(sourceDirectory, "shaders", "test.sm_hi"), shaderBytes);
    await overlayStore.Import({
        target: "eve",
        game: "Eve",
        provider: "ccp",
        name: "legacy-gles",
        mode: "fallback",
        builds: [ "*" ],
        sourceDirectory,
        entries: [ {
            logicalPath: `res:/${shaderPath}`,
            location: "shaders/test.sm_hi",
        } ],
    });

    const targets = new CjsToolTargetRegistry([ {
        id: "eve",
        game: "Eve",
        provider: "ccp",
        client: null,
        libraries: [],
        topics: [ "app", "res" ],
    }, {
        id: "netease",
        game: "Eve",
        provider: "netease",
        client: null,
        libraries: [],
        topics: [ "app", "res" ],
        overlaySources: [ {
            target: "eve",
            names: [ "legacy-gles" ],
        } ],
    } ]);
    const providers = new CjsIndexProviderRegistry([ {
        game: "Eve",
        id: "netease",
        defaultBuildRef: "latest",
        remote: {
            metadataBaseUrl: "https://metadata.test",
            indexBaseUrl: "https://indexes.test",
            appBaseUrl: "https://app.test",
            resBaseUrl: "https://res.test",
        },
        clients: {},
    } ]);
    const responses = {
        "https://indexes.test/eveonline_88.txt": [
            "app:/resfileindex.txt",
            "aa/main",
            "",
            "",
            "",
            "",
        ].join(","),
        "https://app.test/aa/main": "",
    };
    const indexes = new CjsToolIndex({
        targets,
        providers,
        overlays: overlayStore,
        cache: null,
        fetch: async url =>
        {
            if (!(url in responses)) return { ok: false, status: 404 };

            const bytes = Buffer.from(responses[url]);

            return {
                ok: true,
                status: 200,
                async arrayBuffer()
                {
                    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                },
            };
        },
    });
    const server = new CjsToolHttpProxy({ indexes }).CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const response = await fetch(
        `http://127.0.0.1:${server.address().port}/netease/88/res/${shaderPath}`,
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "legacy-gles");
    assert.equal(response.headers.get("x-carbon-target"), "netease");
    assert.equal(response.headers.get("x-carbon-provider"), "ccp");
    assert.equal(response.headers.get("x-carbon-build"), "88");
    assert.equal(response.headers.get("x-carbon-overlay"), "legacy-gles");
    assert.equal(response.headers.get("x-carbon-storage-kind"), "persistent-overlay");
});

test("service launcher emits an unauthenticated loopback bootstrap record", async context =>
{
    const executable = fileURLToPath(new URL("../bin/cjs-tools-service.js", import.meta.url));
    const cacheDirectory = path.join(os.tmpdir(), "cjs-tools-service-test");
    const dataDirectory = path.join(os.tmpdir(), "cjs-tools-service-data-test");
    const child = spawn(process.execPath, [
        executable,
        "--cache",
        cacheDirectory,
        "--data",
        dataDirectory,
    ], {
        stdio: [ "ignore", "pipe", "pipe" ],
    });
    const lines = readline.createInterface({ input: child.stdout });

    context.after(() =>
    {
        lines.close();

        if (child.exitCode === null)
        {
            child.kill("SIGTERM");
        }
    });

    const [ line ] = await once(lines, "line");
    const bootstrap = JSON.parse(line);

    assert.equal(bootstrap.schema, "carbon.tools-service.bootstrap");
    assert.equal(bootstrap.protocol, "carbon.tools");
    assert.equal(bootstrap.protocolVersion, 1);
    assert.equal(bootstrap.host, "127.0.0.1");
    assert.equal(Object.hasOwn(bootstrap, "token"), false);
    assert.equal(bootstrap.cacheDirectory, path.resolve(cacheDirectory));
    assert.equal(bootstrap.dataDirectory, path.resolve(dataDirectory));
    assert.deepEqual(bootstrap.capabilities, {
        resources: true,
        audio: true,
        character: true,
        sde: true,
        skin: true,
        skinr: true,
        weapons: true,
        sofCatalog: true,
    });

    const health = await fetch(`http://${bootstrap.host}:${bootstrap.port}/v1/health`);

    assert.equal(health.status, 200);

    const exit = once(child, "exit");

    child.kill("SIGTERM");
    await exit;
});

test("retains an exact resource source until the latest build changes", async context =>
{
    let currentBuild = "77";
    const openedBuilds = [];
    const proxy = new CjsToolHttpProxy({
        indexes: {
            Open() {},
            async ResolveTargetBuild(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "latest");

                return {
                    target,
                    game: "Eve",
                    provider: "ccp",
                    buildRef: "latest",
                    build: currentBuild,
                    client: "tranquility",
                    source: "latest-remote-metadata",
                };
            },
            async OpenTarget(target, build, options)
            {
                assert.equal(target, "eve");
                assert.deepEqual(options, { client: "tranquility" });
                openedBuilds.push(build);

                return {
                    target,
                    game: "Eve",
                    provider: "ccp",
                    build,
                    async Fetch(logicalPath)
                    {
                        return {
                            resolution: {
                                target,
                                game: "Eve",
                                provider: "ccp",
                                build,
                                logicalPath,
                                record: {
                                    checksum: build.padStart(32, "0"),
                                },
                            },
                            bytes: new TextEncoder().encode(build),
                        };
                    },
                };
            },
        },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const root = `http://127.0.0.1:${server.address().port}/eve/latest/res/test.bin`;

    const first = await fetch(root);
    const firstEtag = first.headers.get("etag");

    assert.equal(await first.text(), "77");
    assert.equal(first.headers.get("cache-control"), "public, max-age=300, must-revalidate");
    assert.equal(firstEtag, '"00000000000000000000000000000077"');

    const unchanged = await fetch(root, {
        headers: { "if-none-match": firstEtag },
    });

    assert.equal(unchanged.status, 304);
    assert.deepEqual(openedBuilds, [ "77" ]);

    currentBuild = "78";

    const changed = await fetch(root, {
        headers: { "if-none-match": firstEtag },
    });

    assert.equal(changed.status, 200);
    assert.equal(await changed.text(), "78");
    assert.equal(changed.headers.get("etag"), '"00000000000000000000000000000078"');
    assert.deepEqual(openedBuilds, [ "77", "78" ]);
});

test("serves a Black resource as parsed JSON through ?format=json", async context =>
{
    const hullBytes = await fs.readFile(path.join(FixtureDirectory, "fixtures", "ab1_t1.black"));
    const hullPath = "res:/dx9/model/spaceobjectfactory/hulls/ab1_t1.black";
    const otherPath = "res:/dx9/model/spaceobjectfactory/hulls/ab1_t1.red";
    let openTargetCount = 0;
    const proxy = new CjsToolHttpProxy({
        indexes: {
            async Open()
            {
                throw new Error("Open was not expected");
            },
            async ResolveTargetBuild(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "3435006");

                return {
                    target: "eve",
                    game: "Eve",
                    provider: "ccp",
                    buildRef: "3435006",
                    build: "3435006",
                    client: null,
                    source: "exact",
                };
            },
            async OpenTarget(target, build, options)
            {
                assert.equal(target, "eve");
                assert.equal(build, "3435006");
                assert.deepEqual(options, { client: undefined });
                openTargetCount++;

                return {
                    async Fetch(logicalPath)
                    {
                        assert.ok([ hullPath, otherPath ].includes(logicalPath));

                        return {
                            resolution: {
                                target: "eve",
                                game: "Eve",
                                provider: "ccp",
                                build: "3435006",
                                logicalPath,
                            },
                            bytes: logicalPath === hullPath ? hullBytes : new TextEncoder().encode("red-bytes"),
                        };
                    },
                };
            },
        },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const root = `http://127.0.0.1:${server.address().port}`;

    const json = await fetch(`${root}/eve/3435006/res/dx9/model/spaceobjectfactory/hulls/ab1_t1.black?format=json`);

    assert.equal(json.status, 200);
    assert.equal(json.headers.get("content-type"), "application/json; charset=utf-8");

    const payload = await json.json();

    assert.equal(payload.object._type, "EveSOFDataHull");
    assert.ok(payload.object.locatorSets.some(set => set.name === "damage"));

    const bytes = await fetch(`${root}/eve/3435006/res/dx9/model/spaceobjectfactory/hulls/ab1_t1.black`);

    assert.equal(bytes.status, 200);
    assert.equal(bytes.headers.get("content-type"), "application/octet-stream");
    assert.equal(Number(bytes.headers.get("content-length")), hullBytes.byteLength);
    assert.equal(openTargetCount, 1);

    const unsupportedFormat = await fetch(
        `${root}/eve/3435006/res/dx9/model/spaceobjectfactory/hulls/ab1_t1.black?format=xml`,
    );

    assert.equal(unsupportedFormat.status, 400);

    const unsupportedResource = await fetch(
        `${root}/eve/3435006/res/dx9/model/spaceobjectfactory/hulls/ab1_t1.red?format=json`,
    );

    assert.equal(unsupportedResource.status, 415);
});
