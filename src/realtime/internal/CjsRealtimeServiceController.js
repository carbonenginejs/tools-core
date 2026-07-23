import { CjsRealtimeError } from "../CjsRealtimeError.js";
import { CjsRealtimeProtocol } from "../CjsRealtimeProtocol.js";
import { CjsRealtimeServiceContext } from "../server/CjsRealtimeServiceContext.js";
import { CjsRealtimeSerialLane } from "./CjsRealtimeSerialLane.js";

/** Owns lifecycle, publication order, cursors, and subscribers for one service. */
export class CjsRealtimeServiceController
{

    #abortController;

    #accepting;

    #clock;

    #createId;

    #lane;

    #sequence;

    #service;

    #streamId;

    #subscribers;

    #topicSequences;

    constructor({ service, description, clock, createId, maxPending })
    {
        this.description = description;
        this.status = "stopped";
        this.#service = service;
        this.#clock = clock;
        this.#createId = createId;
        this.#lane = new CjsRealtimeSerialLane({ maxPending });
        this.#abortController = null;
        this.#accepting = false;
        this.#streamId = null;
        this.#sequence = 0;
        this.#topicSequences = new Map();
        this.#subscribers = new Map();
    }

    /** Starts this service without exposing a partially started registry. */
    async Start()
    {
        if ([ "running", "starting" ].includes(this.status))
        {
            return this.DescribeRuntime();
        }

        this.status = "starting";
        this.#accepting = true;
        this.#abortController = new AbortController();
        this.#streamId = this.#createId("stream");
        this.#sequence = 0;
        this.#topicSequences = new Map(
            this.description.topics.map(topic => [ topic.name, 0 ]),
        );
        const context = this.#CreateExternalContext({
            id: this.description.id,
            kind: "service",
        });

        try
        {
            await this.#service.Start(context);
            this.status = "running";
        }
        catch
        {
            this.#accepting = false;
            this.#abortController.abort();
            await this.#lane.Drain();

            try
            {
                await this.#service.Stop();
            }
            catch
            {
                // Startup failure remains isolated from other registered services.
            }

            this.#streamId = null;
            this.#sequence = 0;
            this.#topicSequences = new Map();
            this.status = "failed";
        }

        return this.DescribeRuntime();
    }

    /** Stops this service idempotently and releases its subscribers. */
    async Stop()
    {
        if ([ "stopped", "stopping" ].includes(this.status))
        {
            return;
        }

        this.#accepting = false;
        this.#abortController?.abort();
        await this.#lane.Drain();
        this.status = "stopping";

        try
        {
            await this.#service.Stop();
        }
        finally
        {
            this.status = "stopped";
            this.#subscribers.clear();
        }
    }

    /** Publishes one event from an independently running service source. */
    async Publish(topic, data, options = {}, generation = this.#streamId)
    {
        this.#RequireGeneration(generation);
        this.#RequireAccepting();

        return this.#lane.Enqueue(() => this.#PublishInline(
            topic,
            data,
            options,
            { id: this.description.id, kind: "service" },
        ));
    }

    /** Atomically installs a subscription and enqueues its cursor result. */
    async Subscribe(connection, topics, requestId)
    {
        this.#RequireAccepting();

        return this.#lane.Enqueue(() =>
        {
            this.#RequireRunning();

            if (!connection.IsOpen())
            {
                throw new CjsRealtimeError(
                    "connection_closed",
                    "Realtime connection closed before subscription activation",
                );
            }

            if (this.#subscribers.has(connection.id))
            {
                throw new CjsRealtimeError(
                    "subscription_exists",
                    "Connection already has a subscription for this service",
                );
            }

            const declared = new Set(this.description.topics.map(topic => topic.name));

            for (const topic of topics)
            {
                if (!declared.has(topic))
                {
                    throw new CjsRealtimeError("topic_not_found", "Realtime topic was not found");
                }
            }

            const subscriptionId = this.#createId("subscription");
            const record = Object.freeze({
                subscriptionId,
                connection,
                topics: new Set(topics),
            });

            this.#subscribers.set(connection.id, record);
            connection.AddSubscription(subscriptionId, this.description.id);
            const accepted = connection.SendResult(requestId, {
                status: "completed",
                data: {
                    subscriptionId,
                    service: CjsRealtimeProtocol.serviceIdentity(this.description),
                    cursor: this.Cursor(),
                },
            });

            if (!accepted)
            {
                this.#subscribers.delete(connection.id);
                connection.RemoveSubscription(subscriptionId);

                return null;
            }

            return subscriptionId;
        });
    }

    /** Atomically removes a subscription after already queued events. */
    async Unsubscribe(connection, subscriptionId, requestId)
    {
        this.#RequireAccepting();

        return this.#lane.Enqueue(() =>
        {
            const record = this.#subscribers.get(connection.id);

            if (!record || record.subscriptionId !== subscriptionId)
            {
                throw new CjsRealtimeError(
                    "subscription_not_found",
                    "Realtime subscription was not found",
                );
            }

            this.#subscribers.delete(connection.id);
            connection.RemoveSubscription(subscriptionId);
            connection.SendResult(requestId, {
                status: "completed",
                data: { subscriptionId },
            });
        });
    }

    /** Removes any subscription owned by a closed connection. */
    RemoveConnection(connection)
    {
        this.#subscribers.delete(connection.id);
    }

    /** Executes one authoritative command through the service lane. */
    async ExecuteCommand({ actor, action, operationId, data })
    {
        this.#RequireAccepting();

        return this.#lane.Enqueue(async () =>
        {
            this.#RequireRunning();
            const declaration = this.description.commands.find(entry => entry.name === action);

            if (!declaration)
            {
                throw new CjsRealtimeError("action_not_found", "Realtime action was not found");
            }

            if (declaration.operationRequired && !operationId)
            {
                throw new CjsRealtimeError("operation_required", "Realtime operationId is required");
            }

            const generation = this.#streamId;
            const value = await this.#RunInline(generation, actor, context =>
                this.#service.HandleCommand(Object.freeze({
                    serviceId: this.description.id,
                    action,
                    operationId,
                    data: CjsRealtimeProtocol.cloneJson(data),
                    actor: Object.freeze(CjsRealtimeProtocol.cloneJson(actor)),
                }), context));

            return CjsRealtimeServiceController.normalizeCommandResult(value);
        });
    }

    /** Captures a service snapshot and cursor in one publication lane. */
    async GetSnapshot(request)
    {
        this.#RequireAccepting();

        return this.#lane.Enqueue(async () =>
        {
            this.#RequireRunning();

            if (!this.description.snapshot)
            {
                throw new CjsRealtimeError(
                    "snapshot_unavailable",
                    "Realtime service does not provide snapshots",
                    { statusCode: 404 },
                );
            }

            const value = await this.#service.GetSnapshot(Object.freeze({
                actor: Object.freeze(CjsRealtimeProtocol.cloneJson(request.actor)),
            }));

            return Object.freeze({
                schema: "carbon.tools.realtime.snapshot",
                version: 1,
                service: CjsRealtimeProtocol.serviceIdentity(this.description),
                cursor: this.Cursor(),
                payload: Object.freeze({
                    schema: `${this.description.family}.snapshot`,
                    version: this.description.familyVersion,
                    data: CjsRealtimeProtocol.cloneJson(value),
                }),
            });
        });
    }

    /** Opens one source-owned resource under the publication lane. */
    async OpenResource(path, request)
    {
        this.#RequireAccepting();

        return this.#lane.Enqueue(async () =>
        {
            this.#RequireRunning();

            if (!this.description.resources)
            {
                throw new CjsRealtimeError(
                    "resource_not_found",
                    "Realtime service does not provide resources",
                    { statusCode: 404 },
                );
            }

            return this.#service.OpenResource(path, Object.freeze({
                actor: Object.freeze(CjsRealtimeProtocol.cloneJson(request.actor)),
                revision: request.revision ?? null,
                method: request.method,
            }));
        });
    }

    /** Returns the current immutable stream cursor. */
    Cursor()
    {
        return Object.freeze({
            streamId: this.#streamId,
            sequence: this.#sequence,
            topicSequences: Object.freeze(Object.fromEntries(this.#topicSequences)),
        });
    }

    /** Returns public runtime status for discovery. */
    DescribeRuntime()
    {
        return Object.freeze({
            ...this.description,
            status: this.status,
            cursor: this.#streamId === null ? null : this.Cursor(),
        });
    }

    #CreateExternalContext(actor)
    {
        const generation = this.#streamId;

        return new CjsRealtimeServiceContext({
            actor,
            signal: this.#abortController?.signal ?? AbortSignal.abort(),
            clock: this.#clock,
            createId: this.#createId,
            publish: (topic, data, options) => this.Publish(
                topic,
                data,
                options,
                generation,
            ),
            commit: callback => this.#CommitExternal(generation, actor, callback),
        });
    }

    #CommitExternal(generation, actor, callback)
    {
        this.#RequireGeneration(generation);
        this.#RequireAccepting();

        return this.#lane.Enqueue(() => this.#RunInline(generation, actor, callback));
    }

    async #RunInline(generation, actor, callback)
    {
        this.#RequireGeneration(generation);
        let active = true;
        let context;
        const pending = new Set();
        const pendingFailures = [];

        context = new CjsRealtimeServiceContext({
            actor,
            signal: this.#abortController?.signal ?? AbortSignal.abort(),
            clock: this.#clock,
            createId: this.#createId,
            publish: (topic, data, options) =>
            {
                this.#RequireGeneration(generation);

                if (!active)
                {
                    throw new CjsRealtimeError(
                        "context_expired",
                        "Deferred realtime work must use context.Commit()",
                    );
                }

                return this.#PublishInline(topic, data, options, actor);
            },
            commit: nested =>
            {
                if (!active)
                {
                    return this.#CommitExternal(generation, actor, nested);
                }

                const operation = Promise.resolve().then(() => nested(context));
                const tracked = operation.then(
                    () => undefined,
                    error =>
                    {
                        pendingFailures.push(error);
                    },
                );

                pending.add(tracked);
                tracked.then(() => pending.delete(tracked));

                return operation;
            },
        });

        try
        {
            const result = await callback(context);

            while (pending.size)
            {
                await Promise.all([ ...pending ]);
            }

            if (pendingFailures.length)
            {
                throw pendingFailures[0];
            }

            return result;
        }
        finally
        {
            active = false;
        }
    }

    #PublishInline(topic, data, options, actor)
    {
        this.#RequirePublishable();

        const topicDescription = this.description.topics.find(entry => entry.name === topic);

        if (!topicDescription)
        {
            throw new CjsRealtimeError("topic_not_found", "Realtime topic was not found");
        }

        CjsRealtimeProtocol.validateJson(data);
        const schema = options.schema ?? `${this.description.family}.event`;
        const version = options.version ?? this.description.familyVersion;

        CjsRealtimeProtocol.assertName(schema, "payload schema");

        if (!Number.isSafeInteger(version) || version < 1)
        {
            throw new CjsRealtimeError("invalid_request", "Event payload version is invalid");
        }

        const publishedAt = new Date(this.#clock()).toISOString();
        const occurredAt = options.occurredAt === undefined
            ? publishedAt
            : new Date(options.occurredAt).toISOString();
        const topicSequence = (this.#topicSequences.get(topic) ?? 0) + 1;

        this.#sequence++;
        this.#topicSequences.set(topic, topicSequence);
        const event = Object.freeze({
            type: "event",
            eventId: this.#createId("event"),
            service: CjsRealtimeProtocol.serviceIdentity(this.description),
            streamId: this.#streamId,
            sequence: this.#sequence,
            topic,
            topicSequence,
            occurredAt,
            publishedAt,
            actor: Object.freeze(CjsRealtimeProtocol.cloneJson(actor)),
            payload: Object.freeze({
                schema,
                version,
                data: CjsRealtimeProtocol.cloneJson(data),
            }),
        });

        for (const subscriber of this.#subscribers.values())
        {
            if (subscriber.topics.has(topic))
            {
                subscriber.connection.Deliver(subscriber.subscriptionId, event);
            }
        }

        return event;
    }

    #RequireRunning()
    {
        if (this.status !== "running")
        {
            throw new CjsRealtimeError(
                "service_unavailable",
                "Realtime service is not running",
                { retryable: true, statusCode: 503 },
            );
        }
    }

    #RequirePublishable()
    {
        if (![ "starting", "running" ].includes(this.status))
        {
            throw new CjsRealtimeError(
                "service_unavailable",
                "Realtime service is not running",
                { retryable: true, statusCode: 503 },
            );
        }
    }

    #RequireAccepting()
    {
        if (!this.#accepting)
        {
            throw new CjsRealtimeError(
                "service_unavailable",
                "Realtime service is not accepting work",
                { retryable: true, statusCode: 503 },
            );
        }
    }

    #RequireGeneration(generation)
    {
        if (generation === null || generation !== this.#streamId)
        {
            throw new CjsRealtimeError(
                "stream_changed",
                "Realtime service stream changed",
                { retryable: true, statusCode: 409 },
            );
        }
    }

    /** Validates a service command response. */
    static normalizeCommandResult(value)
    {
        if (value === undefined)
        {
            return Object.freeze({ status: "completed", data: null });
        }

        if (!CjsRealtimeProtocol.isRecord(value))
        {
            return Object.freeze({
                status: "completed",
                data: CjsRealtimeProtocol.cloneJson(value),
            });
        }

        const status = value.status ?? "completed";

        if (![ "accepted", "completed" ].includes(status))
        {
            throw new CjsRealtimeError(
                "invalid_service_result",
                "Realtime service returned an invalid command status",
                { statusCode: 500 },
            );
        }

        return Object.freeze({
            status,
            data: CjsRealtimeProtocol.cloneJson(value.data ?? null),
        });
    }

}
