import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    CjsIndexCache,
    CjsIndexProviderRegistry,
    CjsToolIndex,
} from "../../src/index.js";

const Provider = Object.freeze({
    id: "test",
    defaultBuildRef: "latest",
    remote: Object.freeze({
        metadataBaseUrl: "https://metadata.test",
        indexBaseUrl: "https://indexes.test",
        appBaseUrl: "https://app.test",
        resBaseUrl: "https://res.test",
    }),
    clients: Object.freeze({
        live: Object.freeze({ metadataToken: "LIVE", aliases: Object.freeze([]) }),
    }),
});

test("matches wildcard and regex selections without duplicate prefetch downloads", async () =>
{
    const requests = [];
    const main = [
        row("res:/staticdata/a.bin", "aa/a"),
        row("res:/staticdata/b.bin", "aa/b"),
        row("res:/staticdata/readme.txt", "aa/readme"),
    ].join("\n");
    const fetch = createFetch({
        "https://indexes.test/eveonline_77.txt": textResponse([
            row("app:/resfileindex.txt", "aa/main"),
            row("app:/resfileindex_prefetch.txt", "bb/prefetch"),
        ].join("\n")),
        "https://app.test/aa/main": textResponse(main),
        "https://app.test/bb/prefetch": textResponse(row("res:/staticdata/a.bin", "aa/a")),
        "https://res.test/aa/a": binaryResponse("a"),
        "https://res.test/aa/b": binaryResponse("b"),
    }, requests);
    const source = await createService(fetch).Open({ provider: "test", build: "77" });
    const wildcard = source.Match("staticdata/*.bin");
    const regex = source.Match("^res:/staticdata/[ab]\\.bin$", { type: "regex" });
    const files = await source.FetchMatching("staticdata/*.bin", { concurrency: 2 });

    assert.deepEqual(wildcard.map((item) => item.logicalPath), [
        "res:/staticdata/a.bin",
        "res:/staticdata/b.bin",
    ]);
    assert.deepEqual(regex.map((item) => item.logicalPath), wildcard.map((item) => item.logicalPath));
    assert.deepEqual(files.map((item) => Buffer.from(item.bytes).toString("utf8")), [ "a", "b" ]);
    assert.equal(requests.filter((url) => url === "https://res.test/aa/a").length, 1);
});

test("reuses validated index and payload bytes from the local cache", async (context) =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-index-"));

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    const payload = Buffer.from("cached-payload");
    const mainText = row("res:/data/cached.bin", "aa/cached", payload);
    const appText = row("app:/resfileindex.txt", "aa/main", Buffer.from(mainText));
    const responses = {
        "https://indexes.test/eveonline_77.txt": textResponse(appText),
        "https://app.test/aa/main": textResponse(mainText),
        "https://res.test/aa/cached": binaryResponse(payload),
    };
    const firstRequests = [];
    const first = createService(
        createFetch(responses, firstRequests),
        new CjsIndexCache({ directory }),
    );
    const firstSource = await first.Open({ provider: "test", build: "77" });
    const ownedResolution = firstSource.Resolve("res:/data/cached.bin");

    await assert.rejects(
        () => firstSource.FetchResolution({
            ...ownedResolution,
            sourceUrl: "https://untrusted.test/payload",
        }),
        /does not belong to this source/u,
    );

    const firstFile = await firstSource.Fetch("res:/data/cached.bin");
    const secondRequests = [];
    const second = createService(
        createFetch(responses, secondRequests),
        new CjsIndexCache({ directory }),
    );
    const secondSource = await second.Open({ provider: "test", build: "77" });
    const secondFile = await secondSource.Fetch("res:/data/cached.bin");

    assert.deepEqual(firstRequests, [
        "https://indexes.test/eveonline_77.txt",
        "https://app.test/aa/main",
        "https://res.test/aa/cached",
    ]);
    assert.deepEqual(secondRequests, []);
    assert.equal(firstFile.cacheHit, false);
    assert.equal(secondSource.app.index.cacheHit, true);
    assert.equal(secondSource.res.index.cacheHit, true);
    assert.equal(secondFile.cacheHit, true);
    assert.equal(Buffer.from(secondFile.bytes).toString("utf8"), "cached-payload");
});

function createService(fetch, cache = null)
{
    return new CjsToolIndex({
        providers: new CjsIndexProviderRegistry([ Provider ]),
        fetch,
        cache,
    });
}

function row(logicalPath, storagePath, bytes = null)
{
    if (!bytes)
    {
        return [ logicalPath, storagePath, "", "", "", "" ].join(",");
    }

    const buffer = Buffer.from(bytes);
    const checksum = createHash("md5").update(buffer).digest("hex");

    return [ logicalPath, storagePath, checksum, buffer.byteLength, buffer.byteLength, "" ].join(",");
}

function textResponse(body)
{
    return { kind: "text", body };
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
            return { ok: false, status: 404 };
        }

        const buffer = response.kind === "binary"
            ? Buffer.from(response.body)
            : Buffer.from(response.body, "utf8");

        return {
            ok: true,
            status: 200,
            async arrayBuffer()
            {
                return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            },
        };
    };
}
