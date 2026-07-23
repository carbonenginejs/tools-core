import { CjsRealtimeError } from "../../realtime/CjsRealtimeError.js";
import { CjsRealtimeProtocol } from "../../realtime/CjsRealtimeProtocol.js";
import { CjsTwitchEventSubSession } from "./CjsTwitchEventSubSession.js";
import { CjsTwitchHelixClient } from "./CjsTwitchHelixClient.js";

/** Composes static family declarations over one Twitch EventSub session. */
export class CjsTwitchEventSubSource
{

    #abortController;

    #attachments;

    #clock;

    #credentials;

    #declarations;

    #helix;

    #lastStatus;

    #oauth;

    #operations;

    #requiredScopes;

    #revoked;

    #sealed;

    #session;

    #startPromise;

    #state;

    #stopPromise;

    #subscriptionTimeoutMs;

    #validationIntervalMs;

    #validationTimer;

    constructor({
        oauth,
        fetch: fetchImplementation = globalThis.fetch,
        helix = null,
        session = null,
        createWebSocket,
        clock = () => Date.now(),
        endpoint,
        apiEndpoint = "https://api.twitch.tv/helix/",
        validationIntervalMs = 60 * 60 * 1000,
        keepaliveGraceMs = 1000,
        reconnectBaseMs = 250,
        reconnectMaxMs = 10000,
        subscriptionTimeoutMs = 8000,
        welcomeTimeoutMs = 8000,
    } = {})
    {
        if (!oauth || typeof oauth.Acquire !== "function"
            || typeof oauth.Invalidate !== "function")
        {
            throw new TypeError("Twitch EventSub source requires an OAuth token provider");
        }

        if ((helix === null && typeof fetchImplementation !== "function")
            || (helix !== null && typeof helix.Request !== "function")
            || typeof clock !== "function")
        {
            throw new TypeError("Twitch EventSub source adapters are invalid");
        }

        if (session !== null && (!session || typeof session.Start !== "function"
            || typeof session.Stop !== "function" || typeof session.Suspend !== "function"
            || typeof session.Resume !== "function" || typeof session.Reconnect !== "function"))
        {
            throw new TypeError("Twitch EventSub source session is invalid");
        }

        if (!Number.isSafeInteger(subscriptionTimeoutMs) || subscriptionTimeoutMs < 1)
        {
            throw new TypeError(
                "Twitch EventSub subscriptionTimeoutMs must be a positive integer",
            );
        }

        if (!Number.isSafeInteger(validationIntervalMs) || validationIntervalMs < 1000
            || validationIntervalMs > 60 * 60 * 1000)
        {
            throw new TypeError(
                "Twitch EventSub validationIntervalMs must be between 1000 and one hour",
            );
        }

        this.kind = "twitch.eventsub";
        this.#oauth = oauth;
        this.#helix = helix ?? new CjsTwitchHelixClient({
            oauth,
            fetch: fetchImplementation,
            endpoint: apiEndpoint,
        });
        this.#clock = clock;
        this.#session = session ?? new CjsTwitchEventSubSession({
            ...(createWebSocket === undefined ? {} : { createWebSocket }),
            ...(endpoint === undefined ? {} : { endpoint }),
            clock,
            keepaliveGraceMs,
            reconnectBaseMs,
            reconnectMaxMs,
            welcomeTimeoutMs,
        });
        this.#validationIntervalMs = validationIntervalMs;
        this.#subscriptionTimeoutMs = subscriptionTimeoutMs;
        this.#abortController = null;
        this.#attachments = new Map();
        this.#credentials = null;
        this.#declarations = new Map();
        this.#lastStatus = null;
        this.#operations = new Set();
        this.#requiredScopes = Object.freeze([]);
        this.#revoked = false;
        this.#sealed = false;
        this.#startPromise = null;
        this.#state = "stopped";
        this.#stopPromise = null;
        this.#validationTimer = null;
    }

    /** Registers one family declaration before the first source attachment. */
    Register({ id, requiredScopes = [], subscriptions })
    {
        if (this.#sealed)
        {
            throw new Error("Twitch EventSub declarations are sealed after first startup");
        }

        const registrationId = CjsTwitchEventSubSource.normalizeRegistrationId(id);

        if (this.#declarations.has(registrationId))
        {
            throw new Error(`Twitch EventSub declaration already exists: ${registrationId}`);
        }

        const declaration = Object.freeze({
            id: registrationId,
            requiredScopes: CjsTwitchEventSubSource.normalizeScopes(requiredScopes),
            subscriptions: CjsTwitchEventSubSource.normalizeSubscriptions(subscriptions),
        });

        this.#declarations.set(registrationId, declaration);
        this.#requiredScopes = Object.freeze([ ...new Set(
            [ ...this.#declarations.values() ].flatMap(entry => entry.requiredScopes),
        ) ].sort());

        return declaration;
    }

    /** Attaches one registered family and starts the shared source on first use. */
    async Attach(id, { signal, onNotification, onRevocation, onStatus })
    {
        if (this.#state === "stopping")
        {
            await this.#stopPromise;
        }

        const registrationId = CjsTwitchEventSubSource.normalizeRegistrationId(id);
        const declaration = this.#declarations.get(registrationId);

        if (!declaration)
        {
            throw new Error(`Twitch EventSub declaration was not registered: ${registrationId}`);
        }

        if (this.#attachments.has(registrationId))
        {
            throw new Error(`Twitch EventSub declaration is already attached: ${registrationId}`);
        }

        if (!(signal instanceof AbortSignal) || typeof onNotification !== "function"
            || typeof onRevocation !== "function" || typeof onStatus !== "function")
        {
            throw new TypeError("Twitch EventSub attachment callbacks are invalid");
        }

        if (signal.aborted)
        {
            throw new CjsRealtimeError(
                "service_unavailable",
                "Twitch EventSub attachment was already aborted",
                { retryable: true },
            );
        }

        const abortHandler = () =>
        {
            this.Detach(registrationId).catch(() => undefined);
        };
        const attachment = Object.freeze({
            declaration,
            signal,
            abortHandler,
            onNotification,
            onRevocation,
            onStatus,
        });

        signal.addEventListener("abort", abortHandler, { once: true });
        this.#attachments.set(registrationId, attachment);

        try
        {
            if (this.#state === "running")
            {
                if (this.#revoked)
                {
                    throw new CjsRealtimeError(
                        "twitch_unavailable",
                        "Twitch EventSub subscriptions were revoked",
                        { retryable: false },
                    );
                }

                if (this.#lastStatus)
                {
                    onStatus({ ...this.#lastStatus });
                }

                return;
            }

            if (this.#state === "stopped")
            {
                this.#sealed = true;
                this.#state = "starting";
                this.#abortController = new AbortController();
                const starting = this.#StartSource();

                this.#startPromise = starting;
            }

            await this.#startPromise;
        }
        catch (error)
        {
            await this.Detach(registrationId);

            throw error;
        }
    }

    /** Detaches one family and stops the shared source after the final user. */
    async Detach(id)
    {
        const registrationId = CjsTwitchEventSubSource.normalizeRegistrationId(id);
        const attachment = this.#attachments.get(registrationId);

        if (!attachment)
        {
            return;
        }

        this.#attachments.delete(registrationId);
        attachment.signal.removeEventListener("abort", attachment.abortHandler);

        if (this.#attachments.size === 0)
        {
            await this.#StopSource();
        }
    }

    /** Force-stops the source and detaches all family consumers. */
    async Stop()
    {
        for (const attachment of this.#attachments.values())
        {
            attachment.signal.removeEventListener("abort", attachment.abortHandler);
        }

        this.#attachments.clear();
        await this.#StopSource();
    }

    async #StartSource()
    {
        try
        {
            this.#revoked = false;
            this.#credentials = await this.#oauth.Acquire({
                requiredScopes: this.#requiredScopes,
            });

            if (this.#abortController.signal.aborted || this.#attachments.size === 0)
            {
                throw new CjsRealtimeError(
                    "service_unavailable",
                    "Twitch EventSub source stopped during startup",
                    { retryable: true },
                );
            }

            await this.#session.Start({
                signal: this.#abortController.signal,
                onWelcome: welcome => this.#HandleWelcome(welcome),
                onNotification: message => this.#DispatchNotification(message),
                onRevocation: message => this.#DispatchRevocation(message),
                onStatus: status => this.#EmitStatus(status),
            });
            this.#state = "running";
            this.#validationTimer = setInterval(
                () => this.#Track(this.#ValidateAuthorization()),
                this.#validationIntervalMs,
            );
            this.#validationTimer.unref?.();
        }
        catch (error)
        {
            clearInterval(this.#validationTimer);
            this.#validationTimer = null;
            await this.#session.Stop();

            if (this.#state !== "stopping")
            {
                this.#state = "stopped";
            }

            throw CjsTwitchEventSubSource.startError(error);
        }
        finally
        {
            this.#startPromise = null;
        }
    }

    #StopSource()
    {
        if (this.#state === "stopped")
        {
            return Promise.resolve();
        }

        if (this.#state === "stopping")
        {
            return this.#stopPromise;
        }

        this.#state = "stopping";
        this.#abortController?.abort();
        clearInterval(this.#validationTimer);
        this.#validationTimer = null;
        const starting = this.#startPromise;
        const stopping = (async () =>
        {
            await this.#session.Stop();

            if (starting)
            {
                await Promise.allSettled([ starting ]);
            }

            await Promise.all([ ...this.#operations ]);
            this.#abortController = null;
            this.#credentials = null;
            this.#lastStatus = null;
            this.#operations = new Set();
            this.#revoked = false;
            this.#state = "stopped";
        })();

        this.#stopPromise = stopping.finally(() =>
        {
            this.#stopPromise = null;
        });

        return this.#stopPromise;
    }

    async #HandleWelcome({ sessionId, recreateSubscriptions, signal })
    {
        if (!recreateSubscriptions)
        {
            return;
        }

        const identity = Object.freeze({
            clientId: this.#credentials.clientId,
            userId: this.#credentials.userId,
            login: this.#credentials.login ?? null,
        });
        const subscriptions = new Map();

        for (const declaration of this.#declarations.values())
        {
            for (const subscription of declaration.subscriptions)
            {
                const condition = typeof subscription.condition === "function"
                    ? subscription.condition(identity)
                    : subscription.condition;

                if (!CjsRealtimeProtocol.isRecord(condition))
                {
                    throw new TypeError("Twitch EventSub subscription condition must be an object");
                }

                const body = {
                    type: subscription.type,
                    version: subscription.version,
                    condition: CjsRealtimeProtocol.cloneJson(condition),
                    transport: {
                        method: "websocket",
                        session_id: sessionId,
                    },
                };
                const fingerprint = CjsRealtimeProtocol.canonicalStringify(body);

                subscriptions.set(fingerprint, body);
            }
        }

        await this.#CreateSubscriptions([ ...subscriptions.values() ], signal);
    }

    async #CreateSubscriptions(subscriptions, parentSignal)
    {
        const abortController = new AbortController();
        const abort = () => abortController.abort();
        const timer = setTimeout(abort, this.#subscriptionTimeoutMs);

        timer.unref?.();

        if (parentSignal.aborted)
        {
            abort();
        }
        else
        {
            parentSignal.addEventListener("abort", abort, { once: true });
        }

        let responses;

        try
        {
            responses = await Promise.all(subscriptions.map(body =>
                this.#helix.Request("eventsub/subscriptions", {
                    method: "POST",
                    requiredScopes: this.#requiredScopes,
                    expectedUserId: this.#credentials.userId,
                    signal: abortController.signal,
                    body,
                })));
        }
        finally
        {
            clearTimeout(timer);
            parentSignal.removeEventListener("abort", abort);
        }

        const failed = responses.find(response => response.status !== 202);

        if (failed)
        {
            throw new CjsRealtimeError(
                failed.status === 401 ? "twitch_unauthorized" : "twitch_unavailable",
                failed.status === 401
                    ? "Twitch EventSub authorization is no longer valid"
                    : "Twitch EventSub subscription could not be created",
                { retryable: failed.status !== 401 },
            );
        }
    }

    async #DispatchNotification(message)
    {
        const key = CjsTwitchEventSubSource.messageSubscriptionKey(message);

        if (key === null)
        {
            this.#EmitStatus({
                state: "degraded",
                reasonCode: "invalid_notification",
                retryable: false,
                occurredAt: this.#clock(),
            });

            return;
        }

        await Promise.all([ ...this.#attachments.values() ].map(async attachment =>
        {
            if (!attachment.declaration.subscriptions.some(subscription =>
                CjsTwitchEventSubSource.subscriptionKey(subscription) === key))
            {
                return;
            }

            try
            {
                await attachment.onNotification(CjsRealtimeProtocol.cloneJson(message));
            }
            catch
            {
                attachment.onStatus({
                    state: "degraded",
                    reasonCode: "notification_rejected",
                    retryable: false,
                    occurredAt: this.#clock(),
                });
            }
        }));
    }

    async #DispatchRevocation(message)
    {
        this.#revoked = true;
        const key = CjsTwitchEventSubSource.messageSubscriptionKey(message);

        await Promise.all([ ...this.#attachments.values() ].map(async attachment =>
        {
            if (key !== null && !attachment.declaration.subscriptions.some(subscription =>
                CjsTwitchEventSubSource.subscriptionKey(subscription) === key))
            {
                return;
            }

            try
            {
                await attachment.onRevocation(CjsRealtimeProtocol.cloneJson(message));
            }
            catch
            {
                // Revocation remains authoritative even if a family observer fails.
            }
        }));
    }

    async #ValidateAuthorization()
    {
        if (this.#state !== "running" || this.#revoked)
        {
            return;
        }

        try
        {
            const credentials = await this.#oauth.Acquire({
                requiredScopes: this.#requiredScopes,
                expectedUserId: this.#credentials?.userId ?? null,
                force: true,
            });
            const changed = credentials.accessToken !== this.#credentials?.accessToken;

            this.#credentials = credentials;
            this.#session.Resume();

            if (changed)
            {
                this.#session.Reconnect("authorization_changed");
            }
        }
        catch (error)
        {
            const reasonCode = error?.code === "twitch_unauthorized"
                || error?.code === "twitch_scope_required"
                ? "authorization_invalid"
                : "authorization_unavailable";

            this.#EmitStatus({
                state: "degraded",
                reasonCode,
                retryable: error?.retryable === true,
                occurredAt: this.#clock(),
            });
            this.#session.Suspend();
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

    #EmitStatus(status)
    {
        this.#lastStatus = Object.freeze({
            state: status.state,
            reasonCode: status.reasonCode ?? null,
            retryable: status.retryable === true,
            occurredAt: status.occurredAt ?? this.#clock(),
        });

        for (const attachment of this.#attachments.values())
        {
            attachment.onStatus({ ...this.#lastStatus });
        }
    }

    /** Validates one stable family registration identity. */
    static normalizeRegistrationId(value)
    {
        if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value))
        {
            throw new TypeError("Twitch EventSub registration id is invalid");
        }

        return value;
    }

    /** Validates and sorts one unionable Twitch OAuth scope list. */
    static normalizeScopes(value)
    {
        if (!Array.isArray(value))
        {
            throw new TypeError("Twitch EventSub requiredScopes must be an array");
        }

        const scopes = value.map(scope =>
        {
            if (typeof scope !== "string" || !/^[a-z][a-z0-9:_-]{0,127}$/u.test(scope))
            {
                throw new TypeError("Twitch EventSub OAuth scope is invalid");
            }

            return scope;
        });

        return Object.freeze([ ...new Set(scopes) ].sort());
    }

    /** Validates static Twitch subscription type/version/condition declarations. */
    static normalizeSubscriptions(value)
    {
        if (!Array.isArray(value) || value.length === 0)
        {
            throw new TypeError("Twitch EventSub subscriptions must be a non-empty array");
        }

        return Object.freeze(value.map(subscription =>
        {
            if (!subscription || typeof subscription !== "object"
                || typeof subscription.type !== "string"
                || !/^[a-z][a-z0-9._-]{0,127}$/u.test(subscription.type)
                || typeof subscription.version !== "string"
                || !/^[1-9][0-9]{0,7}$/u.test(subscription.version)
                || (typeof subscription.condition !== "function"
                    && !CjsRealtimeProtocol.isRecord(subscription.condition)))
            {
                throw new TypeError("Twitch EventSub subscription declaration is invalid");
            }

            return Object.freeze({
                type: subscription.type,
                version: subscription.version,
                condition: subscription.condition,
            });
        }));
    }

    /** Returns the routing key for a declared subscription. */
    static subscriptionKey(subscription)
    {
        return `${subscription.type}@${subscription.version}`;
    }

    /** Returns a notification/revocation routing key or null for invalid metadata. */
    static messageSubscriptionKey(message)
    {
        const type = message?.metadata?.subscription_type
            ?? message?.payload?.subscription?.type;
        const version = message?.metadata?.subscription_version
            ?? message?.payload?.subscription?.version;

        if (typeof type !== "string" || typeof version !== "string")
        {
            return null;
        }

        return `${type}@${version}`;
    }

    /** Preserves stable provider failures and sanitizes unexpected adapters. */
    static startError(error)
    {
        return error instanceof CjsRealtimeError
            ? error
            : CjsTwitchEventSubSession.connectionError(error);
    }

}
