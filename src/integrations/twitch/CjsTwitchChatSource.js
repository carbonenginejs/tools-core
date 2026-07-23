import { CjsRealtimeSerialLane } from "../../realtime/internal/CjsRealtimeSerialLane.js";

const PROVIDER_KINDS = new Set([ "twitch.eventsub", "twitch.irc" ]);

/** Owns one Twitch transport and fans its live output into several chat services. */
export class CjsTwitchChatSource
{

    #abortController;

    #consumers;

    #lane;

    #provider;

    #running;

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
        this.#abortController = null;
        this.#consumers = new Map();
        this.#lane = new CjsRealtimeSerialLane();
        this.#provider = provider;
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

    /** Detaches one service and stops the shared provider after the final consumer. */
    Detach(consumer)
    {
        return this.#lane.Enqueue(async () =>
        {
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

}
