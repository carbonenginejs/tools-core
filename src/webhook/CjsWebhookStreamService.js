import { CjsRealtimeProtocol } from "../realtime/CjsRealtimeProtocol.js";
import { CjsWebhookError } from "./CjsWebhookError.js";

/** Adapts authenticated provider webhooks into one realtime service stream. */
export class CjsWebhookStreamService
{

    #accepting;

    #context;

    #description;

    #handler;

    #maxConcurrentDeliveries;

    #maxRecentDeliveries;

    #operations;

    #recentDeliveries;

    #recentOrder;

    #running;

    #topicNames;

    #webhookDescription;

    constructor({
        id,
        family,
        familyVersion = 1,
        kind,
        topics,
        handler,
        webhookId = id,
        methods = [ "POST" ],
        maxConcurrentDeliveries = 64,
        maxRecentDeliveries = 4096,
    } = {})
    {
        if (!handler || typeof handler.AuthenticateWebhook !== "function"
            || typeof handler.HandleWebhook !== "function")
        {
            throw new TypeError(
                "Webhook stream service requires AuthenticateWebhook() and HandleWebhook()",
            );
        }

        if (!Number.isSafeInteger(maxConcurrentDeliveries) || maxConcurrentDeliveries < 1)
        {
            throw new TypeError("Webhook maxConcurrentDeliveries must be a positive integer");
        }

        if (!Number.isSafeInteger(maxRecentDeliveries) || maxRecentDeliveries < 1)
        {
            throw new TypeError("Webhook maxRecentDeliveries must be a positive integer");
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
        this.#webhookDescription = CjsWebhookStreamService.normalizeWebhookDescription({
            id: webhookId,
            methods,
        });
        this.#topicNames = new Set(this.#description.topics.map(topic => topic.name));
        this.#handler = handler;
        this.#maxConcurrentDeliveries = maxConcurrentDeliveries;
        this.#maxRecentDeliveries = maxRecentDeliveries;
        this.#accepting = false;
        this.#context = null;
        this.#operations = new Set();
        this.#recentDeliveries = new Map();
        this.#recentOrder = [];
        this.#running = false;
    }

    /** Declares the provider-neutral realtime stream visible to clients. */
    Describe()
    {
        return this.#description;
    }

    /** Declares the private HTTP endpoint that feeds this stream. */
    DescribeWebhook()
    {
        return this.#webhookDescription;
    }

    /** Starts accepting verified webhook deliveries. */
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
    }

    /** Stops admitting deliveries and drains work already accepted. */
    async Stop()
    {
        if (!this.#running)
        {
            return;
        }

        this.#running = false;
        this.#accepting = false;
        await Promise.allSettled([ ...this.#operations ]);
        this.#context = null;
        this.#operations = new Set();
        this.#recentDeliveries = new Map();
        this.#recentOrder = [];
    }

    /** Verifies and maps one HTTP delivery before publishing it to clients. */
    HandleWebhook(request)
    {
        if (!this.#accepting || !this.#context)
        {
            return Promise.reject(new CjsWebhookError(
                "service_unavailable",
                "Webhook stream is not accepting deliveries",
                { statusCode: 503, retryable: true },
            ));
        }

        if (this.#operations.size >= this.#maxConcurrentDeliveries)
        {
            return Promise.reject(new CjsWebhookError(
                "delivery_limit_reached",
                "Webhook delivery limit was reached",
                { statusCode: 429, retryable: true },
            ));
        }

        const operation = this.#Process(request);

        this.#operations.add(operation);
        operation.then(
            () => this.#operations.delete(operation),
            () => this.#operations.delete(operation),
        );

        return operation;
    }

    async #Process(request)
    {
        const authenticatedRequest = Object.freeze({
            ...request,
            signal: this.#context.signal,
        });
        const authentication = await this.#handler.AuthenticateWebhook(
            authenticatedRequest,
        );
        const value = await this.#handler.HandleWebhook(Object.freeze({
            ...authenticatedRequest,
            authentication,
        }));
        const delivery = CjsWebhookStreamService.normalizeDelivery(
            value,
            this.#topicNames,
        );

        try
        {
            return await this.#context.Commit(async context =>
            {
                if (delivery.deliveryId !== null)
                {
                    const previous = this.#recentDeliveries.get(delivery.deliveryId);

                    if (previous)
                    {
                        if (previous.fingerprint !== delivery.fingerprint)
                        {
                            throw new CjsWebhookError(
                                "delivery_conflict",
                                "Webhook delivery ID was reused with different content",
                                { statusCode: 409 },
                            );
                        }

                        return CjsWebhookStreamService.cloneResponse(previous.response);
                    }
                }

                for (const event of delivery.events)
                {
                    await context.Publish(event.topic, event.data, event.options);
                }

                if (delivery.deliveryId !== null)
                {
                    this.#Remember(delivery);
                }

                return CjsWebhookStreamService.cloneResponse(delivery.response);
            });
        }
        catch (error)
        {
            throw CjsWebhookStreamService.mapCommitError(error);
        }
    }

    #Remember(delivery)
    {
        this.#recentDeliveries.set(delivery.deliveryId, Object.freeze({
            fingerprint: delivery.fingerprint,
            response: delivery.response,
        }));
        this.#recentOrder.push(delivery.deliveryId);

        while (this.#recentOrder.length > this.#maxRecentDeliveries)
        {
            this.#recentDeliveries.delete(this.#recentOrder.shift());
        }
    }

    /** Validates the HTTP endpoint identity and allowed request methods. */
    static normalizeWebhookDescription(value)
    {
        CjsRealtimeProtocol.assertServiceId(value.id);

        if (!Array.isArray(value.methods) || value.methods.length === 0)
        {
            throw new TypeError("Webhook endpoint methods must be a non-empty array");
        }

        const methods = value.methods.map(method =>
        {
            if (typeof method !== "string" || !/^[A-Z][A-Z0-9-]{0,31}$/u.test(method))
            {
                throw new TypeError("Webhook endpoint method is invalid");
            }

            return method;
        });

        if (new Set(methods).size !== methods.length)
        {
            throw new TypeError("Webhook endpoint methods must be unique");
        }

        return Object.freeze({
            id: value.id,
            methods: Object.freeze([ ...methods ]),
        });
    }

    /** Validates one provider result before it enters the service lane. */
    static normalizeDelivery(value, topicNames)
    {
        const result = value ?? {};

        if (!CjsRealtimeProtocol.isRecord(result))
        {
            throw new CjsWebhookError(
                "invalid_delivery",
                "Webhook handler returned an invalid delivery",
                { statusCode: 500 },
            );
        }

        const deliveryId = result.deliveryId ?? null;

        if (deliveryId !== null && (typeof deliveryId !== "string"
            || deliveryId.length < 1 || deliveryId.length > 256))
        {
            throw new CjsWebhookError(
                "invalid_delivery",
                "Webhook delivery ID is invalid",
                { statusCode: 500 },
            );
        }

        const sourceEvents = result.events ?? [];

        if (!Array.isArray(sourceEvents))
        {
            throw new CjsWebhookError(
                "invalid_delivery",
                "Webhook delivery events must be an array",
                { statusCode: 500 },
            );
        }

        const events = sourceEvents.map(event =>
            CjsWebhookStreamService.normalizeEvent(event, topicNames));
        const response = CjsWebhookStreamService.normalizeResponse(result.response);
        const fingerprint = CjsRealtimeProtocol.canonicalStringify({
            events: events.map(event => ({
                topic: event.topic,
                data: event.data,
                options: event.options,
            })),
        });

        return Object.freeze({
            deliveryId,
            events: Object.freeze(events),
            response,
            fingerprint,
        });
    }

    /** Validates one canonical realtime publication returned by a handler. */
    static normalizeEvent(value, topicNames)
    {
        if (!CjsRealtimeProtocol.isRecord(value) || !topicNames.has(value.topic)
            || !Object.hasOwn(value, "data"))
        {
            throw new CjsWebhookError(
                "invalid_delivery",
                "Webhook handler returned an undeclared event",
                { statusCode: 500 },
            );
        }

        const options = {};

        if (value.occurredAt !== undefined)
        {
            if (!Number.isFinite(new Date(value.occurredAt).getTime()))
            {
                throw new CjsWebhookError(
                    "invalid_delivery",
                    "Webhook event occurredAt is invalid",
                    { statusCode: 500 },
                );
            }

            options.occurredAt = new Date(value.occurredAt).toISOString();
        }

        if (value.schema !== undefined)
        {
            CjsRealtimeProtocol.assertName(value.schema, "payload schema");
            options.schema = value.schema;
        }

        if (value.version !== undefined)
        {
            if (!Number.isSafeInteger(value.version) || value.version < 1)
            {
                throw new CjsWebhookError(
                    "invalid_delivery",
                    "Webhook event version is invalid",
                    { statusCode: 500 },
                );
            }

            options.version = value.version;
        }

        return Object.freeze({
            topic: value.topic,
            data: Object.freeze(CjsRealtimeProtocol.cloneJson(value.data)),
            options: Object.freeze(options),
        });
    }

    /** Normalizes the acknowledgement returned to the provider. */
    static normalizeResponse(value = undefined)
    {
        const response = value ?? {};

        if (!CjsRealtimeProtocol.isRecord(response))
        {
            throw new CjsWebhookError(
                "invalid_delivery",
                "Webhook handler returned an invalid response",
                { statusCode: 500 },
            );
        }

        const statusCode = response.statusCode ?? 204;

        if (!Number.isSafeInteger(statusCode) || statusCode < 200 || statusCode > 299)
        {
            throw new CjsWebhookError(
                "invalid_delivery",
                "Webhook acknowledgement status is invalid",
                { statusCode: 500 },
            );
        }

        const contentType = response.contentType ?? null;

        if (contentType !== null && (typeof contentType !== "string"
            || contentType.length < 1 || contentType.length > 256
            || /[\r\n]/u.test(contentType)))
        {
            throw new CjsWebhookError(
                "invalid_delivery",
                "Webhook acknowledgement content type is invalid",
                { statusCode: 500 },
            );
        }

        let body = response.body ?? null;

        if (body instanceof Uint8Array)
        {
            body = Buffer.from(body);
        }
        else if (body !== null && typeof body !== "string")
        {
            body = Object.freeze(CjsRealtimeProtocol.cloneJson(body));
        }

        return Object.freeze({ statusCode, contentType, body });
    }

    /** Clones one cached response without sharing mutable byte storage. */
    static cloneResponse(response)
    {
        return Object.freeze({
            ...response,
            body: response.body instanceof Uint8Array
                ? Buffer.from(response.body)
                : response.body,
        });
    }

    /** Maps host lifecycle pressure to retryable webhook acknowledgements. */
    static mapCommitError(error)
    {
        if (error instanceof CjsWebhookError)
        {
            return error;
        }

        if ([ "queue_full", "service_unavailable", "stream_changed" ].includes(error?.code))
        {
            return new CjsWebhookError(
                "service_unavailable",
                "Webhook stream could not accept the delivery",
                {
                    statusCode: error.statusCode === 429 ? 429 : 503,
                    retryable: true,
                    cause: error,
                },
            );
        }

        return error;
    }

}
