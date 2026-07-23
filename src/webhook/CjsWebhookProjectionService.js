import { CjsRealtimeProtocol } from "../realtime/CjsRealtimeProtocol.js";
import { CjsWebhookError } from "./CjsWebhookError.js";

/** Exposes one live service family projected from shared webhook ingress. */
export class CjsWebhookProjectionService
{

    #accepting;

    #context;

    #description;

    #operations;

    #running;

    #source;

    constructor({
        id,
        family,
        familyVersion = 1,
        kind,
        topics,
        source,
    } = {})
    {
        if (!source || typeof source.Register !== "function"
            || typeof source.Attach !== "function" || typeof source.Detach !== "function")
        {
            throw new TypeError("Webhook projection requires an ingress source");
        }

        this.#description = CjsRealtimeProtocol.normalizeServiceDescription({
            id,
            family,
            familyVersion,
            kind,
            topics,
            commands: [],
            snapshot: false,
            resources: false,
        });
        source.Register({
            id,
            topics: this.#description.topics.map(topic => topic.name),
        });
        this.#accepting = false;
        this.#context = null;
        this.#operations = new Set();
        this.#running = false;
        this.#source = source;
    }

    /** Declares the live provider-neutral family projection. */
    Describe()
    {
        return this.#description;
    }

    /** Attaches this service to its statically registered ingress topics. */
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
            this.#source.Attach(this.#description.id, {
                signal: context.signal,
                onEvent: event => this.#OnEvent(event),
            });
        }
        catch (error)
        {
            this.#accepting = false;
            this.#context = null;
            this.#running = false;

            throw error;
        }
    }

    /** Detaches this projection and drains admitted publications. */
    async Stop()
    {
        if (!this.#running)
        {
            return;
        }

        this.#running = false;
        this.#accepting = false;
        const [ stopResult ] = await Promise.allSettled([
            this.#source.Detach(this.#description.id),
            ...this.#operations,
        ]);

        this.#context = null;
        this.#operations = new Set();

        if (stopResult.status === "rejected")
        {
            throw stopResult.reason;
        }
    }

    #OnEvent(event)
    {
        if (!this.#accepting || !this.#context)
        {
            return Promise.reject(new CjsWebhookError(
                "service_unavailable",
                "Webhook projection is not accepting deliveries",
                { statusCode: 503, retryable: true },
            ));
        }

        const operation = this.#context.Commit(async context =>
        {
            if (!this.#accepting)
            {
                throw new CjsWebhookError(
                    "service_unavailable",
                    "Webhook projection stopped before publication",
                    { statusCode: 503, retryable: true },
                );
            }

            await context.Publish(event.topic, event.data, event.options);
        });

        this.#operations.add(operation);
        operation.then(
            () => this.#operations.delete(operation),
            () => this.#operations.delete(operation),
        );

        return operation;
    }

}
