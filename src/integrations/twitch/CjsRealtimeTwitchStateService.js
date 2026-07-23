import {
    CjsRealtimeLivestreamContract,
    LIVESTREAM_STATE_FAMILY,
    LIVESTREAM_STATE_TOPICS,
} from "../../realtime/livestream/CjsRealtimeLivestreamContract.js";
import { CjsTwitchStateSource } from "./CjsTwitchStateSource.js";

/** Exposes materialized Twitch stream state with snapshot recovery. */
export class CjsRealtimeTwitchStateService
{

    #accepting;

    #context;

    #operations;

    #room;

    #running;

    #snapshot;

    #source;

    constructor({ id, provider = null, source = null, room = null } = {})
    {
        if (typeof id !== "string" || id.length === 0)
        {
            throw new TypeError("Twitch state service requires an id");
        }

        if ((provider === null) === (source === null))
        {
            throw new TypeError("Twitch state service requires exactly one provider or source");
        }

        const stateSource = source ?? new CjsTwitchStateSource({ provider });

        if (stateSource.kind !== "twitch.eventsub"
            || typeof stateSource.Attach !== "function"
            || typeof stateSource.Detach !== "function")
        {
            throw new TypeError("Twitch state service source is invalid");
        }

        this.id = id;
        this.#room = CjsRealtimeTwitchStateService.normalizeRoom(room);
        this.#accepting = false;
        this.#context = null;
        this.#operations = new Set();
        this.#running = false;
        this.#snapshot = null;
        this.#source = stateSource;
    }

    /** Declares a snapshot-recoverable Twitch livestream state service. */
    Describe()
    {
        return {
            family: LIVESTREAM_STATE_FAMILY,
            familyVersion: 1,
            kind: this.#source.kind,
            id: this.id,
            topics: [ {
                name: LIVESTREAM_STATE_TOPICS.CHANGED,
                recovery: "snapshot",
            } ],
            commands: [],
            snapshot: true,
            resources: false,
        };
    }

    /** Starts one aggregate or exact-room projection after state is seeded. */
    async Start(context)
    {
        if (this.#running)
        {
            return;
        }

        this.#context = context;
        this.#accepting = true;
        this.#running = true;
        context.signal.addEventListener("abort", () =>
        {
            this.#accepting = false;
        }, { once: true });

        try
        {
            await this.#source.Attach(this, Object.freeze({
                onChange: change => this.#OnChange(change),
                onSnapshot: snapshot =>
                {
                    this.#snapshot = CjsRealtimeTwitchStateService.filterSnapshot(
                        snapshot,
                        this.#room,
                    );
                },
                onStatus: () => undefined,
            }));
        }
        catch (error)
        {
            this.#accepting = false;
            this.#context = null;
            this.#running = false;
            this.#snapshot = null;

            throw error;
        }
    }

    /** Stops this projection and drains its admitted publications. */
    async Stop()
    {
        if (!this.#running)
        {
            return;
        }

        this.#running = false;
        this.#accepting = false;
        const [ stopResult ] = await Promise.allSettled([
            this.#source.Detach(this),
            ...this.#operations,
        ]);

        this.#context = null;
        this.#operations = new Set();
        this.#snapshot = null;

        if (stopResult.status === "rejected")
        {
            throw stopResult.reason;
        }
    }

    /** Returns the complete current state for this service projection. */
    async GetSnapshot()
    {
        if (this.#snapshot === null)
        {
            throw new Error("Twitch state service has not been initialized");
        }

        return CjsRealtimeLivestreamContract.normalizeStateSnapshot(this.#snapshot);
    }

    #OnChange(change)
    {
        if (!this.#accepting || change?.topic !== LIVESTREAM_STATE_TOPICS.CHANGED)
        {
            return;
        }

        let normalized;

        try
        {
            normalized = CjsRealtimeLivestreamContract.normalizeStateChange(change.data);
        }
        catch
        {
            return;
        }

        if (!CjsRealtimeTwitchStateService.matchesRoom(this.#room, normalized.source))
        {
            return;
        }

        const operation = this.#context.Commit(async context =>
        {
            if (this.#accepting)
            {
                this.#snapshot = CjsRealtimeTwitchStateService.applyChange(
                    this.#snapshot,
                    normalized,
                );
                await context.Publish(LIVESTREAM_STATE_TOPICS.CHANGED, normalized, {
                    occurredAt: normalized.occurredAt,
                });
            }
        });

        this.#Track(operation);
    }

    #Track(operation)
    {
        const tracked = Promise.resolve(operation).then(
            () => undefined,
            () => undefined,
        );

        this.#operations.add(tracked);
        tracked.then(() => this.#operations.delete(tracked));
    }

    /** Normalizes an optional exact Twitch room selector. */
    static normalizeRoom(value)
    {
        if (value === null)
        {
            return null;
        }

        if (!value || typeof value !== "object" || Array.isArray(value))
        {
            throw new TypeError("Twitch state room must be an object or null");
        }

        const id = value.id ?? null;
        const login = value.login?.replace(/^#/u, "").toLowerCase() ?? null;

        if ((id === null && login === null)
            || (id !== null && (typeof id !== "string" || !/^\d+$/u.test(id)))
            || (login !== null && (typeof login !== "string"
                || !/^[a-z0-9_]{1,25}$/u.test(login))))
        {
            throw new TypeError("Twitch state room requires a valid id or login");
        }

        return Object.freeze({ id, login });
    }

    /** Tests a canonical source against one exact room selector. */
    static matchesRoom(selector, source)
    {
        return selector === null
            || ((selector.id === null || selector.id === source.channelId)
                && (selector.login === null
                    || selector.login === source.channelLogin?.toLowerCase()));
    }

    /** Filters a full source snapshot to one service projection. */
    static filterSnapshot(snapshot, selector)
    {
        return CjsRealtimeLivestreamContract.normalizeStateSnapshot({
            observedAt: snapshot.observedAt,
            states: snapshot.states.filter(state =>
                CjsRealtimeTwitchStateService.matchesRoom(selector, state.source)),
        });
    }

    /** Applies one source patch to service-owned materialized state. */
    static applyChange(snapshot, change)
    {
        const states = snapshot.states.map(state =>
        {
            if (state.source.provider !== change.source.provider
                || state.source.channelId !== change.source.channelId)
            {
                return state;
            }

            return {
                source: change.source,
                stream: { ...state.stream, ...change.changes },
                extensions: change.extensions,
            };
        });

        if (!states.some(state => state.source.provider === change.source.provider
            && state.source.channelId === change.source.channelId))
        {
            throw new TypeError("Twitch state change source was not initialized");
        }

        return CjsRealtimeLivestreamContract.normalizeStateSnapshot({
            observedAt: change.occurredAt,
            states,
        });
    }

}
