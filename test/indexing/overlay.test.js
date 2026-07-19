import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    CjsIndexOverlaySource,
    CjsIndexOverlayStore,
    CjsIndexCache,
    CjsIndexProviderRegistry,
    CjsToolIndex,
    CjsToolTargetRegistry,
} from "../../src/index.js";

const Provider = Object.freeze({
    game: "Eve",
    id: "test",
    defaultBuildRef: "latest",
    remote: Object.freeze({
        metadataBaseUrl: "https://metadata.test",
        indexBaseUrl: "https://indexes.test",
        appBaseUrl: "https://app.test",
        resBaseUrl: "https://res.test",
    }),
    clients: Object.freeze({}),
});

const Targets = new CjsToolTargetRegistry([ {
    id: "eve",
    game: "Eve",
    provider: "test",
    client: null,
    libraries: [],
    topics: [ "app", "res" ],
} ]);

test("composes persistent overrides and fallbacks around the official res index", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-overlays-"));
    const sourceDirectory = path.join(directory, "source");
    const store = new CjsIndexOverlayStore(path.join(directory, "data.local"));

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    await writePayload(sourceDirectory, "aa/override", "override");
    await writePayload(sourceDirectory, "bb/fallback", "fallback");
    await writePayload(sourceDirectory, "cc/fallback-shadowed", "fallback-shadowed");

    await store.Import({
        target: "eve",
        game: "Eve",
        provider: "test",
        name: "generated",
        mode: "override",
        builds: [ "77" ],
        sourceDirectory,
        entries: [
            { logicalPath: "res:/same.bin", location: "aa/override" },
        ],
    });
    await store.Import({
        target: "eve",
        game: "Eve",
        provider: "test",
        name: "legacy",
        mode: "fallback",
        builds: [ "*" ],
        sourceDirectory,
        entries: [
            { logicalPath: "res:/legacy.bin", location: "bb/fallback" },
            { logicalPath: "res:/official.bin", location: "cc/fallback-shadowed" },
        ],
    });

    const requests = [];
    const tool = new CjsToolIndex({
        providers: new CjsIndexProviderRegistry([ Provider ]),
        targets: Targets,
        overlays: store,
        cache: null,
        fetch: createFetch({
            "https://indexes.test/eveonline_77.txt": row(
                "app:/resfileindex.txt",
                "aa/main",
            ),
            "https://app.test/aa/main": [
                row("res:/same.bin", "official/same"),
                row("res:/official.bin", "official/file"),
            ].join("\n"),
            "https://res.test/official/same": "official-same",
            "https://res.test/official/file": "official-file",
        }, requests),
    });
    const source = await tool.OpenTarget("eve", "77");

    assert.ok(source instanceof CjsIndexOverlaySource);
    assert.deepEqual(source.availableIndexes, [ "main", "generated", "legacy" ]);
    assert.equal(source.Resolve("res:/same.bin").overlay, "generated");
    assert.equal(source.Resolve("res:/same.bin").artifactKind, "local-exact");
    assert.equal(source.Resolve("res:/legacy.bin").overlay, "legacy");
    assert.equal(source.Resolve("res:/official.bin").overlay, undefined);
    assert.equal(source.Resolve("res:/official.bin").artifactKind, "hash-safe");
    assert.equal(
        source.Resolve("res:/same.bin", { indexName: "main" }).record.location,
        "official/same",
    );
    assert.equal(
        source.Resolve("res:/official.bin", { indexName: "legacy" }).record.location,
        "official.bin",
    );
    assert.equal(Buffer.from(await source.Read("res:/same.bin")).toString(), "override");
    assert.equal(Buffer.from(await source.Read("res:/legacy.bin")).toString(), "fallback");
    assert.equal(Buffer.from(await source.Read("res:/official.bin")).toString(), "official-file");
    assert.equal(
        source.Resolve("res:/legacy.bin").sourceUrl,
        "local-overlay://eve/legacy/legacy.bin",
    );
    assert.equal(
        (await source.Fetch("res:/legacy.bin")).persistentPath,
        path.join(directory, "data.local", "games", "eve", "overlays", "legacy", "res", "legacy.bin"),
    );
    assert.deepEqual(source.Match("*.bin").map((item) => item.logicalPath), [
        "res:/legacy.bin",
        "res:/official.bin",
        "res:/same.bin",
    ]);
    assert.deepEqual(source.Match("*", { root: "app" }).map((item) => item.logicalPath), [
        "app:/resfileindex.txt",
    ]);
    assert.deepEqual(requests, [
        "https://indexes.test/eveonline_77.txt",
        "https://app.test/aa/main",
        "https://res.test/official/file",
    ]);
});

test("rejects replacement imports and ignores overlays for incompatible builds", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-overlays-"));
    const sourceDirectory = path.join(directory, "source");
    const store = new CjsIndexOverlayStore(path.join(directory, "data.local"));
    const options = {
        target: "eve",
        game: "Eve",
        provider: "test",
        name: "exact",
        mode: "fallback",
        builds: [ "77" ],
        sourceDirectory,
        entries: [ { logicalPath: "res:/exact.bin", location: "aa/exact" } ],
    };

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));
    await writePayload(sourceDirectory, "aa/exact", "exact");
    await store.Import(options);

    await assert.rejects(() => store.Import(options), /already exists/u);
    assert.equal((await store.OpenTarget("eve", "76", {
        game: "Eve",
        provider: "test",
    })).length, 0);
    assert.equal((await store.OpenTarget("eve", "77", {
        game: "Eve",
        provider: "test",
    })).length, 1);
});

test("transactionally replaces an overlay only when explicitly requested", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-overlays-"));
    const sourceDirectory = path.join(directory, "source");
    const store = new CjsIndexOverlayStore(path.join(directory, "data.local"));
    const options = {
        target: "eve",
        game: "Eve",
        provider: "test",
        name: "replaceable",
        mode: "override",
        builds: [ "77" ],
        sourceDirectory,
        entries: [ { logicalPath: "res:/replace.bin", location: "aa/replace" } ],
    };

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    await writePayload(sourceDirectory, "aa/replace", "first");
    await store.Import(options);
    await writePayload(sourceDirectory, "aa/replace", "second");
    const replacement = await store.Replace(options);
    const overlays = await store.OpenTarget("eve", "77", {
        game: "Eve",
        provider: "test",
    });
    const payload = await overlays[0].Read(overlays[0].Resolve("res:/replace.bin").record);

    assert.equal(replacement.replaced, true);
    assert.equal(overlays.length, 1);
    assert.equal(Buffer.from(payload.bytes).toString(), "second");
    assert.equal(
        (await fs.readdir(path.dirname(replacement.directory)))
            .filter((name) => name.includes("replace-"))
            .length,
        0,
    );
});

test("fetches remote fallback overlays through the disposable shared cache", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-overlays-"));
    const store = new CjsIndexOverlayStore(path.join(directory, "data.local"));
    const payload = Buffer.from("remote-legacy");
    const checksum = createHash("md5").update(payload).digest("hex");

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    await store.ImportRemote({
        target: "eve",
        game: "Eve",
        provider: "test",
        name: "remote-legacy",
        mode: "fallback",
        builds: [ "*" ],
        baseUrl: "http://legacy.test/resources",
        entries: [ {
            logicalPath: "res:/remote.bin",
            location: "aa/remote",
            checksum,
            uncompressedSize: payload.byteLength,
            compressedSize: payload.byteLength,
        } ],
    });

    const requests = [];
    const tool = new CjsToolIndex({
        providers: new CjsIndexProviderRegistry([ Provider ]),
        targets: Targets,
        overlays: store,
        cache: new CjsIndexCache({ directory: path.join(directory, "cache") }),
        fetch: createFetch({
            "https://indexes.test/eveonline_77.txt": row(
                "app:/resfileindex.txt",
                "aa/main",
            ),
            "https://app.test/aa/main": "",
            "http://legacy.test/resources/aa/remote": payload,
        }, requests),
    });
    const source = await tool.OpenTarget("eve", "77");
    const resolution = source.Resolve("res:/remote.bin");
    const first = await source.Fetch("res:/remote.bin");
    const second = await source.Fetch("res:/remote.bin");

    assert.equal(resolution.overlay, "remote-legacy");
    assert.equal(resolution.storageKind, "remote-overlay");
    assert.equal(resolution.artifactKind, "hash-safe");
    assert.equal(resolution.sourceUrl, "http://legacy.test/resources/aa/remote");
    assert.equal(Buffer.from(first.bytes).toString(), "remote-legacy");
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(
        requests.filter((url) => url === resolution.sourceUrl).length,
        1,
    );
});

test("keeps concurrent remote overlays with the same locator isolated", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-overlays-"));
    const store = new CjsIndexOverlayStore(path.join(directory, "data.local"));
    const firstPayload = Buffer.from("A");
    const secondPayload = Buffer.from("B");

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    for (const [ name, logicalPath, baseUrl, payload ] of [
        [ "remote-a", "res:/a.bin", "https://overlay-a.test", firstPayload ],
        [ "remote-b", "res:/b.bin", "https://overlay-b.test", secondPayload ],
    ])
    {
        await store.ImportRemote({
            target: "eve",
            game: "Eve",
            provider: "test",
            name,
            mode: "fallback",
            builds: [ "77" ],
            baseUrl,
            entries: [ {
                logicalPath,
                location: "aa/shared",
                checksum: createHash("md5").update(payload).digest("hex"),
                uncompressedSize: payload.byteLength,
                compressedSize: payload.byteLength,
            } ],
        });
    }

    const requests = [];
    const tool = new CjsToolIndex({
        providers: new CjsIndexProviderRegistry([ Provider ]),
        targets: Targets,
        overlays: store,
        cache: null,
        fetch: createFetch({
            "https://indexes.test/eveonline_77.txt": row(
                "app:/resfileindex.txt",
                "aa/main",
            ),
            "https://app.test/aa/main": "",
            "https://overlay-a.test/aa/shared": firstPayload,
            "https://overlay-b.test/aa/shared": secondPayload,
        }, requests),
    });
    const source = await tool.OpenTarget("eve", "77");
    const [ first, second ] = await Promise.all([
        source.Fetch("res:/a.bin"),
        source.Fetch("res:/b.bin"),
    ]);

    assert.equal(Buffer.from(first.bytes).toString(), "A");
    assert.equal(Buffer.from(second.bytes).toString(), "B");
    assert.deepEqual(requests.filter(url => url.includes("overlay-")), [
        "https://overlay-a.test/aa/shared",
        "https://overlay-b.test/aa/shared",
    ]);
});

test("rejects overlay names that collide with official indexes", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-overlays-"));
    const store = new CjsIndexOverlayStore(path.join(directory, "data.local"));
    const payload = Buffer.from("shadow");

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    await store.ImportRemote({
        target: "eve",
        game: "Eve",
        provider: "test",
        name: "main",
        mode: "fallback",
        builds: [ "77" ],
        baseUrl: "https://overlay.test",
        entries: [ {
            logicalPath: "res:/shadow.bin",
            location: "aa/shadow",
            checksum: createHash("md5").update(payload).digest("hex"),
            uncompressedSize: payload.byteLength,
            compressedSize: payload.byteLength,
        } ],
    });

    const tool = new CjsToolIndex({
        providers: new CjsIndexProviderRegistry([ Provider ]),
        targets: Targets,
        overlays: store,
        cache: null,
        fetch: createFetch({
            "https://indexes.test/eveonline_77.txt": row(
                "app:/resfileindex.txt",
                "aa/main",
            ),
            "https://app.test/aa/main": "",
        }),
    });

    await assert.rejects(
        () => tool.OpenTarget("eve", "77"),
        /conflicts with an official index: main/u,
    );
});

async function writePayload(directory, location, value)
{
    const filePath = path.join(directory, ...location.split("/"));

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, value);
}

function row(logicalPath, location)
{
    return [ logicalPath, location, "", "", "", "" ].join(",");
}

function createFetch(responses, requests = [])
{
    return async (url) =>
    {
        requests.push(url);

        if (!(url in responses))
        {
            return { ok: false, status: 404 };
        }

        const bytes = Buffer.from(responses[url]);

        return {
            ok: true,
            status: 200,
            async arrayBuffer()
            {
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            },
        };
    };
}
