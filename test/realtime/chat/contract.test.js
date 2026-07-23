import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
    CHAT_FAMILY,
    CHAT_TOPICS,
    CjsRealtimeChatContract,
} from "../../../src/realtime/chat/index.js";

const fixtures = JSON.parse(await fs.readFile(new URL(
    "../../../docs/protocols/chat-v1.fixtures.json",
    import.meta.url,
), "utf8"));

test("exports the provider-neutral chat contract subpath", async () =>
{
    const chat = await import("@carbonenginejs/tools-core/realtime/chat");

    assert.equal(chat.CjsRealtimeChatContract, CjsRealtimeChatContract);
    assert.equal(CHAT_FAMILY, "chat");
    assert.equal(CHAT_TOPICS.MESSAGE_RECEIVED, "chat.message.received");
    assert.equal(CHAT_TOPICS.STATUS_CHANGED, "chat.status.changed");
});

test("validates channel and hierarchical thread message fixtures", () =>
{
    assert.equal(fixtures.contractVersion, 1);

    const normalized = fixtures.messages.map(fixture => ({
        case: fixture.case,
        topic: fixture.topic,
        data: CjsRealtimeChatContract.normalizeMessage(fixture.data),
    }));

    assert.deepEqual(normalized, fixtures.messages);
    assert.ok(normalized.every(fixture =>
        fixture.topic === CHAT_TOPICS.MESSAGE_RECEIVED));
    assert.ok(normalized.every(fixture => Object.isFrozen(fixture.data)));
    assert.ok(normalized.every(fixture => Object.isFrozen(fixture.data.room)));
    assert.equal(normalized[1].data.room.space.id, "server-one");
    assert.equal(normalized[1].data.room.parentRoomId, "channel-one");
});

test("validates integration and room-scoped status fixtures", () =>
{
    const normalized = fixtures.statuses.map(fixture => ({
        case: fixture.case,
        topic: fixture.topic,
        data: CjsRealtimeChatContract.normalizeStatus(fixture.data),
    }));

    assert.deepEqual(normalized, fixtures.statuses);
    assert.ok(normalized.every(fixture =>
        fixture.topic === CHAT_TOPICS.STATUS_CHANGED));
    assert.equal(normalized[0].data.room, null);
    assert.equal(normalized[1].data.room.kind, "thread");
});

test("keys messages by complete provider integration and room identity", () =>
{
    const first = fixtures.messages[0].data.room;
    const second = {
        ...first,
        integrationId: "twitch-secondary",
    };

    assert.notEqual(
        CjsRealtimeChatContract.roomKey(first),
        CjsRealtimeChatContract.roomKey(second),
    );
    assert.equal(
        CjsRealtimeChatContract.roomKey(first),
        CjsRealtimeChatContract.roomKey(structuredClone(first)),
    );
});

test("rejects replay ambiguity and incomplete hierarchical identity", () =>
{
    const replay = structuredClone(fixtures.messages[0].data);

    replay.deliveryMode = "catchup";
    assert.throws(
        () => CjsRealtimeChatContract.normalizeMessage(replay),
        /deliveryMode/u,
    );

    const thread = structuredClone(fixtures.messages[1].data);

    thread.room.parentRoomId = null;
    assert.throws(
        () => CjsRealtimeChatContract.normalizeMessage(thread),
        /parentRoomId/u,
    );

    const wrongExtension = structuredClone(fixtures.messages[0].data);

    wrongExtension.extensions = { discord: {} };
    assert.throws(
        () => CjsRealtimeChatContract.normalizeMessage(wrongExtension),
        /extensions\.twitch/u,
    );

    const mismatchedStatus = structuredClone(fixtures.statuses[1].data);

    mismatchedStatus.room.integrationId = "discord-secondary";
    assert.throws(
        () => CjsRealtimeChatContract.normalizeStatus(mismatchedStatus),
        /belong to its source/u,
    );
});
