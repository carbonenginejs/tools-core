import { CjsBoundedFetch } from "../../internal/CjsBoundedFetch.js";
import { CjsRealtimeError } from "../../realtime/CjsRealtimeError.js";
import {
    CjsRealtimeLivestreamContract,
} from "../../realtime/livestream/CjsRealtimeLivestreamContract.js";
import { CjsRealtimeTwitchStateNormalizer } from "./CjsRealtimeTwitchStateNormalizer.js";
import { CjsTwitchEventSubSource } from "./CjsTwitchEventSubSource.js";
import { CjsTwitchHelixClient } from "./CjsTwitchHelixClient.js";

const SUBSCRIPTIONS = Object.freeze([
    Object.freeze({ type: "channel.update", version: "2" }),
    Object.freeze({ type: "stream.offline", version: "1" }),
    Object.freeze({ type: "stream.online", version: "1" }),
]);

/** Adds Twitch stream-state declarations and Helix seeding to EventSub. */
export class CjsTwitchEventSubStateProvider
{

    #active;

    #clock;

    #helix;

    #maxResponseBytes;

    #onChange;

    #onStatus;

    #readState;

    #registrationId;

    #responseTimeoutMs;

    #rooms;

    #source;

    constructor({
        oauth,
        rooms,
        source = null,
        registrationId = "state",
        helix = null,
        readState = null,
        fetch: fetchImplementation = globalThis.fetch,
        clock = () => Date.now(),
        createWebSocket,
        endpoint,
        apiEndpoint = "https://api.twitch.tv/helix/",
        validationIntervalMs = 60 * 60 * 1000,
        keepaliveGraceMs = 1000,
        reconnectBaseMs = 250,
        reconnectMaxMs = 10000,
        subscriptionTimeoutMs = 8000,
        welcomeTimeoutMs = 8000,
        responseTimeoutMs = 8000,
        maxResponseBytes = 512 * 1024,
    } = {})
    {
        if (source !== null && (!source || typeof source.Register !== "function"
            || typeof source.Attach !== "function" || typeof source.Detach !== "function"))
        {
            throw new TypeError("Twitch EventSub state source is invalid");
        }

        if (readState !== null && typeof readState !== "function")
        {
            throw new TypeError("Twitch state readState option must be a function");
        }

        if (!Number.isSafeInteger(responseTimeoutMs) || responseTimeoutMs < 1
            || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1)
        {
            throw new TypeError("Twitch state response limits must be positive integers");
        }

        const normalizedRooms = CjsTwitchEventSubStateProvider.normalizeRooms(rooms);
        const helixClient = helix ?? (readState === null || source === null
            ? new CjsTwitchHelixClient({
                oauth,
                fetch: fetchImplementation,
                endpoint: apiEndpoint,
            })
            : null);

        if (readState === null && (!helixClient
            || typeof helixClient.Request !== "function"))
        {
            throw new TypeError("Twitch state provider requires a Helix client");
        }

        this.kind = "twitch.eventsub";
        this.#source = source ?? new CjsTwitchEventSubSource({
            oauth,
            fetch: fetchImplementation,
            helix: helixClient,
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
        this.#rooms = normalizedRooms;
        this.#clock = clock;
        this.#helix = helixClient;
        this.#readState = readState;
        this.#responseTimeoutMs = responseTimeoutMs;
        this.#maxResponseBytes = maxResponseBytes;
        this.#source.Register({
            id: registrationId,
            requiredScopes: [],
            subscriptions: normalizedRooms.flatMap(room => SUBSCRIPTIONS.map(entry => ({
                ...entry,
                condition: { broadcaster_user_id: room.id },
            }))),
        });
        this.#active = false;
        this.#onChange = null;
        this.#onStatus = null;
    }

    /** Attaches state normalization to the shared EventSub source. */
    async Start({ signal, onChange, onStatus })
    {
        if (this.#active)
        {
            return;
        }

        if (!(signal instanceof AbortSignal) || typeof onChange !== "function"
            || typeof onStatus !== "function")
        {
            throw new TypeError("Twitch EventSub state callbacks are invalid");
        }

        this.#active = true;
        this.#onChange = onChange;
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
            this.#onChange = null;
            this.#onStatus = null;

            throw error;
        }
    }

    /** Reads a complete provider state after EventSub has begun buffering. */
    async ReadSnapshot(signal)
    {
        const value = this.#readState
            ? await this.#readState({ rooms: this.#rooms, signal })
            : await this.#ReadHelix(signal);

        return CjsRealtimeLivestreamContract.normalizeStateSnapshot(value);
    }

    /** Detaches state and stops the source when it was the final family user. */
    async Stop()
    {
        this.#active = false;
        await this.#source.Detach(this.#registrationId);
        this.#onChange = null;
        this.#onStatus = null;
    }

    #HandleNotification(message)
    {
        try
        {
            this.#onChange(CjsRealtimeTwitchStateNormalizer.fromEventSub(
                message,
                this.#clock(),
            ));
        }
        catch
        {
            this.#onStatus?.({
                state: "degraded",
                reasonCode: "invalid_state",
                retryable: false,
                occurredAt: this.#clock(),
            });
        }
    }

    async #ReadHelix(signal)
    {
        const ids = this.#rooms.map(room => room.id);
        const [ streams, channels ] = await Promise.all([
            this.#ReadRoute("streams", { user_id: ids }, signal),
            this.#ReadRoute("channels", { broadcaster_id: ids }, signal),
        ]);
        const streamsById = new Map(streams.map(stream => [ stream.user_id, stream ]));
        const channelsById = new Map(channels.map(channel => [
            channel.broadcaster_id,
            channel,
        ]));

        return {
            observedAt: new Date(this.#clock()).toISOString(),
            states: this.#rooms.map(room =>
                CjsTwitchEventSubStateProvider.createState(
                    room,
                    streamsById.get(room.id) ?? null,
                    channelsById.get(room.id) ?? null,
                )),
        };
    }

    async #ReadRoute(route, query, signal)
    {
        const response = await this.#helix.Request(route, { query, signal });

        if (response.status < 200 || response.status >= 300)
        {
            throw new CjsRealtimeError(
                "twitch_unavailable",
                "Twitch state could not be read",
                { retryable: response.status >= 500 },
            );
        }

        const value = await CjsBoundedFetch.readJson(response, {
            maxBytes: this.#maxResponseBytes,
            timeoutMs: this.#responseTimeoutMs,
            signal,
            label: "Twitch state response",
        });

        if (!value || typeof value !== "object" || !Array.isArray(value.data))
        {
            throw new CjsRealtimeError(
                "twitch_invalid_response",
                "Twitch returned invalid state data",
            );
        }

        return value.data;
    }

    /** Creates one complete canonical state from Helix stream/channel records. */
    static createState(room, stream, channel)
    {
        const categoryId = CjsTwitchEventSubStateProvider.string(
            stream?.game_id ?? channel?.game_id,
        );
        const categoryName = CjsTwitchEventSubStateProvider.string(
            stream?.game_name ?? channel?.game_name,
        );
        const online = stream !== null;

        return {
            source: {
                provider: "twitch",
                channelId: room.id,
                channelLogin: CjsTwitchEventSubStateProvider.string(
                    channel?.broadcaster_login ?? stream?.user_login ?? room.login,
                )?.toLowerCase() ?? null,
                channelDisplayName: CjsTwitchEventSubStateProvider.string(
                    channel?.broadcaster_name ?? stream?.user_name ?? room.displayName,
                ),
            },
            stream: {
                online,
                streamId: CjsTwitchEventSubStateProvider.string(stream?.id),
                startedAt: CjsTwitchEventSubStateProvider.string(stream?.started_at),
                endedAt: null,
                title: CjsTwitchEventSubStateProvider.string(
                    stream?.title ?? channel?.title,
                ),
                language: CjsTwitchEventSubStateProvider.string(
                    stream?.language ?? channel?.broadcaster_language,
                ),
                mature: typeof stream?.is_mature === "boolean" ? stream.is_mature : null,
                category: categoryId && categoryName
                    ? { id: categoryId, name: categoryName }
                    : null,
                viewers: Number.isSafeInteger(stream?.viewer_count)
                    && stream.viewer_count >= 0 ? stream.viewer_count : null,
            },
            extensions: {
                twitch: { materializedFrom: "helix" },
            },
        };
    }

    /** Validates configured Twitch broadcasters. */
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

            rooms.set(room.id, Object.freeze({
                id: room.id,
                login: CjsTwitchEventSubStateProvider.string(room.login)?.toLowerCase() ?? null,
                displayName: CjsTwitchEventSubStateProvider.string(room.displayName),
            }));
        }

        return Object.freeze([ ...rooms.values() ].sort((left, right) =>
            left.id.localeCompare(right.id)));
    }

    /** Reads a non-empty string or returns null. */
    static string(value)
    {
        return typeof value === "string" && value.length > 0 ? value : null;
    }

}
