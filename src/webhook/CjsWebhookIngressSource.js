import { CjsRealtimeProtocol } from "../realtime/CjsRealtimeProtocol.js";
import { CjsRealtimeSerialLane } from "../realtime/internal/CjsRealtimeSerialLane.js";
import { CjsWebhookError } from "./CjsWebhookError.js";
import { CjsWebhookStreamService } from "./CjsWebhookStreamService.js";

/** Authenticates one webhook endpoint and routes deliveries to family services. */
export class CjsWebhookIngressSource
{

    #abortController;

    #accepting;

    #attachments;

    #handler;

    #lane;

    #maxConcurrentDeliveries;

    #maxRecentDeliveries;

    #operations;

    #recentDeliveries;

    #recentOrder;

    #registrations;

    #sealed;

    #topicOwners;

    #webhookDescription;

    constructor({
        id,
        handler,
        methods = [ "POST" ],
        maxConcurrentDeliveries = 64,
        maxPendingDeliveries = 1024,
        maxRecentDeliveries = 4096,
    } = {})
    {
        if (!handler || typeof handler.AuthenticateWebhook !== "function"
            || typeof handler.HandleWebhook !== "function")
        {
            throw new TypeError(
                "Webhook ingress requires AuthenticateWebhook() and HandleWebhook()",
            );
        }

        for (const [ value, label ] of [
            [ maxConcurrentDeliveries, "maxConcurrentDeliveries" ],
            [ maxPendingDeliveries, "maxPendingDeliveries" ],
            [ maxRecentDeliveries, "maxRecentDeliveries" ],
        ])
        {
            if (!Number.isSafeInteger(value) || value < 1)
            {
                throw new TypeError(`Webhook ${label} must be a positive integer`);
            }
        }

        this.#webhookDescription = CjsWebhookStreamService.normalizeWebhookDescription({
            id,
            methods,
        });
        this.#handler = handler;
        this.#maxConcurrentDeliveries = maxConcurrentDeliveries;
        this.#maxRecentDeliveries = maxRecentDeliveries;
        this.#abortController = null;
        this.#accepting = false;
        this.#attachments = new Map();
        this.#lane = new CjsRealtimeSerialLane({ maxPending: maxPendingDeliveries });
        this.#operations = new Set();
        this.#recentDeliveries = new Map();
        this.#recentOrder = [];
        this.#registrations = new Map();
        this.#sealed = false;
        this.#topicOwners = new Map();
    }

    /** Registers one static service projection before the ingress starts. */
    Register({ id, topics })
    {
        if (this.#sealed)
        {
            throw new Error("Webhook ingress registrations are sealed after first attachment");
        }

        CjsRealtimeProtocol.assertServiceId(id);

        if (this.#registrations.has(id) || !Array.isArray(topics) || topics.length === 0)
        {
            throw new TypeError("Webhook ingress registration is invalid");
        }

        const names = topics.map(topic =>
        {
            CjsRealtimeProtocol.assertName(topic, "topic");

            if (this.#topicOwners.has(topic))
            {
                throw new Error(`Webhook ingress topic is already registered: ${topic}`);
            }

            return topic;
        });

        if (new Set(names).size !== names.length)
        {
            throw new TypeError("Webhook ingress registration topics must be unique");
        }

        const registration = Object.freeze({
            id,
            topics: Object.freeze([ ...names ]),
        });

        this.#registrations.set(id, registration);

        for (const topic of names)
        {
            this.#topicOwners.set(topic, id);
        }

        return registration;
    }

    /** Attaches one registered projection and admits ingress on first use. */
    Attach(id, { signal, onEvent })
    {
        const registration = this.#registrations.get(id);

        if (!registration)
        {
            throw new Error(`Webhook ingress projection was not registered: ${id}`);
        }

        if (this.#attachments.has(id))
        {
            throw new Error(`Webhook ingress projection is already attached: ${id}`);
        }

        if (!(signal instanceof AbortSignal) || typeof onEvent !== "function")
        {
            throw new TypeError("Webhook ingress attachment is invalid");
        }

        if (signal.aborted)
        {
            throw new CjsWebhookError(
                "service_unavailable",
                "Webhook projection was already stopped",
                { statusCode: 503, retryable: true },
            );
        }

        const abortHandler = () => this.Detach(id).catch(() => undefined);

        signal.addEventListener("abort", abortHandler, { once: true });
        this.#attachments.set(id, Object.freeze({
            registration,
            signal,
            abortHandler,
            onEvent,
        }));
        this.#sealed = true;

        if (!this.#accepting)
        {
            this.#abortController = new AbortController();
            this.#accepting = true;
        }
    }

    /** Detaches one projection and drains ingress after the final projection. */
    async Detach(id)
    {
        const attachment = this.#attachments.get(id);

        if (!attachment)
        {
            return;
        }

        attachment.signal.removeEventListener("abort", attachment.abortHandler);
        this.#attachments.delete(id);

        if (this.#attachments.size !== 0)
        {
            return;
        }

        this.#accepting = false;
        this.#abortController?.abort();
        this.#abortController = null;
        await Promise.allSettled([ ...this.#operations ]);
        await this.#lane.Drain();
        this.#recentDeliveries = new Map();
        this.#recentOrder = [];
    }

    /** Declares the one private HTTP endpoint feeding all projections. */
    DescribeWebhook()
    {
        return this.#webhookDescription;
    }

    /** Authenticates, maps, deduplicates, and routes one provider delivery. */
    HandleWebhook(request)
    {
        if (!this.#accepting || !this.#abortController)
        {
            return Promise.reject(new CjsWebhookError(
                "service_unavailable",
                "Webhook ingress is not accepting deliveries",
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

        const operation = this.#Process(request, this.#abortController.signal);

        this.#operations.add(operation);
        operation.then(
            () => this.#operations.delete(operation),
            () => this.#operations.delete(operation),
        );

        return operation;
    }

    async #Process(request, signal)
    {
        const authenticatedRequest = Object.freeze({ ...request, signal });
        const authentication = await this.#handler.AuthenticateWebhook(
            authenticatedRequest,
        );
        const value = await this.#handler.HandleWebhook(Object.freeze({
            ...authenticatedRequest,
            authentication,
        }));
        const delivery = CjsWebhookStreamService.normalizeDelivery(
            value,
            new Set(this.#topicOwners.keys()),
        );

        try
        {
            return await this.#lane.Enqueue(async () =>
            {
                if (!this.#accepting)
                {
                    throw new CjsWebhookError(
                        "service_unavailable",
                        "Webhook ingress stopped before delivery",
                        { statusCode: 503, retryable: true },
                    );
                }

                let record = delivery.deliveryId === null
                    ? null
                    : this.#recentDeliveries.get(delivery.deliveryId);

                if (record)
                {
                    if (record.fingerprint !== delivery.fingerprint)
                    {
                        throw new CjsWebhookError(
                            "delivery_conflict",
                            "Webhook delivery ID was reused with different content",
                            { statusCode: 409 },
                        );
                    }

                    if (record.complete)
                    {
                        return CjsWebhookStreamService.cloneResponse(record.response);
                    }
                }

                const routes = delivery.events.map(event => ({
                    event,
                    attachment: this.#attachments.get(this.#topicOwners.get(event.topic)),
                }));

                if (routes.some(route => !route.attachment || route.attachment.signal.aborted))
                {
                    throw new CjsWebhookError(
                        "service_unavailable",
                        "Webhook projection is not accepting deliveries",
                        { statusCode: 503, retryable: true },
                    );
                }

                record ??= this.#Remember(delivery);

                for (let index = 0; index < routes.length; index++)
                {
                    if (record?.completed.has(index))
                    {
                        continue;
                    }

                    await routes[index].attachment.onEvent(routes[index].event);
                    record?.completed.add(index);
                }

                if (record)
                {
                    record.complete = true;
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
        if (delivery.deliveryId === null)
        {
            return null;
        }

        const record = {
            complete: false,
            completed: new Set(),
            fingerprint: delivery.fingerprint,
            response: delivery.response,
        };

        this.#recentDeliveries.set(delivery.deliveryId, record);
        this.#recentOrder.push(delivery.deliveryId);

        while (this.#recentOrder.length > this.#maxRecentDeliveries)
        {
            this.#recentDeliveries.delete(this.#recentOrder.shift());
        }

        return record;
    }

}
