import { CjsRealtimeError } from "../../realtime/CjsRealtimeError.js";

/** Canonicalizes Twitch IRC and EventSub messages into the common chat family. */
export class CjsRealtimeTwitchChatNormalizer
{

    /** Normalizes one tmi.js-compatible IRC message callback. */
    static fromIrc({ channel, tags, text, receivedAt = Date.now() })
    {
        const roomLogin = String(channel ?? "").replace(/^#/u, "").toLowerCase();
        const messageId = CjsRealtimeTwitchChatNormalizer.string(tags?.id);
        const roomId = CjsRealtimeTwitchChatNormalizer.string(tags?.["room-id"]);
        const authorId = CjsRealtimeTwitchChatNormalizer.string(tags?.["user-id"]);

        CjsRealtimeTwitchChatNormalizer.requireIdentity(
            messageId,
            roomId,
            authorId,
            roomLogin,
        );
        const occurredAt = CjsRealtimeTwitchChatNormalizer.time(
            tags?.["tmi-sent-ts"],
            receivedAt,
        );
        const badges = CjsRealtimeTwitchChatNormalizer.badges(tags?.badges);
        const sourceMessageId = CjsRealtimeTwitchChatNormalizer.string(tags?.["source-id"]);
        const sourceRoomId = CjsRealtimeTwitchChatNormalizer.string(tags?.["source-room-id"]);

        return CjsRealtimeTwitchChatNormalizer.common({
            id: messageId,
            text,
            occurredAt,
            room: {
                provider: "twitch",
                id: roomId,
                login: roomLogin,
                displayName: null,
            },
            author: {
                id: authorId,
                login: CjsRealtimeTwitchChatNormalizer.string(tags?.username)?.toLowerCase()
                    ?? "unknown",
                displayName: CjsRealtimeTwitchChatNormalizer.string(tags?.["display-name"]),
                color: CjsRealtimeTwitchChatNormalizer.string(tags?.color),
                roles: CjsRealtimeTwitchChatNormalizer.roles(tags, badges),
            },
            reply: CjsRealtimeTwitchChatNormalizer.ircReply(tags),
            fragments: [ { type: "text", text: String(text ?? "") } ],
            twitch: {
                transport: "irc",
                badges,
                sourceMessageId,
                sourceRoomId,
                messageType: CjsRealtimeTwitchChatNormalizer.string(tags?.["message-type"]),
                bits: CjsRealtimeTwitchChatNormalizer.integer(tags?.bits),
            },
        });
    }

    /** Normalizes one channel.chat.message EventSub notification. */
    static fromEventSub(message, receivedAt = Date.now())
    {
        const metadata = message?.metadata;
        const subscription = message?.payload?.subscription;
        const event = message?.payload?.event;

        if (metadata?.message_type !== "notification"
            || metadata?.subscription_type !== "channel.chat.message"
            || subscription?.type !== "channel.chat.message")
        {
            throw CjsRealtimeTwitchChatNormalizer.invalidMessage();
        }

        const messageId = CjsRealtimeTwitchChatNormalizer.string(event?.message_id);
        const roomId = CjsRealtimeTwitchChatNormalizer.string(event?.broadcaster_user_id);
        const authorId = CjsRealtimeTwitchChatNormalizer.string(event?.chatter_user_id);
        const roomLogin = CjsRealtimeTwitchChatNormalizer.string(
            event?.broadcaster_user_login,
        )?.toLowerCase();

        CjsRealtimeTwitchChatNormalizer.requireIdentity(
            messageId,
            roomId,
            authorId,
            roomLogin,
        );
        const badges = CjsRealtimeTwitchChatNormalizer.badges(event?.badges);

        return CjsRealtimeTwitchChatNormalizer.common({
            id: messageId,
            text: event?.message?.text,
            occurredAt: CjsRealtimeTwitchChatNormalizer.time(
                metadata?.message_timestamp,
                receivedAt,
            ),
            room: {
                provider: "twitch",
                id: roomId,
                login: roomLogin,
                displayName: CjsRealtimeTwitchChatNormalizer.string(
                    event?.broadcaster_user_name,
                ),
            },
            author: {
                id: authorId,
                login: CjsRealtimeTwitchChatNormalizer.string(
                    event?.chatter_user_login,
                )?.toLowerCase() ?? "unknown",
                displayName: CjsRealtimeTwitchChatNormalizer.string(
                    event?.chatter_user_name,
                ),
                color: CjsRealtimeTwitchChatNormalizer.string(event?.color),
                roles: CjsRealtimeTwitchChatNormalizer.roles(event, badges),
            },
            reply: CjsRealtimeTwitchChatNormalizer.eventSubReply(event?.reply),
            fragments: CjsRealtimeTwitchChatNormalizer.fragments(
                event?.message?.fragments,
                event?.message?.text,
            ),
            twitch: {
                transport: "eventsub",
                notificationId: CjsRealtimeTwitchChatNormalizer.string(metadata?.message_id),
                subscriptionId: CjsRealtimeTwitchChatNormalizer.string(subscription?.id),
                badges,
                sourceMessageId: CjsRealtimeTwitchChatNormalizer.string(
                    event?.source_message_id,
                ),
                sourceRoomId: CjsRealtimeTwitchChatNormalizer.string(
                    event?.source_broadcaster_user_id,
                ),
                messageType: CjsRealtimeTwitchChatNormalizer.string(event?.message_type),
                bits: CjsRealtimeTwitchChatNormalizer.integer(event?.cheer?.bits),
            },
        });
    }

    /** Freezes the provider-neutral chat message shape. */
    static common({ id, text, occurredAt, room, author, reply, fragments, twitch })
    {
        if (typeof text !== "string" || text.length === 0)
        {
            throw CjsRealtimeTwitchChatNormalizer.invalidMessage();
        }

        return Object.freeze({
            id,
            text,
            occurredAt,
            deliveryMode: "live",
            room: Object.freeze(room),
            author: Object.freeze(author),
            reply: reply === null ? null : Object.freeze(reply),
            fragments: Object.freeze(fragments.map(fragment => Object.freeze(fragment))),
            extensions: Object.freeze({
                twitch: Object.freeze(twitch),
            }),
        });
    }

    /** Normalizes Twitch badge arrays or tmi.js badge maps. */
    static badges(value)
    {
        if (Array.isArray(value))
        {
            return Object.freeze(value.flatMap(entry =>
            {
                const setId = CjsRealtimeTwitchChatNormalizer.string(entry?.set_id);
                const id = CjsRealtimeTwitchChatNormalizer.string(entry?.id);

                return setId && id ? [ Object.freeze({ setId, id }) ] : [];
            }));
        }

        if (value && typeof value === "object")
        {
            return Object.freeze(Object.entries(value)
                .filter(([ setId, id ]) => setId && id !== null && id !== undefined)
                .map(([ setId, id ]) => Object.freeze({ setId, id: String(id) }))
                .sort((left, right) => left.setId.localeCompare(right.setId)));
        }

        return Object.freeze([]);
    }

    /** Derives provider-neutral role names from badges and explicit flags. */
    static roles(source, badges)
    {
        const values = new Set(badges.map(badge => badge.setId));

        if (source?.mod === true || source?.mod === "1")
        {
            values.add("moderator");
        }

        if (source?.subscriber === true || source?.subscriber === "1")
        {
            values.add("subscriber");
        }

        if (source?.vip === true || source?.vip === "1")
        {
            values.add("vip");
        }

        return Object.freeze([ ...values ].sort());
    }

    /** Normalizes structured EventSub fragments without provider URLs or secrets. */
    static fragments(value, fallbackText = "")
    {
        if (!Array.isArray(value) || value.length === 0)
        {
            return typeof fallbackText === "string" && fallbackText.length > 0
                ? Object.freeze([ Object.freeze({ type: "text", text: fallbackText }) ])
                : Object.freeze([]);
        }

        return Object.freeze(value.map(fragment =>
        {
            const result = {
                type: CjsRealtimeTwitchChatNormalizer.string(fragment?.type) ?? "text",
                text: String(fragment?.text ?? ""),
            };

            if (fragment?.emote)
            {
                result.emote = Object.freeze({
                    id: CjsRealtimeTwitchChatNormalizer.string(fragment.emote.id),
                    setId: CjsRealtimeTwitchChatNormalizer.string(
                        fragment.emote.emote_set_id,
                    ),
                    ownerId: CjsRealtimeTwitchChatNormalizer.string(
                        fragment.emote.owner_id,
                    ),
                });
            }

            if (fragment?.mention)
            {
                result.mention = Object.freeze({
                    userId: CjsRealtimeTwitchChatNormalizer.string(
                        fragment.mention.user_id,
                    ),
                    login: CjsRealtimeTwitchChatNormalizer.string(
                        fragment.mention.user_login,
                    ),
                    displayName: CjsRealtimeTwitchChatNormalizer.string(
                        fragment.mention.user_name,
                    ),
                });
            }

            if (fragment?.cheermote)
            {
                result.cheermote = Object.freeze({
                    prefix: CjsRealtimeTwitchChatNormalizer.string(
                        fragment.cheermote.prefix,
                    ),
                    bits: CjsRealtimeTwitchChatNormalizer.integer(fragment.cheermote.bits),
                    tier: CjsRealtimeTwitchChatNormalizer.integer(fragment.cheermote.tier),
                });
            }

            return Object.freeze(result);
        }));
    }

    /** Normalizes the IRC reply tag family. */
    static ircReply(tags)
    {
        const parentMessageId = CjsRealtimeTwitchChatNormalizer.string(
            tags?.["reply-parent-msg-id"],
        );

        if (!parentMessageId)
        {
            return null;
        }

        return {
            parentMessageId,
            parentAuthorId: CjsRealtimeTwitchChatNormalizer.string(
                tags?.["reply-parent-user-id"],
            ),
            parentAuthorLogin: CjsRealtimeTwitchChatNormalizer.string(
                tags?.["reply-parent-user-login"],
            ),
            parentAuthorDisplayName: CjsRealtimeTwitchChatNormalizer.string(
                tags?.["reply-parent-display-name"],
            ),
            parentText: CjsRealtimeTwitchChatNormalizer.string(
                tags?.["reply-parent-msg-body"],
            ),
            threadParentMessageId: CjsRealtimeTwitchChatNormalizer.string(
                tags?.["reply-thread-parent-msg-id"],
            ),
        };
    }

    /** Normalizes the EventSub reply object. */
    static eventSubReply(reply)
    {
        const parentMessageId = CjsRealtimeTwitchChatNormalizer.string(
            reply?.parent_message_id,
        );

        if (!parentMessageId)
        {
            return null;
        }

        return {
            parentMessageId,
            parentAuthorId: CjsRealtimeTwitchChatNormalizer.string(reply?.parent_user_id),
            parentAuthorLogin: CjsRealtimeTwitchChatNormalizer.string(
                reply?.parent_user_login,
            ),
            parentAuthorDisplayName: CjsRealtimeTwitchChatNormalizer.string(
                reply?.parent_user_name,
            ),
            parentText: CjsRealtimeTwitchChatNormalizer.string(reply?.parent_message_body),
            threadParentMessageId: CjsRealtimeTwitchChatNormalizer.string(
                reply?.thread_message_id,
            ),
        };
    }

    /** Converts a provider timestamp to canonical ISO time. */
    static time(value, fallback)
    {
        const numeric = typeof value === "string" && /^\d+$/u.test(value)
            ? Number(value)
            : value;
        const date = new Date(numeric ?? fallback);

        if (!Number.isFinite(date.getTime()))
        {
            throw CjsRealtimeTwitchChatNormalizer.invalidMessage();
        }

        return date.toISOString();
    }

    /** Returns one non-empty provider string or null. */
    static string(value)
    {
        return typeof value === "string" && value.length > 0 ? value : null;
    }

    /** Returns one provider integer or null. */
    static integer(value)
    {
        const numeric = typeof value === "string" && /^\d+$/u.test(value)
            ? Number(value)
            : value;

        return Number.isSafeInteger(numeric) ? numeric : null;
    }

    /** Requires stable message, room, and author identity. */
    static requireIdentity(messageId, roomId, authorId, roomLogin)
    {
        if (!messageId || !roomId || !authorId || !roomLogin)
        {
            throw CjsRealtimeTwitchChatNormalizer.invalidMessage();
        }
    }

    /** Creates a sanitized malformed-upstream error. */
    static invalidMessage()
    {
        return new CjsRealtimeError(
            "twitch_invalid_message",
            "Twitch delivered a chat message without the required stable identity",
        );
    }

}
