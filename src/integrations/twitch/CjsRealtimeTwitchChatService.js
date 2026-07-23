import { CjsRealtimeError } from "../../realtime/CjsRealtimeError.js";
import { CjsRealtimeProtocol } from "../../realtime/CjsRealtimeProtocol.js";
import { CjsTwitchChatSource } from "./CjsTwitchChatSource.js";

const MESSAGE_TOPIC = "chat.message.received";
const STATUS_TOPIC = "chat.status.changed";

/** Exposes a Twitch transport through the provider-neutral live chat family. */
export class CjsRealtimeTwitchChatService
{

    #accepting;

    #clock;

    #context;

    #operations;

    #room;

    #recentByRoom;

    #recentMessageLimit;

    #running;

    #source;

    constructor({
        id,
        provider = null,
        source = null,
        room = null,
        clock = () => Date.now(),
        recentMessageLimit = 1000,
    } = {})
    {
        if (typeof id !== "string" || id.length === 0)
        {
            throw new TypeError("Twitch chat service requires an id");
        }

        if ((provider === null) === (source === null))
        {
            throw new TypeError("Twitch chat service requires exactly one provider or source");
        }

        const chatSource = source ?? new CjsTwitchChatSource({ provider });

        if (typeof chatSource.kind !== "string"
            || typeof chatSource.Attach !== "function"
            || typeof chatSource.Detach !== "function")
        {
            throw new TypeError("Twitch chat service source is invalid");
        }

        if (typeof clock !== "function")
        {
            throw new TypeError("Twitch chat service clock must be a function");
        }

        if (!Number.isSafeInteger(recentMessageLimit) || recentMessageLimit < 1)
        {
            throw new TypeError("Twitch chat recentMessageLimit must be a positive integer");
        }

        this.id = id;
        this.#room = CjsRealtimeTwitchChatService.normalizeRoom(room);
        this.#clock = clock;
        this.#recentMessageLimit = recentMessageLimit;
        this.#accepting = false;
        this.#context = null;
        this.#operations = new Set();
        this.#recentByRoom = new Map();
        this.#running = false;
        this.#source = chatSource;
    }

    /** Declares one future-only provider-neutral chat stream. */
    Describe()
    {
        return {
            family: "chat",
            familyVersion: 1,
            kind: this.#source.kind,
            id: this.id,
            topics: [
                { name: MESSAGE_TOPIC, recovery: "loss-tolerant" },
                { name: STATUS_TOPIC, recovery: "loss-tolerant" },
            ],
            commands: [],
            snapshot: false,
            resources: false,
        };
    }

    /** Starts one injected Twitch provider without publishing an artificial backlog. */
    async Start(context)
    {
        if (this.#running)
        {
            return;
        }

        this.#context = context;
        this.#accepting = true;
        this.#running = true;
        context.signal.addEventListener("abort", () =>
        {
            this.#accepting = false;
        }, { once: true });

        await this.#source.Attach(this, Object.freeze({
            onMessage: message => this.#OnMessage(message),
            onStatus: status => this.#OnStatus(status),
        }));
    }

    /** Stops the provider and drains publications already admitted from it. */
    async Stop()
    {
        if (!this.#running)
        {
            return;
        }

        this.#running = false;
        this.#accepting = false;
        const [ stopResult ] = await Promise.allSettled([
            this.#source.Detach(this),
            ...this.#operations,
        ]);

        this.#context = null;
        this.#operations = new Set();
        this.#recentByRoom = new Map();

        if (stopResult.status === "rejected")
        {
            throw stopResult.reason;
        }
    }

    #OnMessage(message)
    {
        if (!this.#accepting)
        {
            return;
        }

        let normalized;

        try
        {
            normalized = CjsRealtimeTwitchChatService.normalizeMessage(message);
        }
        catch
        {
            this.#OnStatus({
                state: "degraded",
                reasonCode: "invalid_message",
                retryable: false,
            });

            return;
        }

        if (!CjsRealtimeTwitchChatService.matchesRoom(this.#room, normalized.room))
        {
            return;
        }

        const operation = this.#context.Commit(async context =>
        {
            if (!this.#accepting || this.#IsDuplicate(normalized.room.id, normalized.id))
            {
                return;
            }

            await context.Publish(MESSAGE_TOPIC, normalized, {
                occurredAt: normalized.occurredAt,
            });
            this.#Remember(normalized.room.id, normalized.id);
        });

        this.#Track(operation);
    }

    #OnStatus(status)
    {
        if (!this.#accepting)
        {
            return;
        }

        let normalized;

        try
        {
            normalized = CjsRealtimeTwitchChatService.normalizeStatus(
                status,
                this.#source.kind,
                this.#clock(),
            );
        }
        catch
        {
            return;
        }

        const operation = this.#context.Publish(STATUS_TOPIC, normalized, {
            occurredAt: normalized.occurredAt,
        });

        this.#Track(operation);
    }

    #IsDuplicate(roomId, messageId)
    {
        return this.#recentByRoom.get(roomId)?.ids.has(messageId) ?? false;
    }

    #Remember(roomId, messageId)
    {
        let record = this.#recentByRoom.get(roomId);

        if (!record)
        {
            record = { ids: new Set(), order: [] };
            this.#recentByRoom.set(roomId, record);
        }

        record.ids.add(messageId);
        record.order.push(messageId);

        while (record.order.length > this.#recentMessageLimit)
        {
            record.ids.delete(record.order.shift());
        }
    }

    #Track(operation)
    {
        const tracked = Promise.resolve(operation).then(
            () => undefined,
            () => undefined,
        );

        this.#operations.add(tracked);
        tracked.then(() => this.#operations.delete(tracked));
    }

    /** Requires the stable fields shared by all live chat transports. */
    static normalizeMessage(value)
    {
        const normalized = CjsRealtimeProtocol.cloneJson(value);

        if (!normalized || typeof normalized !== "object"
            || typeof normalized.id !== "string" || normalized.id.length === 0
            || typeof normalized.text !== "string" || normalized.text.length === 0
            || normalized.deliveryMode !== "live"
            || typeof normalized.room?.id !== "string" || normalized.room.id.length === 0
            || normalized.room.provider !== "twitch"
            || typeof normalized.author?.id !== "string"
            || normalized.author.id.length === 0
            || !Number.isFinite(Date.parse(normalized.occurredAt)))
        {
            throw new CjsRealtimeError(
                "twitch_invalid_message",
                "Twitch delivered an invalid normalized chat message",
            );
        }

        return normalized;
    }

    /** Normalizes one optional exact room selector; null selects the aggregate feed. */
    static normalizeRoom(value)
    {
        if (value === null)
        {
            return null;
        }

        if (!value || typeof value !== "object" || Array.isArray(value))
        {
            throw new TypeError("Twitch chat room must be an object or null");
        }

        const id = value.id ?? null;
        const login = value.login?.replace(/^#/u, "").toLowerCase() ?? null;

        if ((id === null && login === null)
            || (id !== null && (typeof id !== "string" || !/^\d+$/u.test(id)))
            || (login !== null && (typeof login !== "string"
                || !/^[a-z0-9_]{1,25}$/u.test(login))))
        {
            throw new TypeError("Twitch chat room requires a valid id or login");
        }

        return Object.freeze({ id, login });
    }

    /** Tests a normalized message room against an exact selector. */
    static matchesRoom(selector, room)
    {
        return selector === null
            || ((selector.id === null || selector.id === room.id)
                && (selector.login === null
                    || selector.login === room.login?.toLowerCase()));
    }

    /** Creates the bounded provider status exposed to chat consumers. */
    static normalizeStatus(value, transport, receivedAt)
    {
        const states = new Set([ "degraded", "ready", "reconnecting" ]);
        const state = value?.state;
        const reasonCode = value?.reasonCode ?? null;
        const occurredAt = value?.occurredAt ?? receivedAt;

        if (!states.has(state) || (reasonCode !== null
            && (typeof reasonCode !== "string"
                || !/^[a-z][a-z0-9_]{0,63}$/u.test(reasonCode))))
        {
            throw new TypeError("Twitch provider status is invalid");
        }

        return Object.freeze({
            state,
            reasonCode,
            retryable: value?.retryable === true,
            occurredAt: new Date(occurredAt).toISOString(),
            transport,
        });
    }

}
