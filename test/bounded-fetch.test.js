import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";

import {
    CjsToolBoundedFetch,
    CjsToolBoundedFetchError,
} from "../src/internal/CjsToolBoundedFetch.js";

test("settles a deadline even when an injected fetch ignores cancellation", async () =>
{
    let signal;

    await assert.rejects(CjsToolBoundedFetch.request(
        async (_url, options) =>
        {
            signal = options.signal;

            return new Promise(() => undefined);
        },
        "https://example.invalid/never",
        {},
        { timeoutMs: 10, label: "Fixture request" },
    ), error => error instanceof CjsToolBoundedFetchError
        && error.code === "request_timeout");
    assert.equal(signal.aborted, true);
});

test("composes caller cancellation without reflecting its abort reason", async () =>
{
    const abortController = new AbortController();
    const operation = CjsToolBoundedFetch.request(
        async () => new Promise(() => undefined),
        "https://example.invalid/cancel",
        {},
        {
            timeoutMs: 1000,
            signal: abortController.signal,
            label: "Fixture request",
        },
    );

    abortController.abort(new Error("private abort reason"));
    await assert.rejects(operation, error => error instanceof CjsToolBoundedFetchError
        && error.code === "request_aborted"
        && !error.message.includes("private abort reason"));
});

test("rejects declared oversized responses before reading their body", async () =>
{
    let read = false;
    const response = {
        headers: new Headers({ "content-length": "9" }),
        get body()
        {
            read = true;

            return new ReadableStream({
                start(controller)
                {
                    controller.enqueue(Buffer.from("oversized"));
                    controller.close();
                },
            });
        },
    };

    await assert.rejects(
        CjsToolBoundedFetch.readBytes(response, {
            maxBytes: 8,
            label: "Fixture response",
        }),
        error => error.code === "response_too_large",
    );
    assert.equal(read, false);
});

test("bounds Fetch's decoded gzip body instead of its encoded Content-Length", async context =>
{
    const payload = Buffer.from("small material");
    const encoded = gzipSync(payload);
    assert.ok(encoded.byteLength > payload.byteLength);
    const server = createServer((_request, response) =>
    {
        response.writeHead(200, {
            "content-encoding": "gzip",
            "content-length": encoded.byteLength,
        });
        response.end(encoded);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/material`;

    const response = await fetch(url);
    assert.equal(Number(response.headers.get("content-length")), encoded.byteLength);
    assert.deepEqual(await CjsToolBoundedFetch.readBytes(response, {
        maxBytes: payload.byteLength,
    }), payload);
    await assert.rejects(CjsToolBoundedFetch.readBytes(await fetch(url), {
        maxBytes: payload.byteLength - 1,
    }), error => error.code === "response_too_large");
});

test("encoded JSON adapter headers do not replace decoded size enforcement", async () =>
{
    const response = {
        headers: { "content-encoding": "gzip", "content-length": "22" },
        json: async () => ({}),
    };
    assert.deepEqual(await CjsToolBoundedFetch.readJson(response, { maxBytes: 2 }), {});
    await assert.rejects(CjsToolBoundedFetch.readJson(response, { maxBytes: 1 }),
        error => error.code === "response_too_large");
});

test("cancels an undeclared streaming body as soon as its byte limit is crossed", async () =>
{
    let cancelled = false;
    const response = {
        body: new ReadableStream({
            start(controller)
            {
                controller.enqueue(Buffer.from("1234"));
                controller.enqueue(Buffer.from("5678"));
            },
            cancel()
            {
                cancelled = true;
            },
        }),
    };

    await assert.rejects(
        CjsToolBoundedFetch.readBytes(response, {
            maxBytes: 6,
            label: "Fixture response",
        }),
        error => error.code === "response_too_large",
    );
    assert.equal(cancelled, true);
});

test("cancels a streaming response body when its read deadline expires", async () =>
{
    let cancelled = false;
    const response = {
        body: new ReadableStream({
            cancel()
            {
                cancelled = true;
            },
        }),
    };

    await assert.rejects(
        CjsToolBoundedFetch.readBytes(response, {
            maxBytes: 16,
            timeoutMs: 10,
            label: "Fixture response",
        }),
        error => error.code === "request_timeout",
    );
    assert.equal(cancelled, true);
});
