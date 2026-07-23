import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
    CjsRealtimeLivestreamContract,
    LIVESTREAM_ACTIVITY_FAMILY,
    LIVESTREAM_ACTIVITY_TOPICS,
    LIVESTREAM_STATE_FAMILY,
    LIVESTREAM_STATE_TOPICS,
} from "../../../src/realtime/livestream/index.js";

const fixtures = JSON.parse(await fs.readFile(new URL(
    "../../../docs/realtime-livestream-v1.fixtures.json",
    import.meta.url,
), "utf8"));

test("exports the exact provider-neutral livestream contract subpath", async () =>
{
    const livestream = await import("@carbonenginejs/tools-core/realtime/livestream");

    assert.equal(
        livestream.CjsRealtimeLivestreamContract,
        CjsRealtimeLivestreamContract,
    );
    assert.equal(LIVESTREAM_ACTIVITY_FAMILY, "livestream.activity");
    assert.equal(LIVESTREAM_STATE_FAMILY, "livestream.state");
    assert.equal(
        LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
        "livestream.activity.subscription.received",
    );
    assert.equal(LIVESTREAM_STATE_TOPICS.CHANGED, "livestream.state.changed");
});

test("validates equivalent Twitch and Kick activity fixtures", () =>
{
    assert.equal(fixtures.contractVersion, 1);

    const normalized = fixtures.activity.map(fixture => ({
        case: fixture.case,
        topic: fixture.topic,
        data: CjsRealtimeLivestreamContract.normalizeActivity(
            fixture.topic,
            fixture.data,
        ),
    }));

    assert.deepEqual(normalized, fixtures.activity);

    const subscriptions = normalized.filter(fixture =>
        fixture.topic === LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED);

    assert.deepEqual(
        subscriptions.map(fixture => fixture.data.source.provider).sort(),
        [ "kick", "twitch" ],
    );
    assert.ok(subscriptions.every(fixture => fixture.data.subscription.kind === "new"));
    assert.ok(subscriptions.every(fixture => Object.isFrozen(fixture.data)));
    assert.ok(subscriptions.every(fixture => Object.isFrozen(fixture.data.extensions)));
});

test("validates partial state changes and deterministic materialized snapshots", () =>
{
    const changes = fixtures.stateChanges.map(fixture => ({
        case: fixture.case,
        topic: fixture.topic,
        data: CjsRealtimeLivestreamContract.normalizeStateChange(fixture.data),
    }));

    assert.deepEqual(changes, fixtures.stateChanges);
    assert.ok(changes.every(fixture => fixture.topic === LIVESTREAM_STATE_TOPICS.CHANGED));

    const snapshot = CjsRealtimeLivestreamContract.normalizeStateSnapshot(
        fixtures.stateSnapshots[0].data,
    );

    assert.deepEqual(
        snapshot.states.map(state => state.source.provider),
        [ "kick", "twitch" ],
    );
    assert.ok(snapshot.states.every(state => Object.keys(state.stream).length === 9));
    assert.ok(Object.isFrozen(snapshot.states));
    assert.ok(Object.isFrozen(snapshot.states[0].stream));
});

test("rejects ambiguous activity and state payloads at the family boundary", () =>
{
    const subscription = structuredClone(fixtures.activity[0].data);

    subscription.actor = null;
    assert.throws(() => CjsRealtimeLivestreamContract.normalizeActivity(
        LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
        subscription,
    ), /actor/u);

    subscription.actor = structuredClone(fixtures.activity[0].data.actor);
    subscription.extensions = { kick: {} };
    assert.throws(() => CjsRealtimeLivestreamContract.normalizeActivity(
        LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
        subscription,
    ), /extensions\.twitch/u);

    const state = structuredClone(fixtures.stateChanges[0].data);

    state.changes = {};
    assert.throws(
        () => CjsRealtimeLivestreamContract.normalizeStateChange(state),
        /at least one field/u,
    );

    const snapshot = structuredClone(fixtures.stateSnapshots[0].data);

    snapshot.states.push(structuredClone(snapshot.states[0]));
    assert.throws(
        () => CjsRealtimeLivestreamContract.normalizeStateSnapshot(snapshot),
        /Duplicate livestream snapshot source/u,
    );
});
