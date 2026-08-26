import { CjsToolRealtimeSerialLane } from "../../realtime/internal/CjsToolRealtimeSerialLane.js";
import {
    CjsToolRealtimeLivestreamContract,
    LIVESTREAM_STATE_FAMILY,
    LIVESTREAM_STATE_TOPICS,
} from "../../realtime/livestream/CjsToolRealtimeLivestreamContract.js";
import { CjsToolWebhookError } from "../../webhook/CjsToolWebhookError.js";

/** Materializes snapshot-recoverable Kick state over shared webhook ingress. */
export class KickStateService
{

    #accepting;

    #context;

    #lane;

    #operations;

    #readSnapshot;

    #rejectSeed;

    #resolveSeed;

    #running;

    #seed;

    #snapshot;

    #source;

    /**
     * Registers a Kick state projection with its ingress source and optional
     * initial snapshot reader.
     */
    constructor({ id, source, readSnapshot } = {})
    {
        if (typeof id !== "string" || id.length === 0)
        {
            throw new TypeError("Kick state service requires an id");
        }

        if (!source || typeof source.Register !== "function"
            || typeof source.Attach !== "function" || typeof source.Detach !== "function")
        {
            throw new TypeError("Kick state service requires a webhook ingress source");
        }

        if (typeof readSnapshot !== "function")
        {
            throw new TypeError("Kick state service requires readSnapshot()");
        }

        this.id = id;
        this.#source = source;
        this.#readSnapshot = readSnapshot;
        this.#accepting = false;
        this.#context = null;
        this.#lane = new CjsToolRealtimeSerialLane();
        this.#operations = new Set();
        this.#rejectSeed = null;
        this.#resolveSeed = null;
        this.#running = false;
        this.#seed = null;
        this.#snapshot = null;
        source.Register({ id, topics: [ LIVESTREAM_STATE_TOPICS.CHANGED ] });
    }

    /** Declares the snapshot-backed Kick livestream state projection. */
    Describe()
    {
        return {
            id: this.id,
            family: LIVESTREAM_STATE_FAMILY,
            familyVersion: 1,
            kind: "kick.webhook",
            topics: [ {
                name: LIVESTREAM_STATE_TOPICS.CHANGED,
                recovery: "snapshot",
            } ],
            commands: [],
            snapshot: true,
            resources: false,
        };
    }

    /** Attaches ingress before seeding so signed changes queue without a gap. */
    async Start(context)
    {
        if (this.#running)
        {
            return;
        }

        this.#context = context;
        this.#accepting = true;
        this.#running = true;
        this.#seed = new Promise((resolve, reject) =>
        {
            this.#resolveSeed = resolve;
            this.#rejectSeed = reject;
        });
        this.#seed.catch(() => undefined);
        context.signal.addEventListener("abort", () =>
        {
            this.#accepting = false;
            this.#rejectSeed?.(new CjsToolWebhookError(
                "service_unavailable",
                "Kick state initialization was stopped",
                { statusCode: 503, retryable: true },
            ));
        }, { once: true });

        try
        {
            this.#source.Attach(this.id, {
                signal: context.signal,
                onEvent: event => this.#OnEvent(event),
            });
            this.#snapshot = CjsToolRealtimeLivestreamContract.normalizeStateSnapshot(
                await this.#readSnapshot({ signal: context.signal }),
            );
            this.#resolveSeed();
            this.#resolveSeed = null;
            this.#rejectSeed = null;
            await this.#lane.Drain();
        }
        catch (error)
        {
            this.#accepting = false;
            this.#rejectSeed?.(error);
            await this.#source.Detach(this.id).catch(() => undefined);
            this.#Reset();

            throw error;
        }
    }

    /** Detaches state and drains changes admitted from the shared ingress. */
    async Stop()
    {
        if (!this.#running)
        {
            return;
        }

        this.#running = false;
        this.#accepting = false;
        this.#rejectSeed?.(new CjsToolWebhookError(
            "service_unavailable",
            "Kick state service stopped before initialization",
            { statusCode: 503, retryable: true },
        ));
        const [ stopResult ] = await Promise.allSettled([
            this.#source.Detach(this.id),
            ...this.#operations,
            this.#lane.Drain(),
        ]);

        this.#Reset();

        if (stopResult.status === "rejected")
        {
            throw stopResult.reason;
        }
    }

    /** Returns state materialized in the same lane as its published cursor. */
    async GetSnapshot()
    {
        if (this.#snapshot === null)
        {
            throw new Error("Kick state service has not been initialized");
        }

        return CjsToolRealtimeLivestreamContract.normalizeStateSnapshot(this.#snapshot);
    }

    /**
     * Normalizes an admitted Kick state change, updates the snapshot, and
     * commits publication.
     */
    #OnEvent(event)
    {
        if (!this.#accepting || event?.topic !== LIVESTREAM_STATE_TOPICS.CHANGED)
        {
            return Promise.reject(new CjsToolWebhookError(
                "service_unavailable",
                "Kick state service is not accepting the event",
                { statusCode: 503, retryable: true },
            ));
        }

        const operation = this.#lane.Enqueue(async () =>
        {
            await this.#seed;
            const change = CjsToolRealtimeLivestreamContract.normalizeStateChange(event.data);

            return this.#context.Commit(async context =>
            {
                if (!this.#accepting)
                {
                    throw new CjsToolWebhookError(
                        "service_unavailable",
                        "Kick state service stopped before publication",
                        { statusCode: 503, retryable: true },
                    );
                }

                this.#snapshot = KickStateService.applyChange(
                    this.#snapshot,
                    change,
                );
                await context.Publish(event.topic, change, event.options);
            });
        });

        this.#operations.add(operation);
        operation.then(
            () => this.#operations.delete(operation),
            () => this.#operations.delete(operation),
        );

        return operation;
    }

    /**
     * Clears lifecycle, seed, context, and tracked-operation state after
     * shutdown or failed startup.
     */
    #Reset()
    {
        this.#accepting = false;
        this.#context = null;
        this.#operations = new Set();
        this.#rejectSeed = null;
        this.#resolveSeed = null;
        this.#running = false;
        this.#seed = null;
        this.#snapshot = null;
    }

    /** Applies one canonical patch to a complete state snapshot. */
    static applyChange(snapshot, change)
    {
        let matched = false;
        const states = snapshot.states.map(state =>
        {
            if (state.source.provider !== change.source.provider
                || state.source.channelId !== change.source.channelId)
            {
                return state;
            }

            matched = true;

            return {
                source: change.source,
                stream: { ...state.stream, ...change.changes },
                extensions: change.extensions,
            };
        });

        if (!matched)
        {
            throw new TypeError("Kick state change source was not initialized");
        }

        return CjsToolRealtimeLivestreamContract.normalizeStateSnapshot({
            observedAt: change.occurredAt,
            states,
        });
    }

}
