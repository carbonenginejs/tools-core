import { CjsToolRealtimeProtocol } from "../CjsToolRealtimeProtocol.js";

export const CHAT_FAMILY = "chat";
export const CHAT_TOPICS = Object.freeze({
    MESSAGE_RECEIVED: "chat.message.received",
    STATUS_CHANGED: "chat.status.changed",
});

const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const KIND_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u;
const REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

/** Validates provider-neutral live-chat message and source-status payloads. */
export class CjsToolRealtimeChatContract
{

    /** Normalizes one future-only live chat message. */
    static normalizeMessage(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat message must be an object");
        }

        const room = CjsToolRealtimeChatContract.normalizeRoom(value.room);

        return CjsToolRealtimeChatContract.freeze({
            id: CjsToolRealtimeChatContract.normalizeString(
                value.id,
                "message.id",
                256,
            ),
            text: CjsToolRealtimeChatContract.normalizeString(
                value.text,
                "message.text",
                16384,
            ),
            occurredAt: CjsToolRealtimeChatContract.normalizeTime(
                value.occurredAt,
                "message.occurredAt",
            ),
            deliveryMode: CjsToolRealtimeChatContract.requireValue(
                value.deliveryMode,
                [ "live" ],
                "message.deliveryMode",
            ),
            room,
            author: CjsToolRealtimeChatContract.normalizeAuthor(value.author),
            reply: CjsToolRealtimeChatContract.normalizeReply(value.reply ?? null),
            fragments: CjsToolRealtimeChatContract.normalizeFragments(value.fragments),
            extensions: CjsToolRealtimeChatContract.normalizeExtensions(
                value.extensions,
                room.provider,
            ),
        });
    }

    /** Normalizes one provider integration or room status change. */
    static normalizeStatus(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value)
            || !CjsToolRealtimeProtocol.isRecord(value.source))
        {
            throw new TypeError("Chat status must contain a source");
        }

        const source = {
            provider: CjsToolRealtimeChatContract.normalizeProvider(
                value.source.provider,
            ),
            integrationId: CjsToolRealtimeChatContract.normalizeNullableString(
                value.source.integrationId ?? null,
                "status.source.integrationId",
                256,
            ),
        };
        const room = value.room === null || value.room === undefined
            ? null
            : CjsToolRealtimeChatContract.normalizeRoom(value.room);

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

        return CjsToolRealtimeChatContract.freeze({
            state: CjsToolRealtimeChatContract.requireValue(
                value.state,
                [ "degraded", "ready", "reconnecting" ],
                "status.state",
            ),
            reasonCode,
            retryable: value.retryable,
            occurredAt: CjsToolRealtimeChatContract.normalizeTime(
                value.occurredAt,
                "status.occurredAt",
            ),
            source,
            room,
            extensions: CjsToolRealtimeChatContract.normalizeExtensions(
                value.extensions,
                source.provider,
            ),
        });
    }

    /** Returns the complete provider/integration/space/room identity key. */
    static roomKey(value)
    {
        const room = CjsToolRealtimeChatContract.normalizeRoom(value);

        return JSON.stringify([
            room.provider,
            room.integrationId,
            room.space?.id ?? null,
            room.id,
        ]);
    }

    /** Normalizes a client-selected room at any provider hierarchy tier. */
    static normalizeRoomSelector(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat room selector must be an object");
        }

        const id = CjsToolRealtimeChatContract.normalizeNullableString(
            value.id ?? null,
            "room selector.id",
            256,
        );
        const login = CjsToolRealtimeChatContract.normalizeNullableString(
            value.login ?? null,
            "room selector.login",
            256,
        );

        if (id === null && login === null)
        {
            throw new TypeError("Chat room selector requires id or login");
        }

        return CjsToolRealtimeChatContract.freeze({
            provider: CjsToolRealtimeChatContract.normalizeProvider(value.provider),
            integrationId: CjsToolRealtimeChatContract.normalizeNullableString(
                value.integrationId ?? null,
                "room selector.integrationId",
                256,
            ),
            space: value.space === null || value.space === undefined
                ? null
                : CjsToolRealtimeChatContract.normalizeSpace(value.space),
            id,
            kind: value.kind === null || value.kind === undefined
                ? null
                : CjsToolRealtimeChatContract.normalizeKind(value.kind, "room selector.kind"),
            parentRoomId: CjsToolRealtimeChatContract.normalizeNullableString(
                value.parentRoomId ?? null,
                "room selector.parentRoomId",
                256,
            ),
            login,
        });
    }

    /** Tests one normalized room against a normalized hierarchical selector. */
    static matchesRoomSelector(selectorValue, roomValue)
    {
        const selector = CjsToolRealtimeChatContract.normalizeRoomSelector(selectorValue);
        const room = CjsToolRealtimeChatContract.normalizeRoom(roomValue);

        return selector.provider === room.provider
            && selector.integrationId === room.integrationId
            && (selector.space === null || selector.space.id === room.space?.id)
            && (selector.id === null || selector.id === room.id)
            && (selector.kind === null || selector.kind === room.kind)
            && (selector.parentRoomId === null
                || selector.parentRoomId === room.parentRoomId)
            && (selector.login === null
                || selector.login.toLowerCase() === room.login?.toLowerCase());
    }

    /** Normalizes one literal blocked-term selector and its optional room scope. */
    static normalizeTermSelector(value)
    {
        const candidate = typeof value === "string" ? { text: value } : value;

        if (!CjsToolRealtimeProtocol.isRecord(candidate))
        {
            throw new TypeError("Chat term selector must be a string or object");
        }

        const provider = candidate.provider === null
            || candidate.provider === undefined
            ? null
            : CjsToolRealtimeChatContract.normalizeProvider(candidate.provider);
        const integrationId = CjsToolRealtimeChatContract.normalizeNullableString(
            candidate.integrationId ?? null,
            "term selector.integrationId",
            256,
        );
        const spaceId = CjsToolRealtimeChatContract.normalizeNullableString(
            candidate.spaceId ?? null,
            "term selector.spaceId",
            256,
        );
        const roomId = CjsToolRealtimeChatContract.normalizeNullableString(
            candidate.roomId ?? null,
            "term selector.roomId",
            256,
        );
        const roomLogin = CjsToolRealtimeChatContract.normalizeNullableString(
            candidate.roomLogin ?? null,
            "term selector.roomLogin",
            256,
        );

        if (provider === null
            && [ integrationId, spaceId, roomId, roomLogin ].some(item => item !== null))
        {
            throw new TypeError("Scoped chat term selector requires a provider");
        }

        return CjsToolRealtimeChatContract.freeze({
            provider,
            integrationId,
            spaceId,
            roomId,
            roomLogin,
            text: CjsToolRealtimeChatContract.normalizeString(
                candidate.text,
                "term selector.text",
                512,
            ).toLowerCase(),
        });
    }

    /** Tests a literal term against message text within its optional room scope. */
    static matchesTermBlock(selectorValue, roomValue, textValue)
    {
        const selector = CjsToolRealtimeChatContract.normalizeTermSelector(selectorValue);
        const room = CjsToolRealtimeChatContract.normalizeRoom(roomValue);
        const text = CjsToolRealtimeChatContract.normalizeString(
            textValue,
            "block candidate text",
            16384,
        ).toLowerCase();

        return (selector.provider === null || selector.provider === room.provider)
            && (selector.integrationId === null
                || selector.integrationId === room.integrationId)
            && (selector.spaceId === null || selector.spaceId === room.space?.id)
            && (selector.roomId !== null
                ? selector.roomId === room.id
                : selector.roomLogin === null
                    || selector.roomLogin.toLowerCase() === room.login?.toLowerCase())
            && text.includes(selector.text);
    }

    /** Normalizes one provider user block selector. */
    static normalizeUserSelector(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat user selector must be an object");
        }

        const id = CjsToolRealtimeChatContract.normalizeNullableString(
            value.id ?? null,
            "user selector.id",
            256,
        );
        const login = CjsToolRealtimeChatContract.normalizeNullableString(
            value.login ?? null,
            "user selector.login",
            256,
        );

        if (id === null && login === null)
        {
            throw new TypeError("Chat user selector requires id or login");
        }

        return CjsToolRealtimeChatContract.freeze({
            provider: CjsToolRealtimeChatContract.normalizeProvider(value.provider),
            integrationId: CjsToolRealtimeChatContract.normalizeNullableString(
                value.integrationId ?? null,
                "user selector.integrationId",
                256,
            ),
            id,
            login,
        });
    }

    /** Tests a user block using stable user ID before login fallback. */
    static matchesUserBlock(selectorValue, roomValue, authorValue)
    {
        const selector = CjsToolRealtimeChatContract.normalizeUserSelector(selectorValue);
        const room = CjsToolRealtimeChatContract.normalizeRoomSelector(roomValue);

        if (!CjsToolRealtimeProtocol.isRecord(authorValue))
        {
            throw new TypeError("Chat block candidate author must be an object");
        }

        const authorId = CjsToolRealtimeChatContract.normalizeNullableString(
            authorValue.id ?? null,
            "block candidate author.id",
            256,
        );
        const authorLogin = CjsToolRealtimeChatContract.normalizeNullableString(
            authorValue.login ?? null,
            "block candidate author.login",
            256,
        );

        return selector.provider === room.provider
            && (selector.integrationId === null
                || selector.integrationId === room.integrationId)
            && (selector.id !== null
                ? selector.id === authorId
                : selector.login?.toLowerCase() === authorLogin?.toLowerCase());
    }

    /** Normalizes one provider-native conversation container. */
    static normalizeRoom(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat room must be an object");
        }

        const kind = CjsToolRealtimeChatContract.normalizeKind(value.kind, "room.kind");
        const parentRoomId = CjsToolRealtimeChatContract.normalizeNullableString(
            value.parentRoomId ?? null,
            "room.parentRoomId",
            256,
        );

        if (kind === "thread" && parentRoomId === null)
        {
            throw new TypeError("Chat thread room requires parentRoomId");
        }

        const result = {
            provider: CjsToolRealtimeChatContract.normalizeProvider(value.provider),
            integrationId: CjsToolRealtimeChatContract.normalizeNullableString(
                value.integrationId ?? null,
                "room.integrationId",
                256,
            ),
            space: CjsToolRealtimeChatContract.normalizeSpace(value.space ?? null),
            id: CjsToolRealtimeChatContract.normalizeString(value.id, "room.id", 256),
            kind,
            parentRoomId,
            login: CjsToolRealtimeChatContract.normalizeNullableString(
                value.login ?? null,
                "room.login",
                256,
            ),
            displayName: CjsToolRealtimeChatContract.normalizeNullableString(
                value.displayName ?? null,
                "room.displayName",
                512,
            ),
        };

        if (Object.hasOwn(value, "assets"))
        {
            result.assets = CjsToolRealtimeChatContract.normalizeAssets(
                value.assets,
                "room",
            );
        }

        return result;
    }

    /** Normalizes an optional parent workspace, server, guild, or community. */
    static normalizeSpace(value)
    {
        if (value === null)
        {
            return null;
        }

        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat room space must be an object or null");
        }

        const result = {
            id: CjsToolRealtimeChatContract.normalizeString(value.id, "space.id", 256),
            kind: CjsToolRealtimeChatContract.normalizeKind(value.kind, "space.kind"),
            login: CjsToolRealtimeChatContract.normalizeNullableString(
                value.login ?? null,
                "space.login",
                256,
            ),
            displayName: CjsToolRealtimeChatContract.normalizeNullableString(
                value.displayName ?? null,
                "space.displayName",
                512,
            ),
        };

        if (Object.hasOwn(value, "assets"))
        {
            result.assets = CjsToolRealtimeChatContract.normalizeAssets(
                value.assets,
                "space",
            );
        }

        return result;
    }

    /** Normalizes one provider-native author identity. */
    static normalizeAuthor(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value) || !Array.isArray(value.roles))
        {
            throw new TypeError("Chat author must contain roles");
        }

        if (value.roles.length > 64)
        {
            throw new TypeError("Chat author roles exceed the contract limit");
        }

        const roles = [ ...new Set(value.roles.map(role =>
            CjsToolRealtimeChatContract.normalizeKind(role, "author role"),
        )) ].sort();

        return {
            id: CjsToolRealtimeChatContract.normalizeString(value.id, "author.id", 256),
            login: CjsToolRealtimeChatContract.normalizeNullableString(
                value.login ?? null,
                "author.login",
                256,
            ),
            displayName: CjsToolRealtimeChatContract.normalizeNullableString(
                value.displayName ?? null,
                "author.displayName",
                512,
            ),
            color: CjsToolRealtimeChatContract.normalizeNullableString(
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

        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat reply must be an object or null");
        }

        return {
            parentMessageId: CjsToolRealtimeChatContract.normalizeString(
                value.parentMessageId,
                "reply.parentMessageId",
                256,
            ),
            parentAuthorId: CjsToolRealtimeChatContract.normalizeNullableString(
                value.parentAuthorId ?? null,
                "reply.parentAuthorId",
                256,
            ),
            parentAuthorLogin: CjsToolRealtimeChatContract.normalizeNullableString(
                value.parentAuthorLogin ?? null,
                "reply.parentAuthorLogin",
                256,
            ),
            parentAuthorDisplayName:
                CjsToolRealtimeChatContract.normalizeNullableString(
                    value.parentAuthorDisplayName ?? null,
                    "reply.parentAuthorDisplayName",
                    512,
                ),
            parentText: CjsToolRealtimeChatContract.normalizeNullableString(
                value.parentText ?? null,
                "reply.parentText",
                16384,
            ),
            threadParentMessageId:
                CjsToolRealtimeChatContract.normalizeNullableString(
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

        return value.map(fragment => CjsToolRealtimeChatContract.normalizeFragment(fragment));
    }

    /** Normalizes one visible text, emote, mention, or contribution fragment. */
    static normalizeFragment(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat message fragment must be an object");
        }

        const result = {
            type: CjsToolRealtimeChatContract.normalizeKind(
                value.type,
                "fragment.type",
            ),
            text: CjsToolRealtimeChatContract.normalizeString(
                value.text,
                "fragment.text",
                16384,
                { allowEmpty: true },
            ),
        };

        if (Object.hasOwn(value, "emote"))
        {
            result.emote = CjsToolRealtimeChatContract.normalizeEmote(value.emote);
        }

        if (Object.hasOwn(value, "mention"))
        {
            result.mention = CjsToolRealtimeChatContract.normalizeMention(value.mention);
        }

        if (Object.hasOwn(value, "cheermote"))
        {
            result.cheermote = CjsToolRealtimeChatContract.normalizeCheermote(
                value.cheermote,
            );
        }

        if (Object.hasOwn(value, "media"))
        {
            result.media = CjsToolRealtimeChatContract.normalizeMedia(value.media);
        }

        return result;
    }

    /** Normalizes one emote fragment identity. */
    static normalizeEmote(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat emote fragment is invalid");
        }

        const result = {
            id: CjsToolRealtimeChatContract.normalizeString(value.id, "emote.id", 256),
            setId: CjsToolRealtimeChatContract.normalizeNullableString(
                value.setId ?? null,
                "emote.setId",
                256,
            ),
            ownerId: CjsToolRealtimeChatContract.normalizeNullableString(
                value.ownerId ?? null,
                "emote.ownerId",
                256,
            ),
        };

        if (Object.hasOwn(value, "formats"))
        {
            if (!Array.isArray(value.formats)
                || value.formats.length < 1
                || value.formats.length > 16)
            {
                throw new TypeError("Chat emote formats must be a bounded array");
            }

            result.formats = [ ...new Set(value.formats.map(format =>
                CjsToolRealtimeChatContract.normalizeKind(format, "emote format"))) ].sort();
        }

        if (Object.hasOwn(value, "asset"))
        {
            result.asset = CjsToolRealtimeChatContract.normalizeMedia(value.asset);
        }

        return result;
    }

    /** Normalizes URL-backed presentation assets for a room hierarchy node. */
    static normalizeAssets(value, label = "entity")
    {
        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError(`Chat ${label} assets must be an object`);
        }

        const result = {};

        for (const name of [ "icon", "banner" ])
        {
            if (Object.hasOwn(value, name))
            {
                result[name] = CjsToolRealtimeChatContract.normalizeMedia(value[name]);
            }
        }

        if (Object.keys(result).length === 0)
        {
            throw new TypeError(`Chat ${label} assets must contain icon or banner`);
        }

        return result;
    }

    /** Normalizes one externally hosted visual media fragment. */
    static normalizeMedia(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat media fragment is invalid");
        }

        const url = CjsToolRealtimeChatContract.normalizeString(
            value.url,
            "media.url",
            2048,
        );
        let parsed;

        try
        {
            parsed = new URL(url);
        }
        catch
        {
            throw new TypeError("Chat media.url is invalid");
        }

        if (parsed.protocol !== "https:")
        {
            throw new TypeError("Chat media.url must use HTTPS");
        }

        if (typeof value.animated !== "boolean")
        {
            throw new TypeError("Chat media.animated must be boolean");
        }

        return {
            id: CjsToolRealtimeChatContract.normalizeNullableString(
                value.id ?? null,
                "media.id",
                256,
            ),
            url: parsed.href,
            contentType: CjsToolRealtimeChatContract.normalizeNullableString(
                value.contentType ?? null,
                "media.contentType",
                128,
            ),
            animated: value.animated,
        };
    }

    /** Normalizes one mentioned provider user. */
    static normalizeMention(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat mention fragment is invalid");
        }

        return {
            userId: CjsToolRealtimeChatContract.normalizeString(
                value.userId,
                "mention.userId",
                256,
            ),
            login: CjsToolRealtimeChatContract.normalizeNullableString(
                value.login ?? null,
                "mention.login",
                256,
            ),
            displayName: CjsToolRealtimeChatContract.normalizeNullableString(
                value.displayName ?? null,
                "mention.displayName",
                512,
            ),
        };
    }

    /** Normalizes one provider contribution fragment without converting units. */
    static normalizeCheermote(value)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Chat cheermote fragment is invalid");
        }

        return {
            prefix: CjsToolRealtimeChatContract.normalizeString(
                value.prefix,
                "cheermote.prefix",
                64,
            ),
            bits: CjsToolRealtimeChatContract.normalizeInteger(
                value.bits,
                "cheermote.bits",
                0,
            ),
            tier: CjsToolRealtimeChatContract.normalizeInteger(
                value.tier,
                "cheermote.tier",
                0,
            ),
        };
    }

    /** Clones provider extensions while requiring source-key containment. */
    static normalizeExtensions(value, provider)
    {
        if (!CjsToolRealtimeProtocol.isRecord(value)
            || !CjsToolRealtimeProtocol.isRecord(value[provider]))
        {
            throw new TypeError(`Chat extensions.${provider} must be an object`);
        }

        return CjsToolRealtimeProtocol.cloneJson(value);
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
            : CjsToolRealtimeChatContract.normalizeString(value, label, maximum);
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
                CjsToolRealtimeChatContract.freeze(entry);
            }
        }

        return value;
    }

}
