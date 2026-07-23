import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { CjsRealtimeHub } from "../../../src/realtime/server/CjsRealtimeHub.js";
import { CjsRealtimeSessionAuthority } from "../../../src/realtime/server/CjsRealtimeSessionAuthority.js";
import { CjsRealtimeTwitchChatNormalizer } from "../../../src/integrations/twitch/CjsRealtimeTwitchChatNormalizer.js";
import { CjsRealtimeTwitchChatService } from "../../../src/integrations/twitch/CjsRealtimeTwitchChatService.js";
import { CjsTwitchChatSource } from "../../../src/integrations/twitch/CjsTwitchChatSource.js";
import { CjsTwitchEventSubChatProvider } from "../../../src/integrations/twitch/CjsTwitchEventSubChatProvider.js";
import { CjsTwitchEventSubSession } from "../../../src/integrations/twitch/CjsTwitchEventSubSession.js";
import { CjsTwitchEventSubSource } from "../../../src/integrations/twitch/CjsTwitchEventSubSource.js";
import { CjsTwitchHelixClient } from "../../../src/integrations/twitch/CjsTwitchHelixClient.js";
import { CjsTwitchIrcChatProvider } from "../../../src/integrations/twitch/CjsTwitchIrcChatProvider.js";
import { CjsTwitchOAuthTokenProvider } from "../../../src/integrations/twitch/CjsTwitchOAuthTokenProvider.js";
import { CjsRealtimeMemoryTransport } from "../../realtime/CjsRealtimeTestSupport.js";

class CjsFakeTwitchProvider
{

    constructor(kind = "twitch.eventsub")
    {
        this.kind = kind;
        this.callbacks = null;
        this.startCount = 0;
        this.stopCount = 0;
    }

    async Start(callbacks)
    {
        this.startCount++;
        this.callbacks = callbacks;
    }

    async Stop()
    {
        this.stopCount++;
        this.callbacks = null;
    }

    EmitMessage(message)
    {
        this.callbacks?.onMessage(message);
    }

}

class CjsFakeIrcClient extends EventEmitter
{

    constructor()
    {
        super();
        this.connected = false;
        this.disconnected = false;
        this.connect = async () =>
        {
            this.connected = true;
            this.emit("connected", "irc-ws.chat.twitch.tv", 443);
        };
        this.disconnect = async () =>
        {
            this.disconnected = true;
        };
    }

}

class CjsFakeEventSubSocket extends EventEmitter
{

    constructor(url)
    {
        super();
        this.url = url;
        this.closed = false;
        this.close = () =>
        {
            if (!this.closed)
            {
                this.closed = true;
                this.emit("close", 1000);
            }
        };
        this.terminate = this.close;
    }

    Push(value)
    {
        this.emit("message", JSON.stringify(value));
    }

}

async function Flush()
{
    await new Promise(resolve => setImmediate(resolve));
}

function Deferred()
{
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) =>
    {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
}

function ValidationResponse(status, value = {})
{
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => value,
    };
}

function ChatMessage(id, text = "hello")
{
    return Object.freeze({
        id,
        text,
        occurredAt: "2026-07-21T12:00:00.000Z",
        deliveryMode: "live",
        room: Object.freeze({
            provider: "twitch",
            id: "200",
            login: "carbon",
            displayName: "Carbon",
        }),
        author: Object.freeze({
            id: "300",
            login: "viewer",
            displayName: "Viewer",
            color: null,
            roles: Object.freeze([]),
        }),
        reply: null,
        fragments: Object.freeze([ Object.freeze({ type: "text", text }) ]),
        extensions: Object.freeze({
            twitch: Object.freeze({ transport: "eventsub" }),
        }),
    });
}

function Welcome(sessionId = "session-one")
{
    return {
        metadata: {
            message_id: `welcome-${sessionId}`,
            message_type: "session_welcome",
            message_timestamp: "2026-07-21T12:00:00.000Z",
        },
        payload: {
            session: {
                id: sessionId,
                status: "connected",
                keepalive_timeout_seconds: 30,
            },
        },
    };
}

function EventSubNotification(messageId = "message-one")
{
    return {
        metadata: {
            message_id: `notification-${messageId}`,
            message_type: "notification",
            message_timestamp: "2026-07-21T12:00:01.000Z",
            subscription_type: "channel.chat.message",
            subscription_version: "1",
        },
        payload: {
            subscription: {
                id: "subscription-one",
                type: "channel.chat.message",
                version: "1",
                status: "enabled",
            },
            event: {
                broadcaster_user_id: "200",
                broadcaster_user_login: "carbon",
                broadcaster_user_name: "Carbon",
                chatter_user_id: "300",
                chatter_user_login: "viewer",
                chatter_user_name: "Viewer",
                message_id: messageId,
                message: {
                    text: "Hello Kappa",
                    fragments: [
                        { type: "text", text: "Hello " },
                        {
                            type: "emote",
                            text: "Kappa",
                            emote: { id: "25", emote_set_id: "0", owner_id: "0" },
                        },
                    ],
                },
                color: "#00FF00",
                badges: [ { set_id: "moderator", id: "1", info: "" } ],
                message_type: "text",
            },
        },
    };
}

test("validates, caches, and scopes externally acquired Twitch OAuth tokens", async () =>
{
    let clock = 1000;
    let fetchCount = 0;
    const headers = [];
    const provider = new CjsTwitchOAuthTokenProvider({
        clientId: "client-one",
        getAccessToken: () => "oauth:access-token-one",
        clock: () => clock,
        validationIntervalMs: 60000,
        fetch: async (_url, options) =>
        {
            fetchCount++;
            headers.push(options.headers.authorization);

            return ValidationResponse(200, {
                client_id: "client-one",
                user_id: "100",
                login: "AgentUser",
                scopes: [ "user:read:chat", "chat:read" ],
                expires_in: 7200,
            });
        },
    });
    const first = await provider.Acquire({ requiredScopes: [ "user:read:chat" ] });

    clock += 30000;
    const cached = await provider.Acquire({ requiredScopes: [ "chat:read" ] });

    assert.equal(first, cached);
    assert.equal(first.login, "agentuser");
    assert.equal(first.accessToken, "access-token-one");
    assert.deepEqual(headers, [ "OAuth access-token-one" ]);
    assert.equal(fetchCount, 1);
    await assert.rejects(
        provider.Acquire({ requiredScopes: [ "user:write:chat" ] }),
        error => error.code === "twitch_scope_required",
    );
});

test("bounds Twitch OAuth validation and Helix request lifetimes", async () =>
{
    const oauth = new CjsTwitchOAuthTokenProvider({
        clientId: "client-one",
        getAccessToken: () => "access-token-one",
        requestTimeoutMs: 10,
        fetch: async () => new Promise(() => undefined),
    });

    await assert.rejects(
        oauth.Acquire(),
        error => error.code === "twitch_unavailable" && error.retryable === true,
    );

    const helix = new CjsTwitchHelixClient({
        oauth: {
            Acquire: async () => ({
                accessToken: "access-token-one",
                clientId: "client-one",
                userId: "100",
            }),
            Invalidate: () => undefined,
        },
        requestTimeoutMs: 10,
        fetch: async () => new Promise(() => undefined),
    });

    await assert.rejects(
        helix.Request("streams"),
        error => error.code === "twitch_unavailable" && error.retryable === true,
    );
});

test("rejects an oversized streamed Twitch validation response", async () =>
{
    const oauth = new CjsTwitchOAuthTokenProvider({
        clientId: "client-one",
        getAccessToken: () => "access-token-one",
        maxResponseBytes: 16,
        fetch: async () => ({
            status: 200,
            ok: true,
            body: new ReadableStream({
                start(controller)
                {
                    controller.enqueue(Buffer.from(JSON.stringify({
                        client_id: "client-one",
                        user_id: "100",
                    })));
                    controller.close();
                },
            }),
        }),
    });

    await assert.rejects(
        oauth.Acquire(),
        error => error.code === "twitch_invalid_response" && error.retryable === true,
    );
});

test("exports the Twitch slice through its exact package subpath", async () =>
{
    const twitch = await import("@carbonenginejs/tools-core/integrations/twitch");

    assert.equal(twitch.TwitchOAuthTokenProvider.name, "TwitchOAuthTokenProvider");
    assert.equal(twitch.TwitchHelixClient.name, "TwitchHelixClient");
    assert.equal(twitch.TwitchEventSubChatProvider.name, "TwitchEventSubChatProvider");
    assert.equal(twitch.TwitchEventSubSession.name, "TwitchEventSubSession");
    assert.equal(twitch.TwitchEventSubSource.name, "TwitchEventSubSource");
    assert.equal(twitch.TwitchIrcChatProvider.name, "TwitchIrcChatProvider");
    assert.equal(twitch.TwitchChatService.name, "TwitchChatService");
    assert.equal(twitch.TwitchChatSource.name, "TwitchChatSource");
    assert.equal(new twitch.TwitchOAuthTokenProvider({
        clientId: "client-one",
        getAccessToken: () => "access-token-one",
        fetch: async () => ValidationResponse(401),
    }) instanceof CjsTwitchOAuthTokenProvider, true);
    assert.equal(Object.keys(twitch).some(name => name.startsWith("Cjs")), false);

    const oauth = new twitch.TwitchOAuthTokenProvider({
        clientId: "client-one",
        getAccessToken: () => "access-token-one",
        fetch: async () => ValidationResponse(401),
    });
    const helix = new twitch.TwitchHelixClient({
        oauth,
        fetch: async () => ({ status: 202 }),
    });
    const provider = new twitch.TwitchEventSubChatProvider({
        oauth,
        helix,
        rooms: [ { id: "200" } ],
        createWebSocket: () =>
        {
            throw new Error("not started");
        },
    });
    const service = new twitch.TwitchChatService({
        id: "public-twitch",
        provider,
    });

    assert.equal(service.Describe().kind, "twitch.eventsub");
});

test("shares one Twitch transport across aggregate and exact room emitters", async () =>
{
    const provider = new CjsFakeTwitchProvider();
    const source = new CjsTwitchChatSource({ provider });
    const aggregate = [];
    const carbon = [];
    const other = [];
    const Context = published =>
    {
        const abortController = new AbortController();
        const context = {
            signal: abortController.signal,
            Commit: callback => Promise.resolve().then(() => callback(context)),
            Publish: async (topic, data) => published.push({ topic, data }),
        };

        return context;
    };
    const aggregateService = new CjsRealtimeTwitchChatService({
        id: "primary-chat",
        source,
    });
    const carbonService = new CjsRealtimeTwitchChatService({
        id: "twitch-carbon",
        source,
        room: { id: "200", login: "carbon" },
    });
    const otherService = new CjsRealtimeTwitchChatService({
        id: "twitch-other",
        source,
        room: { login: "other" },
    });

    await Promise.all([
        aggregateService.Start(Context(aggregate)),
        carbonService.Start(Context(carbon)),
        otherService.Start(Context(other)),
    ]);
    assert.equal(provider.startCount, 1);

    provider.EmitMessage(ChatMessage("carbon-message"));
    const otherMessage = JSON.parse(JSON.stringify(ChatMessage("other-message")));

    otherMessage.room.id = "201";
    otherMessage.room.login = "other";
    otherMessage.room.displayName = "Other";
    provider.EmitMessage(otherMessage);
    await Flush();

    assert.deepEqual(aggregate.map(entry => entry.data.id),
        [ "carbon-message", "other-message" ]);
    assert.deepEqual(carbon.map(entry => entry.data.id), [ "carbon-message" ]);
    assert.deepEqual(other.map(entry => entry.data.id), [ "other-message" ]);

    await aggregateService.Stop();
    await carbonService.Stop();
    assert.equal(provider.stopCount, 0);
    await otherService.Stop();
    assert.equal(provider.stopCount, 1);
});

test("serializes an OAuth refresh and never reflects a rejected secret", async () =>
{
    let validationCount = 0;
    let refreshCount = 0;
    const provider = new CjsTwitchOAuthTokenProvider({
        clientId: "client-one",
        getAccessToken: () => "expired-secret-token",
        refreshAccessToken: async () =>
        {
            refreshCount++;

            return "replacement-token";
        },
        fetch: async (_url, options) =>
        {
            validationCount++;

            if (options.headers.authorization.includes("expired"))
            {
                return ValidationResponse(401);
            }

            return ValidationResponse(200, {
                client_id: "client-one",
                user_id: "100",
                login: "agentuser",
                scopes: [ "chat:read" ],
                expires_in: 7200,
            });
        },
    });
    const [ first, second ] = await Promise.all([
        provider.Acquire({ requiredScopes: [ "chat:read" ] }),
        provider.Acquire({ requiredScopes: [ "chat:read" ] }),
    ]);

    assert.equal(first, second);
    assert.equal(refreshCount, 1);
    assert.equal(validationCount, 2);

    const unavailable = new CjsTwitchOAuthTokenProvider({
        clientId: "client-one",
        getAccessToken: () =>
        {
            throw new Error("do-not-reflect-this-secret");
        },
        fetch: async () => ValidationResponse(500),
    });

    await assert.rejects(unavailable.Acquire(), error =>
        error.code === "twitch_unauthorized"
            && !error.message.includes("do-not-reflect-this-secret"));
});

test("normalizes IRC and EventSub into one provider-neutral chat shape", () =>
{
    const irc = CjsRealtimeTwitchChatNormalizer.fromIrc({
        channel: "#Carbon",
        text: "Hello <agent>",
        receivedAt: Date.parse("2026-07-21T12:00:02.000Z"),
        tags: {
            id: "irc-one",
            "room-id": "200",
            "user-id": "300",
            username: "viewer",
            "display-name": "Viewer",
            "tmi-sent-ts": "1784635201000",
            badges: { moderator: "1" },
            mod: "1",
        },
    });
    const eventSub = CjsRealtimeTwitchChatNormalizer.fromEventSub(
        EventSubNotification(),
    );

    assert.equal(irc.text, "Hello <agent>");
    assert.equal(irc.deliveryMode, "live");
    assert.equal(irc.extensions.twitch.transport, "irc");
    assert.deepEqual(irc.author.roles, [ "moderator" ]);
    assert.equal(eventSub.room.id, irc.room.id);
    assert.equal(eventSub.author.id, irc.author.id);
    assert.equal(eventSub.extensions.twitch.transport, "eventsub");
    assert.equal(eventSub.fragments[1].emote.id, "25");
});

test("reuses OAuth scope and refresh policy across Helix integration points", async () =>
{
    const oauthRequests = [];
    const requests = [];
    let token = "first-token";
    const oauth = {
        Acquire: async request =>
        {
            oauthRequests.push(request);

            return {
                accessToken: token,
                clientId: "client-one",
                userId: "100",
                login: "agentuser",
                scopes: request.requiredScopes,
            };
        },
        Invalidate: () =>
        {
            token = "replacement-token";
        },
    };
    const helix = new CjsTwitchHelixClient({
        oauth,
        fetch: async (url, options) =>
        {
            requests.push({ url, options });

            return { status: requests.length === 1 ? 401 : 202 };
        },
    });
    const response = await helix.Request("eventsub/subscriptions", {
        method: "POST",
        query: { after: "cursor-one" },
        requiredScopes: [ "channel:read:redemptions" ],
        expectedUserId: "100",
        body: { type: "channel.channel_points_custom_reward_redemption.add" },
    });

    assert.equal(response.status, 202);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url,
        "https://api.twitch.tv/helix/eventsub/subscriptions?after=cursor-one");
    assert.equal(requests[0].options.headers.authorization, "Bearer first-token");
    assert.equal(requests[1].options.headers.authorization, "Bearer replacement-token");
    assert.deepEqual(oauthRequests[0].requiredScopes,
        [ "channel:read:redemptions" ]);
    assert.equal(oauthRequests[1].force, true);
});

test("publishes only future chat and deduplicates stable ids per room", async context =>
{
    const provider = new CjsFakeTwitchProvider();
    const service = new CjsRealtimeTwitchChatService({
        id: "twitch-main",
        provider,
    });
    const capability = CjsRealtimeSessionAuthority.createCapability();
    const origin = "http://127.0.0.1:8080";
    const authority = new CjsRealtimeSessionAuthority({
        grants: [ {
            capability,
            actor: { id: "viewer-one", kind: "viewer" },
            allowedOrigins: [ origin ],
            scopes: {
                discover: true,
                services: {
                    "twitch-main": {
                        topics: [ "chat.message.received" ],
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

    hub.Register(service);
    await hub.Start();
    context.after(() => hub.Stop());
    provider.EmitMessage(ChatMessage("before-connect"));
    await Flush();

    const transport = new CjsRealtimeMemoryTransport();
    const connection = hub.OpenConnection({ transport, origin });

    await connection.ReceiveText(JSON.stringify({
        type: "hello",
        protocolVersion: 1,
        capability,
        client: { id: "facade-one", kind: "character-facade" },
    }));
    await connection.ReceiveText(JSON.stringify({
        type: "subscribe",
        requestId: "subscribe-one",
        serviceId: "twitch-main",
        topics: [ "chat.message.received" ],
    }));
    await connection.Drain();

    assert.equal(transport.messages.some(message => message.type === "event"), false);
    provider.EmitMessage(ChatMessage("after-connect"));
    provider.EmitMessage(ChatMessage("after-connect"));
    await Flush();
    await connection.Drain();
    const events = transport.messages.filter(message => message.type === "event");

    assert.equal(events.length, 1);
    assert.equal(events[0].payload.data.id, "after-connect");
    assert.equal(events[0].payload.data.deliveryMode, "live");
});

test("validates and isolates complete chat payloads before deduplication", async () =>
{
    const provider = new CjsFakeTwitchProvider();
    const published = [];
    const abortController = new AbortController();
    const context = {
        signal: abortController.signal,
        Commit: callback => Promise.resolve().then(() => callback(context)),
        Publish: async (topic, data) =>
        {
            published.push({ topic, data });
        },
    };
    const service = new CjsRealtimeTwitchChatService({
        id: "twitch-validation",
        provider,
    });

    await service.Start(context);
    const cyclic = JSON.parse(JSON.stringify(ChatMessage("retry-message")));

    cyclic.extensions.twitch.cycle = cyclic;
    provider.EmitMessage(cyclic);
    await Flush();
    assert.equal(published.some(entry => entry.topic === "chat.message.received"), false);

    const corrected = JSON.parse(JSON.stringify(ChatMessage("retry-message")));

    provider.EmitMessage(corrected);
    await Flush();
    const mutable = JSON.parse(JSON.stringify(ChatMessage("mutable-message")));

    provider.EmitMessage(mutable);
    mutable.fragments[0].text = "changed after admission";
    mutable.extensions.twitch.transport = "changed";
    await Flush();
    const messages = published.filter(entry => entry.topic === "chat.message.received");

    assert.equal(messages.length, 2);
    assert.equal(messages[0].data.id, "retry-message");
    assert.equal(messages[1].data.fragments[0].text, "hello");
    assert.equal(messages[1].data.extensions.twitch.transport, "eventsub");
    await service.Stop();
});

test("adapts receive-only tmi-compatible IRC without owning token acquisition", async () =>
{
    const clients = [];
    const options = [];
    const messages = [];
    const statuses = [];
    const oauthRequests = [];
    const oauth = {
        Acquire: async request =>
        {
            oauthRequests.push(request);

            return {
                accessToken: "irc-token",
                clientId: "client-one",
                userId: "100",
                login: "agentuser",
                scopes: [ "chat:read" ],
            };
        },
        Invalidate: () => undefined,
    };
    const provider = new CjsTwitchIrcChatProvider({
        oauth,
        rooms: [ "#Carbon" ],
        validationIntervalMs: 60000,
        createClient: value =>
        {
            options.push(value);
            const client = new CjsFakeIrcClient();

            clients.push(client);

            return client;
        },
    });
    const abortController = new AbortController();

    await provider.Start({
        signal: abortController.signal,
        onMessage: message => messages.push(message),
        onStatus: status => statuses.push(status),
    });
    clients[0].emit("message", "#carbon", {
        id: "irc-one",
        "room-id": "200",
        "user-id": "300",
        username: "viewer",
        "display-name": "Viewer",
        "tmi-sent-ts": "1784635201000",
    }, "hello", false);
    clients[0].emit("message", "#carbon", {}, "self", true);

    assert.deepEqual(oauthRequests[0].requiredScopes, [ "chat:read" ]);
    assert.deepEqual(options[0].channels, [ "carbon" ]);
    assert.equal(options[0].identity.password, "oauth:irc-token");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].extensions.twitch.transport, "irc");
    assert.equal(statuses[0].state, "ready");
    await provider.Stop();
    assert.equal(clients[0].disconnected, true);
    assert.equal(clients[0].listenerCount("message"), 0);
});

test("creates EventSub subscriptions and migrates sessions without recreating them", async () =>
{
    const sockets = [];
    const requests = [];
    const oauthRequests = [];
    const messages = [];
    const statuses = [];
    const oauth = {
        Acquire: async request =>
        {
            oauthRequests.push(request);

            return {
                accessToken: "eventsub-token",
                clientId: "client-one",
                userId: "100",
                login: "agentuser",
                scopes: [ "user:read:chat" ],
            };
        },
        Invalidate: () => undefined,
    };
    const provider = new CjsTwitchEventSubChatProvider({
        oauth,
        rooms: [ { id: "200", login: "carbon", displayName: "Carbon" } ],
        validationIntervalMs: 60000,
        createWebSocket: url =>
        {
            const socket = new CjsFakeEventSubSocket(url);

            sockets.push(socket);

            return socket;
        },
        fetch: async (url, options) =>
        {
            requests.push({ url, options });

            return { status: 202 };
        },
    });
    const abortController = new AbortController();
    const starting = provider.Start({
        signal: abortController.signal,
        onMessage: message => messages.push(message),
        onStatus: status => statuses.push(status),
    });

    await Flush();
    sockets[0].Push(Welcome());
    await starting;
    const subscription = JSON.parse(requests[0].options.body);

    assert.deepEqual(oauthRequests[0].requiredScopes, [ "user:read:chat" ]);
    assert.equal(requests[0].options.headers.authorization, "Bearer eventsub-token");
    assert.equal(subscription.type, "channel.chat.message");
    assert.deepEqual(subscription.condition, {
        broadcaster_user_id: "200",
        user_id: "100",
    });
    assert.deepEqual(subscription.transport, {
        method: "websocket",
        session_id: "session-one",
    });

    sockets[0].Push(EventSubNotification());
    await Flush();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, "message-one");

    sockets[0].Push({
        metadata: {
            message_id: "reconnect-one",
            message_type: "session_reconnect",
            message_timestamp: "2026-07-21T12:00:02.000Z",
        },
        payload: {
            session: {
                id: "session-one",
                status: "reconnecting",
                reconnect_url: "wss://eventsub.wss.twitch.tv/ws?session_id=session-two",
            },
        },
    });
    await Flush();

    assert.equal(sockets.length, 2);
    sockets[1].Push(Welcome("session-two"));
    await Flush();
    assert.equal(sockets[0].closed, true);
    assert.equal(requests.length, 1);
    assert.equal(statuses.at(-1).state, "ready");
    await provider.Stop();
    assert.equal(sockets[1].closed, true);
});

test("serializes early EventSub notifications behind subscription setup", async () =>
{
    const sockets = [];
    const messages = [];
    const subscription = Deferred();
    const oauth = {
        Acquire: async () => ({
            accessToken: "eventsub-token",
            clientId: "client-one",
            userId: "100",
            login: "agentuser",
            scopes: [ "user:read:chat" ],
        }),
        Invalidate: () => undefined,
    };
    const provider = new CjsTwitchEventSubChatProvider({
        oauth,
        helix: {
            Request: () => subscription.promise,
        },
        rooms: [ { id: "200" } ],
        validationIntervalMs: 60000,
        createWebSocket: url =>
        {
            const socket = new CjsFakeEventSubSocket(url);

            sockets.push(socket);

            return socket;
        },
    });
    const starting = provider.Start({
        signal: new AbortController().signal,
        onMessage: message => messages.push(message),
        onStatus: () => undefined,
    });

    await Flush();
    sockets[0].Push(Welcome());
    await Flush();
    sockets[0].Push(EventSubNotification("early-message"));
    await Flush();
    assert.equal(messages.length, 0);
    assert.equal(sockets[0].closed, false);

    subscription.resolve({ status: 202 });
    await starting;
    await Flush();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, "early-message");
    assert.equal(sockets[0].closed, false);
    await provider.Stop();
});

test("keeps the shared EventSub session family-neutral", async () =>
{
    const sockets = [];
    const notifications = [];
    const welcomes = [];
    const setup = Deferred();
    const session = new CjsTwitchEventSubSession({
        createWebSocket: url =>
        {
            const socket = new CjsFakeEventSubSocket(url);

            sockets.push(socket);

            return socket;
        },
    });
    const starting = session.Start({
        signal: new AbortController().signal,
        onWelcome: async welcome =>
        {
            welcomes.push({
                sessionId: welcome.sessionId,
                recreateSubscriptions: welcome.recreateSubscriptions,
            });
            await setup.promise;
        },
        onNotification: message => notifications.push(message),
        onRevocation: () => undefined,
        onStatus: () => undefined,
    });
    const notification = EventSubNotification("family-neutral");

    notification.metadata.subscription_type = "channel.follow";
    notification.payload.subscription.type = "channel.follow";
    await Flush();
    sockets[0].Push(Welcome("shared-session"));
    sockets[0].Push(notification);
    await Flush();
    assert.deepEqual(welcomes, [ {
        sessionId: "shared-session",
        recreateSubscriptions: true,
    } ]);
    assert.deepEqual(notifications, []);

    setup.resolve();
    await starting;
    await Flush();
    assert.equal(notifications[0].metadata.subscription_type, "channel.follow");
    assert.equal(notifications[0].payload.event.message_id, "family-neutral");
    await session.Stop();
});

test("composes static EventSub families over one scoped physical session", async () =>
{
    const sockets = [];
    const oauthRequests = [];
    const helixBodies = [];
    const chatNotifications = [];
    const activityNotifications = [];
    const source = new CjsTwitchEventSubSource({
        oauth: {
            Acquire: async request =>
            {
                oauthRequests.push(request);

                return {
                    accessToken: "shared-token",
                    clientId: "client-one",
                    userId: "100",
                    login: "agentuser",
                    scopes: request.requiredScopes,
                };
            },
            Invalidate: () => undefined,
        },
        helix: {
            Request: async (_path, request) =>
            {
                helixBodies.push(request.body);

                return { status: 202 };
            },
        },
        createWebSocket: url =>
        {
            const socket = new CjsFakeEventSubSocket(url);

            sockets.push(socket);

            return socket;
        },
    });
    const follow = {
        type: "channel.follow",
        version: "2",
        condition: identity => ({
            broadcaster_user_id: "200",
            moderator_user_id: identity.userId,
        }),
    };

    source.Register({
        id: "chat",
        requiredScopes: [ "user:read:chat" ],
        subscriptions: [ {
            type: "channel.chat.message",
            version: "1",
            condition: identity => ({
                broadcaster_user_id: "200",
                user_id: identity.userId,
            }),
        } ],
    });
    source.Register({
        id: "activity",
        requiredScopes: [ "moderator:read:followers" ],
        subscriptions: [ follow, follow ],
    });
    assert.throws(() => source.Register({
        id: "chat",
        subscriptions: [ follow ],
    }), /already exists/u);
    const chatAbort = new AbortController();
    const activityAbort = new AbortController();
    const chatStart = source.Attach("chat", {
        signal: chatAbort.signal,
        onNotification: message => chatNotifications.push(message),
        onRevocation: () => undefined,
        onStatus: () => undefined,
    });
    const activityStart = source.Attach("activity", {
        signal: activityAbort.signal,
        onNotification: message => activityNotifications.push(message),
        onRevocation: () => undefined,
        onStatus: () => undefined,
    });

    assert.throws(() => source.Register({
        id: "late-family",
        subscriptions: [ follow ],
    }), /sealed/u);

    await Flush();
    assert.equal(sockets.length, 1);
    sockets[0].Push(Welcome("composed-session"));
    await Promise.all([ chatStart, activityStart ]);
    assert.deepEqual(oauthRequests[0].requiredScopes, [
        "moderator:read:followers",
        "user:read:chat",
    ]);
    assert.equal(helixBodies.length, 2);
    assert.deepEqual(helixBodies.map(body => body.type).sort(), [
        "channel.chat.message",
        "channel.follow",
    ]);

    sockets[0].Push(EventSubNotification("shared-chat"));
    const followNotification = EventSubNotification("shared-follow");

    followNotification.metadata.subscription_type = "channel.follow";
    followNotification.metadata.subscription_version = "2";
    followNotification.payload.subscription.type = "channel.follow";
    followNotification.payload.subscription.version = "2";
    sockets[0].Push(followNotification);
    await Flush();
    assert.equal(chatNotifications.length, 1);
    assert.equal(chatNotifications[0].payload.event.message_id, "shared-chat");
    assert.equal(activityNotifications.length, 1);
    assert.equal(activityNotifications[0].payload.event.message_id, "shared-follow");

    await source.Detach("chat");
    assert.equal(sockets[0].closed, false);
    await source.Detach("activity");
    assert.equal(sockets[0].closed, true);
});

test("suspends EventSub reconnects until external authorization resumes", async () =>
{
    const sockets = [];
    const welcomes = [];
    const session = new CjsTwitchEventSubSession({
        reconnectBaseMs: 1,
        reconnectMaxMs: 1,
        createWebSocket: url =>
        {
            const socket = new CjsFakeEventSubSocket(url);

            sockets.push(socket);

            return socket;
        },
    });
    const starting = session.Start({
        signal: new AbortController().signal,
        onWelcome: welcome => welcomes.push(welcome.recreateSubscriptions),
        onNotification: () => undefined,
        onRevocation: () => undefined,
        onStatus: () => undefined,
    });

    await Flush();
    sockets[0].Push(Welcome("authorized-one"));
    await starting;
    session.Suspend();
    assert.equal(sockets[0].closed, true);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(sockets.length, 1);

    session.Resume();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(sockets.length, 2);
    sockets[1].Push(Welcome("authorized-two"));
    await Flush();
    assert.deepEqual(welcomes, [ true, true ]);
    await session.Stop();
});

test("fails EventSub startup when a socket never delivers welcome", async () =>
{
    const sockets = [];
    const oauth = {
        Acquire: async () => ({
            accessToken: "eventsub-token",
            clientId: "client-one",
            userId: "100",
            login: "agentuser",
            scopes: [ "user:read:chat" ],
        }),
        Invalidate: () => undefined,
    };
    const provider = new CjsTwitchEventSubChatProvider({
        oauth,
        helix: { Request: async () => ({ status: 202 }) },
        rooms: [ { id: "200" } ],
        validationIntervalMs: 60000,
        welcomeTimeoutMs: 25,
        createWebSocket: url =>
        {
            const socket = new CjsFakeEventSubSocket(url);

            sockets.push(socket);

            return socket;
        },
    });

    await assert.rejects(provider.Start({
        signal: new AbortController().signal,
        onMessage: () => undefined,
        onStatus: () => undefined,
    }), error => error.code === "twitch_unavailable"
        && !error.message.includes("session"));
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].closed, true);
});

test("reports an EventSub gap and recreates subscriptions after unexpected loss", async () =>
{
    const sockets = [];
    const requests = [];
    const statuses = [];
    const oauth = {
        Acquire: async () => ({
            accessToken: "eventsub-token",
            clientId: "client-one",
            userId: "100",
            login: "agentuser",
            scopes: [ "user:read:chat" ],
        }),
        Invalidate: () => undefined,
    };
    const provider = new CjsTwitchEventSubChatProvider({
        oauth,
        rooms: [ { id: "200" } ],
        validationIntervalMs: 60000,
        reconnectBaseMs: 1,
        reconnectMaxMs: 1,
        createWebSocket: url =>
        {
            const socket = new CjsFakeEventSubSocket(url);

            sockets.push(socket);

            return socket;
        },
        fetch: async (_url, options) =>
        {
            requests.push(JSON.parse(options.body));

            return { status: 202 };
        },
    });
    const starting = provider.Start({
        signal: new AbortController().signal,
        onMessage: () => undefined,
        onStatus: status => statuses.push(status),
    });

    await Flush();
    sockets[0].Push(Welcome("first-session"));
    await starting;
    sockets[0].emit("close", 1006);
    await new Promise(resolve => setTimeout(resolve, 10));

    assert.equal(statuses.some(status => status.reasonCode === "upstream_gap"), true);
    assert.equal(sockets.length, 2);
    sockets[1].Push(Welcome("replacement-session"));
    await Flush();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].transport.session_id, "replacement-session");
    await provider.Stop();
});
