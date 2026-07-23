import {
    CjsRealtimeLivestreamContract,
    LIVESTREAM_ACTIVITY_TOPICS,
} from "../../realtime/livestream/CjsRealtimeLivestreamContract.js";

/** Maps Twitch EventSub notifications into provider-neutral activity events. */
export class CjsRealtimeTwitchActivityNormalizer
{

    /** Normalizes one supported Twitch EventSub activity notification. */
    static fromEventSub(message, receivedAt = Date.now())
    {
        const metadata = message?.metadata;
        const subscription = message?.payload?.subscription;
        const event = message?.payload?.event;
        const type = metadata?.subscription_type;
        const version = metadata?.subscription_version;

        if (metadata?.message_type !== "notification"
            || typeof type !== "string"
            || typeof version !== "string"
            || subscription?.type !== type
            || String(subscription?.version) !== version
            || !event || typeof event !== "object")
        {
            throw new TypeError("Twitch EventSub activity notification is invalid");
        }

        const extension = CjsRealtimeTwitchActivityNormalizer.extension(
            metadata,
            subscription,
        );
        let topic;
        let value;

        if (type === "channel.subscribe" && version === "1")
        {
            topic = LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED;
            Object.assign(extension, {
                tier: CjsRealtimeTwitchActivityNormalizer.string(event.tier),
                isGift: event.is_gift === true,
            });
            value = {
                ...CjsRealtimeTwitchActivityNormalizer.common(
                    event,
                    metadata,
                    receivedAt,
                ),
                actor: CjsRealtimeTwitchActivityNormalizer.actor(event, "user"),
                subscription: {
                    kind: event.is_gift === true ? "gift" : "new",
                    giftedBy: null,
                },
            };
        }
        else if (type === "channel.subscription.message" && version === "1")
        {
            topic = LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED;
            Object.assign(extension, {
                tier: CjsRealtimeTwitchActivityNormalizer.string(event.tier),
                cumulativeMonths: CjsRealtimeTwitchActivityNormalizer.integer(
                    event.cumulative_months,
                ),
                durationMonths: CjsRealtimeTwitchActivityNormalizer.integer(
                    event.duration_months,
                ),
                message: CjsRealtimeTwitchActivityNormalizer.string(event.message?.text),
            });
            value = {
                ...CjsRealtimeTwitchActivityNormalizer.common(
                    event,
                    metadata,
                    receivedAt,
                ),
                actor: CjsRealtimeTwitchActivityNormalizer.actor(event, "user"),
                subscription: {
                    kind: "renewal",
                    giftedBy: null,
                },
            };
        }
        else if (type === "channel.subscription.gift" && version === "1")
        {
            topic = LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_GIFTED;
            Object.assign(extension, {
                tier: CjsRealtimeTwitchActivityNormalizer.string(event.tier),
                cumulativeTotal: CjsRealtimeTwitchActivityNormalizer.integer(
                    event.cumulative_total,
                ),
                isAnonymous: event.is_anonymous === true,
            });
            value = {
                ...CjsRealtimeTwitchActivityNormalizer.common(
                    event,
                    metadata,
                    receivedAt,
                ),
                actor: event.is_anonymous === true
                    ? null
                    : CjsRealtimeTwitchActivityNormalizer.actor(event, "user"),
                gift: {
                    count: CjsRealtimeTwitchActivityNormalizer.requiredInteger(event.total),
                },
            };
        }
        else if (type === "channel.follow" && version === "2")
        {
            topic = LIVESTREAM_ACTIVITY_TOPICS.FOLLOW_RECEIVED;
            value = {
                ...CjsRealtimeTwitchActivityNormalizer.common(
                    event,
                    metadata,
                    receivedAt,
                    { occurredAt: event.followed_at },
                ),
                actor: CjsRealtimeTwitchActivityNormalizer.actor(event, "user"),
            };
        }
        else if (type === "channel.raid" && version === "1")
        {
            topic = LIVESTREAM_ACTIVITY_TOPICS.RAID_RECEIVED;
            value = {
                ...CjsRealtimeTwitchActivityNormalizer.common(
                    event,
                    metadata,
                    receivedAt,
                    { sourcePrefix: "to_broadcaster" },
                ),
                actor: CjsRealtimeTwitchActivityNormalizer.actor(
                    event,
                    "from_broadcaster_user",
                ),
                raid: {
                    viewers: CjsRealtimeTwitchActivityNormalizer.requiredInteger(
                        event.viewers,
                        { minimum: 0 },
                    ),
                },
            };
        }
        else if (type === "channel.cheer" && version === "1")
        {
            topic = LIVESTREAM_ACTIVITY_TOPICS.CONTRIBUTION_RECEIVED;
            Object.assign(extension, { isAnonymous: event.is_anonymous === true });
            value = {
                ...CjsRealtimeTwitchActivityNormalizer.common(
                    event,
                    metadata,
                    receivedAt,
                ),
                actor: event.is_anonymous === true
                    ? null
                    : CjsRealtimeTwitchActivityNormalizer.actor(event, "user"),
                contribution: {
                    amount: CjsRealtimeTwitchActivityNormalizer.requiredInteger(event.bits),
                    unit: "bits",
                    message: CjsRealtimeTwitchActivityNormalizer.string(event.message),
                },
            };
        }
        else if (type === "channel.channel_points_custom_reward_redemption.add"
            && version === "1")
        {
            topic = LIVESTREAM_ACTIVITY_TOPICS.REWARD_REDEEMED;
            Object.assign(extension, {
                providerStatus: CjsRealtimeTwitchActivityNormalizer.string(event.status),
            });
            value = {
                ...CjsRealtimeTwitchActivityNormalizer.common(
                    event,
                    metadata,
                    receivedAt,
                    { id: event.id, occurredAt: event.redeemed_at },
                ),
                actor: CjsRealtimeTwitchActivityNormalizer.actor(event, "user"),
                reward: {
                    id: CjsRealtimeTwitchActivityNormalizer.requiredString(event.reward?.id),
                    title: CjsRealtimeTwitchActivityNormalizer.requiredString(
                        event.reward?.title,
                    ),
                    cost: CjsRealtimeTwitchActivityNormalizer.requiredInteger(
                        event.reward?.cost,
                        { minimum: 0 },
                    ),
                    input: CjsRealtimeTwitchActivityNormalizer.string(event.user_input),
                    status: CjsRealtimeTwitchActivityNormalizer.rewardStatus(event.status),
                },
            };
        }
        else
        {
            throw new TypeError(`Unsupported Twitch EventSub activity: ${type}@${version}`);
        }

        value.extensions = { twitch: extension };

        return Object.freeze({
            topic,
            data: CjsRealtimeLivestreamContract.normalizeActivity(topic, value),
        });
    }

    /** Builds fields shared by Twitch activity payloads. */
    static common(event, metadata, receivedAt, {
        id = metadata.message_id,
        occurredAt = metadata.message_timestamp,
        sourcePrefix = "broadcaster",
    } = {})
    {
        const fallback = new Date(receivedAt).toISOString();

        return {
            id: CjsRealtimeTwitchActivityNormalizer.requiredString(id),
            occurredAt: CjsRealtimeTwitchActivityNormalizer.string(occurredAt) ?? fallback,
            deliveryMode: "live",
            source: {
                provider: "twitch",
                channelId: CjsRealtimeTwitchActivityNormalizer.requiredString(
                    event[`${sourcePrefix}_user_id`],
                ),
                channelLogin: CjsRealtimeTwitchActivityNormalizer.string(
                    event[`${sourcePrefix}_user_login`],
                )?.toLowerCase() ?? null,
                channelDisplayName: CjsRealtimeTwitchActivityNormalizer.string(
                    event[`${sourcePrefix}_user_name`],
                ),
            },
        };
    }

    /** Builds one disclosed Twitch user or broadcaster identity. */
    static actor(event, prefix)
    {
        return {
            id: CjsRealtimeTwitchActivityNormalizer.requiredString(
                event[`${prefix}_id`],
            ),
            login: CjsRealtimeTwitchActivityNormalizer.string(
                event[`${prefix}_login`],
            )?.toLowerCase() ?? null,
            displayName: CjsRealtimeTwitchActivityNormalizer.string(
                event[`${prefix}_name`],
            ),
        };
    }

    /** Retains bounded Twitch routing evidence without credentials or raw frames. */
    static extension(metadata, subscription)
    {
        return {
            transport: "eventsub",
            eventSubType: metadata.subscription_type,
            eventSubVersion: metadata.subscription_version,
            notificationId: CjsRealtimeTwitchActivityNormalizer.string(metadata.message_id),
            subscriptionId: CjsRealtimeTwitchActivityNormalizer.string(subscription.id),
        };
    }

    /** Maps Twitch reward status names into the canonical state set. */
    static rewardStatus(value)
    {
        const statuses = {
            canceled: "cancelled",
            cancelled: "cancelled",
            fulfilled: "fulfilled",
            unfulfilled: "pending",
        };
        const status = statuses[value];

        if (!status)
        {
            throw new TypeError("Twitch reward status is invalid");
        }

        return status;
    }

    /** Reads a non-empty string or returns null. */
    static string(value)
    {
        return typeof value === "string" && value.length > 0 ? value : null;
    }

    /** Requires a non-empty string. */
    static requiredString(value)
    {
        const result = CjsRealtimeTwitchActivityNormalizer.string(value);

        if (result === null)
        {
            throw new TypeError("Twitch activity identity is invalid");
        }

        return result;
    }

    /** Reads a non-negative safe integer or returns null. */
    static integer(value)
    {
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }

    /** Requires a safe integer above the declared minimum. */
    static requiredInteger(value, { minimum = 1 } = {})
    {
        if (!Number.isSafeInteger(value) || value < minimum)
        {
            throw new TypeError("Twitch activity count is invalid");
        }

        return value;
    }

}
