import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
    LIVESTREAM_ACTIVITY_TOPICS,
    LIVESTREAM_STATE_TOPICS,
} from "../../../src/realtime/livestream/CjsRealtimeLivestreamContract.js";
import { CjsKickActivityService } from "../../../src/integrations/kick/CjsKickActivityService.js";
import { CjsKickStateService } from "../../../src/integrations/kick/CjsKickStateService.js";
import { CjsKickWebhookHandler } from "../../../src/integrations/kick/CjsKickWebhookHandler.js";
import { CjsWebhookIngressSource } from "../../../src/webhook/CjsWebhookIngressSource.js";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
});

class CjsKickTestSupport
{

    /** Creates one stable ULID-like test identity. */
    static id(prefix, index)
    {
        return `${prefix}${String(index).padStart(23, "0")}`;
    }

    /** Creates an exact signed Kick webhook request. */
    static request({
        type,
        payload,
        index = 1,
        timestamp = "2026-07-23T06:00:00.000Z",
        receivedAt = "2026-07-23T06:00:01.000Z",
    })
    {
        const messageId = CjsKickTestSupport.id("01J", index);
        const subscriptionId = CjsKickTestSupport.id("01K", index);
        const body = Buffer.from(JSON.stringify(payload));
        const signed = Buffer.concat([
            Buffer.from(`${messageId}.${timestamp}.`),
            body,
        ]);
        const signature = crypto.sign("RSA-SHA256", signed, privateKey)
            .toString("base64");

        return Object.freeze({
            body,
            receivedAt,
            headers: Object.freeze({
                "kick-event-message-id": messageId,
                "kick-event-subscription-id": subscriptionId,
                "kick-event-signature": signature,
                "kick-event-message-timestamp": timestamp,
                "kick-event-type": type,
                "kick-event-version": "1",
            }),
        });
    }

    /** Creates a service context that records canonical events. */
    static context(messages)
    {
        const abortController = new AbortController();

        return {
            abortController,
            context: {
                signal: abortController.signal,
                Commit: callback => callback({
                    Publish: async (topic, data) => messages.push({ topic, data }),
                }),
            },
        };
    }

    /** Supplies one Kick broadcaster. */
    static broadcaster()
    {
        return {
            user_id: 100,
            username: "Carbon Actor",
            channel_slug: "carbon_actor",
            is_anonymous: false,
        };
    }

    /** Supplies one Kick user. */
    static user(id, username)
    {
        return {
            user_id: id,
            username,
            channel_slug: username.toLowerCase(),
            is_anonymous: false,
        };
    }

}

test("authenticates exact Kick bytes and publishes a canonical subscriber alert", async () =>
{
    const handler = new CjsKickWebhookHandler({ publicKey });
    const source = new CjsWebhookIngressSource({ id: "kick-main", handler });
    const service = new CjsKickActivityService({ id: "kick-activity", source });
    const messages = [];
    const harness = CjsKickTestSupport.context(messages);
    const request = CjsKickTestSupport.request({
        type: "channel.subscription.new",
        payload: {
            broadcaster: CjsKickTestSupport.broadcaster(),
            subscriber: CjsKickTestSupport.user(200, "NewViewer"),
            duration: 1,
            created_at: "2026-07-23T06:00:00.000Z",
            expires_at: "2026-08-23T06:00:00.000Z",
        },
    });

    await service.Start(harness.context);
    const response = await source.HandleWebhook(request);

    assert.equal(response.statusCode, 204);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].topic, LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED);
    assert.equal(messages[0].data.source.provider, "kick");
    assert.equal(messages[0].data.actor.id, "200");
    assert.equal(messages[0].data.subscription.kind, "new");
    assert.equal(messages[0].data.extensions.kick.duration, 1);
    assert.equal(JSON.stringify(messages[0]).includes("signature"), false);

    const tampered = Object.freeze({
        ...request,
        body: Buffer.from(`${request.body.toString("utf8")} `),
    });

    await assert.rejects(
        source.HandleWebhook(tampered),
        error => error.code === "unauthorized" && error.statusCode === 401,
    );
    await service.Stop();
});

test("fans a Kick gift batch into one batch and stable beneficiary alerts", async () =>
{
    const source = new CjsWebhookIngressSource({
        id: "kick-gifts",
        handler: new CjsKickWebhookHandler({ publicKey }),
    });
    const service = new CjsKickActivityService({ id: "kick-gift-activity", source });
    const messages = [];
    const harness = CjsKickTestSupport.context(messages);
    const request = CjsKickTestSupport.request({
        type: "channel.subscription.gifts",
        index: 2,
        payload: {
            broadcaster: CjsKickTestSupport.broadcaster(),
            gifter: CjsKickTestSupport.user(300, "Gifter"),
            giftees: [
                CjsKickTestSupport.user(301, "First"),
                CjsKickTestSupport.user(302, "Second"),
            ],
            created_at: "2026-07-23T06:00:00.000Z",
            expires_at: "2026-08-23T06:00:00.000Z",
        },
    });

    await service.Start(harness.context);
    await source.HandleWebhook(request);

    assert.deepEqual(messages.map(message => message.topic), [
        LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_GIFTED,
        LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
        LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
    ]);
    assert.equal(messages[0].data.gift.count, 2);
    assert.deepEqual(
        messages.slice(1).map(message => message.data.actor.id),
        [ "301", "302" ],
    );
    assert.ok(messages.slice(1).every(message =>
        message.data.subscription.giftedBy.id === "300"));

    await source.HandleWebhook(request);
    assert.equal(messages.length, 3);
    await service.Stop();
});

test("normalizes Kick stream status and rejects stale signed messages", () =>
{
    const handler = new CjsKickWebhookHandler({
        publicKey,
        maxMessageAgeMs: 60 * 1000,
    });
    const current = CjsKickTestSupport.request({
        type: "livestream.status.updated",
        index: 3,
        payload: {
            broadcaster: CjsKickTestSupport.broadcaster(),
            is_live: true,
            title: "Live now",
            started_at: "2026-07-23T06:00:00.000Z",
            ended_at: null,
        },
    });
    const authentication = handler.AuthenticateWebhook(current);
    const delivery = handler.HandleWebhook({ ...current, authentication });

    assert.equal(delivery.events[0].topic, LIVESTREAM_STATE_TOPICS.CHANGED);
    assert.equal(delivery.events[0].data.changes.online, true);
    assert.equal(delivery.events[0].data.changes.title, "Live now");

    const stale = CjsKickTestSupport.request({
        type: "channel.followed",
        index: 4,
        timestamp: "2026-07-23T05:00:00.000Z",
        receivedAt: "2026-07-23T06:00:01.000Z",
        payload: {
            broadcaster: CjsKickTestSupport.broadcaster(),
            follower: CjsKickTestSupport.user(400, "Follower"),
        },
    });

    assert.throws(
        () => handler.AuthenticateWebhook(stale),
        error => error.code === "unauthorized" && error.statusCode === 401,
    );
});

test("shares one Kick ingress across activity and gap-free state projections", async () =>
{
    const source = new CjsWebhookIngressSource({
        id: "kick-shared",
        handler: new CjsKickWebhookHandler({ publicKey }),
    });
    const activity = new CjsKickActivityService({ id: "kick-shared-activity", source });
    let releaseSnapshot;
    const snapshotGate = new Promise(resolve =>
    {
        releaseSnapshot = resolve;
    });
    const state = new CjsKickStateService({
        id: "kick-shared-state",
        source,
        readSnapshot: async () =>
        {
            await snapshotGate;

            return {
                observedAt: "2026-07-23T05:59:00.000Z",
                states: [ {
                    source: {
                        provider: "kick",
                        channelId: "100",
                        channelLogin: "carbon_actor",
                        channelDisplayName: "Carbon Actor",
                    },
                    stream: {
                        online: false,
                        streamId: null,
                        startedAt: null,
                        endedAt: null,
                        title: "Waiting",
                        language: "en",
                        mature: null,
                        category: null,
                        viewers: null,
                    },
                    extensions: { kick: { materializedFrom: "test" } },
                } ],
            };
        },
    });
    const activityMessages = [];
    const stateMessages = [];
    const activityContext = CjsKickTestSupport.context(activityMessages);
    const stateContext = CjsKickTestSupport.context(stateMessages);

    await activity.Start(activityContext.context);
    const stateStart = state.Start(stateContext.context);
    await new Promise(resolve => setImmediate(resolve));
    const delivery = source.HandleWebhook(CjsKickTestSupport.request({
        type: "livestream.status.updated",
        index: 5,
        payload: {
            broadcaster: CjsKickTestSupport.broadcaster(),
            is_live: true,
            title: "Live now",
            started_at: "2026-07-23T06:00:00.000Z",
            ended_at: null,
        },
    }));

    void releaseSnapshot();
    await stateStart;
    await delivery;

    assert.equal(stateMessages.length, 1);
    assert.equal((await state.GetSnapshot()).states[0].stream.online, true);
    assert.equal(activityMessages.length, 0);
    await state.Stop();
    await activity.Stop();
});

test("exports public Kick integration boundaries", async () =>
{
    const kick = await import("@carbonenginejs/tools-core/integrations/kick");

    assert.equal(typeof kick.KickActivityService, "function");
    assert.equal(typeof kick.KickStateService, "function");
    assert.equal(typeof kick.KickWebhookHandler, "function");
    assert.match(kick.KICK_WEBHOOK_PUBLIC_KEY, /BEGIN PUBLIC KEY/u);
    assert.doesNotThrow(() => new kick.KickWebhookHandler());
});
