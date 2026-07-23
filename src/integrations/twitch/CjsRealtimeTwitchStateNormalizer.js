import {
    CjsRealtimeLivestreamContract,
    LIVESTREAM_STATE_TOPICS,
} from "../../realtime/livestream/CjsRealtimeLivestreamContract.js";

/** Maps Twitch EventSub notifications into provider-neutral state patches. */
export class CjsRealtimeTwitchStateNormalizer
{

    /** Normalizes one supported Twitch EventSub state notification. */
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
            throw new TypeError("Twitch EventSub state notification is invalid");
        }

        const occurredAt = CjsRealtimeTwitchStateNormalizer.string(
            metadata.message_timestamp,
        ) ?? new Date(receivedAt).toISOString();
        const extension = {
            transport: "eventsub",
            eventSubType: type,
            eventSubVersion: version,
            notificationId: CjsRealtimeTwitchStateNormalizer.string(metadata.message_id),
            subscriptionId: CjsRealtimeTwitchStateNormalizer.string(subscription.id),
        };
        let changes;

        if (type === "stream.online" && version === "1")
        {
            changes = {
                online: true,
                streamId: CjsRealtimeTwitchStateNormalizer.requiredString(event.id),
                startedAt: CjsRealtimeTwitchStateNormalizer.requiredString(event.started_at),
                endedAt: null,
            };
            extension.streamType = CjsRealtimeTwitchStateNormalizer.string(event.type);
        }
        else if (type === "stream.offline" && version === "1")
        {
            changes = {
                online: false,
                streamId: null,
                endedAt: occurredAt,
                viewers: null,
            };
        }
        else if (type === "channel.update" && version === "2")
        {
            const categoryId = CjsRealtimeTwitchStateNormalizer.string(event.category_id);
            const categoryName = CjsRealtimeTwitchStateNormalizer.string(
                event.category_name,
            );

            changes = {
                title: CjsRealtimeTwitchStateNormalizer.string(event.title),
                language: CjsRealtimeTwitchStateNormalizer.string(event.language),
                category: categoryId && categoryName
                    ? { id: categoryId, name: categoryName }
                    : null,
            };
            extension.contentClassificationLabels = Array.isArray(
                event.content_classification_labels,
            ) ? event.content_classification_labels.filter(value =>
                    typeof value === "string") : [];
        }
        else
        {
            throw new TypeError(`Unsupported Twitch EventSub state: ${type}@${version}`);
        }

        const value = {
            id: CjsRealtimeTwitchStateNormalizer.requiredString(metadata.message_id),
            occurredAt,
            deliveryMode: "live",
            source: CjsRealtimeTwitchStateNormalizer.source(event),
            changes,
            extensions: { twitch: extension },
        };

        return Object.freeze({
            topic: LIVESTREAM_STATE_TOPICS.CHANGED,
            data: CjsRealtimeLivestreamContract.normalizeStateChange(value),
        });
    }

    /** Builds the destination Twitch broadcaster identity. */
    static source(event)
    {
        return {
            provider: "twitch",
            channelId: CjsRealtimeTwitchStateNormalizer.requiredString(
                event.broadcaster_user_id,
            ),
            channelLogin: CjsRealtimeTwitchStateNormalizer.string(
                event.broadcaster_user_login,
            )?.toLowerCase() ?? null,
            channelDisplayName: CjsRealtimeTwitchStateNormalizer.string(
                event.broadcaster_user_name,
            ),
        };
    }

    /** Reads a non-empty string or returns null. */
    static string(value)
    {
        return typeof value === "string" && value.length > 0 ? value : null;
    }

    /** Requires a non-empty string. */
    static requiredString(value)
    {
        const result = CjsRealtimeTwitchStateNormalizer.string(value);

        if (result === null)
        {
            throw new TypeError("Twitch state identity is invalid");
        }

        return result;
    }

}
