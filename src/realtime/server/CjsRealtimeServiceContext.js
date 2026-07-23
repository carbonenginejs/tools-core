import { CjsRealtimeProtocol } from "../CjsRealtimeProtocol.js";

/** Bounded host capabilities supplied to one registered realtime service. */
export class CjsRealtimeServiceContext
{

    #clock;

    #commit;

    #createId;

    #publish;

    constructor({ actor, signal, clock, createId, commit, publish })
    {
        this.actor = Object.freeze(CjsRealtimeProtocol.cloneJson(actor));
        this.signal = signal;
        this.#clock = clock;
        this.#commit = commit;
        this.#createId = createId;
        this.#publish = publish;
        Object.freeze(this);
    }

    /** Publishes one canonical family topic through the service lane. */
    Publish(topic, data, options = {})
    {
        try
        {
            return Promise.resolve(this.#publish(topic, data, options));
        }
        catch (error)
        {
            return Promise.reject(error);
        }
    }

    /** Runs a state mutation and its publications in one service lane. */
    Commit(callback)
    {
        try
        {
            if (typeof callback !== "function")
            {
                throw new TypeError("Realtime service Commit requires a callback");
            }

            return Promise.resolve(this.#commit(callback));
        }
        catch (error)
        {
            return Promise.reject(error);
        }
    }

    /** Returns the host clock in epoch milliseconds. */
    Now()
    {
        return this.#clock();
    }

    /** Creates a host-scoped opaque identity. */
    CreateId(prefix = "id")
    {
        return this.#createId(prefix);
    }

}
