import { CjsRealtimeSerialLane } from "../../realtime/internal/CjsRealtimeSerialLane.js";
import {
    CjsRealtimeLivestreamContract,
    LIVESTREAM_STATE_TOPICS,
} from "../../realtime/livestream/CjsRealtimeLivestreamContract.js";

/** Owns one Twitch state provider and materializes its shared channel state. */
export class CjsTwitchStateSource
{

    #abortController;

    #consumers;

    #lane;

    #observedAt;

    #provider;

    #recentEventLimit;

    #recentIds;

    #recentOrder;

    #running;

    #states;

    constructor({ provider, recentEventLimit = 4096 } = {})
    {
        if (!provider || provider.kind !== "twitch.eventsub"
            || typeof provider.Start !== "function"
            || typeof provider.ReadSnapshot !== "function"
            || typeof provider.Stop !== "function")
        {
            throw new TypeError("Twitch state source requires an EventSub state provider");
        }

        if (!Number.isSafeInteger(recentEventLimit) || recentEventLimit < 1)
        {
            throw new TypeError("Twitch state recentEventLimit must be a positive integer");
        }

        this.kind = provider.kind;
        this.#abortController = null;
        this.#consumers = new Map();
        this.#lane = new CjsRealtimeSerialLane();
        this.#observedAt = null;
        this.#provider = provider;
        this.#recentEventLimit = recentEventLimit;
        this.#recentIds = new Set();
        this.#recentOrder = [];
        this.#running = false;
        this.#states = new Map();
    }

    /** Attaches one service and initializes state behind the notification lane. */
    Attach(consumer, { onChange, onSnapshot, onStatus } = {})
    {
        if ((typeof consumer !== "object" && typeof consumer !== "function")
            || consumer === null)
        {
            throw new TypeError("Twitch state source consumer must be an object");
        }

        if (typeof onChange !== "function" || typeof onSnapshot !== "function"
            || typeof onStatus !== "function")
        {
            throw new TypeError("Twitch state source requires change and status callbacks");
        }

        return this.#lane.Enqueue(async () =>
        {
            if (this.#consumers.has(consumer))
            {
                return;
            }

            if (this.#running)
            {
                onSnapshot(this.#Snapshot());
                this.#consumers.set(consumer, Object.freeze({
                    onChange,
                    onSnapshot,
                    onStatus,
                }));

                return;
            }

            this.#consumers.set(consumer, Object.freeze({
                onChange,
                onSnapshot,
                onStatus,
            }));

            this.#abortController = new AbortController();

            try
            {
                await this.#provider.Start(Object.freeze({
                    signal: this.#abortController.signal,
                    onChange: change => this.#QueueChange(change),
                    onStatus: status => this.#QueueStatus(status),
                }));
                const snapshot = await this.#provider.ReadSnapshot(
                    this.#abortController.signal,
                );

                this.#Replace(snapshot);
                onSnapshot(this.#Snapshot());
                this.#running = true;
            }
            catch (error)
            {
                this.#consumers.delete(consumer);
                this.#abortController.abort();
                this.#abortController = null;
                await Promise.allSettled([ this.#provider.Stop() ]);
                this.#Reset();

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
            this.#Reset();
        });
    }

    /** Captures the current materialized source state through the source lane. */
    GetSnapshot()
    {
        return this.#lane.Enqueue(() => this.#Snapshot());
    }

    #QueueChange(change)
    {
        this.#lane.Enqueue(() => this.#Apply(change)).catch(() =>
        {
            this.#NotifyStatus({
                state: "degraded",
                reasonCode: "invalid_state",
                retryable: false,
            });
        });
    }

    #QueueStatus(status)
    {
        this.#lane.Enqueue(() => this.#NotifyStatus(status)).catch(() => undefined);
    }

    #Apply(change)
    {
        if (change?.topic !== LIVESTREAM_STATE_TOPICS.CHANGED)
        {
            throw new TypeError("Twitch state source received an unsupported topic");
        }

        const normalized = CjsRealtimeLivestreamContract.normalizeStateChange(change.data);
        const identity = CjsTwitchStateSource.sourceKey(normalized.source);
        const current = this.#states.get(identity);
        const eventIdentity = `${identity}:${normalized.id}`;

        if (!current)
        {
            throw new TypeError(`Twitch state source was not seeded: ${identity}`);
        }

        if (this.#recentIds.has(eventIdentity))
        {
            return;
        }

        const next = CjsRealtimeLivestreamContract.normalizeStateSnapshot({
            observedAt: normalized.occurredAt,
            states: [ {
                source: normalized.source,
                stream: { ...current.stream, ...normalized.changes },
                extensions: normalized.extensions,
            } ],
        }).states[0];

        this.#states.set(identity, next);
        this.#observedAt = normalized.occurredAt;
        this.#recentIds.add(eventIdentity);
        this.#recentOrder.push(eventIdentity);

        while (this.#recentOrder.length > this.#recentEventLimit)
        {
            this.#recentIds.delete(this.#recentOrder.shift());
        }

        for (const consumer of this.#consumers.values())
        {
            try
            {
                consumer.onChange(Object.freeze({
                    topic: change.topic,
                    data: normalized,
                }));
            }
            catch
            {
                // A broken consumer cannot interrupt sibling state services.
            }
        }
    }

    #Replace(snapshot)
    {
        const normalized = CjsRealtimeLivestreamContract.normalizeStateSnapshot(snapshot);

        this.#states = new Map(normalized.states.map(state => [
            CjsTwitchStateSource.sourceKey(state.source),
            state,
        ]));
        this.#observedAt = normalized.observedAt;
    }

    #Snapshot()
    {
        return CjsRealtimeLivestreamContract.normalizeStateSnapshot({
            observedAt: this.#observedAt,
            states: [ ...this.#states.values() ],
        });
    }

    #NotifyStatus(status)
    {
        for (const consumer of this.#consumers.values())
        {
            try
            {
                consumer.onStatus(status);
            }
            catch
            {
                // A broken consumer cannot interrupt sibling state services.
            }
        }
    }

    #Reset()
    {
        this.#observedAt = null;
        this.#recentIds = new Set();
        this.#recentOrder = [];
        this.#running = false;
        this.#states = new Map();
    }

    /** Returns a provider/channel identity for one canonical source. */
    static sourceKey(source)
    {
        return `${source.provider}:${source.channelId}`;
    }

}
