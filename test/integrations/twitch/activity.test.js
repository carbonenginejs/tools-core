import assert from "node:assert/strict";
import test from "node:test";

import {
    LIVESTREAM_ACTIVITY_TOPICS,
} from "../../../src/realtime/livestream/CjsRealtimeLivestreamContract.js";
import { CjsRealtimeTwitchActivityNormalizer } from "../../../src/integrations/twitch/CjsRealtimeTwitchActivityNormalizer.js";
import { CjsRealtimeTwitchActivityService } from "../../../src/integrations/twitch/CjsRealtimeTwitchActivityService.js";
import { CjsTwitchActivitySource } from "../../../src/integrations/twitch/CjsTwitchActivitySource.js";
import { CjsTwitchEventSubActivityProvider } from "../../../src/integrations/twitch/CjsTwitchEventSubActivityProvider.js";

class CjsActivityTestEventSubSource
{

    constructor()
    {
        this.attachments = new Map();
        this.declarations = [];
        this.detached = [];
    }

    /** Captures one static family declaration. */
    Register(declaration)
    {
        this.declarations.push(declaration);
    }

    /** Captures callbacks for one attached declaration. */
    async Attach(id, callbacks)
    {
        this.attachments.set(id, callbacks);
    }

    /** Captures one detached declaration. */
    async Detach(id)
    {
        this.detached.push(id);
        this.attachments.delete(id);
    }

    /** Delivers one raw notification to an attached declaration. */
    Notify(id, message)
    {
        this.attachments.get(id).onNotification(message);
    }

}

class CjsActivityTestProvider
{

    constructor(topics)
    {
        this.kind = "twitch.eventsub";
        this.topics = topics;
        this.starts = 0;
        this.stops = 0;
        this.callbacks = null;
    }

    /** Starts one synthetic provider. */
    async Start(callbacks)
    {
        this.starts++;
        this.callbacks = callbacks;
    }

    /** Stops one synthetic provider. */
    async Stop()
    {
        this.stops++;
        this.callbacks = null;
    }

    /** Emits one canonical activity into the source. */
    Emit(activity)
    {
        this.callbacks.onActivity(activity);
    }

}

class CjsActivityTestSupport
{

    /** Creates one EventSub WebSocket notification fixture. */
    static notification(type, version, event, id = `notification-${type}`)
    {
        return {
            metadata: {
                message_id: id,
                message_type: "notification",
                message_timestamp: "2026-07-23T04:00:00.000Z",
                subscription_type: type,
                subscription_version: version,
            },
            payload: {
                subscription: {
                    id: `subscription-${type}`,
                    type,
                    version,
                },
                event,
            },
        };
    }

    /** Supplies the common destination broadcaster fields. */
    static broadcaster(id = "100")
    {
        return {
            broadcaster_user_id: id,
            broadcaster_user_login: `room_${id}`,
            broadcaster_user_name: `Room ${id}`,
        };
    }

    /** Supplies common Twitch user fields. */
    static user(id = "200")
    {
        return {
            user_id: id,
            user_login: `user_${id}`,
            user_name: `User ${id}`,
        };
    }

    /** Creates a service context that records published activity. */
    static context(messages)
    {
        const abortController = new AbortController();

        return {
            abortController,
            context: {
                signal: abortController.signal,
                Commit: callback => callback({
                    Publish: async (topic, data) =>
                    {
                        messages.push({ topic, data });
                    },
                }),
            },
        };
    }

    /** Lets admitted promise continuations settle. */
    static settle()
    {
        return new Promise(resolve => setImmediate(resolve));
    }

}

test("normalizes supported Twitch EventSub activity families", () =>
{
    const broadcaster = CjsActivityTestSupport.broadcaster();
    const user = CjsActivityTestSupport.user();
    const fixtures = [
        {
            type: "channel.subscribe",
            version: "1",
            event: { ...broadcaster, ...user, tier: "1000", is_gift: false },
            topic: LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
            assert: data => assert.equal(data.subscription.kind, "new"),
        },
        {
            type: "channel.subscription.message",
            version: "1",
            event: {
                ...broadcaster,
                ...user,
                tier: "2000",
                cumulative_months: 4,
                duration_months: 2,
                message: { text: "still here" },
            },
            topic: LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
            assert: data => assert.equal(data.subscription.kind, "renewal"),
        },
        {
            type: "channel.subscription.gift",
            version: "1",
            event: {
                ...broadcaster,
                ...user,
                total: 5,
                tier: "1000",
                cumulative_total: 12,
                is_anonymous: false,
            },
            topic: LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_GIFTED,
            assert: data => assert.equal(data.gift.count, 5),
        },
        {
            type: "channel.follow",
            version: "2",
            event: {
                ...broadcaster,
                ...user,
                followed_at: "2026-07-23T03:59:00.000Z",
            },
            topic: LIVESTREAM_ACTIVITY_TOPICS.FOLLOW_RECEIVED,
            assert: data => assert.equal(data.occurredAt, "2026-07-23T03:59:00.000Z"),
        },
        {
            type: "channel.raid",
            version: "1",
            event: {
                from_broadcaster_user_id: "300",
                from_broadcaster_user_login: "raider",
                from_broadcaster_user_name: "Raider",
                to_broadcaster_user_id: "100",
                to_broadcaster_user_login: "room_100",
                to_broadcaster_user_name: "Room 100",
                viewers: 42,
            },
            topic: LIVESTREAM_ACTIVITY_TOPICS.RAID_RECEIVED,
            assert: data => assert.equal(data.raid.viewers, 42),
        },
        {
            type: "channel.cheer",
            version: "1",
            event: {
                ...broadcaster,
                ...user,
                bits: 100,
                message: "nice",
                is_anonymous: false,
            },
            topic: LIVESTREAM_ACTIVITY_TOPICS.CONTRIBUTION_RECEIVED,
            assert: data => assert.equal(data.contribution.unit, "bits"),
        },
        {
            type: "channel.channel_points_custom_reward_redemption.add",
            version: "1",
            event: {
                ...broadcaster,
                ...user,
                id: "redemption-one",
                redeemed_at: "2026-07-23T03:58:00.000Z",
                status: "unfulfilled",
                user_input: "please",
                reward: { id: "reward-one", title: "Wave", cost: 500 },
            },
            topic: LIVESTREAM_ACTIVITY_TOPICS.REWARD_REDEEMED,
            assert: data => assert.equal(data.reward.status, "pending"),
        },
    ];

    for (const fixture of fixtures)
    {
        const activity = CjsRealtimeTwitchActivityNormalizer.fromEventSub(
            CjsActivityTestSupport.notification(
                fixture.type,
                fixture.version,
                fixture.event,
            ),
        );

        assert.equal(activity.topic, fixture.topic);
        assert.equal(activity.data.source.provider, "twitch");
        assert.equal(activity.data.deliveryMode, "live");
        assert.ok(Object.isFrozen(activity.data));
        fixture.assert(activity.data);
    }
});

test("registers selected activity topics once over the shared EventSub source", async () =>
{
    const source = new CjsActivityTestEventSubSource();
    const activities = [];
    const provider = new CjsTwitchEventSubActivityProvider({
        source,
        registrationId: "alerts",
        rooms: [ { id: "200" }, { id: "100" } ],
        topics: [
            LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
            LIVESTREAM_ACTIVITY_TOPICS.FOLLOW_RECEIVED,
        ],
        clock: () => Date.parse("2026-07-23T04:00:00.000Z"),
    });
    const declaration = source.declarations[0];

    assert.deepEqual(declaration.requiredScopes, [
        "channel:read:subscriptions",
        "moderator:read:followers",
    ]);
    assert.equal(declaration.subscriptions.length, 6);
    assert.deepEqual(
        declaration.subscriptions[0].condition({ userId: "moderator-one" }),
        {
            broadcaster_user_id: "100",
            moderator_user_id: "moderator-one",
        },
    );

    const abortController = new AbortController();

    await provider.Start({
        signal: abortController.signal,
        onActivity: activity => activities.push(activity),
        onStatus: () => undefined,
    });
    source.Notify("alerts", CjsActivityTestSupport.notification(
        "channel.follow",
        "2",
        {
            ...CjsActivityTestSupport.broadcaster("100"),
            ...CjsActivityTestSupport.user("201"),
            followed_at: "2026-07-23T04:00:00.000Z",
        },
    ));

    assert.equal(activities.length, 1);
    assert.equal(activities[0].topic, LIVESTREAM_ACTIVITY_TOPICS.FOLLOW_RECEIVED);
    await provider.Stop();
    assert.deepEqual(source.detached, [ "alerts" ]);
});

test("shares one activity provider across aggregate and exact room services", async () =>
{
    const topic = LIVESTREAM_ACTIVITY_TOPICS.FOLLOW_RECEIVED;
    const provider = new CjsActivityTestProvider([ topic ]);
    const source = new CjsTwitchActivitySource({ provider });
    const aggregateMessages = [];
    const exactMessages = [];
    const aggregateContext = CjsActivityTestSupport.context(aggregateMessages);
    const exactContext = CjsActivityTestSupport.context(exactMessages);
    const aggregate = new CjsRealtimeTwitchActivityService({
        id: "twitch-activity-all",
        source,
    });
    const exact = new CjsRealtimeTwitchActivityService({
        id: "twitch-activity-room-100",
        source,
        room: { id: "100" },
    });

    await Promise.all([
        aggregate.Start(aggregateContext.context),
        exact.Start(exactContext.context),
    ]);
    assert.equal(provider.starts, 1);

    for (const roomId of [ "100", "200" ])
    {
        provider.Emit({
            topic,
            data: CjsRealtimeTwitchActivityNormalizer.fromEventSub(
                CjsActivityTestSupport.notification(
                    "channel.follow",
                    "2",
                    {
                        ...CjsActivityTestSupport.broadcaster(roomId),
                        ...CjsActivityTestSupport.user(`3${roomId}`),
                        followed_at: "2026-07-23T04:00:00.000Z",
                    },
                    `follow-${roomId}`,
                ),
            ).data,
        });
    }
    await CjsActivityTestSupport.settle();

    assert.deepEqual(
        aggregateMessages.map(message => message.data.source.channelId),
        [ "100", "200" ],
    );
    assert.deepEqual(
        exactMessages.map(message => message.data.source.channelId),
        [ "100" ],
    );

    await exact.Stop();
    assert.equal(provider.stops, 0);
    await aggregate.Stop();
    assert.equal(provider.stops, 1);
});

test("exports public Twitch activity boundaries", async () =>
{
    const twitch = await import("@carbonenginejs/tools-core/integrations/twitch");

    for (const name of [
        "TwitchActivityNormalizer",
        "TwitchActivityService",
        "TwitchActivitySource",
        "TwitchEventSubActivityProvider",
    ])
    {
        assert.equal(typeof twitch[name], "function");
    }
});
