import assert from "node:assert/strict";
import test from "node:test";

import {
    CjsBoundedFetch,
    CjsBoundedFetchError,
} from "../src/internal/CjsBoundedFetch.js";

test("settles a deadline even when an injected fetch ignores cancellation", async () =>
{
    let signal;

    await assert.rejects(CjsBoundedFetch.request(
        async (_url, options) =>
        {
            signal = options.signal;

            return new Promise(() => undefined);
        },
        "https://example.invalid/never",
        {},
        { timeoutMs: 10, label: "Fixture request" },
    ), error => error instanceof CjsBoundedFetchError
        && error.code === "request_timeout");
    assert.equal(signal.aborted, true);
});

test("composes caller cancellation without reflecting its abort reason", async () =>
{
    const abortController = new AbortController();
    const operation = CjsBoundedFetch.request(
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
    await assert.rejects(operation, error => error instanceof CjsBoundedFetchError
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
        CjsBoundedFetch.readBytes(response, {
            maxBytes: 8,
            label: "Fixture response",
        }),
        error => error.code === "response_too_large",
    );
    assert.equal(read, false);
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
        CjsBoundedFetch.readBytes(response, {
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
        CjsBoundedFetch.readBytes(response, {
            maxBytes: 16,
            timeoutMs: 10,
            label: "Fixture response",
        }),
        error => error.code === "request_timeout",
    );
    assert.equal(cancelled, true);
});
