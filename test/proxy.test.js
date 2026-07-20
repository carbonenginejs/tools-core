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

import { CjsToolCharacterLibrary, CjsToolHttpProxy } from "../src/index.js";

const FixtureDirectory = path.dirname(fileURLToPath(import.meta.url));

test("serves health, SOF values, and compatibility document requests without a framework", async context =>
{
    const proxy = new CjsToolHttpProxy({
        core: {
            BuildSofDocument()
            {
                throw new Error("Synchronous path was not expected");
            },
            async BuildSofDocumentAsync(dna)
            {
                return { schema: "carbon.document", dna };
            },
            async BuildTypeSofDocumentAsync(selection)
            {
                return { schema: "carbon.document", selection };
            },
            async BuildSofValuesAsync(dna)
            {
                return { _type: "EveShip2", dna };
            },
            async BuildTypeSofValuesAsync(selection)
            {
                return { _type: "EveShip2", selection };
            }
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
            resources: false,
            character: false,
            sde: false,
            skin: false,
            skinr: false,
            weapons: false,
            sofValues: true,
            sofDocument: true,
        },
    });

    const values = await fetch(`${root}/v1/sof/values`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dna: "rifter:minmatar:minmatar" })
    });

    assert.equal(values.status, 200);
    assert.deepEqual(await values.json(), {
        _type: "EveShip2",
        dna: "rifter:minmatar:minmatar"
    });

    const response = await fetch(`${root}/v1/sof/document`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dna: "rifter:minmatar:minmatar" })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        schema: "carbon.document",
        dna: "rifter:minmatar:minmatar"
    });
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
    assert.equal(preflight.headers.get("access-control-allow-headers"), "Content-Type");
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
        character: false,
        sde: true,
        skin: true,
        skinr: true,
        weapons: true,
        sofValues: false,
        sofDocument: false,
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

test("resolves character names and type identities with atomic LOD bundles", async context =>
{
    const partID = "female/hair/hair_long_01/types/hair_long_01";
    const anonymousPartID = "female/hair/hair_plain/types/hair_plain";
    const library = new CjsToolCharacterLibrary({
        schema: "carbonenginejs.characterLibrary",
        schemaVersion: 2,
        sourceTarget: "eve",
        sourceGame: "Eve",
        sourceProvider: "ccp",
        sourceBuild: "3435006",
        partSources: {
            "female/hair/hair_long_01": {
                resources: {
                    configPaths: [
                        "res:/character/hair_long_01_lod0.black",
                        "res:/character/hair_long_01_lod1.black",
                    ],
                    geometryPaths: [
                        "res:/character/hair_long_01_lod0.gr2",
                        "res:/character/hair_long_01_lod1.gr2",
                    ],
                    lodBundles: [
                        {
                            requestedLod: null,
                            resolvedLod: 0,
                            configurationPath: "res:/character/hair_long_01_lod0.black",
                            geometryPath: "res:/character/hair_long_01_lod0.gr2",
                            modelFamily: "hairlong01",
                            fallbackReason: "",
                        },
                        {
                            requestedLod: null,
                            resolvedLod: 1,
                            configurationPath: "res:/character/hair_long_01_lod1.black",
                            geometryPath: "res:/character/hair_long_01_lod1.gr2",
                            modelFamily: "hairlong01",
                            fallbackReason: "",
                        },
                    ],
                },
                versions: {
                    default: {
                        types: {
                            [partID]: {
                                typeID: "9001",
                                name: "Long Hair",
                            },
                        },
                    },
                },
            },
            "female/hair/hair_plain": {
                versions: {
                    default: {
                        resources: {
                            configPaths: [
                                "res:/character/hair_plain_lod0.black",
                                "res:/character/hair_plain_lod1.black",
                            ],
                            geometryPaths: [
                                "res:/character/hair_plain_lod0.gr2",
                                "res:/character/hair_plain_lod1.gr2",
                            ],
                            lodBundles: [
                                {
                                    requestedLod: null,
                                    resolvedLod: 0,
                                    configurationPath: "res:/character/hair_plain_lod0.black",
                                    geometryPath: "res:/character/hair_plain_lod0.gr2",
                                    modelFamily: "hairplain",
                                    fallbackReason: "",
                                },
                                {
                                    requestedLod: null,
                                    resolvedLod: 1,
                                    configurationPath: "res:/character/hair_plain_lod1.black",
                                    geometryPath: "res:/character/hair_plain_lod1.gr2",
                                    modelFamily: "hairplain",
                                    fallbackReason: "",
                                },
                            ],
                        },
                        types: {
                            [anonymousPartID]: {
                                name: "Unidentified Hair",
                            },
                        },
                    },
                },
            },
        },
    });
    const proxy = new CjsToolHttpProxy({
        characters: {
            async OpenTarget(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "3435006");

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
    const root = `http://127.0.0.1:${address.port}/eve/3435006/character`;
    const health = await fetch(`http://127.0.0.1:${address.port}/v1/health`);

    assert.deepEqual((await health.json()).capabilities, {
        resources: false,
        character: true,
        sde: false,
        skin: false,
        skinr: false,
        weapons: false,
        sofValues: false,
        sofDocument: false,
    });

    const wholeLibrary = await (await fetch(root)).json();

    assert.equal(wholeLibrary.schemaVersion, 2);
    assert.equal(wholeLibrary.sourceTarget, "eve");
    assert.equal(wholeLibrary.partSources["female/hair/hair_long_01"]
        .versions.default.types[partID].typeID, "9001");
    assert.deepEqual(library.GetSourceIdentity(), {
        sourceTarget: "eve",
        sourceGame: "Eve",
        sourceProvider: "ccp",
        sourceBuild: "3435006",
    });

    const nameOptions = await (await fetch(
        `${root}/lookup?name=${encodeURIComponent("Long Hair")}`
    )).json();
    const searchedOptions = await (await fetch(
        `${root}/search?name=${encodeURIComponent("long-hair")}`
    )).json();

    assert.deepEqual(nameOptions, [ {
        kind: "character",
        typeID: "9001",
        partID,
    } ]);
    assert.deepEqual(searchedOptions, nameOptions);

    const anonymousOptions = await (await fetch(
        `${root}/lookup?name=${encodeURIComponent("Unidentified Hair")}`
    )).json();

    assert.deepEqual(anonymousOptions, [ {
        kind: "character",
        typeID: null,
        partID: anonymousPartID,
    } ]);

    const anonymous = await fetch(`${root}/parts/${anonymousPartID}?lod=0`);
    const anonymousPart = await anonymous.json();

    assert.equal(anonymous.status, 200);
    assert.equal(anonymousPart.id, anonymousPartID);
    assert.equal(anonymousPart.typeID, null);
    assert.equal(anonymousPart.lodBundle.resolvedLod, 0);

    const anonymousPathLod = await fetch(`${root}/lod/1/parts/${anonymousPartID}`);
    assert.equal(anonymousPathLod.status, 200);
    assert.equal((await anonymousPathLod.json()).lodBundle.resolvedLod, 1);

    const named = await fetch(`${root}/resolve?name=Long%20Hair&lod=0`);
    const namedPart = await named.json();

    assert.equal(named.status, 200);
    assert.equal(namedPart.id, partID);
    assert.equal(namedPart.typeID, "9001");
    assert.equal(namedPart.lodBundle.requestedLod, 0);
    assert.equal(namedPart.lodBundle.resolvedLod, 0);
    assert.match(namedPart.lodBundle.configurationPath, /_lod0\.black$/u);
    assert.match(namedPart.lodBundle.geometryPath, /_lod0\.gr2$/u);

    const typed = await fetch(`${root}/lod/1/types/9001`);
    const typedPart = await typed.json();

    assert.equal(typed.status, 200);
    assert.equal(typedPart.id, partID);
    assert.equal(typedPart.lodBundle.requestedLod, 1);
    assert.equal(typedPart.lodBundle.resolvedLod, 1);

    const category = await fetch(`${root}/hair?lod=0`);
    const categoryBody = await category.json();

    assert.equal(category.status, 200);
    assert.equal(categoryBody.category, "hair");
    assert.equal(categoryBody.requestedLod, 0);
    assert.equal(categoryBody.items[0].typeID, "9001");
    assert.equal(categoryBody.items[0].lodBundle.resolvedLod, 0);

    const pathNamed = await fetch(`${root}/lod/1/resolve?name=Long%20Hair`);
    const pathNamedPart = await pathNamed.json();

    assert.equal(pathNamed.status, 200);
    assert.equal(pathNamedPart.typeID, "9001");
    assert.equal(pathNamedPart.lodBundle.resolvedLod, 1);

    const missing = await fetch(`${root}/resolve?name=Missing`);

    assert.equal(missing.status, 404);
    assert.equal((await fetch(`${root}/parts/female/hair/missing`)).status, 404);

    const disagreement = await fetch(`${root}/lod/1/types/9001?lod=0`);

    assert.equal(disagreement.status, 400);
    assert.match((await disagreement.json()).error, /disagree/u);
    assert.equal((await fetch(`${root}/lookup?name=Long%20Hair&lod=0`)).status, 400);
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
        character: false,
        sde: false,
        skin: false,
        skinr: false,
        weapons: false,
        sofValues: false,
        sofDocument: false,
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
        character: true,
        sde: true,
        skin: true,
        skinr: true,
        weapons: true,
        sofValues: false,
        sofDocument: false,
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
