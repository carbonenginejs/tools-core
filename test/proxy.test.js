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

import { CjsToolHttpProxy } from "../src/index.js";

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
    assert.deepEqual(await health.json(), {
        ok: true,
        service: "@carbonenginejs/tools-core",
        protocol: "carbon.tools",
        protocolVersion: 1,
        capabilities: {
            resources: false,
            sde: false,
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
        sde: true,
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

test("authenticates resource resolution and validated fetch-to-cache requests", async context =>
{
    const token = "0123456789abcdef0123456789abcdef";
    const resolution = Object.freeze({
        provider: "ccp",
        build: "3435006",
        logicalPath: "res:/dx9/model/ship/test.gr2",
    });
    const proxy = new CjsToolHttpProxy({
        token,
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
                assert.equal(build, "latest");

                return {
                    target: "eve",
                    game: "Eve",
                    provider: "ccp",
                    buildRef: "latest",
                    build: "3435006",
                    client: "tranquility",
                    source: "latest-remote-metadata",
                };
            },
            async OpenTarget(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "3435006");

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
    const unauthorized = await fetch(`${root}/v1/health`);

    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const headers = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
    };
    const health = await fetch(`${root}/v1/health`, { headers });
    const healthBody = await health.json();

    assert.equal(health.status, 200);
    assert.deepEqual(healthBody.capabilities, {
        resources: true,
        sde: false,
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

test("service launcher emits an authenticated loopback bootstrap record", async context =>
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
    assert.equal(bootstrap.cacheDirectory, path.resolve(cacheDirectory));
    assert.equal(bootstrap.dataDirectory, path.resolve(dataDirectory));
    assert.deepEqual(bootstrap.capabilities, {
        resources: true,
        sde: true,
        sofValues: false,
        sofDocument: false,
    });

    const health = await fetch(`http://${bootstrap.host}:${bootstrap.port}/v1/health`, {
        headers: { authorization: `Bearer ${bootstrap.token}` },
    });

    assert.equal(health.status, 200);

    const exit = once(child, "exit");

    child.kill("SIGTERM");
    await exit;
});

test("serves a Black resource as parsed JSON through ?format=json", async context =>
{
    const hullBytes = await fs.readFile(path.join(FixtureDirectory, "fixtures", "ab1_t1.black"));
    const hullPath = "res:/dx9/model/spaceobjectfactory/hulls/ab1_t1.black";
    const otherPath = "res:/dx9/model/spaceobjectfactory/hulls/ab1_t1.red";
    const proxy = new CjsToolHttpProxy({
        indexes: {
            async Open()
            {
                throw new Error("Open was not expected");
            },
            async ResolveTargetBuild()
            {
                throw new Error("ResolveTargetBuild was not expected");
            },
            async OpenTarget(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "3435006");

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

    const unsupportedFormat = await fetch(
        `${root}/eve/3435006/res/dx9/model/spaceobjectfactory/hulls/ab1_t1.black?format=xml`,
    );

    assert.equal(unsupportedFormat.status, 400);

    const unsupportedResource = await fetch(
        `${root}/eve/3435006/res/dx9/model/spaceobjectfactory/hulls/ab1_t1.red?format=json`,
    );

    assert.equal(unsupportedResource.status, 415);
});
