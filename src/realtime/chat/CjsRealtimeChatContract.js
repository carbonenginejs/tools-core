import { CjsRealtimeProtocol } from "../CjsRealtimeProtocol.js";

export const CHAT_FAMILY = "chat";
export const CHAT_TOPICS = Object.freeze({
    MESSAGE_RECEIVED: "chat.message.received",
    STATUS_CHANGED: "chat.status.changed",
});

const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const KIND_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u;
const REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

/** Validates provider-neutral live-chat message and source-status payloads. */
export class CjsRealtimeChatContract
{

    /** Normalizes one future-only live chat message. */
    static normalizeMessage(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat message must be an object");
        }

        const room = CjsRealtimeChatContract.normalizeRoom(value.room);

        return CjsRealtimeChatContract.freeze({
            id: CjsRealtimeChatContract.normalizeString(
                value.id,
                "message.id",
                256,
            ),
            text: CjsRealtimeChatContract.normalizeString(
                value.text,
                "message.text",
                16384,
            ),
            occurredAt: CjsRealtimeChatContract.normalizeTime(
                value.occurredAt,
                "message.occurredAt",
            ),
            deliveryMode: CjsRealtimeChatContract.requireValue(
                value.deliveryMode,
                [ "live" ],
                "message.deliveryMode",
            ),
            room,
            author: CjsRealtimeChatContract.normalizeAuthor(value.author),
            reply: CjsRealtimeChatContract.normalizeReply(value.reply ?? null),
            fragments: CjsRealtimeChatContract.normalizeFragments(value.fragments),
            extensions: CjsRealtimeChatContract.normalizeExtensions(
                value.extensions,
                room.provider,
            ),
        });
    }

    /** Normalizes one provider integration or room status change. */
    static normalizeStatus(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value)
            || !CjsRealtimeProtocol.isRecord(value.source))
        {
            throw new TypeError("Chat status must contain a source");
        }

        const source = {
            provider: CjsRealtimeChatContract.normalizeProvider(
                value.source.provider,
            ),
            integrationId: CjsRealtimeChatContract.normalizeNullableString(
                value.source.integrationId ?? null,
                "status.source.integrationId",
                256,
            ),
        };
        const room = value.room === null || value.room === undefined
            ? null
            : CjsRealtimeChatContract.normalizeRoom(value.room);

        if (room && (room.provider !== source.provider
            || room.integrationId !== source.integrationId))
        {
            throw new TypeError("Chat status room must belong to its source");
        }

        const reasonCode = value.reasonCode ?? null;

        if (reasonCode !== null && (typeof reasonCode !== "string"
            || !REASON_PATTERN.test(reasonCode)))
        {
            throw new TypeError("Chat status reasonCode is invalid");
        }

        if (typeof value.retryable !== "boolean")
        {
            throw new TypeError("Chat status retryable must be boolean");
        }

        return CjsRealtimeChatContract.freeze({
            state: CjsRealtimeChatContract.requireValue(
                value.state,
                [ "degraded", "ready", "reconnecting" ],
                "status.state",
            ),
            reasonCode,
            retryable: value.retryable,
            occurredAt: CjsRealtimeChatContract.normalizeTime(
                value.occurredAt,
                "status.occurredAt",
            ),
            source,
            room,
            extensions: CjsRealtimeChatContract.normalizeExtensions(
                value.extensions,
                source.provider,
            ),
        });
    }

    /** Returns the complete provider/integration/space/room identity key. */
    static roomKey(value)
    {
        const room = CjsRealtimeChatContract.normalizeRoom(value);

        return JSON.stringify([
            room.provider,
            room.integrationId,
            room.space?.id ?? null,
            room.id,
        ]);
    }

    /** Normalizes one provider-native conversation container. */
    static normalizeRoom(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat room must be an object");
        }

        const kind = CjsRealtimeChatContract.normalizeKind(value.kind, "room.kind");
        const parentRoomId = CjsRealtimeChatContract.normalizeNullableString(
            value.parentRoomId ?? null,
            "room.parentRoomId",
            256,
        );

        if (kind === "thread" && parentRoomId === null)
        {
            throw new TypeError("Chat thread room requires parentRoomId");
        }

        return {
            provider: CjsRealtimeChatContract.normalizeProvider(value.provider),
            integrationId: CjsRealtimeChatContract.normalizeNullableString(
                value.integrationId ?? null,
                "room.integrationId",
                256,
            ),
            space: CjsRealtimeChatContract.normalizeSpace(value.space ?? null),
            id: CjsRealtimeChatContract.normalizeString(value.id, "room.id", 256),
            kind,
            parentRoomId,
            login: CjsRealtimeChatContract.normalizeNullableString(
                value.login ?? null,
                "room.login",
                256,
            ),
            displayName: CjsRealtimeChatContract.normalizeNullableString(
                value.displayName ?? null,
                "room.displayName",
                512,
            ),
        };
    }

    /** Normalizes an optional parent workspace, server, guild, or community. */
    static normalizeSpace(value)
    {
        if (value === null)
        {
            return null;
        }

        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat room space must be an object or null");
        }

        return {
            id: CjsRealtimeChatContract.normalizeString(value.id, "space.id", 256),
            kind: CjsRealtimeChatContract.normalizeKind(value.kind, "space.kind"),
            login: CjsRealtimeChatContract.normalizeNullableString(
                value.login ?? null,
                "space.login",
                256,
            ),
            displayName: CjsRealtimeChatContract.normalizeNullableString(
                value.displayName ?? null,
                "space.displayName",
                512,
            ),
        };
    }

    /** Normalizes one provider-native author identity. */
    static normalizeAuthor(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value) || !Array.isArray(value.roles))
        {
            throw new TypeError("Chat author must contain roles");
        }

        if (value.roles.length > 64)
        {
            throw new TypeError("Chat author roles exceed the contract limit");
        }

        const roles = [ ...new Set(value.roles.map(role =>
            CjsRealtimeChatContract.normalizeKind(role, "author role"),
        )) ].sort();

        return {
            id: CjsRealtimeChatContract.normalizeString(value.id, "author.id", 256),
            login: CjsRealtimeChatContract.normalizeNullableString(
                value.login ?? null,
                "author.login",
                256,
            ),
            displayName: CjsRealtimeChatContract.normalizeNullableString(
                value.displayName ?? null,
                "author.displayName",
                512,
            ),
            color: CjsRealtimeChatContract.normalizeNullableString(
                value.color ?? null,
                "author.color",
                64,
            ),
            roles,
        };
    }

    /** Normalizes an optional provider-neutral reply relation. */
    static normalizeReply(value)
    {
        if (value === null)
        {
            return null;
        }

        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat reply must be an object or null");
        }

        return {
            parentMessageId: CjsRealtimeChatContract.normalizeString(
                value.parentMessageId,
                "reply.parentMessageId",
                256,
            ),
            parentAuthorId: CjsRealtimeChatContract.normalizeNullableString(
                value.parentAuthorId ?? null,
                "reply.parentAuthorId",
                256,
            ),
            parentAuthorLogin: CjsRealtimeChatContract.normalizeNullableString(
                value.parentAuthorLogin ?? null,
                "reply.parentAuthorLogin",
                256,
            ),
            parentAuthorDisplayName:
                CjsRealtimeChatContract.normalizeNullableString(
                    value.parentAuthorDisplayName ?? null,
                    "reply.parentAuthorDisplayName",
                    512,
                ),
            parentText: CjsRealtimeChatContract.normalizeNullableString(
                value.parentText ?? null,
                "reply.parentText",
                16384,
            ),
            threadParentMessageId:
                CjsRealtimeChatContract.normalizeNullableString(
                    value.threadParentMessageId ?? null,
                    "reply.threadParentMessageId",
                    256,
                ),
        };
    }

    /** Normalizes the ordered visible fragments of a message. */
    static normalizeFragments(value)
    {
        if (!Array.isArray(value) || value.length < 1 || value.length > 256)
        {
            throw new TypeError("Chat message fragments must be a bounded array");
        }

        return value.map(fragment => CjsRealtimeChatContract.normalizeFragment(fragment));
    }

    /** Normalizes one visible text, emote, mention, or contribution fragment. */
    static normalizeFragment(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat message fragment must be an object");
        }

        const result = {
            type: CjsRealtimeChatContract.normalizeKind(
                value.type,
                "fragment.type",
            ),
            text: CjsRealtimeChatContract.normalizeString(
                value.text,
                "fragment.text",
                16384,
                { allowEmpty: true },
            ),
        };

        if (Object.hasOwn(value, "emote"))
        {
            result.emote = CjsRealtimeChatContract.normalizeEmote(value.emote);
        }

        if (Object.hasOwn(value, "mention"))
        {
            result.mention = CjsRealtimeChatContract.normalizeMention(value.mention);
        }

        if (Object.hasOwn(value, "cheermote"))
        {
            result.cheermote = CjsRealtimeChatContract.normalizeCheermote(
                value.cheermote,
            );
        }

        return result;
    }

    /** Normalizes one emote fragment identity. */
    static normalizeEmote(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat emote fragment is invalid");
        }

        return {
            id: CjsRealtimeChatContract.normalizeString(value.id, "emote.id", 256),
            setId: CjsRealtimeChatContract.normalizeNullableString(
                value.setId ?? null,
                "emote.setId",
                256,
            ),
            ownerId: CjsRealtimeChatContract.normalizeNullableString(
                value.ownerId ?? null,
                "emote.ownerId",
                256,
            ),
        };
    }

    /** Normalizes one mentioned provider user. */
    static normalizeMention(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat mention fragment is invalid");
        }

        return {
            userId: CjsRealtimeChatContract.normalizeString(
                value.userId,
                "mention.userId",
                256,
            ),
            login: CjsRealtimeChatContract.normalizeNullableString(
                value.login ?? null,
                "mention.login",
                256,
            ),
            displayName: CjsRealtimeChatContract.normalizeNullableString(
                value.displayName ?? null,
                "mention.displayName",
                512,
            ),
        };
    }

    /** Normalizes one provider contribution fragment without converting units. */
    static normalizeCheermote(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat cheermote fragment is invalid");
        }

        return {
            prefix: CjsRealtimeChatContract.normalizeString(
                value.prefix,
                "cheermote.prefix",
                64,
            ),
            bits: CjsRealtimeChatContract.normalizeInteger(
                value.bits,
                "cheermote.bits",
                0,
            ),
            tier: CjsRealtimeChatContract.normalizeInteger(
                value.tier,
                "cheermote.tier",
                0,
            ),
        };
    }

    /** Clones provider extensions while requiring source-key containment. */
    static normalizeExtensions(value, provider)
    {
        if (!CjsRealtimeProtocol.isRecord(value)
            || !CjsRealtimeProtocol.isRecord(value[provider]))
        {
            throw new TypeError(`Chat extensions.${provider} must be an object`);
        }

        return CjsRealtimeProtocol.cloneJson(value);
    }

    /** Normalizes a provider namespace. */
    static normalizeProvider(value)
    {
        if (typeof value !== "string" || !PROVIDER_PATTERN.test(value))
        {
            throw new TypeError("Chat provider is invalid");
        }

        return value;
    }

    /** Normalizes a room, space, fragment, or role kind. */
    static normalizeKind(value, label)
    {
        if (typeof value !== "string" || !KIND_PATTERN.test(value))
        {
            throw new TypeError(`Chat ${label} is invalid`);
        }

        return value;
    }

    /** Converts an RFC 3339-compatible time into canonical UTC form. */
    static normalizeTime(value, label)
    {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(value))
        {
            throw new TypeError(`Chat ${label} is invalid`);
        }

        const milliseconds = Date.parse(value);

        if (!Number.isFinite(milliseconds))
        {
            throw new TypeError(`Chat ${label} is invalid`);
        }

        return new Date(milliseconds).toISOString();
    }

    /** Normalizes a required bounded string. */
    static normalizeString(value, label, maximum, { allowEmpty = false } = {})
    {
        const minimum = allowEmpty ? 0 : 1;

        if (typeof value !== "string"
            || value.length < minimum
            || value.length > maximum)
        {
            throw new TypeError(`Chat ${label} must be a bounded string`);
        }

        return value;
    }

    /** Normalizes an explicitly nullable bounded string. */
    static normalizeNullableString(value, label, maximum)
    {
        return value === null
            ? null
            : CjsRealtimeChatContract.normalizeString(value, label, maximum);
    }

    /** Normalizes one safe integer with a declared lower bound. */
    static normalizeInteger(value, label, minimum)
    {
        if (!Number.isSafeInteger(value) || value < minimum)
        {
            throw new TypeError(`Chat ${label} is invalid`);
        }

        return value;
    }

    /** Requires one value from a stable contract enumeration. */
    static requireValue(value, allowed, label)
    {
        if (!allowed.includes(value))
        {
            throw new TypeError(`Chat ${label} is invalid`);
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
                CjsRealtimeChatContract.freeze(entry);
            }
        }

        return value;
    }

}
