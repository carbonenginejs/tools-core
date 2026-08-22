import { CjsToolRealtimeError } from "../../realtime/CjsToolRealtimeError.js";
import { CjsToolRealtimeSerialLane } from "../../realtime/internal/CjsToolRealtimeSerialLane.js";
import { TwitchChatNormalizer } from "./TwitchChatNormalizer.js";
import { TwitchChatAssetResolver } from "./TwitchChatAssetResolver.js";
import { TwitchHelixClient } from "./TwitchHelixClient.js";

/** Adapts an injected tmi.js-compatible client into the Twitch chat source contract. */
export class TwitchIrcChatProvider
{

    #active;

    #assetResolver;

    #client;

    #clock;

    #createClient;

    #handlers;

    #identity;

    #lane;

    #messageLane;

    #onMessage;

    #onStatus;

    #oauth;

    #operation;

    #pinnedRooms;

    #rooms;

    #timer;

    #validationIntervalMs;

    constructor({
        oauth,
        rooms = [],
        createClient,
        clock = () => Date.now(),
        validationIntervalMs = 60 * 60 * 1000,
        assetResolver = undefined,
        helix = null,
        fetch: fetchImplementation = globalThis.fetch,
        apiEndpoint = "https://api.twitch.tv/helix/",
        requestTimeoutMs = 10000,
    } = {})
    {
        if (!oauth || typeof oauth.Acquire !== "function"
            || typeof oauth.Invalidate !== "function")
        {
            throw new TypeError("Twitch IRC provider requires an OAuth token provider");
        }

        if (typeof createClient !== "function" || typeof clock !== "function")
        {
            throw new TypeError("Twitch IRC client factory and clock must be functions");
        }

        if (!Number.isSafeInteger(validationIntervalMs) || validationIntervalMs < 1000
            || validationIntervalMs > 60 * 60 * 1000)
        {
            throw new TypeError(
                "Twitch IRC validationIntervalMs must be between 1000 and one hour",
            );
        }

        this.kind = "twitch.irc";
        this.#oauth = oauth;
        this.#assetResolver = assetResolver === null
            ? null
            : assetResolver ?? new TwitchChatAssetResolver({
                helix: helix ?? new TwitchHelixClient({
                    oauth,
                    fetch: fetchImplementation,
                    endpoint: apiEndpoint,
                    requestTimeoutMs,
                }),
                fetch: fetchImplementation,
                clock,
                requestTimeoutMs,
            });
        if (this.#assetResolver !== null
            && (typeof this.#assetResolver.ResolveRoom !== "function"
                || typeof this.#assetResolver.ResolveIrcMessage !== "function"))
        {
            throw new TypeError("Twitch IRC asset resolver is invalid");
        }
        this.#pinnedRooms = new Set(TwitchIrcChatProvider.normalizeRooms(rooms));
        this.#rooms = new Set(this.#pinnedRooms);
        this.#createClient = createClient;
        this.#clock = clock;
        this.#validationIntervalMs = validationIntervalMs;
        this.#active = false;
        this.#client = null;
        this.#handlers = null;
        this.#identity = null;
        this.#lane = new CjsToolRealtimeSerialLane();
        this.#messageLane = new CjsToolRealtimeSerialLane();
        this.#onMessage = null;
        this.#onStatus = null;
        this.#operation = null;
        this.#timer = null;
    }

    /** Resolves one joined channel into canonical room presentation metadata. */
    ResolveRoom(login)
    {
        const room = TwitchIrcChatProvider.normalizeRoom(login);
        return this.#assetResolver?.ResolveRoom(room) ?? Promise.resolve(null);
    }

    /** Joins one desired Twitch channel once across all downstream listeners. */
    JoinRoom(login)
    {
        const room = TwitchIrcChatProvider.normalizeRoom(login);

        return this.#lane.Enqueue(async () =>
        {
            if (this.#rooms.has(room))
            {
                return false;
            }

            if (this.#rooms.size >= 100)
            {
                throw new CjsToolRealtimeError(
                    "twitch_room_limit",
                    "Twitch IRC channel limit was reached",
                    { retryable: false },
                );
            }

            this.#rooms.add(room);

            if (!this.#active || !this.#client)
            {
                return true;
            }

            if (typeof this.#client.join !== "function")
            {
                this.#rooms.delete(room);
                throw new TypeError("Twitch IRC client does not support dynamic joins");
            }

            try
            {
                await this.#client.join(room);
            }
            catch (error)
            {
                this.#rooms.delete(room);
                this.#EmitStatus("degraded", "room_unavailable", true);

                throw new CjsToolRealtimeError(
                    "twitch_room_unavailable",
                    "Twitch IRC channel could not be joined",
                    { retryable: true, cause: error },
                );
            }

            return true;
        });
    }

    /** Parts one unpinned Twitch channel when it is no longer desired. */
    PartRoom(login)
    {
        const room = TwitchIrcChatProvider.normalizeRoom(login);

        return this.#lane.Enqueue(async () =>
        {
            if (this.#pinnedRooms.has(room) || !this.#rooms.delete(room))
            {
                return false;
            }

            if (!this.#active || !this.#client)
            {
                return true;
            }

            if (typeof this.#client.part !== "function")
            {
                this.#EmitStatus("degraded", "room_part_failed", false);

                return true;
            }

            try
            {
                await this.#client.part(room);
            }
            catch
            {
                this.#EmitStatus("degraded", "room_part_failed", true);
            }

            return true;
        });
    }

    /** Connects receive-only Twitch IRC using chat:read authorization. */
    async Start({ signal, onMessage, onStatus })
    {
        if (this.#active)
        {
            return;
        }

        if (!(signal instanceof AbortSignal) || typeof onMessage !== "function"
            || typeof onStatus !== "function")
        {
            throw new TypeError("Twitch IRC provider callbacks are invalid");
        }

        this.#active = true;
        this.#onMessage = onMessage;
        this.#onStatus = onStatus;
        signal.addEventListener("abort", () =>
        {
            this.#active = false;
        }, { once: true });

        try
        {
            const identity = await this.#oauth.Acquire({
                requiredScopes: [ "chat:read" ],
            });

            this.#identity = identity;
            await this.#Connect(identity);
            this.#timer = setInterval(() => this.#TrackValidation(), this.#validationIntervalMs);
            this.#timer.unref?.();
        }
        catch (error)
        {
            this.#active = false;
            await this.#CloseClient().catch(() => undefined);

            throw TwitchIrcChatProvider.startError(error);
        }
    }

    /** Disconnects IRC and removes all adapter-owned event listeners. */
    async Stop()
    {
        this.#active = false;
        clearInterval(this.#timer);
        this.#timer = null;
        await this.#operation?.catch(() => undefined);
        await this.#messageLane.Drain();
        await this.#lane.Drain();
        await this.#CloseClient();
        this.#identity = null;
        this.#onMessage = null;
        this.#onStatus = null;
        this.#operation = null;
    }

    async #Connect(identity)
    {
        const client = this.#createClient(Object.freeze({
            identity: Object.freeze({
                username: identity.login,
                password: `oauth:${identity.accessToken}`,
            }),
            channels: Object.freeze([ ...this.#rooms ].sort()),
            connection: Object.freeze({ secure: true, reconnect: true }),
        }));

        if (!client || typeof client.on !== "function" || typeof client.connect !== "function"
            || typeof client.disconnect !== "function")
        {
            throw new TypeError("Twitch IRC factory returned an invalid client");
        }

        const handlers = {
            message: (channel, tags, text, self) =>
            {
                if (!this.#active || self)
                {
                    return;
                }

                this.#messageLane.Enqueue(() => this.#HandleMessage(
                    channel,
                    tags,
                    text,
                )).catch(() =>
                {
                    this.#EmitStatus("degraded", "invalid_message", false);
                });
            },
            connected: () =>
            {
                if (this.#active)
                {
                    this.#EmitStatus("ready", null, false);
                }
            },
            disconnected: () =>
            {
                if (this.#active)
                {
                    this.#EmitStatus("degraded", "upstream_disconnected", true);
                }
            },
            reconnect: () =>
            {
                if (this.#active)
                {
                    this.#EmitStatus("reconnecting", "upstream_reconnecting", true);
                }
            },
            notice: (_channel, messageId) =>
            {
                if (this.#active && [ "msg_banned", "msg_channel_suspended" ].includes(messageId))
                {
                    this.#EmitStatus("degraded", "room_unavailable", false);
                }
            },
        };

        for (const [ event, handler ] of Object.entries(handlers))
        {
            client.on(event, handler);
        }

        this.#client = client;
        this.#handlers = handlers;

        try
        {
            await client.connect();
        }
        catch (error)
        {
            await this.#CloseClient().catch(() => undefined);

            throw error;
        }
    }

    async #HandleMessage(channel, tags, text)
    {
        let assets = null;

        try
        {
            assets = await this.#assetResolver?.ResolveIrcMessage({
                channel,
                tags,
            }) ?? null;
        }
        catch
        {
            this.#EmitStatus("degraded", "asset_metadata_unavailable", true);
        }

        if (!this.#active)
        {
            return;
        }

        this.#onMessage(TwitchChatNormalizer.fromIrc({
            channel,
            tags,
            text,
            receivedAt: this.#clock(),
            assets,
        }));
    }

    #TrackValidation()
    {
        if (!this.#active || this.#operation)
        {
            return;
        }

        const operation = this.#lane.Enqueue(() => this.#ValidateAuthorization());

        this.#operation = operation;
        operation.then(
            () =>
            {
                if (this.#operation === operation)
                {
                    this.#operation = null;
                }
            },
            () =>
            {
                if (this.#operation === operation)
                {
                    this.#operation = null;
                }
            },
        );
    }

    async #ValidateAuthorization()
    {
        try
        {
            const identity = await this.#oauth.Acquire({
                requiredScopes: [ "chat:read" ],
                expectedUserId: this.#identity?.userId ?? null,
                force: true,
            });

            if (!this.#active)
            {
                return;
            }

            if (!this.#client || identity.accessToken !== this.#identity?.accessToken)
            {
                this.#EmitStatus("reconnecting", "authorization_changed", true);
                await this.#CloseClient();
                this.#identity = identity;
                await this.#Connect(identity);
            }
        }
        catch (error)
        {
            const reasonCode = error?.code === "twitch_unauthorized"
                || error?.code === "twitch_scope_required"
                ? "authorization_invalid"
                : "authorization_unavailable";

            this.#EmitStatus("degraded", reasonCode, error?.retryable === true);

            if (reasonCode === "authorization_invalid")
            {
                await this.#CloseClient().catch(() => undefined);
            }
        }
    }

    async #CloseClient()
    {
        const client = this.#client;
        const handlers = this.#handlers;

        this.#client = null;
        this.#handlers = null;

        if (!client)
        {
            return;
        }

        const remove = typeof client.off === "function"
            ? client.off.bind(client)
            : client.removeListener?.bind(client);

        if (remove && handlers)
        {
            for (const [ event, handler ] of Object.entries(handlers))
            {
                remove(event, handler);
            }
        }

        await client.disconnect();
    }

    #EmitStatus(state, reasonCode, retryable)
    {
        this.#onStatus?.({
            state,
            reasonCode,
            retryable,
            occurredAt: this.#clock(),
        });
    }

    /** Validates and freezes the receive-only channel login list. */
    static normalizeRooms(value)
    {
        if (!Array.isArray(value) || value.length > 100)
        {
            throw new TypeError("Twitch IRC rooms must contain at most 100 channel logins");
        }

        return Object.freeze([ ...new Set(value.map(room =>
            TwitchIrcChatProvider.normalizeRoom(room))) ].sort());
    }

    /** Normalizes one Twitch IRC channel login. */
    static normalizeRoom(value)
    {
        const room = typeof value === "string"
            ? value.replace(/^#/u, "").toLowerCase()
            : "";

        if (!/^[a-z0-9_]{1,25}$/u.test(room))
        {
            throw new TypeError("Twitch IRC room login is invalid");
        }

        return room;
    }

    /** Sanitizes adapter startup failures without reflecting credentials. */
    static startError(error)
    {
        if (error instanceof CjsToolRealtimeError)
        {
            return error;
        }

        return new CjsToolRealtimeError(
            "twitch_unavailable",
            "Twitch IRC could not be started",
            { retryable: true, cause: error },
        );
    }

}
