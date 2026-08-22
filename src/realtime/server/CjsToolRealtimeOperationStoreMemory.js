import { CjsToolRealtimeError } from "../CjsToolRealtimeError.js";
import { CjsToolRealtimeProtocol } from "../CjsToolRealtimeProtocol.js";

/** Bounded in-memory single-flight and completed-operation deduplication. */
export class CjsToolRealtimeOperationStoreMemory
{

    #clock;

    #entries;

    constructor({
        clock = () => Date.now(),
        retentionMs = 15 * 60 * 1000,
        maxEntries = 10000,
    } = {})
    {
        if (typeof clock !== "function")
        {
            throw new TypeError("Realtime operation clock must be a function");
        }

        if (!Number.isSafeInteger(retentionMs) || retentionMs < 1)
        {
            throw new TypeError("Realtime operation retentionMs must be a positive integer");
        }

        if (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
        {
            throw new TypeError("Realtime operation maxEntries must be a positive integer");
        }

        this.#clock = clock;
        this.retentionMs = retentionMs;
        this.maxEntries = maxEntries;
        this.#entries = new Map();
    }

    /** Executes one operation once or joins its existing invocation. */
    Execute({ actor, serviceId, action, operationId, data }, callback)
    {
        const key = CjsToolRealtimeProtocol.canonicalStringify([
            actor.kind,
            actor.id,
            serviceId,
            action,
            operationId,
        ]);
        const fingerprint = CjsToolRealtimeProtocol.canonicalStringify(data);

        this.Prune();
        const existing = this.#entries.get(key);

        if (existing)
        {
            if (existing.fingerprint !== fingerprint)
            {
                throw new CjsToolRealtimeError(
                    "operation_conflict",
                    "Operation ID was already used with different data",
                );
            }

            return existing.promise;
        }

        if (this.#entries.size >= this.maxEntries)
        {
            throw new CjsToolRealtimeError("queue_full", "Realtime operation store is full", {
                retryable: true,
                statusCode: 503,
            });
        }

        const entry = {
            fingerprint,
            expiresAt: Number.POSITIVE_INFINITY,
            promise: null,
        };

        entry.promise = Promise.resolve().then(callback).catch(error =>
        {
            if (error instanceof CjsToolRealtimeError && error.retryable)
            {
                this.#entries.delete(key);
            }

            throw error;
        }).finally(() =>
        {
            if (this.#entries.get(key) === entry)
            {
                entry.expiresAt = this.#clock() + this.retentionMs;
            }
        });
        this.#entries.set(key, entry);

        return entry.promise;
    }

    /** Removes expired completed operations and returns the removed count. */
    Prune()
    {
        const now = this.#clock();
        let removed = 0;

        for (const [ key, entry ] of this.#entries)
        {
            if (entry.expiresAt <= now)
            {
                this.#entries.delete(key);
                removed++;
            }
        }

        return removed;
    }

}
