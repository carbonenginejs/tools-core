import { CjsToolRealtimeError } from "../../realtime/CjsToolRealtimeError.js";
import { CjsToolRealtimeProtocol } from "../../realtime/CjsToolRealtimeProtocol.js";
import {
    CHAT_FAMILY,
    CHAT_TOPICS,
    CjsToolRealtimeChatBlockList,
    CjsToolRealtimeChatContract,
} from "../../realtime/chat/index.js";
import { TwitchChatSource } from "./TwitchChatSource.js";

const MESSAGE_TOPIC = CHAT_TOPICS.MESSAGE_RECEIVED;
const STATUS_TOPIC = CHAT_TOPICS.STATUS_CHANGED;

/** Exposes a Twitch transport through the provider-neutral live chat family. */
export class TwitchChatService
{

    #accepting;

    #blockList;

    #clock;

    #context;

    #integrationId;

    #operations;

    #room;

    #recentByRoom;

    #recentMessageLimit;

    #running;

    #source;

    #subscriptionRooms;

    /**
     * Configures a room-scoped chat projection, content policy, clock, and
     * bounded message replay window.
     */
    constructor({
        id,
        provider = null,
        source = null,
        integrationId = null,
        room = null,
        blockList = null,
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

        if (source !== null && integrationId !== null)
        {
            throw new TypeError(
                "Twitch chat integrationId belongs to the shared source",
            );
        }

        const chatSource = source ?? new TwitchChatSource({
            provider,
            integrationId,
        });

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
        this.#blockList = blockList instanceof CjsToolRealtimeChatBlockList
            ? blockList
            : new CjsToolRealtimeChatBlockList(blockList ?? {});
        this.#room = TwitchChatService.normalizeRoom(room);
        this.#integrationId = CjsToolRealtimeChatContract.normalizeNullableString(
            chatSource.integrationId ?? null,
            "source.integrationId",
            256,
        );
        this.#clock = clock;
        this.#recentMessageLimit = recentMessageLimit;
        this.#accepting = false;
        this.#context = null;
        this.#operations = new Set();
        this.#recentByRoom = new Map();
        this.#running = false;
        this.#source = chatSource;
        this.#subscriptionRooms = new Map();
    }

    /** Declares one future-only provider-neutral chat stream. */
    Describe()
    {
        return {
            family: CHAT_FAMILY,
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
            subscriptions: {
                multiple: true,
                target: this.#source.supportsDynamicRooms ? "chat.room" : null,
            },
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
        this.#subscriptionRooms = new Map();

        if (stopResult.status === "rejected")
        {
            throw stopResult.reason;
        }
    }

    /** Acquires the Twitch IRC room selected by one downstream subscription. */
    async OpenSubscription(subscription)
    {
        if (subscription.target === null)
        {
            return null;
        }

        if (!this.#source.supportsDynamicRooms)
        {
            throw new CjsToolRealtimeError(
                "subscription_target_unsupported",
                "Twitch chat source does not support dynamic room subscriptions",
            );
        }

        const target = TwitchChatService.normalizeSubscriptionTarget(
            subscription.target,
            this.#integrationId,
        );

        const roomMetadata = await this.#source.AcquireRoom(
            this,
            subscription.subscriptionId,
            target.room.login,
        );
        const resolvedTarget = Object.freeze({
            room: CjsToolRealtimeChatContract.freeze({
                ...target.room,
                id: roomMetadata?.id ?? target.room.id,
                displayName: roomMetadata?.displayName ?? null,
                ...(roomMetadata?.assets
                    ? { assets: roomMetadata.assets }
                    : {}),
            }),
        });
        this.#subscriptionRooms.set(
            subscription.subscriptionId,
            resolvedTarget.room,
        );

        return resolvedTarget;
    }

    /** Releases the upstream Twitch IRC room held by one subscription. */
    async CloseSubscription(subscription)
    {
        if (!this.#subscriptionRooms.delete(subscription.subscriptionId))
        {
            return;
        }

        await this.#source.ReleaseRoom(this, subscription.subscriptionId);
    }

    /** Selects room messages and room-scoped status for one subscription. */
    MatchesSubscription(subscription, topic, data)
    {
        const room = subscription.target?.room;

        if (!room)
        {
            return true;
        }

        if (topic === STATUS_TOPIC && data.room === null)
        {
            return true;
        }

        return CjsToolRealtimeChatContract.matchesRoomSelector(room, data.room);
    }

    /**
     * Normalizes, filters, deduplicates, and commits one provider message to the
     * realtime topic.
     */
    #OnMessage(message)
    {
        if (!this.#accepting)
        {
            return;
        }

        let normalized;

        try
        {
            normalized = TwitchChatService.normalizeMessage(
                message,
                this.#integrationId,
            );
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

        if (!TwitchChatService.matchesRoom(this.#room, normalized.room))
        {
            return;
        }

        if (this.#blockList.BlocksMessage(normalized))
        {
            return;
        }

        const operation = this.#context.Commit(async context =>
        {
            if (!this.#accepting
                || this.#IsDuplicate(normalized.room, normalized.id))
            {
                return;
            }

            await context.Publish(MESSAGE_TOPIC, normalized, {
                occurredAt: normalized.occurredAt,
            });
            this.#Remember(normalized.room, normalized.id);
        });

        this.#Track(operation);
    }

    /**
     * Normalizes a provider condition and publishes it as service status when
     * accepted.
     */
    #OnStatus(status)
    {
        if (!this.#accepting)
        {
            return;
        }

        let normalized;

        try
        {
            normalized = TwitchChatService.normalizeStatus(
                status,
                this.#source.kind,
                this.#clock(),
                this.#integrationId,
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

    /**
     * Checks whether a message identity already exists in its room's recent
     * window.
     */
    #IsDuplicate(room, messageId)
    {
        const roomKey = CjsToolRealtimeChatContract.roomKey(room);

        return this.#recentByRoom.get(roomKey)?.ids.has(messageId) ?? false;
    }

    /** Adds a message identity to its room's bounded replay window. */
    #Remember(room, messageId)
    {
        const roomKey = CjsToolRealtimeChatContract.roomKey(room);
        let record = this.#recentByRoom.get(roomKey);

        if (!record)
        {
            record = { ids: new Set(), order: [] };
            this.#recentByRoom.set(roomKey, record);
        }

        record.ids.add(messageId);
        record.order.push(messageId);

        while (record.order.length > this.#recentMessageLimit)
        {
            record.ids.delete(record.order.shift());
        }
    }

    /**
     * Holds a publication promise until settlement so stop can drain accepted
     * chat work.
     */
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
    static normalizeMessage(value, integrationId = null)
    {
        let candidate = value;

        if (integrationId !== null)
        {
            if (!CjsToolRealtimeProtocol.isRecord(value)
                || !CjsToolRealtimeProtocol.isRecord(value.room))
            {
                throw new CjsToolRealtimeError(
                    "twitch_invalid_message",
                    "Twitch delivered an invalid normalized chat message",
                );
            }

            candidate = {
                ...value,
                room: {
                    ...value.room,
                    integrationId,
                },
            };
        }

        const normalized = CjsToolRealtimeChatContract.normalizeMessage(candidate);

        if (normalized.room.provider !== "twitch"
            || !CjsToolRealtimeProtocol.isRecord(normalized.extensions.twitch))
        {
            throw new CjsToolRealtimeError(
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

    /** Normalizes a provider-neutral room target for Twitch IRC joining. */
    static normalizeSubscriptionTarget(value, integrationId = null)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value)
            || !CjsToolRealtimeProtocol.isRecord(value.room))
        {
            throw new CjsToolRealtimeError(
                "invalid_subscription_target",
                "Twitch chat target must contain a room selector",
            );
        }

        const selector = CjsToolRealtimeChatContract.normalizeRoomSelector(value.room);
        const login = selector.login?.replace(/^#/u, "").toLowerCase() ?? null;

        if (selector.provider !== "twitch"
            || selector.space !== null
            || (selector.integrationId !== null
                && selector.integrationId !== integrationId)
            || (selector.kind !== null && selector.kind !== "channel")
            || (selector.id !== null && !/^\d+$/u.test(selector.id))
            || login === null
            || !/^[a-z0-9_]{1,25}$/u.test(login))
        {
            throw new CjsToolRealtimeError(
                "invalid_subscription_target",
                "Twitch chat target must identify a channel login",
            );
        }

        return Object.freeze({
            room: CjsToolRealtimeChatContract.freeze({
                ...selector,
                integrationId,
                kind: "channel",
                login,
            }),
        });
    }

    /** Creates the bounded provider status exposed to chat consumers. */
    static normalizeStatus(value, kind, receivedAt, integrationId = null)
    {
        if (!new Set([ "twitch.eventsub", "twitch.irc" ]).has(kind))
        {
            throw new TypeError("Twitch provider status is invalid");
        }

        return CjsToolRealtimeChatContract.normalizeStatus({
            state: value?.state,
            reasonCode: value?.reasonCode ?? null,
            retryable: value?.retryable === true,
            occurredAt: new Date(value?.occurredAt ?? receivedAt).toISOString(),
            source: {
                provider: "twitch",
                integrationId,
            },
            room: null,
            extensions: {
                twitch: {
                    transport: kind.slice("twitch.".length),
                },
            },
        });
    }

}
