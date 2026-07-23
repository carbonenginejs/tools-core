import { CjsRealtimeError } from "../CjsRealtimeError.js";
import {
    CjsRealtimeProtocol,
    REALTIME_PROTOCOL,
    REALTIME_PROTOCOL_VERSION,
    REALTIME_ROUTE,
} from "../CjsRealtimeProtocol.js";
import { CjsRealtimeSerialLane } from "../internal/CjsRealtimeSerialLane.js";

/** One authenticated, transport-neutral realtime protocol connection. */
export class CjsRealtimeConnection
{

    #closed;

    #helloTimer;

    #hub;

    #inboundLane;

    #inboundBytes;

    #inboundMessages;

    #outboundBytes;

    #outboundQueue;

    #pumpPromise;

    #requestIds;

    #requestCount;

    #requestWindowStartedAt;

    #subscriptions;

    #transport;

    constructor({ hub, transport, origin = null, clientAddress = null })
    {
        if (!transport || typeof transport.Send !== "function"
            || typeof transport.Close !== "function")
        {
            throw new TypeError("Realtime connection transport requires Send() and Close()");
        }

        this.id = hub.CreateId("connection");
        this.origin = origin;
        this.clientAddress = clientAddress;
        this.session = null;
        this.client = null;
        this.#hub = hub;
        this.#transport = transport;
        this.#closed = false;
        this.#requestIds = new Set();
        this.#requestCount = 0;
        this.#requestWindowStartedAt = hub.Now();
        this.#subscriptions = new Map();
        this.#inboundLane = new CjsRealtimeSerialLane();
        this.#inboundBytes = 0;
        this.#inboundMessages = 0;
        this.#outboundQueue = [];
        this.#outboundBytes = 0;
        this.#pumpPromise = Promise.resolve();
        this.#helloTimer = setTimeout(() =>
        {
            this.Close(4408, "hello_timeout");
        }, hub.limits.helloTimeoutMs);
        this.#helloTimer.unref?.();
    }

    /** Receives one application text message in connection order. */
    ReceiveText(text)
    {
        if (this.#closed)
        {
            return Promise.resolve();
        }

        const bytes = typeof text === "string"
            ? new TextEncoder().encode(text).byteLength
            : this.#hub.limits.maxMessageBytes + 1;

        if (bytes > this.#hub.limits.maxMessageBytes)
        {
            this.Close(1009, "message_too_large");

            return Promise.resolve();
        }

        if (this.#inboundMessages >= this.#hub.limits.maxInboundMessages
            || this.#inboundBytes + bytes > this.#hub.limits.maxInboundBytes)
        {
            this.Close(1008, "rate_limited");

            return Promise.resolve();
        }

        this.#inboundMessages++;
        this.#inboundBytes += bytes;

        return this.#inboundLane.Enqueue(() => this.#ReceiveText(text)).finally(() =>
        {
            this.#inboundMessages--;
            this.#inboundBytes -= bytes;
        });
    }

    /** Rejects a binary application message. */
    RejectBinary()
    {
        this.Close(1003, "text_messages_required");
    }

    /** Returns whether this protocol connection can still accept delivery. */
    IsOpen()
    {
        return !this.#closed;
    }

    /** Records one service subscription owned by this connection. */
    AddSubscription(subscriptionId, serviceId)
    {
        this.#subscriptions.set(subscriptionId, serviceId);
    }

    /** Removes one service subscription owned by this connection. */
    RemoveSubscription(subscriptionId)
    {
        this.#subscriptions.delete(subscriptionId);
    }

    /** Resolves the service ID for a connection-owned subscription. */
    GetSubscriptionService(subscriptionId)
    {
        return this.#subscriptions.get(subscriptionId) ?? null;
    }

    /** Lists the service IDs currently subscribed by this connection. */
    ListSubscriptionServices()
    {
        return [ ...new Set(this.#subscriptions.values()) ];
    }

    /** Enqueues one successful terminal request response. */
    SendResult(requestId, result)
    {
        return this.#EnqueueMessage({
            type: "result",
            requestId,
            status: result.status,
            data: result.data ?? null,
        });
    }

    /** Enqueues one stable request or connection error. */
    SendError(error, requestId = undefined)
    {
        return this.#EnqueueMessage(CjsRealtimeError.from(error).ToMessage(requestId));
    }

    /** Enqueues one canonical event for a matching subscription. */
    Deliver(subscriptionId, event)
    {
        if (!this.ValidateSession())
        {
            return false;
        }

        return this.#EnqueueMessage({ ...event, subscriptionId });
    }

    /** Revalidates an authenticated session and closes it when no longer valid. */
    ValidateSession()
    {
        if (this.session === null)
        {
            return true;
        }

        try
        {
            this.#hub.ValidateSession(this.session);

            return true;
        }
        catch
        {
            this.Close(1008, "unauthorized");

            return false;
        }
    }

    /** Closes the protocol connection and its underlying transport. */
    Close(code = 1000, reason = "normal")
    {
        if (!this.#CloseInternal())
        {
            return;
        }

        try
        {
            this.#hub.DetachConnection(this);
        }
        finally
        {
            this.#transport.Close(code, reason);
        }
    }

    /** Records that the underlying transport closed first. */
    TransportClosed()
    {
        if (this.#CloseInternal())
        {
            this.#hub.DetachConnection(this);
        }
    }

    /** Resolves after currently queued inbound and outbound work settles. */
    async Drain()
    {
        await this.#inboundLane.Drain();
        await this.#pumpPromise;
    }

    async #ReceiveText(text)
    {
        if (this.#closed)
        {
            return;
        }

        let message;

        try
        {
            const parsed = CjsRealtimeProtocol.parseText(text, {
                maxBytes: this.#hub.limits.maxMessageBytes,
                maxDepth: this.#hub.limits.maxJsonDepth,
                maxNodes: this.#hub.limits.maxJsonNodes,
            });

            message = CjsRealtimeProtocol.normalizeClientMessage(parsed, {
                authenticated: this.session !== null,
            });

            if (message.type === "hello")
            {
                this.#AcceptHello(message);

                return;
            }

            if (this.#requestIds.has(message.requestId))
            {
                throw new CjsRealtimeError(
                    "duplicate_request_id",
                    "requestId was already used on this connection",
                );
            }

            const now = this.#hub.Now();

            if (now - this.#requestWindowStartedAt >= this.#hub.limits.requestWindowMs)
            {
                this.#requestWindowStartedAt = now;
                this.#requestCount = 0;
            }

            if (this.#requestCount >= this.#hub.limits.maxRequestsPerWindow)
            {
                throw new CjsRealtimeError(
                    "rate_limited",
                    "Realtime request rate limit was reached",
                    { retryable: true },
                );
            }

            if (this.#requestIds.size >= this.#hub.limits.maxRequestIds)
            {
                throw new CjsRealtimeError(
                    "rate_limited",
                    "Connection request identity limit was reached",
                    {
                        retryable: true,
                        connectionUsable: false,
                        closeCode: 1008,
                    },
                );
            }

            this.#requestIds.add(message.requestId);
            this.#requestCount++;

            if (message.type === "subscribe")
            {
                await this.#hub.Subscribe(this, message);

                return;
            }

            if (message.type === "unsubscribe")
            {
                await this.#hub.Unsubscribe(this, message);

                return;
            }

            if (message.type === "command")
            {
                const result = await this.#hub.Command(this, message);

                this.SendResult(message.requestId, result);
            }
        }
        catch (failure)
        {
            const error = CjsRealtimeError.from(failure);
            const requestId = message?.requestId;

            if (this.session !== null && error.connectionUsable)
            {
                this.SendError(error, requestId);

                return;
            }

            this.Close(error.closeCode ?? 1002, error.code);
        }
    }

    #AcceptHello(message)
    {
        this.session = this.#hub.Authenticate(message.capability, { origin: this.origin });
        this.client = message.client;
        clearTimeout(this.#helloTimer);
        this.#helloTimer = null;
        this.#EnqueueMessage({
            type: "hello",
            protocol: REALTIME_PROTOCOL,
            protocolVersion: REALTIME_PROTOCOL_VERSION,
            connectionId: this.id,
            actor: this.session.actor,
            scopes: this.session.scopes,
            discoveryRef: REALTIME_ROUTE,
            limits: {
                maxMessageBytes: this.#hub.limits.maxMessageBytes,
                maxSubscriptions: this.#hub.limits.maxSubscriptions,
                maxRequestIds: this.#hub.limits.maxRequestIds,
                maxRequestsPerWindow: this.#hub.limits.maxRequestsPerWindow,
                requestWindowMs: this.#hub.limits.requestWindowMs,
                maxInboundMessages: this.#hub.limits.maxInboundMessages,
                maxInboundBytes: this.#hub.limits.maxInboundBytes,
            },
            heartbeat: {
                intervalMs: this.#hub.limits.heartbeatIntervalMs,
                idleTimeoutMs: this.#hub.limits.idleTimeoutMs,
            },
        });
    }

    #EnqueueMessage(message)
    {
        if (this.#closed)
        {
            return false;
        }

        let text;

        try
        {
            text = JSON.stringify(message);
        }
        catch
        {
            this.Close(1011, "serialization_failure");

            return false;
        }

        const bytes = new TextEncoder().encode(text).byteLength;

        if (this.#outboundQueue.length >= this.#hub.limits.maxOutboundMessages
            || this.#outboundBytes + bytes > this.#hub.limits.maxOutboundBytes)
        {
            this.Close(4409, "resync_required");

            return false;
        }

        this.#outboundQueue.push({ text, bytes });
        this.#outboundBytes += bytes;

        if (this.#outboundQueue.length === 1)
        {
            this.#pumpPromise = this.#Pump();
        }

        return true;
    }

    async #Pump()
    {
        while (!this.#closed && this.#outboundQueue.length)
        {
            const entry = this.#outboundQueue[0];

            try
            {
                await this.#transport.Send(entry.text);
            }
            catch
            {
                this.Close(1011, "transport_failure");

                return;
            }

            this.#outboundQueue.shift();
            this.#outboundBytes -= entry.bytes;
        }
    }

    #CloseInternal()
    {
        if (this.#closed)
        {
            return false;
        }

        this.#closed = true;
        clearTimeout(this.#helloTimer);
        this.#helloTimer = null;
        this.#outboundQueue.length = 0;
        this.#outboundBytes = 0;

        return true;
    }

}
