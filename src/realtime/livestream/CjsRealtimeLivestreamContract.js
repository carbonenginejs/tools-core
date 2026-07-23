import { CjsRealtimeProtocol } from "../CjsRealtimeProtocol.js";

export const LIVESTREAM_ACTIVITY_FAMILY = "livestream.activity";
export const LIVESTREAM_STATE_FAMILY = "livestream.state";
export const LIVESTREAM_ACTIVITY_TOPICS = Object.freeze({
    CONTRIBUTION_RECEIVED: "livestream.activity.contribution.received",
    FOLLOW_RECEIVED: "livestream.activity.follow.received",
    RAID_RECEIVED: "livestream.activity.raid.received",
    REWARD_REDEEMED: "livestream.activity.reward.redeemed",
    SUBSCRIPTION_GIFTED: "livestream.activity.subscription.gifted",
    SUBSCRIPTION_RECEIVED: "livestream.activity.subscription.received",
});
export const LIVESTREAM_STATE_TOPICS = Object.freeze({
    CHANGED: "livestream.state.changed",
});

const ACTIVITY_TOPICS = new Set(Object.values(LIVESTREAM_ACTIVITY_TOPICS));
const CHANGE_FIELDS = Object.freeze([
    "online",
    "streamId",
    "startedAt",
    "endedAt",
    "title",
    "language",
    "mature",
    "category",
    "viewers",
]);

/** Validates provider-neutral livestream activity and state payloads. */
export class CjsRealtimeLivestreamContract
{

    /** Normalizes one live activity payload for its declared canonical topic. */
    static normalizeActivity(topic, value)
    {
        if (!ACTIVITY_TOPICS.has(topic))
        {
            throw new TypeError(`Unsupported livestream activity topic: ${topic}`);
        }

        const result = {
            ...CjsRealtimeLivestreamContract.normalizeEventBase(value),
            actor: CjsRealtimeLivestreamContract.normalizeActor(value.actor, {
                nullable: [
                    LIVESTREAM_ACTIVITY_TOPICS.CONTRIBUTION_RECEIVED,
                    LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_GIFTED,
                ].includes(topic),
            }),
        };

        if (topic === LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED)
        {
            result.subscription = CjsRealtimeLivestreamContract.normalizeSubscription(
                value.subscription,
            );
        }
        else if (topic === LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_GIFTED)
        {
            result.gift = CjsRealtimeLivestreamContract.normalizeGift(value.gift);
        }
        else if (topic === LIVESTREAM_ACTIVITY_TOPICS.RAID_RECEIVED)
        {
            result.raid = CjsRealtimeLivestreamContract.normalizeRaid(value.raid);
        }
        else if (topic === LIVESTREAM_ACTIVITY_TOPICS.CONTRIBUTION_RECEIVED)
        {
            result.contribution = CjsRealtimeLivestreamContract.normalizeContribution(
                value.contribution,
            );
        }
        else if (topic === LIVESTREAM_ACTIVITY_TOPICS.REWARD_REDEEMED)
        {
            result.reward = CjsRealtimeLivestreamContract.normalizeReward(value.reward);
        }

        return CjsRealtimeLivestreamContract.freeze(result);
    }

    /** Normalizes one atomic state patch. Omitted fields remain unchanged. */
    static normalizeStateChange(value)
    {
        const base = CjsRealtimeLivestreamContract.normalizeEventBase(value);
        const changes = CjsRealtimeLivestreamContract.normalizeStream(
            value.changes,
            { partial: true },
        );

        if (Object.keys(changes).length === 0)
        {
            throw new TypeError("Livestream state changes must contain at least one field");
        }

        return CjsRealtimeLivestreamContract.freeze({
            ...base,
            changes,
        });
    }

    /** Normalizes a deterministic materialized snapshot for one or more sources. */
    static normalizeStateSnapshot(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value) || !Array.isArray(value.states))
        {
            throw new TypeError("Livestream state snapshot must contain states");
        }

        const observedAt = CjsRealtimeLivestreamContract.normalizeTime(
            value.observedAt,
            "observedAt",
        );
        const identities = new Set();
        const states = value.states.map(entry =>
        {
            if (!CjsRealtimeProtocol.isRecord(entry))
            {
                throw new TypeError("Livestream snapshot state must be an object");
            }

            const source = CjsRealtimeLivestreamContract.normalizeSource(entry.source);
            const identity = `${source.provider}:${source.channelId}`;

            if (identities.has(identity))
            {
                throw new TypeError(`Duplicate livestream snapshot source: ${identity}`);
            }

            identities.add(identity);

            return {
                source,
                stream: CjsRealtimeLivestreamContract.normalizeStream(entry.stream),
                extensions: CjsRealtimeLivestreamContract.normalizeExtensions(
                    entry.extensions,
                    source.provider,
                ),
            };
        }).sort((left, right) =>
        {
            const provider = left.source.provider.localeCompare(right.source.provider);

            return provider || left.source.channelId.localeCompare(right.source.channelId);
        });

        return CjsRealtimeLivestreamContract.freeze({ observedAt, states });
    }

    /** Normalizes fields shared by all live provider events. */
    static normalizeEventBase(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Livestream event must be an object");
        }

        const source = CjsRealtimeLivestreamContract.normalizeSource(value.source);

        return {
            id: CjsRealtimeLivestreamContract.normalizeString(value.id, "id", 256),
            occurredAt: CjsRealtimeLivestreamContract.normalizeTime(
                value.occurredAt,
                "occurredAt",
            ),
            deliveryMode: CjsRealtimeLivestreamContract.requireValue(
                value.deliveryMode,
                [ "live" ],
                "deliveryMode",
            ),
            source,
            extensions: CjsRealtimeLivestreamContract.normalizeExtensions(
                value.extensions,
                source.provider,
            ),
        };
    }

    /** Normalizes the channel identity shared by activity and state families. */
    static normalizeSource(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value)
            || typeof value.provider !== "string"
            || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.provider))
        {
            throw new TypeError("Livestream source provider is invalid");
        }

        return {
            provider: value.provider,
            channelId: CjsRealtimeLivestreamContract.normalizeString(
                value.channelId,
                "source.channelId",
                256,
            ),
            channelLogin: CjsRealtimeLivestreamContract.normalizeNullableString(
                value.channelLogin,
                "source.channelLogin",
                256,
            ),
            channelDisplayName: CjsRealtimeLivestreamContract.normalizeNullableString(
                value.channelDisplayName,
                "source.channelDisplayName",
                256,
            ),
        };
    }

    /** Normalizes a provider user identity or an explicitly anonymous actor. */
    static normalizeActor(value, { nullable = false } = {})
    {
        if (value === null && nullable)
        {
            return null;
        }

        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Livestream actor is invalid");
        }

        return {
            id: CjsRealtimeLivestreamContract.normalizeString(
                value.id,
                "actor.id",
                256,
            ),
            login: CjsRealtimeLivestreamContract.normalizeNullableString(
                value.login,
                "actor.login",
                256,
            ),
            displayName: CjsRealtimeLivestreamContract.normalizeNullableString(
                value.displayName,
                "actor.displayName",
                256,
            ),
        };
    }

    /** Normalizes subscription beneficiary semantics across providers. */
    static normalizeSubscription(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Livestream subscription is invalid");
        }

        return {
            kind: CjsRealtimeLivestreamContract.requireValue(
                value.kind,
                [ "gift", "new", "renewal" ],
                "subscription.kind",
            ),
            giftedBy: CjsRealtimeLivestreamContract.normalizeActor(value.giftedBy, {
                nullable: true,
            }),
        };
    }

    /** Normalizes one provider gift batch. */
    static normalizeGift(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Livestream subscription gift is invalid");
        }

        return {
            count: CjsRealtimeLivestreamContract.normalizeInteger(
                value.count,
                "gift.count",
                { minimum: 1 },
            ),
        };
    }

    /** Normalizes one incoming raid. */
    static normalizeRaid(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Livestream raid is invalid");
        }

        return {
            viewers: CjsRealtimeLivestreamContract.normalizeInteger(
                value.viewers,
                "raid.viewers",
                { minimum: 0 },
            ),
        };
    }

    /** Normalizes a fungible provider contribution without guessing currency. */
    static normalizeContribution(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Livestream contribution is invalid");
        }

        return {
            amount: CjsRealtimeLivestreamContract.normalizeInteger(
                value.amount,
                "contribution.amount",
                { minimum: 1 },
            ),
            unit: CjsRealtimeLivestreamContract.normalizeString(
                value.unit,
                "contribution.unit",
                64,
            ),
            message: CjsRealtimeLivestreamContract.normalizeNullableString(
                value.message,
                "contribution.message",
                2048,
            ),
        };
    }

    /** Normalizes a provider reward redemption. */
    static normalizeReward(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Livestream reward is invalid");
        }

        return {
            id: CjsRealtimeLivestreamContract.normalizeString(
                value.id,
                "reward.id",
                256,
            ),
            title: CjsRealtimeLivestreamContract.normalizeString(
                value.title,
                "reward.title",
                512,
            ),
            cost: CjsRealtimeLivestreamContract.normalizeInteger(
                value.cost,
                "reward.cost",
                { minimum: 0 },
            ),
            input: CjsRealtimeLivestreamContract.normalizeNullableString(
                value.input,
                "reward.input",
                2048,
            ),
            status: CjsRealtimeLivestreamContract.requireValue(
                value.status,
                [ "cancelled", "fulfilled", "pending" ],
                "reward.status",
            ),
        };
    }

    /** Normalizes a full stream value or an event patch. */
    static normalizeStream(value, { partial = false } = {})
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Livestream state value is invalid");
        }

        const result = {};

        for (const field of CHANGE_FIELDS)
        {
            if (!partial || Object.hasOwn(value, field))
            {
                result[field] = CjsRealtimeLivestreamContract.normalizeStreamField(
                    field,
                    value[field],
                );
            }
        }

        return result;
    }

    /** Normalizes a field from a materialized stream or partial patch. */
    static normalizeStreamField(field, value)
    {
        if (field === "online")
        {
            if (typeof value !== "boolean")
            {
                throw new TypeError("Livestream state online must be boolean");
            }

            return value;
        }

        if ([ "streamId", "title", "language" ].includes(field))
        {
            return CjsRealtimeLivestreamContract.normalizeNullableString(
                value,
                `stream.${field}`,
                field === "title" ? 2048 : 256,
            );
        }

        if ([ "startedAt", "endedAt" ].includes(field))
        {
            return value === null
                ? null
                : CjsRealtimeLivestreamContract.normalizeTime(value, `stream.${field}`);
        }

        if (field === "mature")
        {
            if (value !== null && typeof value !== "boolean")
            {
                throw new TypeError("Livestream state mature must be boolean or null");
            }

            return value;
        }

        if (field === "viewers")
        {
            return value === null
                ? null
                : CjsRealtimeLivestreamContract.normalizeInteger(
                    value,
                    "stream.viewers",
                    { minimum: 0 },
                );
        }

        if (field === "category")
        {
            if (value === null)
            {
                return null;
            }

            if (!CjsRealtimeProtocol.isRecord(value))
            {
                throw new TypeError("Livestream state category is invalid");
            }

            return {
                id: CjsRealtimeLivestreamContract.normalizeString(
                    value.id,
                    "category.id",
                    256,
                ),
                name: CjsRealtimeLivestreamContract.normalizeString(
                    value.name,
                    "category.name",
                    512,
                ),
            };
        }

        throw new TypeError(`Unsupported livestream state field: ${field}`);
    }

    /** Clones provider extensions while requiring source-key containment. */
    static normalizeExtensions(value, provider)
    {
        if (!CjsRealtimeProtocol.isRecord(value)
            || !CjsRealtimeProtocol.isRecord(value[provider]))
        {
            throw new TypeError(`Livestream extensions.${provider} must be an object`);
        }

        return CjsRealtimeProtocol.cloneJson(value);
    }

    /** Converts an RFC 3339-compatible time into canonical UTC form. */
    static normalizeTime(value, label)
    {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(value))
        {
            throw new TypeError(`Livestream ${label} is invalid`);
        }

        const milliseconds = Date.parse(value);

        if (!Number.isFinite(milliseconds))
        {
            throw new TypeError(`Livestream ${label} is invalid`);
        }

        return new Date(milliseconds).toISOString();
    }

    /** Normalizes a required bounded string. */
    static normalizeString(value, label, maximum)
    {
        if (typeof value !== "string" || value.length < 1 || value.length > maximum)
        {
            throw new TypeError(`Livestream ${label} must be a bounded string`);
        }

        return value;
    }

    /** Normalizes an explicitly nullable bounded string. */
    static normalizeNullableString(value, label, maximum)
    {
        return value === null
            ? null
            : CjsRealtimeLivestreamContract.normalizeString(value, label, maximum);
    }

    /** Normalizes one safe integer with a declared lower bound. */
    static normalizeInteger(value, label, { minimum })
    {
        if (!Number.isSafeInteger(value) || value < minimum)
        {
            throw new TypeError(`Livestream ${label} is invalid`);
        }

        return value;
    }

    /** Requires one value from a stable contract enumeration. */
    static requireValue(value, allowed, label)
    {
        if (!allowed.includes(value))
        {
            throw new TypeError(`Livestream ${label} is invalid`);
        }

        return value;
    }

    /** Deep-freezes a normalized JSON-compatible payload. */
    static freeze(value)
    {
        if (value && typeof value === "object" && !Object.isFrozen(value))
        {
            Object.freeze(value);

            for (const entry of Object.values(value))
            {
                CjsRealtimeLivestreamContract.freeze(entry);
            }
        }

        return value;
    }

}
