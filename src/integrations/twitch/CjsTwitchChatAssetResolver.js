import { CjsToolBoundedFetch } from "../../internal/CjsToolBoundedFetch.js";
import { CjsToolRealtimeError } from "../../realtime/CjsToolRealtimeError.js";
import { CjsToolRealtimeChatContract } from "../../realtime/chat/CjsToolRealtimeChatContract.js";
import { CjsRealtimeTwitchChatNormalizer } from "./CjsRealtimeTwitchChatNormalizer.js";

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Resolves and caches Twitch channel profile images and preferred static or
 * animated IRC emote URLs before chat publication.
 */
export class CjsTwitchChatAssetResolver
{

    #catalogs;
    #clock;
    #emotes;
    #fetch;
    #helix;
    #requestTimeoutMs;
    #rooms;
    #ttlMs;

    constructor({
        helix,
        fetch: fetchImplementation = globalThis.fetch,
        clock = () => Date.now(),
        ttlMs = DEFAULT_TTL_MS,
        requestTimeoutMs = 10000,
    } = {})
    {
        if (!helix || typeof helix.Request !== "function")
        {
            throw new TypeError("Twitch chat asset resolver requires a Helix client");
        }
        if (typeof fetchImplementation !== "function" || typeof clock !== "function")
        {
            throw new TypeError("Twitch chat asset resolver fetch and clock must be functions");
        }
        if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000
            || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1)
        {
            throw new TypeError("Twitch chat asset resolver time limits are invalid");
        }

        this.#helix = helix;
        this.#fetch = fetchImplementation;
        this.#clock = clock;
        this.#ttlMs = ttlMs;
        this.#requestTimeoutMs = requestTimeoutMs;
        this.#rooms = new Map();
        this.#catalogs = new Map();
        this.#emotes = new Map();
    }

    /** Resolves a Twitch channel identity and its profile-image URL. */
    async ResolveRoom(loginValue, { signal = undefined } = {})
    {
        const login = CjsTwitchChatAssetResolver.normalizeLogin(loginValue);
        const cached = this.#Read(this.#rooms, login);

        if (cached)
        {
            return cached;
        }

        const payload = await this.#RequestJson("users", {
            query: { login },
            signal,
        });
        const user = Array.isArray(payload?.data) ? payload.data[0] : null;
        const id = CjsTwitchChatAssetResolver.string(user?.id);
        const profileImageUrl = CjsTwitchChatAssetResolver.httpsUrl(
            user?.profile_image_url,
        );

        if (!id || !profileImageUrl)
        {
            throw new CjsToolRealtimeError(
                "twitch_room_metadata_unavailable",
                "Twitch channel metadata is unavailable",
                { retryable: true },
            );
        }

        const room = CjsToolRealtimeChatContract.freeze({
            id,
            login: CjsTwitchChatAssetResolver.string(user?.login)?.toLowerCase()
                ?? login,
            displayName: CjsTwitchChatAssetResolver.string(user?.display_name)
                ?? login,
            assets: {
                icon: {
                    id: `twitch-channel-${id}`,
                    url: profileImageUrl,
                    contentType: CjsTwitchChatAssetResolver.imageContentType(
                        profileImageUrl,
                    ),
                    animated: false,
                },
            },
        });

        this.#Write(this.#rooms, login, room);
        return room;
    }

    /** Resolves all Twitch assets needed to publish one IRC message. */
    async ResolveIrcMessage({ channel, tags, signal = undefined } = {})
    {
        const login = CjsTwitchChatAssetResolver.normalizeLogin(channel);
        const room = await this.ResolveRoom(login, { signal });
        const ids = CjsTwitchChatAssetResolver.emoteIds(tags?.emotes);

        await Promise.allSettled([
            this.#LoadCatalog("global", "chat/emotes/global", null, signal),
            this.#LoadCatalog(
                `channel:${room.id}`,
                "chat/emotes",
                { broadcaster_id: room.id },
                signal,
            ),
        ]);

        const emotes = {};

        for (const id of ids)
        {
            const cached = this.#Read(this.#emotes, id);
            emotes[id] = cached ?? await this.#ProbeEmote(id, signal);
        }

        return CjsToolRealtimeChatContract.freeze({ room, emotes });
    }

    async #LoadCatalog(key, route, query, signal)
    {
        if (this.#Read(this.#catalogs, key))
        {
            return;
        }

        const payload = await this.#RequestJson(route, { query, signal });

        for (const entry of Array.isArray(payload?.data) ? payload.data : [])
        {
            const id = CjsTwitchChatAssetResolver.string(entry?.id);
            const formats = Array.isArray(entry?.format) ? entry.format : [];

            if (id)
            {
                this.#Write(
                    this.#emotes,
                    id,
                    CjsRealtimeTwitchChatNormalizer.emoteAsset(id, formats),
                );
            }
        }

        this.#Write(this.#catalogs, key, true);
    }

    async #ProbeEmote(id, signal)
    {
        const animated = CjsRealtimeTwitchChatNormalizer.emoteAsset(
            id,
            [ "animated" ],
        );
        let supportsAnimation = false;

        try
        {
            const response = await CjsToolBoundedFetch.run(
                requestSignal => this.#fetch(animated.url, {
                    method: "HEAD",
                    signal: requestSignal,
                }),
                {
                    timeoutMs: this.#requestTimeoutMs,
                    signal,
                    label: "Twitch emote probe",
                },
            );
            supportsAnimation = response?.ok === true
                || Number(response?.status) >= 200 && Number(response?.status) < 300;
        }
        catch
        {
            supportsAnimation = false;
        }

        const asset = supportsAnimation
            ? animated
            : CjsRealtimeTwitchChatNormalizer.emoteAsset(id, [ "static" ]);
        this.#Write(this.#emotes, id, asset);
        return asset;
    }

    async #RequestJson(route, { query = null, signal = undefined } = {})
    {
        const response = await this.#helix.Request(route, { query, signal });

        if (!response?.ok || typeof response.json !== "function")
        {
            throw new CjsToolRealtimeError(
                "twitch_asset_metadata_unavailable",
                "Twitch asset metadata is unavailable",
                { retryable: Number(response?.status) >= 500 },
            );
        }

        return response.json();
    }

    #Read(cache, key)
    {
        const entry = cache.get(key);

        if (!entry)
        {
            return null;
        }

        if (entry.expiresAt <= this.#clock())
        {
            cache.delete(key);
            return null;
        }

        return entry.value;
    }

    #Write(cache, key, value)
    {
        cache.set(key, {
            expiresAt: this.#clock() + this.#ttlMs,
            value,
        });
    }

    static normalizeLogin(value)
    {
        const login = String(value ?? "").replace(/^#/u, "").toLowerCase();

        if (!/^[a-z0-9_]{1,25}$/u.test(login))
        {
            throw new TypeError("Twitch asset room login is invalid");
        }

        return login;
    }

    static emoteIds(value)
    {
        const ids = typeof value === "string"
            ? value.split("/").map(entry => entry.split(":")[0])
            : value && typeof value === "object"
                ? Object.keys(value)
                : [];

        return Object.freeze([ ...new Set(ids.filter(id =>
            typeof id === "string" && id.length > 0 && id.length <= 256)) ]);
    }

    static httpsUrl(value)
    {
        try
        {
            const url = new URL(String(value ?? ""));
            return url.protocol === "https:" ? url.href : null;
        }
        catch
        {
            return null;
        }
    }

    static imageContentType(value)
    {
        const pathname = new URL(value).pathname.toLowerCase();
        if (pathname.endsWith(".png")) return "image/png";
        if (pathname.endsWith(".webp")) return "image/webp";
        if (pathname.endsWith(".gif")) return "image/gif";
        if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
        return null;
    }

    static string(value)
    {
        return typeof value === "string" && value.length > 0 ? value : null;
    }

}
