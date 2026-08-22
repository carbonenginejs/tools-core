import crypto from "node:crypto";

import {
    CjsToolRealtimeLivestreamContract,
    LIVESTREAM_ACTIVITY_TOPICS,
    LIVESTREAM_STATE_TOPICS,
} from "../../realtime/livestream/CjsToolRealtimeLivestreamContract.js";
import { CjsToolWebhookError } from "../../webhook/CjsToolWebhookError.js";

export const KICK_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----`;

const EVENT_TYPES = new Set([
    "channel.followed",
    "channel.reward.redemption.updated",
    "channel.subscription.gifts",
    "channel.subscription.new",
    "channel.subscription.renewal",
    "kicks.gifted",
    "livestream.metadata.updated",
    "livestream.status.updated",
]);

/** Authenticates and normalizes official Kick webhook deliveries. */
export class KickWebhookHandler
{

    #maxFutureSkewMs;

    #maxMessageAgeMs;

    #publicKey;

    constructor({
        publicKey = KICK_WEBHOOK_PUBLIC_KEY,
        maxMessageAgeMs = 10 * 60 * 1000,
        maxFutureSkewMs = 60 * 1000,
    } = {})
    {
        if (!Number.isSafeInteger(maxMessageAgeMs) || maxMessageAgeMs < 1
            || !Number.isSafeInteger(maxFutureSkewMs) || maxFutureSkewMs < 0)
        {
            throw new TypeError("Kick webhook time limits are invalid");
        }

        let key;

        try
        {
            key = publicKey?.type === "public"
                ? publicKey
                : crypto.createPublicKey(publicKey);
        }
        catch (error)
        {
            throw new TypeError("Kick webhook public key is invalid", { cause: error });
        }

        if (key.asymmetricKeyType !== "rsa")
        {
            throw new TypeError("Kick webhook public key must be RSA");
        }

        this.#publicKey = key;
        this.#maxMessageAgeMs = maxMessageAgeMs;
        this.#maxFutureSkewMs = maxFutureSkewMs;
    }

    /** Verifies signed Kick identity, raw bytes, event metadata, and freshness. */
    AuthenticateWebhook(request)
    {
        const messageId = KickWebhookHandler.header(
            request.headers,
            "kick-event-message-id",
        );
        const subscriptionId = KickWebhookHandler.header(
            request.headers,
            "kick-event-subscription-id",
        );
        const signatureText = KickWebhookHandler.header(
            request.headers,
            "kick-event-signature",
        );
        const messageTimestamp = KickWebhookHandler.header(
            request.headers,
            "kick-event-message-timestamp",
        );
        const eventType = KickWebhookHandler.header(
            request.headers,
            "kick-event-type",
        );
        const eventVersion = KickWebhookHandler.header(
            request.headers,
            "kick-event-version",
        );

        if (!/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(messageId)
            || !/^[0-9A-HJKMNP-TV-Z]{26}$/u.test(subscriptionId)
            || !EVENT_TYPES.has(eventType) || eventVersion !== "1"
            || !(request.body instanceof Uint8Array))
        {
            throw KickWebhookHandler.authenticationError();
        }

        const sentAt = Date.parse(messageTimestamp);
        const receivedAt = Date.parse(request.receivedAt);

        if (!Number.isFinite(sentAt) || !Number.isFinite(receivedAt)
            || sentAt < receivedAt - this.#maxMessageAgeMs
            || sentAt > receivedAt + this.#maxFutureSkewMs)
        {
            throw KickWebhookHandler.authenticationError();
        }

        const signature = KickWebhookHandler.decodeSignature(signatureText);
        const signed = Buffer.concat([
            Buffer.from(`${messageId}.${messageTimestamp}.`, "utf8"),
            Buffer.from(request.body),
        ]);
        let verified = false;

        try
        {
            verified = crypto.verify("RSA-SHA256", signed, this.#publicKey, signature);
        }
        catch
        {
            verified = false;
        }

        if (!verified)
        {
            throw KickWebhookHandler.authenticationError();
        }

        return Object.freeze({
            provider: "kick",
            messageId,
            subscriptionId,
            messageTimestamp: new Date(sentAt).toISOString(),
            eventType,
            eventVersion,
        });
    }

    /** Maps one authenticated Kick payload into canonical service events. */
    HandleWebhook(request)
    {
        const authentication = request.authentication;
        let payload;

        try
        {
            payload = JSON.parse(Buffer.from(request.body).toString("utf8"));
        }
        catch (error)
        {
            throw new CjsToolWebhookError(
                "invalid_delivery",
                "Kick webhook body is not valid JSON",
                { statusCode: 400, cause: error },
            );
        }

        if (!payload || typeof payload !== "object" || Array.isArray(payload))
        {
            throw new CjsToolWebhookError(
                "invalid_delivery",
                "Kick webhook body is invalid",
                { statusCode: 400 },
            );
        }

        const events = KickWebhookHandler.normalize(
            authentication,
            payload,
            request.receivedAt,
        );

        return {
            deliveryId: authentication.messageId,
            events: events.map(event => ({
                topic: event.topic,
                occurredAt: event.data.occurredAt,
                data: event.data,
            })),
            response: { statusCode: 204 },
        };
    }

    /** Normalizes one supported event type, including gift fan-out. */
    static normalize(authentication, payload, receivedAt)
    {
        const type = authentication.eventType;

        if (type === "channel.followed")
        {
            return [ KickWebhookHandler.activity(
                LIVESTREAM_ACTIVITY_TOPICS.FOLLOW_RECEIVED,
                authentication,
                payload,
                receivedAt,
                {
                    actor: KickWebhookHandler.actor(payload.follower),
                    extension: { timeSource: "received" },
                },
            ) ];
        }

        if ([ "channel.subscription.new", "channel.subscription.renewal" ].includes(type))
        {
            return [ KickWebhookHandler.activity(
                LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
                authentication,
                payload,
                payload.created_at ?? receivedAt,
                {
                    actor: KickWebhookHandler.actor(payload.subscriber),
                    fields: {
                        subscription: {
                            kind: type.endsWith(".new") ? "new" : "renewal",
                            giftedBy: null,
                        },
                    },
                    extension: {
                        duration: KickWebhookHandler.integer(payload.duration),
                        expiresAt: KickWebhookHandler.string(payload.expires_at),
                    },
                },
            ) ];
        }

        if (type === "channel.subscription.gifts")
        {
            const giftees = Array.isArray(payload.giftees) ? payload.giftees : [];
            const gifter = payload.gifter?.is_anonymous === true
                ? null
                : KickWebhookHandler.actor(payload.gifter);
            const occurredAt = payload.created_at ?? receivedAt;
            const batch = KickWebhookHandler.activity(
                LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_GIFTED,
                authentication,
                payload,
                occurredAt,
                {
                    id: `${authentication.messageId}:batch`,
                    actor: gifter,
                    fields: { gift: { count: giftees.length } },
                    extension: {
                        expiresAt: KickWebhookHandler.string(payload.expires_at),
                        isAnonymous: gifter === null,
                    },
                },
            );
            const beneficiaries = giftees.map((giftee, index) =>
                KickWebhookHandler.activity(
                    LIVESTREAM_ACTIVITY_TOPICS.SUBSCRIPTION_RECEIVED,
                    authentication,
                    payload,
                    occurredAt,
                    {
                        id: `${authentication.messageId}:beneficiary:${index}`,
                        actor: KickWebhookHandler.actor(giftee),
                        fields: {
                            subscription: { kind: "gift", giftedBy: gifter },
                        },
                        extension: {
                            giftIndex: index,
                            expiresAt: KickWebhookHandler.string(payload.expires_at),
                        },
                    },
                ));

            return [ batch, ...beneficiaries ];
        }

        if (type === "channel.reward.redemption.updated")
        {
            return [ KickWebhookHandler.activity(
                LIVESTREAM_ACTIVITY_TOPICS.REWARD_REDEEMED,
                authentication,
                payload,
                payload.redeemed_at ?? receivedAt,
                {
                    id: KickWebhookHandler.requiredString(payload.id),
                    actor: KickWebhookHandler.actor(payload.redeemer),
                    fields: {
                        reward: {
                            id: KickWebhookHandler.requiredString(payload.reward?.id),
                            title: KickWebhookHandler.requiredString(payload.reward?.title),
                            cost: KickWebhookHandler.requiredInteger(
                                payload.reward?.cost,
                                { minimum: 0 },
                            ),
                            input: KickWebhookHandler.string(payload.user_input),
                            status: KickWebhookHandler.rewardStatus(payload.status),
                        },
                    },
                    extension: { providerStatus: KickWebhookHandler.string(payload.status) },
                },
            ) ];
        }

        if (type === "kicks.gifted")
        {
            return [ KickWebhookHandler.activity(
                LIVESTREAM_ACTIVITY_TOPICS.CONTRIBUTION_RECEIVED,
                authentication,
                payload,
                payload.created_at ?? receivedAt,
                {
                    actor: KickWebhookHandler.actor(payload.sender),
                    fields: {
                        contribution: {
                            amount: KickWebhookHandler.requiredInteger(
                                payload.gift?.amount,
                            ),
                            unit: "kicks",
                            message: KickWebhookHandler.string(payload.gift?.message),
                        },
                    },
                    extension: {
                        name: KickWebhookHandler.string(payload.gift?.name),
                        type: KickWebhookHandler.string(payload.gift?.type),
                        tier: KickWebhookHandler.string(payload.gift?.tier),
                        pinnedTimeSeconds: KickWebhookHandler.integer(
                            payload.gift?.pinned_time_seconds,
                        ),
                    },
                },
            ) ];
        }

        if (type === "livestream.status.updated")
        {
            const online = payload.is_live === true;
            const occurredAt = online
                ? payload.started_at ?? receivedAt
                : payload.ended_at ?? receivedAt;

            return [ KickWebhookHandler.state(
                authentication,
                payload,
                occurredAt,
                {
                    online,
                    startedAt: KickWebhookHandler.string(payload.started_at),
                    endedAt: KickWebhookHandler.string(payload.ended_at),
                    title: KickWebhookHandler.string(payload.title),
                },
            ) ];
        }

        if (type === "livestream.metadata.updated")
        {
            const categoryId = KickWebhookHandler.identityId(payload.metadata?.category?.id);
            const categoryName = KickWebhookHandler.string(payload.metadata?.category?.name);

            return [ KickWebhookHandler.state(
                authentication,
                payload,
                receivedAt,
                {
                    title: KickWebhookHandler.string(payload.metadata?.title),
                    language: KickWebhookHandler.string(payload.metadata?.language),
                    mature: typeof payload.metadata?.has_mature_content === "boolean"
                        ? payload.metadata.has_mature_content
                        : null,
                    category: categoryId && categoryName
                        ? { id: categoryId, name: categoryName }
                        : null,
                },
                { timeSource: "received" },
            ) ];
        }

        throw new CjsToolWebhookError(
            "unsupported_event",
            "Kick webhook event is unsupported",
            { statusCode: 400 },
        );
    }

    /** Builds one canonical activity through the common contract. */
    static activity(topic, authentication, payload, occurredAt, {
        id = authentication.messageId,
        actor,
        fields = {},
        extension = {},
    })
    {
        const data = CjsToolRealtimeLivestreamContract.normalizeActivity(topic, {
            id,
            occurredAt,
            deliveryMode: "live",
            source: KickWebhookHandler.source(payload.broadcaster),
            actor,
            ...fields,
            extensions: {
                kick: KickWebhookHandler.extension(authentication, extension),
            },
        });

        return Object.freeze({ topic, data });
    }

    /** Builds one canonical state patch through the common contract. */
    static state(authentication, payload, occurredAt, changes, extension = {})
    {
        return Object.freeze({
            topic: LIVESTREAM_STATE_TOPICS.CHANGED,
            data: CjsToolRealtimeLivestreamContract.normalizeStateChange({
                id: authentication.messageId,
                occurredAt,
                deliveryMode: "live",
                source: KickWebhookHandler.source(payload.broadcaster),
                changes,
                extensions: {
                    kick: KickWebhookHandler.extension(authentication, extension),
                },
            }),
        });
    }

    /** Builds one canonical Kick channel identity. */
    static source(value)
    {
        return {
            provider: "kick",
            channelId: KickWebhookHandler.requiredIdentityId(value?.user_id),
            channelLogin: KickWebhookHandler.string(value?.channel_slug)?.toLowerCase()
                ?? null,
            channelDisplayName: KickWebhookHandler.string(value?.username),
        };
    }

    /** Builds one disclosed Kick user identity. */
    static actor(value)
    {
        return {
            id: KickWebhookHandler.requiredIdentityId(value?.user_id),
            login: KickWebhookHandler.string(value?.channel_slug)?.toLowerCase()
                ?? KickWebhookHandler.string(value?.username)?.toLowerCase()
                ?? null,
            displayName: KickWebhookHandler.string(value?.username),
        };
    }

    /** Retains signed Kick routing evidence and safe provider-only fields. */
    static extension(authentication, value)
    {
        return {
            eventType: authentication.eventType,
            eventVersion: authentication.eventVersion,
            messageId: authentication.messageId,
            subscriptionId: authentication.subscriptionId,
            ...value,
        };
    }

    /** Reads one scalar HTTP header exactly once. */
    static header(headers, name)
    {
        const value = headers?.[name];

        if (typeof value !== "string" || value.length === 0)
        {
            throw KickWebhookHandler.authenticationError();
        }

        return value;
    }

    /** Decodes a strict bounded base64 signature. */
    static decodeSignature(value)
    {
        if (value.length > 1024 || value.length % 4 !== 0
            || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value))
        {
            throw KickWebhookHandler.authenticationError();
        }

        const signature = Buffer.from(value, "base64");

        if (signature.length === 0 || signature.toString("base64") !== value)
        {
            throw KickWebhookHandler.authenticationError();
        }

        return signature;
    }

    /** Maps Kick reward statuses into canonical states. */
    static rewardStatus(value)
    {
        const result = {
            accepted: "fulfilled",
            pending: "pending",
            rejected: "cancelled",
        }[value];

        if (!result)
        {
            throw new TypeError("Kick reward status is invalid");
        }

        return result;
    }

    /** Converts a safe string or integer identity to a string. */
    static identityId(value)
    {
        if (typeof value === "string" && value.length > 0)
        {
            return value;
        }

        return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    }

    /** Requires one exact provider identity. */
    static requiredIdentityId(value)
    {
        const result = KickWebhookHandler.identityId(value);

        if (result === null)
        {
            throw new TypeError("Kick identity is invalid");
        }

        return result;
    }

    /** Reads a non-empty string or returns null. */
    static string(value)
    {
        return typeof value === "string" && value.length > 0 ? value : null;
    }

    /** Requires a non-empty string. */
    static requiredString(value)
    {
        const result = KickWebhookHandler.string(value);

        if (result === null)
        {
            throw new TypeError("Kick string value is invalid");
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
            throw new TypeError("Kick integer value is invalid");
        }

        return value;
    }

    /** Creates a non-reflective provider authentication failure. */
    static authenticationError()
    {
        return new CjsToolWebhookError(
            "unauthorized",
            "Kick webhook authentication failed",
            { statusCode: 401 },
        );
    }

}
