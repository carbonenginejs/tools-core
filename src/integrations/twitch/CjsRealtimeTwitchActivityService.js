import {
    CjsRealtimeLivestreamContract,
    LIVESTREAM_ACTIVITY_FAMILY,
} from "../../realtime/livestream/CjsRealtimeLivestreamContract.js";
import { CjsTwitchActivitySource } from "./CjsTwitchActivitySource.js";

/** Exposes Twitch EventSub activity through a live provider-neutral service. */
export class CjsRealtimeTwitchActivityService
{

    #accepting;

    #context;

    #operations;

    #recentEventLimit;

    #recentIds;

    #recentOrder;

    #room;

    #running;

    #source;

    constructor({
        id,
        provider = null,
        source = null,
        room = null,
        recentEventLimit = 4096,
    } = {})
    {
        if (typeof id !== "string" || id.length === 0)
        {
            throw new TypeError("Twitch activity service requires an id");
        }

        if ((provider === null) === (source === null))
        {
            throw new TypeError("Twitch activity service requires exactly one provider or source");
        }

        const activitySource = source ?? new CjsTwitchActivitySource({ provider });

        if (activitySource.kind !== "twitch.eventsub"
            || !Array.isArray(activitySource.topics)
            || typeof activitySource.Attach !== "function"
            || typeof activitySource.Detach !== "function")
        {
            throw new TypeError("Twitch activity service source is invalid");
        }

        if (!Number.isSafeInteger(recentEventLimit) || recentEventLimit < 1)
        {
            throw new TypeError("Twitch activity recentEventLimit must be a positive integer");
        }

        this.id = id;
        this.#room = CjsRealtimeTwitchActivityService.normalizeRoom(room);
        this.#recentEventLimit = recentEventLimit;
        this.#accepting = false;
        this.#context = null;
        this.#operations = new Set();
        this.#recentIds = new Set();
        this.#recentOrder = [];
        this.#running = false;
        this.#source = activitySource;
    }

    /** Declares one future-only provider-neutral livestream activity stream. */
    Describe()
    {
        return {
            family: LIVESTREAM_ACTIVITY_FAMILY,
            familyVersion: 1,
            kind: this.#source.kind,
            id: this.id,
            topics: this.#source.topics.map(name => ({
                name,
                recovery: "loss-tolerant",
            })),
            commands: [],
            snapshot: false,
            resources: false,
        };
    }

    /** Starts one aggregate or exact-room projection over the shared source. */
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
                onActivity: activity => this.#OnActivity(activity),
                onStatus: () => undefined,
            }));
        }
        catch (error)
        {
            this.#accepting = false;
            this.#context = null;
            this.#running = false;

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
        this.#recentIds = new Set();
        this.#recentOrder = [];

        if (stopResult.status === "rejected")
        {
            throw stopResult.reason;
        }
    }

    #OnActivity(activity)
    {
        if (!this.#accepting || !activity || typeof activity.topic !== "string")
        {
            return;
        }

        let normalized;

        try
        {
            normalized = CjsRealtimeLivestreamContract.normalizeActivity(
                activity.topic,
                activity.data,
            );
        }
        catch
        {
            return;
        }

        if (!CjsRealtimeTwitchActivityService.matchesRoom(this.#room, normalized.source))
        {
            return;
        }

        const identity = `${normalized.source.channelId}:${normalized.id}`;
        const operation = this.#context.Commit(async context =>
        {
            if (!this.#accepting || this.#recentIds.has(identity))
            {
                return;
            }

            await context.Publish(activity.topic, normalized, {
                occurredAt: normalized.occurredAt,
            });
            this.#Remember(identity);
        });

        this.#Track(operation);
    }

    #Remember(identity)
    {
        this.#recentIds.add(identity);
        this.#recentOrder.push(identity);

        while (this.#recentOrder.length > this.#recentEventLimit)
        {
            this.#recentIds.delete(this.#recentOrder.shift());
        }
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
            throw new TypeError("Twitch activity room must be an object or null");
        }

        const id = value.id ?? null;
        const login = value.login?.replace(/^#/u, "").toLowerCase() ?? null;

        if ((id === null && login === null)
            || (id !== null && (typeof id !== "string" || !/^\d+$/u.test(id)))
            || (login !== null && (typeof login !== "string"
                || !/^[a-z0-9_]{1,25}$/u.test(login))))
        {
            throw new TypeError("Twitch activity room requires a valid id or login");
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

}
