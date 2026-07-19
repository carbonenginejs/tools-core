import assert from "node:assert/strict";
import test from "node:test";
import {
    CjsIndexProvider,
    CjsIndexProviderRegistry,
    CjsToolIndex,
    DefaultProviderData,
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
    clients: Object.freeze({
        live: Object.freeze({
            metadataToken: "LIVE",
            aliases: Object.freeze([]),
        }),
        preview: Object.freeze({
            metadataToken: "PREVIEW",
            aliases: Object.freeze([]),
        }),
    }),
});

test("returns a friendly build's complete app/res index graph", async () =>
{
    const fetch = createFetch({
        "https://metadata.test/eveclient_LIVE.json": jsonResponse({ build: 42 }),
        "https://metadata.test/eveclient_PREVIEW.json": jsonResponse({ build: 43 }),
        "https://indexes.test/eveonline_43.txt": textResponse([
            row("app:/resfileindex.txt", "aa/main"),
            row("app:/resfileindex_windows.txt", "bb/windows"),
            row("app:/resfileindex_windows_prefetch.txt", "cc/windows-prefetch"),
            row("app:/resfileindex_linux.txt", "dd/linux"),
        ].join("\n")),
        "https://app.test/aa/main": textResponse(row("res:/same.red", "main/source")),
        "https://app.test/bb/windows": textResponse(row("res:/same.red", "windows/source")),
        "https://app.test/cc/windows-prefetch": textResponse(row("res:/prefetch.red", "prefetch/source")),
        "https://app.test/dd/linux": textResponse(row("res:/linux.red", "linux/source")),
    });
    const source = await createReader(fetch).Open({ provider: "test", build: "latest" });

    assert.equal(source.game, "Eve");
    assert.equal(source.buildRef, "latest");
    assert.equal(source.build, "43");
    assert.equal(source.client, "preview");
    assert.equal(source.res.index.name, "main");
    assert.deepEqual(Object.keys(source.app.extensions), [ "windows", "windows_prefetch", "linux" ]);
    assert.deepEqual(source.indexes.availableIndexes, [
        "main",
        "windows",
        "windows_prefetch",
        "linux",
    ]);
    assert.throws(
        () => source.Resolve("res:/same.red"),
        /conflicting declarations/u,
    );
    assert.equal(
        source.Resolve("res:/same.red", { indexName: "main" }).record.storagePath,
        "main/source",
    );
    assert.equal(
        source.Resolve("res:/same.red", { indexName: "windows" }).record.storagePath,
        "windows/source",
    );
});

test("resolves latest inside the requested client only", async () =>
{
    const requests = [];
    const fetch = createFetch({
        "https://metadata.test/eveclient_LIVE.json": jsonResponse({ build: 42 }),
        "https://indexes.test/eveonline_42.txt": textResponse(row("app:/bin/file.bin", "app/file")),
    }, requests);
    const source = await createReader(fetch).Open({
        provider: "test",
        client: "live",
        build: "latest",
    });

    assert.equal(source.buildRef, "latest");
    assert.equal(source.build, "42");
    assert.equal(source.client, "live");
    assert.deepEqual(requests, [
        "https://metadata.test/eveclient_LIVE.json",
        "https://indexes.test/eveonline_42.txt",
    ]);
});

test("uses exact builds without fetching channel metadata", async () =>
{
    const requests = [];
    const fetch = createFetch({
        "https://indexes.test/eveonline_77.txt": textResponse(row("app:/bin/file.bin", "app/file")),
    }, requests);
    const source = await createReader(fetch).Open({
        provider: "test",
        build: 77,
    });

    assert.equal(source.build, "77");
    assert.deepEqual(requests, [ "https://indexes.test/eveonline_77.txt" ]);
    assert.equal(
        source.Resolve("app:/bin/file.bin").sourceUrl,
        "https://app.test/app/file",
    );
});

test("built-in latest is not a client alias and NetEase tq is not a client", () =>
{
    const ccp = new CjsIndexProvider(DefaultProviderData.find(
        (provider) => provider.game === "Eve" && provider.id === "ccp",
    ));
    const netease = new CjsIndexProvider(DefaultProviderData.find((provider) => provider.id === "netease"));

    assert.equal(ccp.ResolveClient("latest"), null);
    assert.equal(ccp.ResolveClient("tq").id, "tranquility");
    assert.equal(netease.ResolveClient("latest"), null);
    assert.equal(netease.ResolveClient("tq"), null);
    assert.equal(netease.ResolveClient("infinity").id, "infinity");
});

test("registers CCP independently for Eve and Frontier and resolves Frontier latest metadata", async () =>
{
    const registry = new CjsIndexProviderRegistry();
    const eve = registry.Get("ccp", "Eve");
    const frontier = registry.Get("ccp", "Frontier");

    assert.equal(eve.game, "Eve");
    assert.equal(frontier.game, "Frontier");
    assert.equal(frontier.ResolveClient("stillness").metadataToken, "STILLNESS");
    assert.equal(frontier.remote.metadataBaseUrl, "https://binaries.shared.reitnorf.com");
    assert.equal(frontier.remote.resBaseUrl, "https://resources.shared.reitnorf.com");

    const requests = [];
    const tool = new CjsToolIndex({
        fetch: createFetch({
            "https://binaries.shared.reitnorf.com/eveclient_STILLNESS.json": jsonResponse({
                build: "3438337",
                protected: "true",
            }),
        }, requests),
        cache: null,
    });
    const build = await tool.ResolveTargetBuild("frontier", "latest");

    assert.equal(build.target, "frontier");
    assert.equal(build.game, "Frontier");
    assert.equal(build.provider, "ccp");
    assert.equal(build.build, "3438337");
    assert.equal(build.client, "stillness");
    assert.equal(build.metadata.protected, "true");
    assert.deepEqual(requests, [
        "https://binaries.shared.reitnorf.com/eveclient_STILLNESS.json",
    ]);
});

test("rejects separate client and friendly build references", async () =>
{
    await assert.rejects(
        () => createReader(createFetch({})).Open({ provider: "test", client: "live", build: "preview" }),
        /either a client option or a friendly build reference/u,
    );
});

test("finds extension-only files without layering extension groups", async () =>
{
    const fetch = createFetch({
        "https://indexes.test/eveonline_77.txt": textResponse([
            row("app:/resfileindex.txt", "aa/main"),
            row("app:/resfileindex_windows.txt", "bb/windows"),
        ].join("\n")),
        "https://app.test/aa/main": textResponse(row("res:/main.red", "main/source")),
        "https://app.test/bb/windows": textResponse(row("res:/windows.red", "windows/source")),
    });
    const source = await createReader(fetch).Open({ provider: "test", build: "77" });

    assert.equal(
        source.Resolve("res:/windows.red").sourceUrl,
        "https://res.test/windows/source",
    );
    assert.throws(
        () => source.Resolve("res:/windows.red", { indexName: "main" }),
        /Resource file not found/u,
    );
});

test("reads app and explicitly selected res payloads as ArrayBuffers", async () =>
{
    const fetch = createFetch({
        "https://indexes.test/eveonline_77.txt": textResponse([
            row("app:/bin/file.bin", "app/file"),
            row("app:/resfileindex.txt", "aa/main"),
        ].join("\n")),
        "https://app.test/aa/main": textResponse(row("res:/data/file.bin", "res/file")),
        "https://app.test/app/file": binaryResponse("app-bytes"),
        "https://res.test/res/file": binaryResponse("res-bytes"),
    });
    const source = await createReader(fetch).Open({ provider: "test", build: "77" });
    const appBytes = Buffer.from(await source.Read("app:/bin/file.bin"));
    const resBytes = Buffer.from(await source.Read("res:/data/file.bin"));

    assert.equal(appBytes.toString("utf8"), "app-bytes");
    assert.equal(resBytes.toString("utf8"), "res-bytes");
});

function createReader(fetch)
{
    return new CjsToolIndex({
        providers: new CjsIndexProviderRegistry([ Provider ]),
        fetch,
        cache: null,
    });
}

function row(logicalPath, storagePath)
{
    return [ logicalPath, storagePath, "", "", "", "" ].join(",");
}

function textResponse(body)
{
    return { kind: "text", body };
}

function jsonResponse(value)
{
    return { kind: "json", body: JSON.stringify(value) };
}

function binaryResponse(body)
{
    return { kind: "binary", body: Buffer.from(body) };
}

function createFetch(responses, requests = [])
{
    return async (url) =>
    {
        requests.push(url);

        const response = responses[url];

        if (!response)
        {
            return {
                ok: false,
                status: 404,
            };
        }

        const buffer = response.kind === "binary"
            ? Buffer.from(response.body)
            : Buffer.from(response.body, "utf8");

        return {
            ok: true,
            status: 200,
            async text()
            {
                return buffer.toString("utf8");
            },
            async json()
            {
                return JSON.parse(buffer.toString("utf8"));
            },
            async arrayBuffer()
            {
                return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            },
        };
    };
}
