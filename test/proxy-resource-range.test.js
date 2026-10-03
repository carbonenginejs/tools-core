import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { resFileAddress } from "@carbonenginejs/runtime/utils/resfile";
import { CjsToolHttpProxy } from "../src/proxy/index.js";

const build = "3552227";
const resourcePath = "texture/header.dds";
// A nonzero byteOffset catches accidental slicing of the backing allocation.
const bytes = Buffer.alloc(1042, 255).subarray(9, 1033);

for (let index = 0; index < bytes.length; index++)
{
    bytes[index] = index % 251;
}

bytes.write("DDS ");
const checksum = createHash("md5").update(bytes).digest("hex");
const etag = `"${checksum}"`;
const address = resFileAddress(`res:/${resourcePath}`, checksum);
const encoded = gzipSync(bytes);
const routes = [
    `/eve/${build}/res/${resourcePath}`,
    `/eve/${build}/app/${resourcePath}`,
    `/eve/${build}/resources/${resourcePath}`,
    `/resfiles/${address}`,
    `/appfiles/${address}`,
];

/** Starts an isolated loopback HTTP server with synthetic resource acquisition. */
async function Start(context, options = {})
{
    const calls = [];
    const payload = options.bytes ?? bytes;
    const source = {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build,
        Match()
        {
            return [ { logicalPath: `res:/${resourcePath}` } ];
        },
        async Fetch(logicalPath, fetchOptions)
        {
            calls.push({ logicalPath, options: fetchOptions });

            if (logicalPath.endsWith("missing.dds"))
            {
                const error = new Error("Synthetic resource is missing");

                error.statusCode = 404;
                throw error;
            }

            return {
                bytes: payload,
                resolution: {
                    target: "eve",
                    game: "Eve",
                    provider: "ccp",
                    build,
                    logicalPath,
                    artifactKind: "hash-safe",
                    overlay: "synthetic",
                    storageKind: "persistent-overlay",
                    record: { checksum, location: address },
                },
            };
        },
    };
    const indexes = {
        async Open()
        {
            return source;
        },
        async ResolveTargetBuild()
        {
            return { target: "eve", game: "Eve", provider: "ccp", build };
        },
        async OpenTarget()
        {
            return source;
        },
        async ReadPayloadByAddress(asked)
        {
            return asked === address ? { bytes: payload, store: "cache" } : null;
        },
        async ReadCompressedPayloadByAddress(asked)
        {
            return asked === address ? { bytes: encoded, store: "cache", encoded: true } : null;
        },
    };
    const server = new CjsToolHttpProxy({
        indexes,
        addressedRedirects: options.addressedRedirects ?? false,
    }).CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    return { origin: `http://127.0.0.1:${server.address().port}`, calls };
}

/** Reads the wire bytes without fetch's automatic gzip decoding. */
async function ReadRaw(url, headers)
{
    return new Promise((resolve, reject) =>
    {
        const outgoing = request(url, { headers }, response =>
        {
            const chunks = [];

            response.on("data", chunk => chunks.push(chunk));
            response.on("error", reject);
            response.on("end", () => resolve({
                status: response.statusCode,
                headers: response.headers,
                bytes: Buffer.concat(chunks),
            }));
        });

        outgoing.on("error", reject);
        outgoing.end();
    });
}

test("resource routes serve exact bounded, open and suffix ranges and ordinary GETs", async context =>
{
    const { origin } = await Start(context);
    const cases = [
        [ "bytes=0-147", 0, 147 ],
        [ "bytes=999-", 999, 1023 ],
        [ "bytes=-25", 999, 1023 ],
        [ "bytes=1023-1023", 1023, 1023 ],
        [ "bytes=1000-9999", 1000, 1023 ],
        [ "bytes=-9999", 0, 1023 ],
        [ "BYTES=1-3", 1, 3 ],
    ];

    for (const route of routes)
    {
        const complete = await fetch(origin + route);

        assert.equal(complete.status, 200, route);
        assert.equal(complete.headers.get("accept-ranges"), "bytes");
        assert.equal(complete.headers.get("content-range"), null);
        assert.equal(complete.headers.get("content-length"), "1024");
        assert.deepEqual(Buffer.from(await complete.arrayBuffer()), bytes);

        for (const [ range, first, last ] of cases)
        {
            const response = await fetch(origin + route, { headers: { range } });

            assert.equal(response.status, 206, `${route} ${range}`);
            assert.equal(response.headers.get("content-range"), `bytes ${first}-${last}/1024`);
            assert.equal(response.headers.get("content-length"), String(last - first + 1));
            assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(first, last + 1));

            for (const name of [ "accept-ranges", "etag", "cache-control", "content-type",
                "x-carbon-target", "x-carbon-game", "x-carbon-provider", "x-carbon-build",
                "x-carbon-logical-path", "x-carbon-resfile", "x-carbon-artifact-kind",
                "x-carbon-overlay", "x-carbon-storage-kind", "x-carbon-payload-store" ])
            {
                assert.equal(response.headers.get(name), complete.headers.get(name), name);
            }
        }
    }
});

test("resource routes reject malformed, multiple and unsatisfiable byte ranges", async context =>
{
    const { origin } = await Start(context);
    const cases = [
        "bytes=1024-", "bytes=7-3", "bytes=-0", "bytes=-", "bytes=abc",
        "bytes=0-1,4-5", "bytes=0-1,2000-3000", "bytes=1.5-3",
        "bytes=9007199254740992-", "bytes=0-9007199254740992",
    ];

    for (const route of routes)
    {
        for (const range of cases)
        {
            const response = await fetch(origin + route, { headers: { range } });

            assert.equal(response.status, 416, `${route} ${range}`);
            assert.equal(response.headers.get("content-range"), "bytes */1024");
            assert.equal(response.headers.get("cache-control"), "no-store");
            assert.match(response.headers.get("content-type"), /^application\/json/u);
            assert.match((await response.json()).error, /byte range is not satisfiable/u);
        }
    }
});

test("conditional GET precedes ranges and If-Range requires a matching strong ETag", async context =>
{
    const { origin } = await Start(context);

    for (const route of routes)
    {
        for (const range of [ "bytes=0-147", "bytes=9999-" ])
        {
            const unchanged = await fetch(origin + route, {
                headers: { range, "if-none-match": `W/${etag}` },
            });

            assert.equal(unchanged.status, 304);
            assert.equal(unchanged.headers.get("etag"), etag);
            assert.equal(unchanged.headers.get("content-range"), null);
            assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
        }

        const partial = await fetch(origin + route, {
            headers: { range: "bytes=0-147", "if-range": etag },
        });

        assert.equal(partial.status, 206);
        assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(0, 148));

        for (const validator of [ '"stale"', `W/${etag}`, "Wed, 21 Oct 2015 07:28:00 GMT" ])
        {
            // A stale validator ignores even an otherwise unsatisfiable range.
            const complete = await fetch(origin + route, {
                headers: { range: "bytes=9999-", "if-range": validator },
            });

            assert.equal(complete.status, 200);
            assert.equal(complete.headers.get("content-range"), null);
            assert.deepEqual(Buffer.from(await complete.arrayBuffer()), bytes);
        }
    }
});

test("empty resources, ArrayBuffers, unknown units and existing HEAD behavior", async context =>
{
    const { origin } = await Start(context, {
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    const empty = await Start(context, { bytes: Buffer.alloc(0) });

    for (const route of routes)
    {
        const partial = await fetch(origin + route, { headers: { range: "bytes=3-5" } });

        assert.equal(partial.status, 206);
        assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(3, 6));
        const complete = await fetch(origin + route, { headers: { range: "items=0-1" } });

        assert.equal(complete.status, 200);
        assert.deepEqual(Buffer.from(await complete.arrayBuffer()), bytes);
        const head = await fetch(origin + route, { method: "HEAD", headers: { range: "bytes=9999-" } });

        assert.equal(head.status, route.startsWith("/eve/") ? 404 : 200);
        assert.equal((await head.arrayBuffer()).byteLength, 0);

        if (head.status === 200)
        {
            assert.equal(head.headers.get("content-length"), "1024");
            assert.equal(head.headers.get("accept-ranges"), "bytes");
            assert.equal(head.headers.get("content-range"), null);
        }

        const noBytes = await fetch(empty.origin + route);

        assert.equal(noBytes.status, 200);
        assert.equal(noBytes.headers.get("content-length"), "0");
        assert.equal((await noBytes.arrayBuffer()).byteLength, 0);

        for (const range of [ "bytes=0-", "bytes=-1" ])
        {
            const response = await fetch(empty.origin + route, { headers: { range } });

            assert.equal(response.status, 416);
            assert.equal(response.headers.get("content-range"), "bytes */0");
            await response.arrayBuffer();
        }
    }
});

test("ranges preserve refresh, JSON directories, source errors and CORS behavior", async context =>
{
    const { origin, calls } = await Start(context);
    const refreshed = await fetch(`${origin}${routes[0]}?refresh=true&index=secondary`, {
        headers: { range: "bytes=0-147" },
    });

    assert.equal(refreshed.status, 206);
    assert.equal(refreshed.headers.get("cache-control"), "no-store");
    assert.equal(refreshed.headers.get("etag"), null);
    assert.equal((await refreshed.arrayBuffer()).byteLength, 148);
    assert.deepEqual(calls[0].options, { refresh: true, indexName: "secondary" });

    const noValidator = await fetch(`${origin}${routes[0]}?refresh=true`, {
        headers: { range: "bytes=0-147", "if-range": etag },
    });

    assert.equal(noValidator.status, 200);
    assert.equal((await noValidator.arrayBuffer()).byteLength, 1024);
    const directory = await fetch(`${origin}/eve/${build}/resources/texture`, {
        headers: { range: "bytes=9999-" },
    });

    assert.equal(directory.status, 200);
    assert.equal(directory.headers.get("content-range"), null);
    assert.equal((await directory.json()).type, "directory");

    for (const [ route, status ] of [
        [ `/eve/${build}/res/missing.dds`, 404 ],
        [ `/resfiles/${address.replace(checksum, "0".repeat(32))}`, 404 ],
        [ `${routes[0]}?format=json`, 415 ],
        [ `${routes[0]}?format=invalid`, 400 ],
    ])
    {
        const response = await fetch(origin + route, { headers: { range: "bytes=9999-" } });

        assert.equal(response.status, status);
        assert.equal(response.headers.get("content-range"), null);
        await response.arrayBuffer();
    }

    const metadata = await fetch(`${origin}/eve/${build}/resource/${resourcePath}`, {
        headers: { range: "bytes=9999-" },
    });

    assert.equal(metadata.status, 200);
    assert.equal(metadata.headers.get("content-range"), null);
    assert.equal((await metadata.json()).type, "file");

    const preflight = await fetch(origin + routes[0], { method: "OPTIONS" });

    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers"), /If-Range/u);
    assert.match(refreshed.headers.get("access-control-expose-headers"), /Content-Range/u);
});

test("range redirects retain raw offsets while ordinary GET still selects gzip", async context =>
{
    const { origin } = await Start(context, { addressedRedirects: true });
    const headers = { "accept-encoding": "gzip", range: "bytes=0-147" };
    const redirect = await fetch(origin + routes[0], { headers, redirect: "manual" });

    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), `/resfiles/${address}`);
    assert.equal(redirect.headers.get("vary"), "accept-encoding, range");
    await redirect.arrayBuffer();
    const followed = await fetch(origin + routes[0], { headers });

    assert.equal(followed.status, 206);
    assert.equal(followed.headers.get("content-encoding"), null);
    assert.equal(followed.headers.get("content-range"), "bytes 0-147/1024");
    assert.deepEqual(Buffer.from(await followed.arrayBuffer()), bytes.subarray(0, 148));
    const normal = await fetch(origin + routes[0], {
        headers: { "accept-encoding": "gzip" }, redirect: "manual",
    });

    assert.equal(normal.status, 302);
    assert.equal(normal.headers.get("location"), `/resfiles/${address}.gz`);
    assert.equal(normal.headers.get("vary"), "accept-encoding, range");
    await normal.arrayBuffer();
});

test("explicit gzip addresses range over encoded bytes and keep representation validators", async context =>
{
    const { origin } = await Start(context);
    const url = `${origin}/resfiles/${address}.gz`;
    const complete = await ReadRaw(url, {});

    assert.equal(complete.status, 200);
    assert.equal(complete.headers["content-encoding"], "gzip");
    assert.equal(complete.headers.etag, `"${checksum}-gz"`);
    assert.deepEqual(complete.bytes, encoded);
    const partial = await ReadRaw(url, { range: "bytes=1-10", "if-range": complete.headers.etag });

    assert.equal(partial.status, 206);
    assert.equal(partial.headers["content-range"], `bytes 1-10/${encoded.length}`);
    assert.equal(partial.headers["content-encoding"], "gzip");
    assert.equal(partial.headers["content-length"], "10");
    assert.equal(partial.headers.etag, complete.headers.etag);
    assert.deepEqual(partial.bytes, encoded.subarray(1, 11));
    const differentRepresentation = await ReadRaw(url, { range: "bytes=1-10", "if-range": etag });

    assert.equal(differentRepresentation.status, 200);
    assert.deepEqual(differentRepresentation.bytes, encoded);
});
