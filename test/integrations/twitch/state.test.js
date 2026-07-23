import assert from "node:assert/strict";
import test from "node:test";

import {
    CjsRealtimeLivestreamContract,
    LIVESTREAM_STATE_TOPICS,
} from "../../../src/realtime/livestream/CjsRealtimeLivestreamContract.js";
import { CjsRealtimeTwitchStateNormalizer } from "../../../src/integrations/twitch/CjsRealtimeTwitchStateNormalizer.js";
import { CjsRealtimeTwitchStateService } from "../../../src/integrations/twitch/CjsRealtimeTwitchStateService.js";
import { CjsTwitchEventSubStateProvider } from "../../../src/integrations/twitch/CjsTwitchEventSubStateProvider.js";
import { CjsTwitchStateSource } from "../../../src/integrations/twitch/CjsTwitchStateSource.js";

class CjsStateTestEventSubSource
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

    /** Delivers one raw notification. */
    Notify(id, message)
    {
        this.attachments.get(id).onNotification(message);
    }

}

class CjsStateTestProvider
{

    constructor(snapshot)
    {
        this.kind = "twitch.eventsub";
        this.snapshot = snapshot;
        this.callbacks = null;
        this.readGate = null;
        this.readRelease = null;
        this.starts = 0;
        this.stops = 0;
    }

    /** Starts one synthetic state provider. */
    async Start(callbacks)
    {
        this.starts++;
        this.callbacks = callbacks;
    }

    /** Reads the configured snapshot after an optional test gate. */
    async ReadSnapshot()
    {
        await this.readGate;

        return this.snapshot;
    }

    /** Stops one synthetic state provider. */
    async Stop()
    {
        this.stops++;
        this.callbacks = null;
    }

    /** Blocks initial state so a notification can race it. */
    BlockRead()
    {
        this.readGate = new Promise(resolve =>
        {
            this.readRelease = resolve;
        });
    }

    /** Releases a blocked initial state read. */
    ReleaseRead()
    {
        this.readRelease();
        this.readGate = null;
        this.readRelease = null;
    }

    /** Emits one canonical state change. */
    Emit(change)
    {
        this.callbacks.onChange(change);
    }

}

class CjsStateTestSupport
{

    /** Creates one EventSub WebSocket notification fixture. */
    static notification(type, version, event, id = `notification-${type}`)
    {
        return {
            metadata: {
                message_id: id,
                message_type: "notification",
                message_timestamp: "2026-07-23T05:00:00.000Z",
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

    /** Supplies the common Twitch broadcaster fields. */
    static broadcaster(id = "100")
    {
        return {
            broadcaster_user_id: id,
            broadcaster_user_login: `room_${id}`,
            broadcaster_user_name: `Room ${id}`,
        };
    }

    /** Creates one complete offline state snapshot. */
    static snapshot(ids = [ "100" ])
    {
        return CjsRealtimeLivestreamContract.normalizeStateSnapshot({
            observedAt: "2026-07-23T04:59:00.000Z",
            states: ids.map(id => ({
                source: {
                    provider: "twitch",
                    channelId: id,
                    channelLogin: `room_${id}`,
                    channelDisplayName: `Room ${id}`,
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
                extensions: { twitch: { materializedFrom: "test" } },
            })),
        });
    }

    /** Creates a service context that records publications. */
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

    /** Lets admitted promise continuations settle. */
    static settle()
    {
        return new Promise(resolve => setImmediate(resolve));
    }

}

test("normalizes Twitch online, offline, and metadata state patches", () =>
{
    const broadcaster = CjsStateTestSupport.broadcaster();
    const fixtures = [
        {
            type: "stream.online",
            version: "1",
            event: {
                ...broadcaster,
                id: "stream-one",
                type: "live",
                started_at: "2026-07-23T05:00:00.000Z",
            },
            assert: changes => assert.deepEqual(changes, {
                online: true,
                streamId: "stream-one",
                startedAt: "2026-07-23T05:00:00.000Z",
                endedAt: null,
            }),
        },
        {
            type: "stream.offline",
            version: "1",
            event: broadcaster,
            assert: changes => assert.deepEqual(changes, {
                online: false,
                streamId: null,
                endedAt: "2026-07-23T05:00:00.000Z",
                viewers: null,
            }),
        },
        {
            type: "channel.update",
            version: "2",
            event: {
                ...broadcaster,
                title: "Updated",
                language: "en",
                category_id: "509658",
                category_name: "Just Chatting",
                content_classification_labels: [ "MatureGame" ],
            },
            assert: changes => assert.deepEqual(changes, {
                title: "Updated",
                language: "en",
                category: { id: "509658", name: "Just Chatting" },
            }),
        },
    ];

    for (const fixture of fixtures)
    {
        const change = CjsRealtimeTwitchStateNormalizer.fromEventSub(
            CjsStateTestSupport.notification(
                fixture.type,
                fixture.version,
                fixture.event,
            ),
        );

        assert.equal(change.topic, LIVESTREAM_STATE_TOPICS.CHANGED);
        assert.equal(change.data.source.provider, "twitch");
        assert.ok(Object.isFrozen(change.data));
        fixture.assert(change.data.changes);
    }
});

test("registers Twitch state once and seeds complete bounded Helix state", async () =>
{
    const source = new CjsStateTestEventSubSource();
    const requests = [];
    const helix = {
        Request: async (route, options) =>
        {
            requests.push({ route, options });
            const data = route === "streams" ? [ {
                id: "stream-one",
                user_id: "100",
                user_login: "room_100",
                user_name: "Room 100",
                game_id: "509658",
                game_name: "Just Chatting",
                title: "Live now",
                language: "en",
                viewer_count: 42,
                started_at: "2026-07-23T05:00:00.000Z",
                is_mature: false,
            } ] : [ {
                broadcaster_id: "100",
                broadcaster_login: "room_100",
                broadcaster_name: "Room 100",
                game_id: "509658",
                game_name: "Just Chatting",
                title: "Live now",
                broadcaster_language: "en",
            } ];

            return {
                status: 200,
                json: async () => ({ data }),
            };
        },
    };
    const provider = new CjsTwitchEventSubStateProvider({
        source,
        helix,
        registrationId: "state-main",
        rooms: [ { id: "200" }, { id: "100" } ],
        clock: () => Date.parse("2026-07-23T05:01:00.000Z"),
    });
    const declaration = source.declarations[0];

    assert.deepEqual(declaration.requiredScopes, []);
    assert.equal(declaration.subscriptions.length, 6);
    assert.deepEqual(declaration.subscriptions[0], {
        type: "channel.update",
        version: "2",
        condition: { broadcaster_user_id: "100" },
    });

    const snapshot = await provider.ReadSnapshot(new AbortController().signal);

    assert.deepEqual(requests.map(request => request.route), [ "streams", "channels" ]);
    assert.deepEqual(requests[0].options.query.user_id, [ "100", "200" ]);
    assert.deepEqual(snapshot.states.map(state => state.source.channelId), [ "100", "200" ]);
    assert.equal(snapshot.states[0].stream.online, true);
    assert.equal(snapshot.states[0].stream.viewers, 42);
    assert.equal(snapshot.states[1].stream.online, false);
});

test("queues early state behind its seed and shares exact snapshot projections", async () =>
{
    const provider = new CjsStateTestProvider(CjsStateTestSupport.snapshot([ "100", "200" ]));
    const source = new CjsTwitchStateSource({ provider });
    const aggregateMessages = [];
    const exactMessages = [];
    const aggregateContext = CjsStateTestSupport.context(aggregateMessages);
    const exactContext = CjsStateTestSupport.context(exactMessages);
    const aggregate = new CjsRealtimeTwitchStateService({
        id: "twitch-state-all",
        source,
    });
    const exact = new CjsRealtimeTwitchStateService({
        id: "twitch-state-room-100",
        source,
        room: { id: "100" },
    });
    const online = CjsRealtimeTwitchStateNormalizer.fromEventSub(
        CjsStateTestSupport.notification(
            "stream.online",
            "1",
            {
                ...CjsStateTestSupport.broadcaster("100"),
                id: "stream-one",
                type: "live",
                started_at: "2026-07-23T05:00:00.000Z",
            },
            "online-one",
        ),
    );

    provider.BlockRead();
    const aggregateStart = aggregate.Start(aggregateContext.context);

    await CjsStateTestSupport.settle();
    provider.Emit(online);
    provider.ReleaseRead();
    await aggregateStart;
    await exact.Start(exactContext.context);
    await CjsStateTestSupport.settle();

    assert.equal(provider.starts, 1);
    assert.equal(aggregateMessages.length, 1);
    assert.equal(exactMessages.length, 0);
    assert.equal((await aggregate.GetSnapshot()).states[0].stream.online, true);
    assert.equal((await exact.GetSnapshot()).states[0].stream.online, true);

    provider.Emit(online);
    await CjsStateTestSupport.settle();
    assert.equal(aggregateMessages.length, 1);
    assert.equal(exactMessages.length, 0);

    const offline = CjsRealtimeTwitchStateNormalizer.fromEventSub(
        CjsStateTestSupport.notification(
            "stream.offline",
            "1",
            CjsStateTestSupport.broadcaster("100"),
            "offline-one",
        ),
    );

    provider.Emit(offline);
    await CjsStateTestSupport.settle();
    assert.equal(aggregateMessages.length, 2);
    assert.equal(exactMessages.length, 1);
    assert.equal((await exact.GetSnapshot()).states[0].stream.online, false);

    await exact.Stop();
    assert.equal(provider.stops, 0);
    await aggregate.Stop();
    assert.equal(provider.stops, 1);
});

test("exports public Twitch state boundaries", async () =>
{
    const twitch = await import("@carbonenginejs/tools-core/integrations/twitch");

    for (const name of [
        "TwitchEventSubStateProvider",
        "TwitchStateNormalizer",
        "TwitchStateService",
        "TwitchStateSource",
    ])
    {
        assert.equal(typeof twitch[name], "function");
    }
});
