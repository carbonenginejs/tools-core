import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolRealtimeError } from "../../src/realtime/CjsToolRealtimeError.js";
import {
    CjsToolRealtimeProtocol,
    REALTIME_PROTOCOL_VERSION,
    REALTIME_SUBPROTOCOL,
} from "../../src/realtime/CjsToolRealtimeProtocol.js";
import { CjsToolRealtimeSessionAuthority } from "../../src/realtime/server/CjsToolRealtimeSessionAuthority.js";

test("exports the realtime slice through exact package subpaths", async () =>
{
    const protocol = await import("@carbonenginejs/tools-core/realtime");
    const server = await import("@carbonenginejs/tools-core/realtime/server");
    const websocket = await import("@carbonenginejs/tools-core/realtime/websocket");
    const service = await import("@carbonenginejs/tools-core/service");

    assert.equal(typeof protocol.CjsToolRealtimeProtocol, "function");
    assert.equal(typeof server.CjsToolRealtimeHub, "function");
    assert.equal(typeof websocket.CjsToolRealtimeGatewayWebsocket, "function");
    assert.equal(typeof service.CjsToolServiceHost, "function");
    assert.equal(typeof service.CjsToolRealtimeServer, "function");
});

test("normalizes the versioned client message boundary", () =>
{
    assert.equal(REALTIME_PROTOCOL_VERSION, 1);
    assert.equal(REALTIME_SUBPROTOCOL, "carbon.tools.realtime.v1");
    assert.deepEqual(CjsToolRealtimeProtocol.normalizeClientMessage({
        type: "subscribe",
        requestId: "request-1",
        serviceId: "primary-chat",
        topics: [ "chat.message.received" ],
    }, { authenticated: true }), {
        type: "subscribe",
        requestId: "request-1",
        serviceId: "primary-chat",
        topics: [ "chat.message.received" ],
    });
    assert.deepEqual(CjsToolRealtimeProtocol.normalizeClientMessage({
        type: "subscribe-targeted",
        requestId: "request-2",
        serviceId: "primary-chat",
        topics: [ "chat.message.received" ],
        target: {
            room: {
                provider: "twitch",
                login: "fenriscreations",
            },
        },
    }, { authenticated: true }), {
        type: "subscribe",
        requestId: "request-2",
        serviceId: "primary-chat",
        topics: [ "chat.message.received" ],
        target: {
            room: {
                provider: "twitch",
                login: "fenriscreations",
            },
        },
    });
    assert.throws(() => CjsToolRealtimeProtocol.normalizeClientMessage({
        type: "subscribe-targeted",
        requestId: "request-3",
        serviceId: "primary-chat",
        topics: [ "chat.message.received" ],
    }, { authenticated: true }), error => error.code === "invalid_request");

    assert.throws(() => CjsToolRealtimeProtocol.normalizeClientMessage({
        type: "subscribe",
        requestId: "request-1",
        serviceId: "primary-chat",
        topics: [ "chat.message.received" ],
    }), error => error instanceof CjsToolRealtimeError
        && error.code === "hello_required"
        && error.closeCode === 1002);
});

test("rejects malformed, oversized, cyclic, and excessively deep JSON", () =>
{
    assert.throws(
        () => CjsToolRealtimeProtocol.parseText("{"),
        error => error.code === "invalid_json" && error.closeCode === 1002,
    );
    assert.throws(
        () => CjsToolRealtimeProtocol.parseText(JSON.stringify({ value: "12345" }), {
            maxBytes: 5,
        }),
        error => error.code === "message_too_large" && error.closeCode === 1009,
    );
    const cyclic = {};

    cyclic.self = cyclic;
    assert.throws(
        () => CjsToolRealtimeProtocol.validateJson(cyclic),
        error => error.code === "invalid_request",
    );
    assert.throws(
        () => CjsToolRealtimeProtocol.validateJson({ one: { two: true } }, { maxDepth: 1 }),
        error => error.code === "invalid_request",
    );
});

test("creates deterministic operation fingerprints", () =>
{
    assert.equal(
        CjsToolRealtimeProtocol.canonicalStringify({ b: 2, a: { d: 4, c: 3 } }),
        CjsToolRealtimeProtocol.canonicalStringify({ a: { c: 3, d: 4 }, b: 2 }),
    );
    const prototypeKey = JSON.parse("{\"__proto__\":{\"value\":1}}");

    assert.notEqual(
        CjsToolRealtimeProtocol.canonicalStringify(prototypeKey),
        CjsToolRealtimeProtocol.canonicalStringify({}),
    );
    assert.throws(
        () => CjsToolRealtimeProtocol.validateJson(new Date()),
        error => error.code === "invalid_request",
    );
});

test("authenticates exact scoped origins without retaining token authority in clients", () =>
{
    const capability = CjsToolRealtimeSessionAuthority.createCapability();
    const authority = new CjsToolRealtimeSessionAuthority({
        grants: [ {
            capability,
            actor: { id: "agent-one", kind: "agent" },
            allowedOrigins: [ "http://127.0.0.1:8080" ],
            scopes: {
                discover: true,
                services: {
                    "primary-chat": {
                        topics: [ "chat.message.received" ],
                        commands: [],
                        snapshots: false,
                        content: false,
                    },
                },
            },
        } ],
    });
    const session = authority.Authenticate(capability, {
        origin: "http://127.0.0.1:8080",
    });

    assert.deepEqual(session.actor, { id: "agent-one", kind: "agent" });
    assert.doesNotThrow(() => authority.AuthorizeTopics(
        session,
        "primary-chat",
        [ "chat.message.received" ],
    ));
    assert.throws(
        () => authority.Authenticate(capability, { origin: "http://127.0.0.1:8081" }),
        error => error.code === "unauthorized" && error.closeCode === 1008,
    );
    assert.throws(
        () => authority.Authenticate("not-the-capability", {
            origin: "http://127.0.0.1:8080",
        }),
        error => error.code === "unauthorized",
    );
    assert.deepEqual(
        authority.FilterServices(session, [ { id: "constructor" }, { id: "primary-chat" } ]),
        [ { id: "primary-chat" } ],
    );

    authority.AddGrant({
        capability,
        actor: { id: "agent-two", kind: "agent" },
        allowedOrigins: [ "http://127.0.0.1:8080" ],
        scopes: { discover: false, services: {} },
    });
    assert.throws(
        () => authority.ValidateSession(session),
        error => error.code === "unauthorized",
    );
    assert.deepEqual(authority.Authenticate(capability, {
        origin: "http://127.0.0.1:8080",
    }).actor, { id: "agent-two", kind: "agent" });
});

test("requires snapshots for snapshot-recovery topics", () =>
{
    assert.throws(() => CjsToolRealtimeProtocol.normalizeServiceDescription({
        family: "synthetic.state",
        familyVersion: 1,
        kind: "synthetic.memory",
        id: "synthetic-main",
        topics: [ { name: "synthetic.state.changed", recovery: "snapshot" } ],
        snapshot: false,
    }), /require service snapshot support/u);
    const targeted = CjsToolRealtimeProtocol.normalizeServiceDescription({
        family: "chat",
        familyVersion: 1,
        kind: "twitch.irc",
        id: "primary-chat",
        topics: [ "chat.message.received" ],
        subscriptions: {
            multiple: true,
            target: "chat.room",
        },
    });

    assert.deepEqual(targeted.subscriptions, {
        multiple: true,
        target: "chat.room",
    });
});

test("sanitizes hostile protocol error metadata", () =>
{
    const details = { value: 1n };
    const error = new CjsToolRealtimeError("Invalid Code", "bad\nmessage", {
        details,
        closeCode: 999,
        statusCode: 999,
    });
    const message = error.ToMessage("request-1");

    assert.equal(error.code, "internal_error");
    assert.equal(error.closeCode, 1011);
    assert.equal(error.statusCode, 500);
    assert.equal(message.message, "bad message");
    assert.equal(Object.hasOwn(message, "details"), false);
    assert.doesNotThrow(() => JSON.stringify(message));
});
