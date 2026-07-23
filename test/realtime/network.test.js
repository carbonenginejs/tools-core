import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { WebSocket } from "ws";

import { REALTIME_SUBPROTOCOL } from "../../src/realtime/CjsRealtimeProtocol.js";
import { CjsRealtimeHttpRouter } from "../../src/realtime/server/CjsRealtimeHttpRouter.js";
import { CjsRealtimeWebSocketGateway } from "../../src/realtime/websocket/CjsRealtimeWebSocketGateway.js";
import { CjsRealtimeWebSocketTransport } from "../../src/realtime/websocket/CjsRealtimeWebSocketTransport.js";
import { CjsRealtimeServer } from "../../src/service/CjsRealtimeServer.js";
import { CjsToolServiceHost } from "../../src/service/CjsToolServiceHost.js";
import {
    CjsRealtimeSyntheticService,
    CjsRealtimeTestSupport,
} from "./CjsRealtimeTestSupport.js";

class CjsRealtimeFallback
{

    /** Handles a synthetic non-realtime route. */
    async Handle(request, response)
    {
        const body = Buffer.from(JSON.stringify({ path: request.url }));

        response.writeHead(200, {
            "content-type": "application/json",
            "content-length": String(body.byteLength),
        });
        response.end(body);
    }

}

class CjsRealtimeNetworkTest
{

    /** Creates a listening composed host around one synthetic hub. */
    static async create(options = {})
    {
        const harness = await CjsRealtimeTestSupport.createHarness({
            limits: {
                helloTimeoutMs: options.helloTimeoutMs ?? 50,
                heartbeatIntervalMs: options.heartbeatIntervalMs ?? 1000,
                idleTimeoutMs: options.idleTimeoutMs ?? 3000,
            },
        });
        const router = new CjsRealtimeHttpRouter({
            hub: harness.hub,
            allowedOrigins: [ harness.origin ],
        });
        const gateway = new CjsRealtimeWebSocketGateway({
            hub: harness.hub,
            allowedOrigins: [ harness.origin ],
        });
        const host = new CjsToolServiceHost({
            hub: harness.hub,
            realtimeRouter: router,
            realtimeGateway: gateway,
            fallback: new CjsRealtimeFallback(),
        });
        await host.Start();
        const server = host.CreateServer();

        await new Promise((resolve, reject) =>
        {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();

        return {
            ...harness,
            host,
            server,
            httpRoot: `http://127.0.0.1:${address.port}`,
            webSocketUrl: `ws://127.0.0.1:${address.port}/v1/realtime`,
        };
    }

    /** Stops a composed host and its HTTP listener. */
    static async close(network)
    {
        await network.host.Stop();
        await new Promise(resolve => network.server.close(resolve));
    }

    /** Receives and parses the next WebSocket application message. */
    static async nextMessage(socket)
    {
        let probe = CjsRealtimeNetworkTest.#probes.get(socket);

        if (!probe)
        {
            probe = { messages: [], waiters: [] };
            CjsRealtimeNetworkTest.#probes.set(socket, probe);
            socket.on("message", data =>
            {
                const message = JSON.parse(data.toString("utf8"));
                const resolve = probe.waiters.shift();

                if (resolve)
                {
                    resolve(message);
                }
                else
                {
                    probe.messages.push(message);
                }
            });
        }

        if (probe.messages.length)
        {
            return probe.messages.shift();
        }

        return new Promise(resolve => probe.waiters.push(resolve));
    }

    /** Resolves the HTTP status from a rejected WebSocket upgrade. */
    static rejectedStatus(socket)
    {
        return new Promise((resolve, reject) =>
        {
            socket.once("unexpected-response", (request, response) =>
            {
                response.resume();
                resolve(response.statusCode);
            });
            socket.once("error", reject);
        });
    }

    static #probes = new WeakMap();

}

test("owns a standalone realtime listener without changing the legacy launcher", async () =>
{
    const capability = "standalone-capability-value-00000001";
    const origin = "http://127.0.0.1:8080";
    const service = new CjsRealtimeSyntheticService();
    const realtime = new CjsRealtimeServer({
        services: [ service ],
        grants: [ {
            capability,
            actor: { id: "standalone-client", kind: "application" },
            allowedOrigins: [ origin ],
            scopes: {
                discover: true,
                services: {
                    "synthetic-main": {
                        topics: [ "synthetic.state.changed" ],
                        commands: [],
                        snapshots: true,
                        content: false,
                    },
                },
            },
        } ],
        allowedOrigins: [ origin ],
    });
    const address = await realtime.Listen();

    assert.equal(address.host, "127.0.0.1");
    assert.equal(service.startCount, 1);
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/realtime`, {
        headers: {
            origin,
            authorization: `Bearer ${capability}`,
        },
    });
    const discovery = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(discovery.services.map(entry => entry.id), [ "synthetic-main" ]);
    assert.equal(JSON.stringify(discovery).includes(capability), false);

    await realtime.Stop();
    assert.equal(service.stopCount, 1);
    assert.equal(realtime.Address(), null);
    await realtime.Stop();
});

test("serves authenticated discovery, snapshots, content, and fallback HTTP", async context =>
{
    const network = await CjsRealtimeNetworkTest.create();

    context.after(() => CjsRealtimeNetworkTest.close(network));
    const authorized = {
        origin: network.origin,
        authorization: `Bearer ${network.capability}`,
    };
    const discoveryResponse = await fetch(`${network.httpRoot}/v1/realtime`, {
        headers: authorized,
    });
    const discovery = await discoveryResponse.json();

    assert.equal(discoveryResponse.status, 200);
    assert.equal(discoveryResponse.headers.get("access-control-allow-origin"), network.origin);
    assert.equal(discoveryResponse.headers.get("vary"), "Origin");
    assert.equal(discoveryResponse.headers.get("cache-control"), "no-store");
    assert.equal(discovery.services[0].id, "synthetic-main");
    assert.equal(JSON.stringify(discovery).includes(network.capability), false);

    const unauthorized = await fetch(`${network.httpRoot}/v1/realtime`, {
        headers: { origin: network.origin },
    });

    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"),
        "Bearer realm=\"carbon-tools-realtime\"");

    const wrongOrigin = await fetch(`${network.httpRoot}/v1/realtime`, {
        headers: {
            origin: "http://127.0.0.1:8081",
            authorization: `Bearer ${network.capability}`,
        },
    });

    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.headers.has("access-control-allow-origin"), false);

    const preflight = await fetch(`${network.httpRoot}/v1/realtime`, {
        method: "OPTIONS",
        headers: {
            origin: network.origin,
            "access-control-request-method": "GET",
            "access-control-request-headers": "authorization",
        },
    });

    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization/u);

    const snapshot = await fetch(
        `${network.httpRoot}/v1/realtime/services/synthetic-main/snapshot`,
        { headers: authorized },
    );

    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.headers.get("cache-control"), "no-store");
    assert.deepEqual((await snapshot.json()).payload.data, { value: 0 });

    const resource = await fetch(
        `${network.httpRoot}/v1/realtime/services/synthetic-main/content/state.json?revision=value-0`,
        { headers: authorized },
    );

    assert.equal(resource.status, 200);
    assert.equal(resource.headers.get("cache-control"), "private, no-cache");
    assert.equal(resource.headers.get("etag"), "\"value-0\"");
    assert.deepEqual(await resource.json(), { value: 0 });

    const notModified = await fetch(
        `${network.httpRoot}/v1/realtime/services/synthetic-main/content/state.json?revision=value-0`,
        { headers: { ...authorized, "if-none-match": "\"value-0\"" } },
    );

    assert.equal(notModified.status, 304);

    const mismatch = await fetch(
        `${network.httpRoot}/v1/realtime/services/synthetic-main/content/state.json?revision=value-old`,
        { headers: authorized },
    );

    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.headers.get("cache-control"), "no-store");
    assert.equal((await mismatch.json()).error.code, "revision_mismatch");

    const fallback = await fetch(`${network.httpRoot}/v1/health`);

    assert.deepEqual(await fallback.json(), { path: "/v1/health" });

    const head = await fetch(
        `${network.httpRoot}/v1/realtime/services/synthetic-main/content/state.json?revision=value-0`,
        { method: "HEAD", headers: authorized },
    );

    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
});

test("releases a service-owned response body when ETag returns 304", async () =>
{
    let destroyed = false;
    let statusCode = null;
    const response = {
        writeHead(value)
        {
            statusCode = value;
        },
        end()
        {
            return undefined;
        },
    };

    await CjsRealtimeHttpRouter.writeResource(response, {
        method: "GET",
        headers: { "if-none-match": "\"revision-one\"" },
    }, {
        revision: "revision-one",
        etag: "\"revision-one\"",
        body: {
            destroy()
            {
                destroyed = true;
            },
        },
    });

    assert.equal(statusCode, 304);
    assert.equal(destroyed, true);
});

test("rejects raw traversal aliases, drive prefixes, and malformed content paths", () =>
{
    const cases = [
        "/v1/realtime/services/synthetic-main/content/foo/../secret?revision=r",
        "/v1/realtime/services/synthetic-main/content/foo/%2e%2e/secret?revision=r",
        "/v1/realtime/services/synthetic-main/content/C:/Windows/win.ini?revision=r",
        "/v1/realtime/services/synthetic-main/content/%ZZ?revision=r",
    ];

    for (const requestTarget of cases)
    {
        const url = new URL(requestTarget, "http://tools-core.local");

        assert.throws(
            () => CjsRealtimeHttpRouter.matchContent(url, requestTarget),
            error => [ "invalid_path", "invalid_request" ].includes(error.code),
            requestTarget,
        );
    }
});

test("upgrades the same route and carries authenticated duplex messages", async context =>
{
    const network = await CjsRealtimeNetworkTest.create();
    const socket = new WebSocket(network.webSocketUrl, REALTIME_SUBPROTOCOL, {
        origin: network.origin,
    });

    context.after(async () =>
    {
        socket.terminate();
        await CjsRealtimeNetworkTest.close(network);
    });
    await once(socket, "open");
    const helloPromise = CjsRealtimeNetworkTest.nextMessage(socket);

    socket.send(JSON.stringify({
        type: "hello",
        protocolVersion: 1,
        capability: network.capability,
        client: { id: "ws-test", kind: "test" },
    }));
    const hello = await helloPromise;

    assert.equal(hello.type, "hello");
    assert.equal(hello.protocol, "carbon.tools.realtime");
    assert.deepEqual(hello.actor, { id: "agent-one", kind: "agent" });
    assert.equal(JSON.stringify(hello).includes(network.capability), false);

    const subscribePromise = CjsRealtimeNetworkTest.nextMessage(socket);

    socket.send(JSON.stringify({
        type: "subscribe",
        requestId: "subscribe-ws",
        serviceId: "synthetic-main",
        topics: [ "synthetic.state.changed" ],
    }));
    const subscribed = await subscribePromise;

    assert.equal(subscribed.type, "result");
    assert.equal(subscribed.requestId, "subscribe-ws");

    const eventPromise = CjsRealtimeNetworkTest.nextMessage(socket);

    await network.service.Emit("synthetic.state.changed", { value: 9 });
    const event = await eventPromise;

    assert.equal(event.type, "event");
    assert.equal(event.subscriptionId, subscribed.data.subscriptionId);
    assert.deepEqual(event.payload.data, { value: 9 });

    const commandEventPromise = CjsRealtimeNetworkTest.nextMessage(socket);

    socket.send(JSON.stringify({
        type: "command",
        requestId: "command-ws",
        serviceId: "synthetic-main",
        action: "set",
        operationId: "operation-ws",
        data: { value: 10 },
    }));
    const commandEvent = await commandEventPromise;
    const commandResult = await CjsRealtimeNetworkTest.nextMessage(socket);

    assert.deepEqual(commandEvent.actor, { id: "agent-one", kind: "agent" });
    assert.deepEqual(commandResult.data, { value: 10 });
});

test("rejects invalid origins, missing subprotocols, and late hello", async context =>
{
    const network = await CjsRealtimeNetworkTest.create({ helloTimeoutMs: 25 });

    context.after(() => CjsRealtimeNetworkTest.close(network));
    const wrongOrigin = new WebSocket(network.webSocketUrl, REALTIME_SUBPROTOCOL, {
        origin: "http://127.0.0.1:8081",
    });
    const wrongOriginStatus = await CjsRealtimeNetworkTest.rejectedStatus(wrongOrigin);

    assert.equal(wrongOriginStatus, 403);

    const noProtocol = new WebSocket(network.webSocketUrl, { origin: network.origin });
    const noProtocolStatus = await CjsRealtimeNetworkTest.rejectedStatus(noProtocol);

    assert.equal(noProtocolStatus, 426);

    const late = new WebSocket(network.webSocketUrl, REALTIME_SUBPROTOCOL, {
        origin: network.origin,
    });

    await once(late, "open");
    const [ code, reason ] = await once(late, "close");

    assert.equal(code, 4408);
    assert.equal(reason.toString(), "hello_timeout");
});

test("heartbeat removes an idle revoked WebSocket session", async context =>
{
    const network = await CjsRealtimeNetworkTest.create({
        heartbeatIntervalMs: 15,
        idleTimeoutMs: 100,
    });
    const socket = new WebSocket(network.webSocketUrl, REALTIME_SUBPROTOCOL, {
        origin: network.origin,
    });

    context.after(() => CjsRealtimeNetworkTest.close(network));
    await once(socket, "open");
    const helloPromise = CjsRealtimeNetworkTest.nextMessage(socket);

    socket.send(JSON.stringify({
        type: "hello",
        protocolVersion: 1,
        capability: network.capability,
    }));
    await helloPromise;
    network.authority.RevokeCapability(network.capability);
    const [ code ] = await once(socket, "close");

    assert.equal(code, 1008);
});

test("checks WebSocket backpressure including the next message bytes", async () =>
{
    const closes = [];
    const socket = {
        readyState: WebSocket.OPEN,
        bufferedAmount: 4,
        send()
        {
            throw new Error("send should not be reached");
        },
        close(code, reason)
        {
            closes.push({ code, reason });
        },
    };
    const transport = new CjsRealtimeWebSocketTransport({
        socket,
        maxBufferedBytes: 5,
    });

    await assert.rejects(transport.Send("ab"), /consumer is too slow/u);
    assert.deepEqual(closes, [ { code: 4409, reason: "resync_required" } ]);
});
