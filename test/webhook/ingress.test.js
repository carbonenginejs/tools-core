import assert from "node:assert/strict";
import test from "node:test";

import { CjsWebhookIngressSource } from "../../src/webhook/CjsWebhookIngressSource.js";
import { CjsWebhookProjectionService } from "../../src/webhook/CjsWebhookProjectionService.js";

class CjsWebhookIngressTestHandler
{

    constructor()
    {
        this.authentications = 0;
        this.handles = 0;
    }

    /** Authenticates one synthetic shared delivery. */
    AuthenticateWebhook(request)
    {
        this.authentications++;
        assert.ok(request.signal instanceof AbortSignal);

        return Object.freeze({ provider: "synthetic" });
    }

    /** Maps one delivery across two service projections. */
    HandleWebhook(request)
    {
        this.handles++;
        assert.equal(request.authentication.provider, "synthetic");
        const value = JSON.parse(request.body.toString("utf8"));

        return {
            deliveryId: value.deliveryId,
            events: value.events,
            response: { statusCode: 202, body: { accepted: true } },
        };
    }

}

class CjsWebhookIngressTestSupport
{

    /** Creates a service context that records its publications. */
    static context(messages, { fail = null } = {})
    {
        const abortController = new AbortController();

        return {
            abortController,
            context: {
                signal: abortController.signal,
                Commit: callback => callback({
                    Publish: async (topic, data, options) =>
                    {
                        if (fail?.())
                        {
                            throw new Error("synthetic publication failure");
                        }

                        messages.push({ topic, data, options });
                    },
                }),
            },
        };
    }

    /** Creates one exact-byte synthetic request. */
    static request(value)
    {
        return Object.freeze({
            body: Buffer.from(JSON.stringify(value)),
            headers: Object.freeze({}),
            receivedAt: "2026-07-23T06:00:00.000Z",
        });
    }

}

test("routes one authenticated webhook delivery across static family projections", async () =>
{
    const handler = new CjsWebhookIngressTestHandler();
    const source = new CjsWebhookIngressSource({ id: "provider-main", handler });
    const activityMessages = [];
    const stateMessages = [];
    const activityContext = CjsWebhookIngressTestSupport.context(activityMessages);
    const stateContext = CjsWebhookIngressTestSupport.context(stateMessages);
    const activity = new CjsWebhookProjectionService({
        id: "provider-activity",
        family: "synthetic.activity",
        familyVersion: 1,
        kind: "synthetic.webhook",
        topics: [ "synthetic.activity.received" ],
        source,
    });
    const state = new CjsWebhookProjectionService({
        id: "provider-state",
        family: "synthetic.state",
        familyVersion: 1,
        kind: "synthetic.webhook",
        topics: [ "synthetic.state.changed" ],
        source,
    });

    await activity.Start(activityContext.context);
    await state.Start(stateContext.context);
    assert.throws(() => source.Register({
        id: "too-late",
        topics: [ "synthetic.late" ],
    }), /sealed/u);

    const request = CjsWebhookIngressTestSupport.request({
        deliveryId: "delivery-one",
        events: [
            {
                topic: "synthetic.activity.received",
                occurredAt: "2026-07-23T06:00:00.000Z",
                data: { value: "activity" },
            },
            {
                topic: "synthetic.state.changed",
                occurredAt: "2026-07-23T06:00:01.000Z",
                data: { value: "state" },
            },
        ],
    });
    const first = await source.HandleWebhook(request);
    const retry = await source.HandleWebhook(request);

    assert.equal(first.statusCode, 202);
    assert.deepEqual(retry, first);
    assert.equal(handler.authentications, 2);
    assert.equal(handler.handles, 2);
    assert.deepEqual(activityMessages.map(message => message.data.value), [ "activity" ]);
    assert.deepEqual(stateMessages.map(message => message.data.value), [ "state" ]);

    await state.Stop();
    await assert.rejects(
        source.HandleWebhook(CjsWebhookIngressTestSupport.request({
            deliveryId: "delivery-two",
            events: [ {
                topic: "synthetic.state.changed",
                data: { value: "unavailable" },
            } ],
        })),
        error => error.code === "service_unavailable" && error.retryable === true,
    );
    await activity.Stop();
});

test("resumes a partial multi-family retry without republishing completed steps", async () =>
{
    const source = new CjsWebhookIngressSource({
        id: "provider-partial",
        handler: new CjsWebhookIngressTestHandler(),
    });
    const activityMessages = [];
    const stateMessages = [];
    let shouldFail = true;
    const activityContext = CjsWebhookIngressTestSupport.context(activityMessages);
    const stateContext = CjsWebhookIngressTestSupport.context(stateMessages, {
        fail: () =>
        {
            if (!shouldFail)
            {
                return false;
            }

            shouldFail = false;

            return true;
        },
    });
    const activity = new CjsWebhookProjectionService({
        id: "partial-activity",
        family: "synthetic.activity",
        kind: "synthetic.webhook",
        topics: [ "synthetic.activity.received" ],
        source,
    });
    const state = new CjsWebhookProjectionService({
        id: "partial-state",
        family: "synthetic.state",
        kind: "synthetic.webhook",
        topics: [ "synthetic.state.changed" ],
        source,
    });
    const request = CjsWebhookIngressTestSupport.request({
        deliveryId: "partial-one",
        events: [
            { topic: "synthetic.activity.received", data: { value: "activity" } },
            { topic: "synthetic.state.changed", data: { value: "state" } },
        ],
    });

    await activity.Start(activityContext.context);
    await state.Start(stateContext.context);
    await assert.rejects(source.HandleWebhook(request), /synthetic publication failure/u);
    await source.HandleWebhook(request);

    assert.deepEqual(activityMessages.map(message => message.data.value), [ "activity" ]);
    assert.deepEqual(stateMessages.map(message => message.data.value), [ "state" ]);
    await state.Stop();
    await activity.Stop();
});

test("exports shared ingress and projection classes through the webhook subpath", async () =>
{
    const webhook = await import("@carbonenginejs/tools-core/webhook");

    assert.equal(webhook.CjsWebhookIngressSource, CjsWebhookIngressSource);
    assert.equal(webhook.CjsWebhookProjectionService, CjsWebhookProjectionService);
});
