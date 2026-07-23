import { CjsRealtimeError } from "../../realtime/CjsRealtimeError.js";
import { CjsRealtimeTwitchChatNormalizer } from "./CjsRealtimeTwitchChatNormalizer.js";

/** Adapts an injected tmi.js-compatible client into the Twitch chat source contract. */
export class CjsTwitchIrcChatProvider
{

    #active;

    #client;

    #clock;

    #createClient;

    #handlers;

    #identity;

    #onMessage;

    #onStatus;

    #oauth;

    #operation;

    #rooms;

    #timer;

    #validationIntervalMs;

    constructor({
        oauth,
        rooms,
        createClient,
        clock = () => Date.now(),
        validationIntervalMs = 60 * 60 * 1000,
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
        this.#rooms = CjsTwitchIrcChatProvider.normalizeRooms(rooms);
        this.#createClient = createClient;
        this.#clock = clock;
        this.#validationIntervalMs = validationIntervalMs;
        this.#active = false;
        this.#client = null;
        this.#handlers = null;
        this.#identity = null;
        this.#onMessage = null;
        this.#onStatus = null;
        this.#operation = null;
        this.#timer = null;
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

            throw CjsTwitchIrcChatProvider.startError(error);
        }
    }

    /** Disconnects IRC and removes all adapter-owned event listeners. */
    async Stop()
    {
        this.#active = false;
        clearInterval(this.#timer);
        this.#timer = null;
        await this.#operation?.catch(() => undefined);
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
            channels: this.#rooms,
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

                try
                {
                    this.#onMessage(CjsRealtimeTwitchChatNormalizer.fromIrc({
                        channel,
                        tags,
                        text,
                        receivedAt: this.#clock(),
                    }));
                }
                catch
                {
                    this.#EmitStatus("degraded", "invalid_message", false);
                }
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

    #TrackValidation()
    {
        if (!this.#active || this.#operation)
        {
            return;
        }

        const operation = this.#ValidateAuthorization();

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
        if (!Array.isArray(value) || value.length === 0 || value.length > 100
            || value.some(room => typeof room !== "string"
                || !/^[a-z0-9_]{1,25}$/iu.test(room.replace(/^#/u, ""))))
        {
            throw new TypeError("Twitch IRC rooms must be 1 to 100 channel logins");
        }

        return Object.freeze([ ...new Set(value.map(room =>
            room.replace(/^#/u, "").toLowerCase())) ].sort());
    }

    /** Sanitizes adapter startup failures without reflecting credentials. */
    static startError(error)
    {
        if (error instanceof CjsRealtimeError)
        {
            return error;
        }

        return new CjsRealtimeError(
            "twitch_unavailable",
            "Twitch IRC could not be started",
            { retryable: true, cause: error },
        );
    }

}
