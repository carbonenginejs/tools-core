import { CjsToolRealtimeSerialLane } from "../../realtime/internal/CjsToolRealtimeSerialLane.js";

const PROVIDER_KINDS = new Set([ "twitch.eventsub", "twitch.irc" ]);

/** Owns one Twitch transport and fans its live output into several chat services. */
export class TwitchChatSource
{

    #abortController;

    #consumers;

    #lane;

    #leasesByConsumer;

    #provider;

    #roomLeases;

    #roomMetadata;

    #running;

    /**
     * Adapts an IRC or EventSub chat provider into shared consumers and
     * reference-counted room leases.
     */
    constructor({ provider, integrationId = null } = {})
    {
        if (!provider || !PROVIDER_KINDS.has(provider.kind)
            || typeof provider.Start !== "function" || typeof provider.Stop !== "function")
        {
            throw new TypeError("Twitch chat source requires an IRC or EventSub provider");
        }

        if (integrationId !== null && (typeof integrationId !== "string"
            || integrationId.length < 1 || integrationId.length > 256))
        {
            throw new TypeError("Twitch chat source integrationId is invalid");
        }

        this.kind = provider.kind;
        this.integrationId = integrationId;
        this.supportsDynamicRooms = typeof provider.JoinRoom === "function"
            && typeof provider.PartRoom === "function";
        this.#abortController = null;
        this.#consumers = new Map();
        this.#lane = new CjsToolRealtimeSerialLane();
        this.#leasesByConsumer = new Map();
        this.#provider = provider;
        this.#roomLeases = new Map();
        this.#roomMetadata = new Map();
        this.#running = false;
    }

    /** Attaches one service and starts the shared provider for the first consumer. */
    Attach(consumer, { onMessage, onStatus } = {})
    {
        if ((typeof consumer !== "object" && typeof consumer !== "function")
            || consumer === null)
        {
            throw new TypeError("Twitch chat source consumer must be an object");
        }

        if (typeof onMessage !== "function" || typeof onStatus !== "function")
        {
            throw new TypeError("Twitch chat source requires message and status callbacks");
        }

        return this.#lane.Enqueue(async () =>
        {
            if (this.#consumers.has(consumer))
            {
                return;
            }

            this.#consumers.set(consumer, Object.freeze({ onMessage, onStatus }));

            if (this.#running)
            {
                return;
            }

            this.#abortController = new AbortController();

            try
            {
                await this.#provider.Start(Object.freeze({
                    signal: this.#abortController.signal,
                    onMessage: message => this.#OnMessage(message),
                    onStatus: status => this.#OnStatus(status),
                }));
                this.#running = true;
            }
            catch (error)
            {
                this.#consumers.delete(consumer);
                this.#abortController.abort();
                this.#abortController = null;
                await Promise.allSettled([ this.#provider.Stop() ]);

                throw error;
            }
        });
    }

    /** Acquires one upstream room for a service subscription lease. */
    AcquireRoom(consumer, leaseId, login)
    {
        const room = TwitchChatSource.normalizeRoomLogin(login);

        if (!this.supportsDynamicRooms)
        {
            throw new TypeError("Twitch chat source does not support dynamic rooms");
        }

        if (typeof leaseId !== "string" || leaseId.length < 1 || leaseId.length > 128)
        {
            throw new TypeError("Twitch chat room lease ID is invalid");
        }

        return this.#lane.Enqueue(async () =>
        {
            if (!this.#consumers.has(consumer))
            {
                throw new Error("Twitch chat source consumer is not attached");
            }

            const leases = this.#leasesByConsumer.get(consumer) ?? new Map();
            const existing = leases.get(leaseId);

            if (existing)
            {
                if (existing !== room)
                {
                    throw new Error("Twitch chat room lease already targets another room");
                }

                return false;
            }

            let roomLeases = this.#roomLeases.get(room);

            if (!roomLeases)
            {
                await this.#provider.JoinRoom(room);
                let metadata;

                try
                {
                    metadata = typeof this.#provider.ResolveRoom === "function"
                        ? await this.#provider.ResolveRoom(room)
                        : null;
                }
                catch (error)
                {
                    await this.#provider.PartRoom(room).catch(() => undefined);
                    throw error;
                }

                roomLeases = new Set();
                this.#roomLeases.set(room, roomLeases);
                this.#roomMetadata.set(room, metadata);
            }

            leases.set(leaseId, room);
            roomLeases.add(leaseId);
            this.#leasesByConsumer.set(consumer, leases);

            return this.#roomMetadata.get(room) ?? null;
        });
    }

    /** Releases one room and parts upstream after its final service lease. */
    ReleaseRoom(consumer, leaseId)
    {
        return this.#lane.Enqueue(() => this.#ReleaseRoom(consumer, leaseId));
    }

    /** Detaches one service and stops the shared provider after the final consumer. */
    Detach(consumer)
    {
        return this.#lane.Enqueue(async () =>
        {
            await this.#ReleaseConsumerRooms(consumer);
            this.#consumers.delete(consumer);

            if (this.#consumers.size !== 0 || !this.#running)
            {
                return;
            }

            this.#running = false;
            this.#abortController?.abort();
            this.#abortController = null;
            await this.#provider.Stop();
        });
    }

    /**
     * Fans one normalized chat message out without allowing a failed consumer to
     * interrupt siblings.
     */
    #OnMessage(message)
    {
        for (const consumer of this.#consumers.values())
        {
            try
            {
                consumer.onMessage(message);
            }
            catch
            {
                // A broken consumer cannot interrupt sibling room services.
            }
        }
    }

    /**
     * Fans one chat-provider condition out to every attached consumer
     * independently.
     */
    #OnStatus(status)
    {
        for (const consumer of this.#consumers.values())
        {
            try
            {
                consumer.onStatus(status);
            }
            catch
            {
                // A broken consumer cannot interrupt sibling room services.
            }
        }
    }

    /** Releases every room lease held by one detaching consumer. */
    async #ReleaseConsumerRooms(consumer)
    {
        const leases = this.#leasesByConsumer.get(consumer);

        if (!leases)
        {
            return;
        }

        for (const leaseId of [ ...leases.keys() ])
        {
            await this.#ReleaseRoom(consumer, leaseId);
        }
    }

    /**
     * Removes one lease and parts the upstream room after its final consumer
     * releases it.
     */
    async #ReleaseRoom(consumer, leaseId)
    {
        const leases = this.#leasesByConsumer.get(consumer);
        const room = leases?.get(leaseId);

        if (!room)
        {
            return false;
        }

        leases.delete(leaseId);

        if (leases.size === 0)
        {
            this.#leasesByConsumer.delete(consumer);
        }

        const roomLeases = this.#roomLeases.get(room);

        roomLeases?.delete(leaseId);

        if (roomLeases?.size === 0)
        {
            this.#roomLeases.delete(room);
            this.#roomMetadata.delete(room);
            await this.#provider.PartRoom(room);
        }

        return true;
    }

    /** Normalizes one Twitch channel login for source-wide lease identity. */
    static normalizeRoomLogin(value)
    {
        const room = typeof value === "string"
            ? value.replace(/^#/u, "").toLowerCase()
            : "";

        if (!/^[a-z0-9_]{1,25}$/u.test(room))
        {
            throw new TypeError("Twitch chat room login is invalid");
        }

        return room;
    }

}
