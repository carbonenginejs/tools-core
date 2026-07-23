import crypto from "node:crypto";

import { CjsRealtimeError } from "../CjsRealtimeError.js";
import { CjsRealtimeConnection } from "./CjsRealtimeConnection.js";
import { CjsRealtimeMemoryOperationStore } from "./CjsRealtimeMemoryOperationStore.js";
import { CjsRealtimeServiceRegistry } from "./CjsRealtimeServiceRegistry.js";
import { CjsRealtimeServiceController } from "../internal/CjsRealtimeServiceController.js";
import { CjsRealtimeSerialLane } from "../internal/CjsRealtimeSerialLane.js";

/** Transport-neutral realtime service host and protocol coordinator. */
export class CjsRealtimeHub
{

    #authority;

    #clock;

    #connections;

    #controllers;

    #createId;

    #operationStore;

    #registry;

    #lifecycleLane;

    constructor({
        authority,
        registry = new CjsRealtimeServiceRegistry(),
        operationStore = new CjsRealtimeMemoryOperationStore(),
        clock = () => Date.now(),
        createId = CjsRealtimeHub.createId,
        limits = {},
    } = {})
    {
        if (!authority || typeof authority.Authenticate !== "function")
        {
            throw new TypeError("CjsRealtimeHub requires a session authority");
        }

        if (typeof clock !== "function" || typeof createId !== "function")
        {
            throw new TypeError("Realtime hub clock and createId must be functions");
        }

        this.#authority = authority;
        this.#registry = registry;
        this.#operationStore = operationStore;
        this.#clock = clock;
        this.#createId = createId;
        this.limits = CjsRealtimeHub.normalizeLimits(limits);
        this.#controllers = new Map();
        this.#connections = new Map();
        this.#lifecycleLane = new CjsRealtimeSerialLane();
        this.status = "stopped";

        for (const entry of this.#registry.List())
        {
            this.#AddController(entry);
        }
    }

    /** Registers one service before hub startup. */
    Register(service)
    {
        if (this.status !== "stopped")
        {
            throw new Error("Realtime services must be registered before startup");
        }

        const description = this.#registry.Register(service);
        const entry = this.#registry.Get(description.id);

        this.#AddController(entry);

        return description;
    }

    /** Starts every registered service while isolating individual failures. */
    async Start()
    {
        return this.#lifecycleLane.Enqueue(() => this.#Start());
    }

    /** Stops connections and registered services idempotently. */
    async Stop()
    {
        return this.#lifecycleLane.Enqueue(() => this.#Stop());
    }

    async #Start()
    {
        if (this.status === "running")
        {
            return this.ListRuntimeServices();
        }

        if (this.status !== "stopped")
        {
            throw new Error(`Realtime hub cannot start while ${this.status}`);
        }

        this.status = "starting";
        this.#registry.Seal();
        await Promise.all([ ...this.#controllers.values() ].map(controller =>
            controller.Start()));
        this.status = "running";

        return this.ListRuntimeServices();
    }

    async #Stop()
    {
        if (this.status === "stopped")
        {
            return;
        }

        this.status = "stopping";

        for (const connection of [ ...this.#connections.values() ])
        {
            connection.Close(1001, "server_shutdown");
        }

        await Promise.allSettled([ ...this.#controllers.values() ].map(controller =>
            controller.Stop()));
        this.status = "stopped";
    }

    /** Opens one transport-neutral protocol connection. */
    OpenConnection(options)
    {
        if (this.status !== "running")
        {
            throw new CjsRealtimeError(
                "service_unavailable",
                "Realtime hub is not running",
                { retryable: true, statusCode: 503 },
            );
        }

        if (this.#connections.size >= this.limits.maxConnections)
        {
            throw new CjsRealtimeError(
                "rate_limited",
                "Realtime connection limit was reached",
                { retryable: true, statusCode: 429 },
            );
        }

        const connection = new CjsRealtimeConnection({ hub: this, ...options });

        this.#connections.set(connection.id, connection);

        return connection;
    }

    /** Removes a closed connection and its service subscriptions. */
    DetachConnection(connection)
    {
        if (!this.#connections.delete(connection.id))
        {
            return;
        }

        for (const serviceId of connection.ListSubscriptionServices())
        {
            this.#controllers.get(serviceId)?.RemoveConnection(connection);
        }
    }

    /** Authenticates a capability through the configured authority. */
    Authenticate(capability, options)
    {
        return this.#authority.Authenticate(capability, options);
    }

    /** Revalidates an established session before further use. */
    ValidateSession(session)
    {
        return this.#authority.ValidateSession(session);
    }

    /** Installs one exact service/topic subscription. */
    async Subscribe(connection, message)
    {
        if (connection.ListSubscriptionServices().length >= this.limits.maxSubscriptions)
        {
            throw new CjsRealtimeError(
                "queue_full",
                "Realtime subscription limit was reached",
                { retryable: true },
            );
        }

        this.#authority.AuthorizeTopics(
            connection.session,
            message.serviceId,
            message.topics,
        );
        const controller = this.#RequireController(message.serviceId);

        return controller.Subscribe(connection, message.topics, message.requestId);
    }

    /** Removes one connection-owned subscription. */
    async Unsubscribe(connection, message)
    {
        this.#authority.ValidateSession(connection.session);
        const serviceId = connection.GetSubscriptionService(message.subscriptionId);

        if (serviceId === null)
        {
            throw new CjsRealtimeError(
                "subscription_not_found",
                "Realtime subscription was not found",
            );
        }

        return this.#RequireController(serviceId).Unsubscribe(
            connection,
            message.subscriptionId,
            message.requestId,
        );
    }

    /** Routes one idempotent authoritative service command. */
    async Command(connection, message)
    {
        this.#authority.AuthorizeCommand(
            connection.session,
            message.serviceId,
            message.action,
        );
        const controller = this.#RequireController(message.serviceId);

        const execute = () => controller.ExecuteCommand({
            actor: connection.session.actor,
            action: message.action,
            operationId: message.operationId,
            data: message.data,
        });

        if (message.operationId === null)
        {
            return execute();
        }

        return this.#operationStore.Execute({
            actor: connection.session.actor,
            serviceId: message.serviceId,
            action: message.action,
            operationId: message.operationId,
            data: message.data,
        }, execute);
    }

    /** Returns authenticated discovery filtered to visible services. */
    Discover(session)
    {
        const services = this.#authority.FilterServices(session, this.ListRuntimeServices());

        return Object.freeze({
            schema: "carbon.tools.realtime.discovery",
            version: 1,
            protocol: "carbon.tools.realtime",
            protocolVersion: 1,
            route: "/v1/realtime",
            services: Object.freeze(services),
        });
    }

    /** Returns one authenticated cursor-stamped service snapshot. */
    async GetSnapshot(session, serviceId)
    {
        this.#authority.AuthorizeSnapshot(session, serviceId);

        return this.#RequireController(serviceId).GetSnapshot({ actor: session.actor });
    }

    /** Opens one authenticated source-owned service resource. */
    async OpenResource(session, serviceId, path, request)
    {
        this.#authority.AuthorizeContent(session, serviceId);

        return this.#RequireController(serviceId).OpenResource(path, {
            ...request,
            actor: session.actor,
        });
    }

    /** Lists all registered services with their current runtime status. */
    ListRuntimeServices()
    {
        return [ ...this.#controllers.values() ]
            .map(controller => controller.DescribeRuntime())
            .sort((left, right) => left.id.localeCompare(right.id));
    }

    /** Creates an opaque host identity using the injected policy. */
    CreateId(prefix)
    {
        return this.#createId(prefix);
    }

    /** Returns the injected host clock in epoch milliseconds. */
    Now()
    {
        return this.#clock();
    }

    #RequireController(serviceId)
    {
        const controller = this.#controllers.get(serviceId);

        if (!controller)
        {
            throw new CjsRealtimeError(
                "service_not_found",
                "Realtime service was not found",
                { statusCode: 404 },
            );
        }

        return controller;
    }

    #AddController(entry)
    {
        this.#controllers.set(entry.description.id, new CjsRealtimeServiceController({
            service: entry.service,
            description: entry.description,
            clock: this.#clock,
            createId: this.#createId,
            maxPending: this.limits.maxServiceQueue,
        }));
    }

    /** Creates an opaque default host identity. */
    static createId(prefix)
    {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    /** Validates and freezes the shared connection and protocol limits. */
    static normalizeLimits(value)
    {
        const limits = {
            maxConnections: value.maxConnections ?? 64,
            maxMessageBytes: value.maxMessageBytes ?? 64 * 1024,
            maxJsonDepth: value.maxJsonDepth ?? 16,
            maxJsonNodes: value.maxJsonNodes ?? 4096,
            maxSubscriptions: value.maxSubscriptions ?? 32,
            maxRequestIds: value.maxRequestIds ?? 4096,
            maxRequestsPerWindow: value.maxRequestsPerWindow ?? 600,
            requestWindowMs: value.requestWindowMs ?? 60 * 1000,
            maxInboundMessages: value.maxInboundMessages ?? 64,
            maxInboundBytes: value.maxInboundBytes ?? 1024 * 1024,
            maxServiceQueue: value.maxServiceQueue ?? 1024,
            maxOutboundMessages: value.maxOutboundMessages ?? 256,
            maxOutboundBytes: value.maxOutboundBytes ?? 1024 * 1024,
            helloTimeoutMs: value.helloTimeoutMs ?? 3000,
            heartbeatIntervalMs: value.heartbeatIntervalMs ?? 15000,
            idleTimeoutMs: value.idleTimeoutMs ?? 45000,
        };

        for (const [ name, limit ] of Object.entries(limits))
        {
            if (!Number.isSafeInteger(limit) || limit < 1)
            {
                throw new TypeError(`Realtime ${name} must be a positive integer`);
            }
        }

        if (limits.idleTimeoutMs <= limits.heartbeatIntervalMs)
        {
            throw new TypeError("Realtime idleTimeoutMs must exceed heartbeatIntervalMs");
        }

        return Object.freeze(limits);
    }

}
