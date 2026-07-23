import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { WebSocket } from "ws";

import { REALTIME_SUBPROTOCOL } from "../../src/realtime/CjsRealtimeProtocol.js";
import { CjsRealtimeHub } from "../../src/realtime/server/CjsRealtimeHub.js";
import { CjsRealtimeHttpRouter } from "../../src/realtime/server/CjsRealtimeHttpRouter.js";
import { CjsRealtimeSessionAuthority } from "../../src/realtime/server/CjsRealtimeSessionAuthority.js";
import { CjsRealtimeWebSocketGateway } from "../../src/realtime/websocket/CjsRealtimeWebSocketGateway.js";
import { CjsToolServiceHost } from "../../src/service/CjsToolServiceHost.js";
import { CjsWebhookError } from "../../src/webhook/CjsWebhookError.js";
import { CjsWebhookHttpRouter } from "../../src/webhook/CjsWebhookHttpRouter.js";
import { CjsWebhookStreamService } from "../../src/webhook/CjsWebhookStreamService.js";

const TOPIC = "livestream.activity.subscription.received";

class CjsWebhookFixtureHandler
{

    constructor()
    {
        this.requests = [];
    }

    /** Authenticates one synthetic provider delivery against its raw bytes. */
    async AuthenticateWebhook(request)
    {
        this.requests.push(request);

        if (request.headers.authorization !== "Bearer provider-secret")
        {
            throw new CjsWebhookError(
                "unauthorized",
                "Webhook authentication failed",
                { statusCode: 401 },
            );
        }

        return Object.freeze({ provider: "synthetic" });
    }

    /** Maps one authenticated synthetic provider delivery. */
    async HandleWebhook(request)
    {
        assert.equal(request.authentication.provider, "synthetic");

        const data = JSON.parse(request.body.toString("utf8"));

        return {
            deliveryId: request.headers["x-delivery-id"],
            events: [ {
                topic: data.invalidTopic ? "livestream.unknown" : TOPIC,
                occurredAt: data.occurredAt,
                data: {
                    channel: data.channel,
                    subscriber: data.subscriber,
                    source: { provider: "synthetic" },
                },
            } ],
            response: {
                statusCode: 202,
                body: { accepted: true },
            },
        };
    }

}

class CjsWebhookFallback
{

    /** Handles one non-webhook route after the extension routers decline it. */
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

class CjsBlockingWebhookHandler
{

    constructor()
    {
        this.release = null;
        this.started = new Promise(resolve =>
        {
            this.markStarted = resolve;
        });
    }

    /** Explicitly accepts the synthetic request before blocking its mapping. */
    AuthenticateWebhook()
    {
        return null;
    }

    /** Holds one delivery until the concurrency-limit assertion completes. */
    HandleWebhook()
    {
        this.markStarted();

        return new Promise(resolve =>
        {
            this.release = () => resolve({ events: [] });
        });
    }

}

class CjsWebhookTestSupport
{

    /** Creates a composed webhook and realtime server with one stream service. */
    static async create({
        maxBodyBytes = 1024,
        maxConcurrentRequests = 64,
        handler = new CjsWebhookFixtureHandler(),
    } = {})
    {
        const origin = "http://127.0.0.1:8080";
        const capability = CjsRealtimeSessionAuthority.createCapability();
        const service = new CjsWebhookStreamService({
            id: "synthetic-webhook",
            family: "livestream.activity",
            familyVersion: 1,
            kind: "synthetic.webhook",
            topics: [ { name: TOPIC, recovery: "loss-tolerant" } ],
            handler,
        });
        const authority = new CjsRealtimeSessionAuthority({
            grants: [ {
                capability,
                actor: { id: "facade-one", kind: "application" },
                allowedOrigins: [ origin ],
                scopes: {
                    discover: true,
                    services: {
                        "synthetic-webhook": {
                            topics: [ TOPIC ],
                            commands: [],
                            snapshots: false,
                            content: false,
                        },
                    },
                },
            } ],
        });
        let nextId = 0;
        const hub = new CjsRealtimeHub({
            authority,
            createId: prefix => `${prefix}-${++nextId}`,
        });
        const realtimeRouter = new CjsRealtimeHttpRouter({
            hub,
            allowedOrigins: [ origin ],
        });
        const realtimeGateway = new CjsRealtimeWebSocketGateway({
            hub,
            allowedOrigins: [ origin ],
        });
        const webhookRouter = new CjsWebhookHttpRouter({
            endpoints: [ service ],
            maxBodyBytes,
            maxConcurrentRequests,
        });
        const host = new CjsToolServiceHost({
            hub,
            realtimeRouter,
            realtimeGateway,
            httpRouters: [ webhookRouter ],
            fallback: new CjsWebhookFallback(),
        });

        hub.Register(service);
        await host.Start();
        const server = host.CreateServer();

        await new Promise((resolve, reject) =>
        {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();

        return {
            origin,
            capability,
            handler,
            service,
            hub,
            host,
            server,
            httpRoot: `http://127.0.0.1:${address.port}`,
            webSocketUrl: `ws://127.0.0.1:${address.port}/v1/realtime`,
        };
    }

    /** Stops the composed host and closes its listener. */
    static async close(harness)
    {
        await harness.host.Stop();
        await new Promise(resolve => harness.server.close(resolve));
    }

    /** Receives and parses the next WebSocket application message. */
    static nextMessage(socket)
    {
        return new Promise((resolve, reject) =>
        {
            socket.once("message", data =>
            {
                resolve(JSON.parse(data.toString("utf8")));
            });
            socket.once("error", reject);
        });
    }

    /** Opens and authenticates one realtime WebSocket client. */
    static async connect(harness)
    {
        const socket = new WebSocket(harness.webSocketUrl, REALTIME_SUBPROTOCOL, {
            origin: harness.origin,
        });

        await once(socket, "open");
        const helloPromise = CjsWebhookTestSupport.nextMessage(socket);

        socket.send(JSON.stringify({
            type: "hello",
            protocolVersion: 1,
            capability: harness.capability,
            client: { id: "webhook-test", kind: "test" },
        }));
        await helloPromise;
        const subscribedPromise = CjsWebhookTestSupport.nextMessage(socket);

        socket.send(JSON.stringify({
            type: "subscribe",
            requestId: "subscribe-webhook",
            serviceId: "synthetic-webhook",
            topics: [ TOPIC ],
        }));
        await subscribedPromise;

        return socket;
    }

}

test("bridges authenticated webhook bytes into a future-only client stream", async context =>
{
    const harness = await CjsWebhookTestSupport.create();
    const socket = await CjsWebhookTestSupport.connect(harness);

    context.after(async () =>
    {
        socket.terminate();
        await CjsWebhookTestSupport.close(harness);
    });
    const body = JSON.stringify({
        channel: { id: "channel-one" },
        subscriber: { id: "viewer-one" },
        occurredAt: "2026-07-22T04:00:00.000Z",
    });
    const eventPromise = CjsWebhookTestSupport.nextMessage(socket);
    const response = await fetch(
        `${harness.httpRoot}/v1/webhooks/synthetic-webhook?tenant=primary`,
        {
            method: "POST",
            headers: {
                authorization: "Bearer provider-secret",
                "content-type": "application/json",
                "x-delivery-id": "delivery-one",
            },
            body,
        },
    );
    const event = await eventPromise;

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
    assert.equal(event.type, "event");
    assert.equal(event.topic, TOPIC);
    assert.equal(event.occurredAt, "2026-07-22T04:00:00.000Z");
    assert.deepEqual(event.actor, { id: "synthetic-webhook", kind: "service" });
    assert.deepEqual(event.payload.data, {
        channel: { id: "channel-one" },
        subscriber: { id: "viewer-one" },
        source: { provider: "synthetic" },
    });
    assert.equal(harness.handler.requests[0].body.toString("utf8"), body);
    assert.equal(harness.handler.requests[0].search, "?tenant=primary");
    assert.equal(harness.handler.requests[0].signal instanceof AbortSignal, true);
    assert.equal(JSON.stringify(event).includes("provider-secret"), false);
});

test("deduplicates provider retries and rejects delivery ID collisions", async context =>
{
    const harness = await CjsWebhookTestSupport.create();

    context.after(() => CjsWebhookTestSupport.close(harness));
    const headers = {
        authorization: "Bearer provider-secret",
        "content-type": "application/json",
        "x-delivery-id": "delivery-retry",
    };
    const firstBody = JSON.stringify({
        channel: { id: "channel-one" },
        subscriber: { id: "viewer-one" },
        occurredAt: "2026-07-22T04:00:00.000Z",
    });
    const first = await fetch(`${harness.httpRoot}/v1/webhooks/synthetic-webhook`, {
        method: "POST",
        headers,
        body: firstBody,
    });
    const retry = await fetch(`${harness.httpRoot}/v1/webhooks/synthetic-webhook`, {
        method: "POST",
        headers,
        body: firstBody,
    });

    assert.equal(first.status, 202);
    assert.equal(retry.status, 202);
    assert.equal(harness.hub.ListRuntimeServices()[0].cursor.sequence, 1);

    const collision = await fetch(`${harness.httpRoot}/v1/webhooks/synthetic-webhook`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            channel: { id: "channel-one" },
            subscriber: { id: "viewer-two" },
            occurredAt: "2026-07-22T04:00:00.000Z",
        }),
    });

    assert.equal(collision.status, 409);
    assert.equal((await collision.json()).error.code, "delivery_conflict");
    assert.equal(harness.hub.ListRuntimeServices()[0].cursor.sequence, 1);
});

test("rejects invalid ingress without publishing or bypassing the fallback", async context =>
{
    const harness = await CjsWebhookTestSupport.create({ maxBodyBytes: 64 });

    context.after(() => CjsWebhookTestSupport.close(harness));
    const unauthorized = await fetch(
        `${harness.httpRoot}/v1/webhooks/synthetic-webhook`,
        { method: "POST", body: "{}" },
    );

    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error.code, "unauthorized");

    const wrongMethod = await fetch(
        `${harness.httpRoot}/v1/webhooks/synthetic-webhook`,
    );

    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");

    const oversized = await fetch(
        `${harness.httpRoot}/v1/webhooks/synthetic-webhook`,
        {
            method: "POST",
            headers: {
                authorization: "Bearer provider-secret",
                "x-delivery-id": "delivery-large",
            },
            body: "x".repeat(65),
        },
    );

    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "body_too_large");

    const invalidEvent = await fetch(
        `${harness.httpRoot}/v1/webhooks/synthetic-webhook`,
        {
            method: "POST",
            headers: {
                authorization: "Bearer provider-secret",
                "content-type": "application/json",
                "x-delivery-id": "delivery-invalid",
            },
            body: JSON.stringify({
                invalidTopic: true,
                occurredAt: "2026-07-22T04:00:00.000Z",
            }),
        },
    );

    assert.equal(invalidEvent.status, 500);
    assert.equal((await invalidEvent.json()).error.code, "invalid_delivery");
    assert.equal(harness.hub.ListRuntimeServices()[0].cursor.sequence, 0);

    const fallback = await fetch(`${harness.httpRoot}/v1/health`);

    assert.equal(fallback.status, 200);
    assert.deepEqual(await fallback.json(), { path: "/v1/health" });
});

test("refuses new webhook deliveries outside the realtime service lifecycle", async () =>
{
    const handler = new CjsWebhookFixtureHandler();
    const service = new CjsWebhookStreamService({
        id: "stopped-webhook",
        family: "livestream.activity",
        kind: "synthetic.webhook",
        topics: [ TOPIC ],
        handler,
    });

    await assert.rejects(
        service.HandleWebhook({ headers: {}, body: Buffer.alloc(0) }),
        error => error.code === "service_unavailable" && error.statusCode === 503,
    );
});

test("requires an explicit provider authentication phase", () =>
{
    assert.throws(() => new CjsWebhookStreamService({
        id: "unsafe-webhook",
        family: "livestream.activity",
        kind: "synthetic.webhook",
        topics: [ TOPIC ],
        handler: { HandleWebhook: () => ({ events: [] }) },
    }), /AuthenticateWebhook/);
});

test("bounds provider verification work before it reaches the service lane", async context =>
{
    const handler = new CjsBlockingWebhookHandler();
    const service = new CjsWebhookStreamService({
        id: "bounded-webhook",
        family: "livestream.activity",
        kind: "synthetic.webhook",
        topics: [ TOPIC ],
        handler,
        maxConcurrentDeliveries: 1,
    });
    const authority = new CjsRealtimeSessionAuthority({ grants: [] });
    const hub = new CjsRealtimeHub({ authority });

    context.after(() => hub.Stop());
    hub.Register(service);
    await hub.Start();
    const first = service.HandleWebhook({ headers: {}, body: Buffer.alloc(0) });

    await handler.started;
    await assert.rejects(
        service.HandleWebhook({ headers: {}, body: Buffer.alloc(0) }),
        error => error.code === "delivery_limit_reached" && error.statusCode === 429,
    );
    handler.release();
    await first;
});

test("bounds aggregate HTTP body and handler admission before reading more requests", async context =>
{
    const handler = new CjsBlockingWebhookHandler();
    const harness = await CjsWebhookTestSupport.create({
        handler,
        maxConcurrentRequests: 1,
    });

    context.after(() => CjsWebhookTestSupport.close(harness));
    const first = fetch(`${harness.httpRoot}/v1/webhooks/synthetic-webhook`, {
        method: "POST",
        body: "first",
    });

    await handler.started;
    const rejected = await fetch(`${harness.httpRoot}/v1/webhooks/synthetic-webhook`, {
        method: "POST",
        body: "second",
    });

    assert.equal(rejected.status, 429);
    assert.equal((await rejected.json()).error.code, "request_limit_reached");
    handler.release();
    assert.equal((await first).status, 204);
});

test("validates exact endpoint paths without decoding separator aliases", () =>
{
    assert.deepEqual(
        CjsWebhookHttpRouter.matchEndpoint(
            "/v1/webhooks/synthetic-webhook?tenant=primary",
        ),
        {
            endpointId: "synthetic-webhook",
            pathname: "/v1/webhooks/synthetic-webhook",
            search: "?tenant=primary",
        },
    );
    assert.equal(
        CjsWebhookHttpRouter.matchEndpoint("/v1/webhooks/a/b"),
        null,
    );
    assert.equal(
        CjsWebhookHttpRouter.matchEndpoint("/v1/webhooks/a%2fb"),
        null,
    );
    assert.throws(
        () => CjsWebhookHttpRouter.matchEndpoint("/v1/webhooks/%2e%2e"),
        error => error.code === "invalid_path",
    );
});
