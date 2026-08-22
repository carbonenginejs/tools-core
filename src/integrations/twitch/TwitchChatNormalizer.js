import { CjsToolRealtimeError } from "../../realtime/CjsToolRealtimeError.js";
import {
    CjsToolRealtimeChatContract,
} from "../../realtime/chat/CjsToolRealtimeChatContract.js";

const EMOTE_CDN = "https://static-cdn.jtvnw.net/emoticons/v2";

/** Canonicalizes Twitch IRC and EventSub messages into the common chat family. */
export class TwitchChatNormalizer
{

    /** Normalizes one tmi.js-compatible IRC message callback. */
    static fromIrc({
        channel,
        tags,
        text,
        receivedAt = Date.now(),
        assets = null,
    })
    {
        const roomLogin = String(channel ?? "").replace(/^#/u, "").toLowerCase();
        const messageId = TwitchChatNormalizer.string(tags?.id);
        const roomId = TwitchChatNormalizer.string(
            assets?.room?.id ?? tags?.["room-id"],
        );
        const authorId = TwitchChatNormalizer.string(tags?.["user-id"]);

        TwitchChatNormalizer.requireIdentity(
            messageId,
            roomId,
            authorId,
            roomLogin,
        );
        const occurredAt = TwitchChatNormalizer.time(
            tags?.["tmi-sent-ts"],
            receivedAt,
        );
        const badges = TwitchChatNormalizer.badges(tags?.badges);
        const sourceMessageId = TwitchChatNormalizer.string(tags?.["source-id"]);
        const sourceRoomId = TwitchChatNormalizer.string(tags?.["source-room-id"]);

        return TwitchChatNormalizer.common({
            id: messageId,
            text,
            occurredAt,
            room: {
                provider: "twitch",
                id: roomId,
                kind: "channel",
                login: roomLogin,
                displayName: TwitchChatNormalizer.string(
                    assets?.room?.displayName,
                ),
                ...(assets?.room?.assets
                    ? { assets: assets.room.assets }
                    : {}),
            },
            author: {
                id: authorId,
                login: TwitchChatNormalizer.string(tags?.username)?.toLowerCase()
                    ?? "unknown",
                displayName: TwitchChatNormalizer.string(tags?.["display-name"]),
                color: TwitchChatNormalizer.string(tags?.color),
                roles: TwitchChatNormalizer.roles(tags, badges),
            },
            reply: TwitchChatNormalizer.ircReply(tags),
            fragments: TwitchChatNormalizer.ircFragments(
                text,
                tags?.emotes,
                tags?.gifs,
                assets?.emotes,
            ),
            twitch: {
                transport: "irc",
                badges,
                sourceMessageId,
                sourceRoomId,
                messageType: TwitchChatNormalizer.string(tags?.["message-type"]),
                bits: TwitchChatNormalizer.integer(tags?.bits),
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
            throw TwitchChatNormalizer.invalidMessage();
        }

        const messageId = TwitchChatNormalizer.string(event?.message_id);
        const roomId = TwitchChatNormalizer.string(event?.broadcaster_user_id);
        const authorId = TwitchChatNormalizer.string(event?.chatter_user_id);
        const roomLogin = TwitchChatNormalizer.string(
            event?.broadcaster_user_login,
        )?.toLowerCase();

        TwitchChatNormalizer.requireIdentity(
            messageId,
            roomId,
            authorId,
            roomLogin,
        );
        const badges = TwitchChatNormalizer.badges(event?.badges);

        return TwitchChatNormalizer.common({
            id: messageId,
            text: event?.message?.text,
            occurredAt: TwitchChatNormalizer.time(
                metadata?.message_timestamp,
                receivedAt,
            ),
            room: {
                provider: "twitch",
                id: roomId,
                kind: "channel",
                login: roomLogin,
                displayName: TwitchChatNormalizer.string(
                    event?.broadcaster_user_name,
                ),
            },
            author: {
                id: authorId,
                login: TwitchChatNormalizer.string(
                    event?.chatter_user_login,
                )?.toLowerCase() ?? "unknown",
                displayName: TwitchChatNormalizer.string(
                    event?.chatter_user_name,
                ),
                color: TwitchChatNormalizer.string(event?.color),
                roles: TwitchChatNormalizer.roles(event, badges),
            },
            reply: TwitchChatNormalizer.eventSubReply(event?.reply),
            fragments: TwitchChatNormalizer.fragments(
                event?.message?.fragments,
                event?.message?.text,
            ),
            twitch: {
                transport: "eventsub",
                notificationId: TwitchChatNormalizer.string(metadata?.message_id),
                subscriptionId: TwitchChatNormalizer.string(subscription?.id),
                badges,
                sourceMessageId: TwitchChatNormalizer.string(
                    event?.source_message_id,
                ),
                sourceRoomId: TwitchChatNormalizer.string(
                    event?.source_broadcaster_user_id,
                ),
                messageType: TwitchChatNormalizer.string(event?.message_type),
                bits: TwitchChatNormalizer.integer(event?.cheer?.bits),
            },
        });
    }

    /** Freezes the provider-neutral chat message shape. */
    static common({ id, text, occurredAt, room, author, reply, fragments, twitch })
    {
        if (typeof text !== "string" || text.length === 0)
        {
            throw TwitchChatNormalizer.invalidMessage();
        }

        return CjsToolRealtimeChatContract.normalizeMessage({
            id,
            text,
            occurredAt,
            deliveryMode: "live",
            room,
            author,
            reply,
            fragments,
            extensions: {
                twitch,
            },
        });
    }

    /** Normalizes Twitch badge arrays or tmi.js badge maps. */
    static badges(value)
    {
        if (Array.isArray(value))
        {
            return Object.freeze(value.flatMap(entry =>
            {
                const setId = TwitchChatNormalizer.string(entry?.set_id);
                const id = TwitchChatNormalizer.string(entry?.id);

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
                type: TwitchChatNormalizer.string(fragment?.type) ?? "text",
                text: String(fragment?.text ?? ""),
            };

            if (fragment?.emote)
            {
                const emote = {
                    id: TwitchChatNormalizer.string(fragment.emote.id),
                    setId: TwitchChatNormalizer.string(
                        fragment.emote.emote_set_id,
                    ),
                    ownerId: TwitchChatNormalizer.string(
                        fragment.emote.owner_id,
                    ),
                };
                const formats = TwitchChatNormalizer.formats(
                    fragment.emote.format,
                );

                if (formats)
                {
                    emote.formats = formats;
                }
                emote.asset = TwitchChatNormalizer.emoteAsset(
                    emote.id,
                    formats,
                );

                result.emote = Object.freeze(emote);
            }

            if (fragment?.mention)
            {
                result.mention = Object.freeze({
                    userId: TwitchChatNormalizer.string(
                        fragment.mention.user_id,
                    ),
                    login: TwitchChatNormalizer.string(
                        fragment.mention.user_login,
                    ),
                    displayName: TwitchChatNormalizer.string(
                        fragment.mention.user_name,
                    ),
                });
            }

            if (fragment?.cheermote)
            {
                result.cheermote = Object.freeze({
                    prefix: TwitchChatNormalizer.string(
                        fragment.cheermote.prefix,
                    ),
                    bits: TwitchChatNormalizer.integer(fragment.cheermote.bits),
                    tier: TwitchChatNormalizer.integer(fragment.cheermote.tier),
                });
            }

            return Object.freeze(result);
        }));
    }

    /** Reconstructs typed IRC text, emote, and hosted GIF fragments. */
    static ircFragments(textValue, emoteValue, gifValue, emoteAssets = null)
    {
        const characters = Array.from(String(textValue ?? ""));
        const spans = [
            ...TwitchChatNormalizer.ircEmoteSpans(
                emoteValue,
                emoteAssets,
            ),
            ...TwitchChatNormalizer.ircGifSpans(gifValue),
        ].sort((left, right) => left.start - right.start || left.end - right.end);

        if (spans.length === 0)
        {
            return Object.freeze([ Object.freeze({
                type: "text",
                text: characters.join(""),
            }) ]);
        }

        const fragments = [];
        let position = 0;

        for (const span of spans)
        {
            if (span.start < position || span.end >= characters.length)
            {
                continue;
            }

            if (span.start > position)
            {
                fragments.push(Object.freeze({
                    type: "text",
                    text: characters.slice(position, span.start).join(""),
                }));
            }

            fragments.push(Object.freeze({
                ...span.fragment,
                text: characters.slice(span.start, span.end + 1).join(""),
            }));
            position = span.end + 1;
        }

        if (position < characters.length)
        {
            fragments.push(Object.freeze({
                type: "text",
                text: characters.slice(position).join(""),
            }));
        }

        return Object.freeze(fragments.length > 0
            ? fragments
            : [ Object.freeze({ type: "text", text: characters.join("") }) ]);
    }

    /** Parses tmi-compatible emote maps and raw Twitch IRC emote tags. */
    static ircEmoteSpans(value, assetValue = null)
    {
        let entries;

        if (typeof value === "string")
        {
            entries = value.split("/").flatMap(entry =>
            {
                const separator = entry.indexOf(":");

                return separator > 0
                    ? [ [ entry.slice(0, separator), entry.slice(separator + 1).split(",") ] ]
                    : [];
            });
        }
        else if (value && typeof value === "object")
        {
            entries = Object.entries(value);
        }
        else
        {
            entries = [];
        }

        return entries.flatMap(([ id, positions ]) =>
        {
            if (!TwitchChatNormalizer.string(id)
                || !Array.isArray(positions))
            {
                return [];
            }

            const resolved = assetValue && typeof assetValue === "object"
                ? assetValue[id]
                : null;

            return positions.flatMap(position =>
            {
                const match = /^(\d+)-(\d+)$/u.exec(String(position));
                const start = match ? Number(match[1]) : -1;
                const end = match ? Number(match[2]) : -1;

                return Number.isSafeInteger(start) && Number.isSafeInteger(end)
                    && start >= 0 && end >= start
                    ? [ {
                        start,
                        end,
                        fragment: {
                            type: "emote",
                            emote: Object.freeze({
                                id,
                                setId: null,
                                ownerId: null,
                                formats: Object.freeze([
                                    resolved?.animated === true ? "animated" : "static",
                                    ...(resolved?.animated === true ? [ "static" ] : []),
                                ]),
                                asset: Object.freeze(resolved
                                    ?? TwitchChatNormalizer.emoteAsset(
                                        id,
                                        [ "static" ],
                                    )),
                            }),
                        },
                    } ]
                    : [];
            });
        });
    }

    /** Parses Twitch-hosted GIF ranges without modifying their supplied URLs. */
    static ircGifSpans(value)
    {
        if (typeof value !== "string" || value.length === 0)
        {
            return [];
        }

        return value.split(",").flatMap(entry =>
        {
            const [ range, id, url ] = entry.split("|");
            const match = /^(\d+)-(\d+)$/u.exec(range ?? "");
            const start = match ? Number(match[1]) : -1;
            const end = match ? Number(match[2]) : -1;

            if (!Number.isSafeInteger(start)
                || !Number.isSafeInteger(end)
                || start < 0
                || end < start
                || !TwitchChatNormalizer.string(id)
                || !TwitchChatNormalizer.string(url))
            {
                return [];
            }

            return [ {
                start,
                end,
                fragment: {
                    type: "media",
                    media: Object.freeze({
                        id,
                        url,
                        contentType: "image/gif",
                        animated: true,
                    }),
                },
            } ];
        });
    }

    /** Normalizes provider-declared static and animated emote formats. */
    static formats(value)
    {
        if (!Array.isArray(value))
        {
            return undefined;
        }

        const formats = [ ...new Set(value
            .filter(format => typeof format === "string" && format.length > 0)) ].sort();

        return formats.length > 0 ? Object.freeze(formats) : undefined;
    }

    /** Creates one ready-to-render preferred Twitch emote URL. */
    static emoteAsset(idValue, formatValue)
    {
        const id = TwitchChatNormalizer.string(idValue);
        const formats = Array.isArray(formatValue) ? formatValue : [];
        const animated = formats.includes("animated");

        if (!id)
        {
            throw TwitchChatNormalizer.invalidMessage();
        }

        return Object.freeze({
            id: `twitch-emote-${id}`,
            url: `${EMOTE_CDN}/${encodeURIComponent(id)}/${animated ? "animated" : "static"}/dark/3.0`,
            contentType: animated ? "image/gif" : "image/png",
            animated,
        });
    }

    /** Normalizes the IRC reply tag family. */
    static ircReply(tags)
    {
        const parentMessageId = TwitchChatNormalizer.string(
            tags?.["reply-parent-msg-id"],
        );

        if (!parentMessageId)
        {
            return null;
        }

        return {
            parentMessageId,
            parentAuthorId: TwitchChatNormalizer.string(
                tags?.["reply-parent-user-id"],
            ),
            parentAuthorLogin: TwitchChatNormalizer.string(
                tags?.["reply-parent-user-login"],
            ),
            parentAuthorDisplayName: TwitchChatNormalizer.string(
                tags?.["reply-parent-display-name"],
            ),
            parentText: TwitchChatNormalizer.string(
                tags?.["reply-parent-msg-body"],
            ),
            threadParentMessageId: TwitchChatNormalizer.string(
                tags?.["reply-thread-parent-msg-id"],
            ),
        };
    }

    /** Normalizes the EventSub reply object. */
    static eventSubReply(reply)
    {
        const parentMessageId = TwitchChatNormalizer.string(
            reply?.parent_message_id,
        );

        if (!parentMessageId)
        {
            return null;
        }

        return {
            parentMessageId,
            parentAuthorId: TwitchChatNormalizer.string(reply?.parent_user_id),
            parentAuthorLogin: TwitchChatNormalizer.string(
                reply?.parent_user_login,
            ),
            parentAuthorDisplayName: TwitchChatNormalizer.string(
                reply?.parent_user_name,
            ),
            parentText: TwitchChatNormalizer.string(reply?.parent_message_body),
            threadParentMessageId: TwitchChatNormalizer.string(
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
            throw TwitchChatNormalizer.invalidMessage();
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
            throw TwitchChatNormalizer.invalidMessage();
        }
    }

    /** Creates a sanitized malformed-upstream error. */
    static invalidMessage()
    {
        return new CjsToolRealtimeError(
            "twitch_invalid_message",
            "Twitch delivered a chat message without the required stable identity",
        );
    }

}
