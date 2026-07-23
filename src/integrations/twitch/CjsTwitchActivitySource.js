import { CjsRealtimeSerialLane } from "../../realtime/internal/CjsRealtimeSerialLane.js";

/** Owns one Twitch activity provider and fans it into service projections. */
export class CjsTwitchActivitySource
{

    #abortController;

    #consumers;

    #lane;

    #provider;

    #running;

    constructor({ provider } = {})
    {
        if (!provider || provider.kind !== "twitch.eventsub"
            || !Array.isArray(provider.topics)
            || typeof provider.Start !== "function" || typeof provider.Stop !== "function")
        {
            throw new TypeError("Twitch activity source requires an EventSub provider");
        }

        this.kind = provider.kind;
        this.topics = Object.freeze([ ...provider.topics ]);
        this.#abortController = null;
        this.#consumers = new Map();
        this.#lane = new CjsRealtimeSerialLane();
        this.#provider = provider;
        this.#running = false;
    }

    /** Attaches one service and starts the shared provider for the first consumer. */
    Attach(consumer, { onActivity, onStatus } = {})
    {
        if ((typeof consumer !== "object" && typeof consumer !== "function")
            || consumer === null)
        {
            throw new TypeError("Twitch activity source consumer must be an object");
        }

        if (typeof onActivity !== "function" || typeof onStatus !== "function")
        {
            throw new TypeError("Twitch activity source requires activity and status callbacks");
        }

        return this.#lane.Enqueue(async () =>
        {
            if (this.#consumers.has(consumer))
            {
                return;
            }

            this.#consumers.set(consumer, Object.freeze({ onActivity, onStatus }));

            if (this.#running)
            {
                return;
            }

            this.#abortController = new AbortController();

            try
            {
                await this.#provider.Start(Object.freeze({
                    signal: this.#abortController.signal,
                    onActivity: activity => this.#OnActivity(activity),
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

    /** Detaches one service and stops the provider after the final consumer. */
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

    #OnActivity(activity)
    {
        for (const consumer of this.#consumers.values())
        {
            try
            {
                consumer.onActivity(activity);
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
