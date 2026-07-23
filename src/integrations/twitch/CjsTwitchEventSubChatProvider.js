import { CjsRealtimeTwitchChatNormalizer } from "./CjsRealtimeTwitchChatNormalizer.js";
import { CjsTwitchEventSubSource } from "./CjsTwitchEventSubSource.js";

/** Adds chat room and normalization policy to a static EventSub source. */
export class CjsTwitchEventSubChatProvider
{

    #active;

    #clock;

    #onMessage;

    #onStatus;

    #registrationId;

    #source;

    constructor({
        oauth,
        rooms,
        source = null,
        registrationId = "chat",
        fetch: fetchImplementation = globalThis.fetch,
        helix = null,
        session = null,
        createWebSocket,
        clock = () => Date.now(),
        endpoint,
        apiEndpoint = "https://api.twitch.tv/helix/",
        validationIntervalMs = 60 * 60 * 1000,
        keepaliveGraceMs = 1000,
        reconnectBaseMs = 250,
        reconnectMaxMs = 10000,
        subscriptionTimeoutMs = 8000,
        welcomeTimeoutMs = 8000,
    } = {})
    {
        if (source !== null && (!source || typeof source.Register !== "function"
            || typeof source.Attach !== "function" || typeof source.Detach !== "function"))
        {
            throw new TypeError("Twitch EventSub chat source is invalid");
        }

        const normalizedRooms = CjsTwitchEventSubChatProvider.normalizeRooms(rooms);

        this.kind = "twitch.eventsub";
        this.#source = source ?? new CjsTwitchEventSubSource({
            oauth,
            fetch: fetchImplementation,
            helix,
            session,
            ...(createWebSocket === undefined ? {} : { createWebSocket }),
            ...(endpoint === undefined ? {} : { endpoint }),
            clock,
            apiEndpoint,
            validationIntervalMs,
            keepaliveGraceMs,
            reconnectBaseMs,
            reconnectMaxMs,
            subscriptionTimeoutMs,
            welcomeTimeoutMs,
        });
        this.#registrationId = registrationId;
        this.#clock = clock;
        this.#source.Register({
            id: registrationId,
            requiredScopes: [ "user:read:chat" ],
            subscriptions: normalizedRooms.map(room => ({
                type: "channel.chat.message",
                version: "1",
                condition: identity => ({
                    broadcaster_user_id: room.id,
                    user_id: identity.userId,
                }),
            })),
        });
        this.#active = false;
        this.#onMessage = null;
        this.#onStatus = null;
    }

    /** Attaches chat normalization to the statically composed EventSub source. */
    async Start({ signal, onMessage, onStatus })
    {
        if (this.#active)
        {
            return;
        }

        if (!(signal instanceof AbortSignal) || typeof onMessage !== "function"
            || typeof onStatus !== "function")
        {
            throw new TypeError("Twitch EventSub provider callbacks are invalid");
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
            await this.#source.Attach(this.#registrationId, {
                signal,
                onNotification: message => this.#HandleNotification(message),
                onRevocation: () => undefined,
                onStatus: status => this.#onStatus?.(status),
            });
        }
        catch (error)
        {
            this.#active = false;
            this.#onMessage = null;
            this.#onStatus = null;

            throw error;
        }
    }

    /** Detaches chat and stops the source when it was the final family user. */
    async Stop()
    {
        this.#active = false;
        await this.#source.Detach(this.#registrationId);
        this.#onMessage = null;
        this.#onStatus = null;
    }

    #HandleNotification(message)
    {
        try
        {
            this.#onMessage(CjsRealtimeTwitchChatNormalizer.fromEventSub(
                message,
                this.#clock(),
            ));
        }
        catch
        {
            this.#onStatus?.({
                state: "degraded",
                reasonCode: "invalid_message",
                retryable: false,
                occurredAt: this.#clock(),
            });
        }
    }

    /** Validates broadcaster identities while retaining optional display labels. */
    static normalizeRooms(value)
    {
        if (!Array.isArray(value) || value.length === 0 || value.length > 100)
        {
            throw new TypeError("Twitch EventSub rooms must contain 1 to 100 broadcasters");
        }

        const rooms = new Map();

        for (const room of value)
        {
            if (!room || typeof room !== "object" || typeof room.id !== "string"
                || !/^\d+$/u.test(room.id))
            {
                throw new TypeError("Twitch EventSub rooms require numeric broadcaster ids");
            }

            rooms.set(room.id, Object.freeze({
                id: room.id,
                login: typeof room.login === "string" ? room.login.toLowerCase() : null,
                displayName: typeof room.displayName === "string" ? room.displayName : null,
            }));
        }

        return Object.freeze([ ...rooms.values() ].sort((left, right) =>
            left.id.localeCompare(right.id)));
    }

}
