import {
    LIVESTREAM_ACTIVITY_TOPICS,
} from "../../realtime/livestream/CjsRealtimeLivestreamContract.js";
import { CjsRealtimeTwitchActivityNormalizer } from "./CjsRealtimeTwitchActivityNormalizer.js";
import { CjsTwitchEventSubSource } from "./CjsTwitchEventSubSource.js";

const TOPIC_DEFINITIONS = Object.freeze({
    [LIVESTREAM_ACTIVITY_TOPICS.CONTRIBUTION_RECEIVED]: Object.freeze({
        requiredScopes: Object.freeze([ "bits:read" ]),
        subscriptions: Object.freeze([ Object.freeze({
            type: "channel.cheer",
            version: "1",
            condition: room => ({ broadcaster_user_id: room.id }),
        }) ]),
    }),
    [LIVESTREAM_ACTIVITY_TOPICS.FOLLOW_RECEIVED]: Object.freeze({
        requiredScopes: Object.freeze([ "moderator:read:followers" ]),
        subscriptions: Object.freeze([ Object.freeze({
            type: "channel.follow",
            version: "2",
            condition: (room, identity) => ({
                broadcaster_user_id: room.id,
                moderator_user_id: identity.userId,
            }),
        }) ]),
    }),
    [LIVESTREAM_ACTIVITY_TOPICS.RAID_RECEIVED]: Object.freeze({
        requiredScopes: Object.freeze([]),
        subscriptions: Object.freeze([ Object.freeze({
            type: "channel.raid",
            version: "1",
            condition: room => ({ to_broadcaster_user_id: room.id }),
        }) ]),
    }),
    [LIVESTREAM_ACTIVITY_TOPICS.REWARD_REDEEMED]: Object.freeze({
        requiredScopes: Object.freeze([ "channel:read:redemptions" ]),
        subscriptions: Object.freeze([ Object.freeze({
            type: "channel.channel_points_custom_reward_redemption.add",
            version: "1",
            condition: room => ({ broadcaster_user_id: room.id }),
        }) ]),
    }),
    [LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_GIFTED]: Object.freeze({
        requiredScopes: Object.freeze([ "channel:read:subscriptions" ]),
        subscriptions: Object.freeze([ Object.freeze({
            type: "channel.subscription.gift",
            version: "1",
            condition: room => ({ broadcaster_user_id: room.id }),
        }) ]),
    }),
    [LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED]: Object.freeze({
        requiredScopes: Object.freeze([ "channel:read:subscriptions" ]),
        subscriptions: Object.freeze([
            Object.freeze({
                type: "channel.subscribe",
                version: "1",
                condition: room => ({ broadcaster_user_id: room.id }),
            }),
            Object.freeze({
                type: "channel.subscription.message",
                version: "1",
                condition: room => ({ broadcaster_user_id: room.id }),
            }),
        ]),
    }),
});

/** Adds Twitch activity declarations and normalization to an EventSub source. */
export class CjsTwitchEventSubActivityProvider
{

    #active;

    #clock;

    #onActivity;

    #onStatus;

    #registrationId;

    #source;

    #topicNames;

    constructor({
        oauth,
        rooms,
        topics = Object.values(LIVESTREAM_ACTIVITY_TOPICS),
        source = null,
        registrationId = "activity",
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
            throw new TypeError("Twitch EventSub activity source is invalid");
        }

        const normalizedRooms = CjsTwitchEventSubActivityProvider.normalizeRooms(rooms);
        const normalizedTopics = CjsTwitchEventSubActivityProvider.normalizeTopics(topics);
        const definitions = normalizedTopics.map(topic => TOPIC_DEFINITIONS[topic]);

        this.kind = "twitch.eventsub";
        this.topics = normalizedTopics;
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
        this.#topicNames = new Set(normalizedTopics);
        this.#source.Register({
            id: registrationId,
            requiredScopes: [ ...new Set(definitions.flatMap(entry =>
                entry.requiredScopes)) ].sort(),
            subscriptions: normalizedRooms.flatMap(room => definitions.flatMap(definition =>
                definition.subscriptions.map(subscription => ({
                    type: subscription.type,
                    version: subscription.version,
                    condition: identity => subscription.condition(room, identity),
                })))),
        });
        this.#active = false;
        this.#onActivity = null;
        this.#onStatus = null;
    }

    /** Attaches activity normalization to the statically composed EventSub source. */
    async Start({ signal, onActivity, onStatus })
    {
        if (this.#active)
        {
            return;
        }

        if (!(signal instanceof AbortSignal) || typeof onActivity !== "function"
            || typeof onStatus !== "function")
        {
            throw new TypeError("Twitch EventSub activity callbacks are invalid");
        }

        this.#active = true;
        this.#onActivity = onActivity;
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
                onRevocation: () => this.#onStatus?.({
                    state: "degraded",
                    reasonCode: "subscription_revoked",
                    retryable: false,
                    occurredAt: this.#clock(),
                }),
                onStatus: status => this.#onStatus?.(status),
            });
        }
        catch (error)
        {
            this.#active = false;
            this.#onActivity = null;
            this.#onStatus = null;

            throw error;
        }
    }

    /** Detaches activity and stops the source when it was the final family user. */
    async Stop()
    {
        this.#active = false;
        await this.#source.Detach(this.#registrationId);
        this.#onActivity = null;
        this.#onStatus = null;
    }

    #HandleNotification(message)
    {
        try
        {
            const activity = CjsRealtimeTwitchActivityNormalizer.fromEventSub(
                message,
                this.#clock(),
            );

            if (this.#topicNames.has(activity.topic))
            {
                this.#onActivity(activity);
            }
        }
        catch
        {
            this.#onStatus?.({
                state: "degraded",
                reasonCode: "invalid_activity",
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

            rooms.set(room.id, Object.freeze({ id: room.id }));
        }

        return Object.freeze([ ...rooms.values() ].sort((left, right) =>
            left.id.localeCompare(right.id)));
    }

    /** Validates and orders enabled canonical activity topics. */
    static normalizeTopics(value)
    {
        if (!Array.isArray(value) || value.length === 0)
        {
            throw new TypeError("Twitch EventSub activity topics must be non-empty");
        }

        const topics = [ ...new Set(value) ].sort();

        if (topics.some(topic => typeof topic !== "string" || !TOPIC_DEFINITIONS[topic]))
        {
            throw new TypeError("Twitch EventSub activity topic is unsupported");
        }

        return Object.freeze(topics);
    }

}
