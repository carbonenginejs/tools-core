import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
    CHAT_FAMILY,
    CHAT_TOPICS,
    CjsRealtimeChatBlockList,
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
    assert.equal(chat.CjsRealtimeChatBlockList, CjsRealtimeChatBlockList);
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

test("selects provider rooms by hierarchy and stable id or login", () =>
{
    const twitchRoom = fixtures.messages[0].data.room;
    const selector = CjsRealtimeChatContract.normalizeRoomSelector({
        provider: "twitch",
        integrationId: twitchRoom.integrationId,
        kind: "channel",
        login: twitchRoom.login.toUpperCase(),
    });

    assert.equal(
        CjsRealtimeChatContract.matchesRoomSelector(selector, twitchRoom),
        true,
    );
    assert.equal(
        CjsRealtimeChatContract.matchesRoomSelector({
            provider: "twitch",
            integrationId: "twitch-secondary",
            id: twitchRoom.id,
        }, twitchRoom),
        false,
    );
    assert.throws(
        () => CjsRealtimeChatContract.normalizeRoomSelector({
            provider: "twitch",
        }),
        /requires id or login/u,
    );
});

test("preserves animated emote formats and hosted visual media", () =>
{
    const message = structuredClone(fixtures.messages[0].data);

    message.room.assets = {
        icon: {
            id: "room-icon",
            url: "https://example.test/room-icon.png",
            contentType: "image/png",
            animated: false,
        },
    };
    message.fragments = [
        {
            type: "emote",
            text: "Wave",
            emote: {
                id: "emote-one",
                setId: "set-one",
                ownerId: "owner-one",
                formats: [ "static", "animated" ],
                asset: {
                    id: "emote-one-animated",
                    url: "https://example.test/emote-one.gif",
                    contentType: "image/gif",
                    animated: true,
                },
            },
        },
        {
            type: "media",
            text: "GIF",
            media: {
                id: "gif-one",
                url: "https://example.test/chat/gif-one.gif",
                contentType: "image/gif",
                animated: true,
            },
        },
    ];
    const normalized = CjsRealtimeChatContract.normalizeMessage(message);

    assert.deepEqual(normalized.fragments[0].emote.formats, [
        "animated",
        "static",
    ]);
    assert.equal(normalized.fragments[0].emote.asset.url,
        "https://example.test/emote-one.gif");
    assert.equal(normalized.room.assets.icon.url,
        "https://example.test/room-icon.png");
    assert.equal(normalized.fragments[1].media.animated, true);
    assert.throws(() => CjsRealtimeChatContract.normalizeMedia({
        id: null,
        url: "http://example.test/not-secure.gif",
        contentType: "image/gif",
        animated: true,
    }), /must use HTTPS/u);
});

test("supports empty, scoped-term, and stable-user block lists without defaults", () =>
{
    const empty = new CjsRealtimeChatBlockList();

    assert.equal(empty.IsEmpty(), true);
    const blocks = new CjsRealtimeChatBlockList({
        terms: [
            "spoiler",
            {
                text: "room secret",
                provider: "twitch",
                roomLogin: "blockedroom",
            },
        ],
        users: [ {
            provider: "twitch",
            id: "blocked-user",
            login: "old-login",
        } ],
    });
    const room = {
        provider: "twitch",
        integrationId: "primary",
        space: null,
        id: "200",
        kind: "channel",
        parentRoomId: null,
        login: "BlockedRoom",
    };

    assert.equal(blocks.IsEmpty(), false);
    assert.equal(Object.isFrozen(blocks), true);
    assert.equal(blocks.BlocksTerm(room, "A SPOILER appeared"), true);
    assert.equal(blocks.BlocksTerm(room, "The room secret appeared"), true);
    assert.equal(blocks.BlocksTerm({
        ...room,
        login: "allowedroom",
    }, "The room secret appeared"), false);
    assert.equal(blocks.BlocksMessage({
        room,
        author: {
            id: "allowed-user",
            login: "allowed-user",
        },
        text: "",
        fragments: [ {
            type: "emote",
            text: "Wave",
            emote: { id: "emote-one" },
        } ],
    }), false);
    assert.equal(blocks.BlocksUser({
        ...room,
        login: "allowedroom",
    }, {
        id: "blocked-user",
        login: "renamed-user",
    }), true);
    assert.equal(blocks.BlocksUser(room, {
        id: "allowed-user",
        login: "old-login",
    }), false);
    assert.throws(
        () => new CjsRealtimeChatBlockList({
            users: [ { provider: "twitch" } ],
        }),
        /requires id or login/u,
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
