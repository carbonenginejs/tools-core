import { CjsRealtimeError } from "../CjsRealtimeError.js";

/** Minimal promise lane for deterministic per-service work ordering. */
export class CjsRealtimeSerialLane
{

    #maxPending;

    #pending;

    #tail;

    constructor({ maxPending = Number.POSITIVE_INFINITY } = {})
    {
        if (!(maxPending === Number.POSITIVE_INFINITY
            || (Number.isSafeInteger(maxPending) && maxPending > 0)))
        {
            throw new TypeError("Realtime serial lane maxPending must be positive");
        }

        this.#maxPending = maxPending;
        this.#pending = 0;
        this.#tail = Promise.resolve();
    }

    /** Enqueues one unit of work without poisoning later work on failure. */
    Enqueue(callback)
    {
        if (this.#pending >= this.#maxPending)
        {
            throw new CjsRealtimeError("queue_full", "Realtime service queue is full", {
                retryable: true,
                statusCode: 503,
            });
        }

        this.#pending++;
        const result = this.#tail.then(callback).finally(() =>
        {
            this.#pending--;
        });

        this.#tail = result.catch(() => undefined);

        return result;
    }

    /** Resolves after all previously queued work settles. */
    Drain()
    {
        return this.#tail;
    }

}
