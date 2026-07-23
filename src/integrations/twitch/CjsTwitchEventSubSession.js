import { WebSocket } from "ws";

import { CjsRealtimeError } from "../../realtime/CjsRealtimeError.js";

const DEFAULT_ENDPOINT = "wss://eventsub.wss.twitch.tv/ws";

/** Owns one family-neutral Twitch EventSub WebSocket session lifecycle. */
export class CjsTwitchEventSubSession
{

    #active;

    #available;

    #clock;

    #createWebSocket;

    #endpoint;

    #keepaliveGraceMs;

    #onNotification;

    #onRevocation;

    #onStatus;

    #onWelcome;

    #operations;

    #primary;

    #reconnectAttempt;

    #reconnectBaseMs;

    #reconnectMaxMs;

    #reconnectTimer;

    #records;

    #revoked;

    #welcomeTimeoutMs;

    constructor({
        createWebSocket = url => new WebSocket(url, { maxPayload: 64 * 1024 }),
        clock = () => Date.now(),
        endpoint = DEFAULT_ENDPOINT,
        keepaliveGraceMs = 1000,
        reconnectBaseMs = 250,
        reconnectMaxMs = 10000,
        welcomeTimeoutMs = 8000,
    } = {})
    {
        if (typeof createWebSocket !== "function" || typeof clock !== "function")
        {
            throw new TypeError("Twitch EventSub session adapters must be functions");
        }

        for (const [ name, value ] of Object.entries({
            keepaliveGraceMs,
            reconnectBaseMs,
            reconnectMaxMs,
            welcomeTimeoutMs,
        }))
        {
            if (!Number.isSafeInteger(value) || value < 1)
            {
                throw new TypeError(`Twitch EventSub ${name} must be a positive integer`);
            }
        }

        if (reconnectMaxMs < reconnectBaseMs)
        {
            throw new TypeError("Twitch EventSub reconnectMaxMs must cover reconnectBaseMs");
        }

        this.#createWebSocket = createWebSocket;
        this.#clock = clock;
        this.#endpoint = CjsTwitchEventSubSession.normalizeEndpoint(endpoint, false);
        this.#keepaliveGraceMs = keepaliveGraceMs;
        this.#reconnectBaseMs = reconnectBaseMs;
        this.#reconnectMaxMs = reconnectMaxMs;
        this.#welcomeTimeoutMs = welcomeTimeoutMs;
        this.#active = false;
        this.#available = false;
        this.#onNotification = null;
        this.#onRevocation = null;
        this.#onStatus = null;
        this.#onWelcome = null;
        this.#operations = new Set();
        this.#primary = null;
        this.#reconnectAttempt = 0;
        this.#reconnectTimer = null;
        this.#records = new Set();
        this.#revoked = false;
    }

    /** Opens EventSub and resolves only after family subscription setup completes. */
    async Start({ signal, onWelcome, onNotification, onRevocation, onStatus })
    {
        if (this.#active)
        {
            return;
        }

        if (!(signal instanceof AbortSignal) || typeof onWelcome !== "function"
            || typeof onNotification !== "function" || typeof onRevocation !== "function"
            || typeof onStatus !== "function")
        {
            throw new TypeError("Twitch EventSub session callbacks are invalid");
        }

        this.#active = true;
        this.#available = true;
        this.#revoked = false;
        this.#onWelcome = onWelcome;
        this.#onNotification = onNotification;
        this.#onRevocation = onRevocation;
        this.#onStatus = onStatus;
        signal.addEventListener("abort", () =>
        {
            this.#active = false;
        }, { once: true });

        try
        {
            await this.#Open(this.#endpoint, { recreateSubscriptions: true });
        }
        catch (error)
        {
            this.#active = false;
            this.#available = false;
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
            this.#CloseAll();

            throw CjsTwitchEventSubSession.startError(error);
        }
    }

    /** Stops reconnects, closes every socket, and drains admitted frame handlers. */
    async Stop()
    {
        this.#active = false;
        this.#available = false;
        clearTimeout(this.#reconnectTimer);
        this.#reconnectTimer = null;
        this.#CloseAll();
        await Promise.all([ ...this.#operations ]);
        this.#onNotification = null;
        this.#onRevocation = null;
        this.#onStatus = null;
        this.#onWelcome = null;
        this.#operations = new Set();
        this.#primary = null;
        this.#reconnectAttempt = 0;
        this.#records = new Set();
        this.#revoked = false;
    }

    /** Suspends sockets and reconnects while external authorization is unavailable. */
    Suspend()
    {
        this.#available = false;
        clearTimeout(this.#reconnectTimer);
        this.#reconnectTimer = null;
        this.#CloseAll();
    }

    /** Resumes a suspended session after external authorization is valid again. */
    Resume()
    {
        if (!this.#active || this.#revoked)
        {
            return;
        }

        this.#available = true;

        if (!this.#primary)
        {
            this.#ScheduleReconnect();
        }
    }

    /** Reconnects a ready session to apply changed external authorization. */
    Reconnect(reasonCode = "upstream_reconnecting")
    {
        if (!this.#active || !this.#available || this.#revoked)
        {
            return;
        }

        this.#EmitStatus("reconnecting", reasonCode, true);

        if (this.#primary)
        {
            CjsTwitchEventSubSession.closeSocket(this.#primary.socket, true);
        }
        else
        {
            this.#ScheduleReconnect();
        }
    }

    #Open(url, { recreateSubscriptions, migrationSource = null })
    {
        const endpoint = CjsTwitchEventSubSession.normalizeEndpoint(
            url,
            url !== this.#endpoint,
        );
        let socket;

        try
        {
            socket = this.#createWebSocket(endpoint);
        }
        catch (error)
        {
            return Promise.reject(CjsTwitchEventSubSession.connectionError(error));
        }

        if (!socket || typeof socket.on !== "function" || typeof socket.close !== "function")
        {
            return Promise.reject(new TypeError(
                "Twitch EventSub WebSocket factory returned an invalid socket",
            ));
        }

        const record = {
            socket,
            recreateSubscriptions,
            migrationSource,
            ready: false,
            closed: false,
            failed: false,
            intentional: false,
            settled: false,
            keepaliveTimer: null,
            welcomeTimer: null,
            setupAbort: new AbortController(),
            messageLane: Promise.resolve(),
            resolve: null,
            reject: null,
        };
        const operation = new Promise((resolve, reject) =>
        {
            record.resolve = resolve;
            record.reject = reject;
        });

        this.#records.add(record);
        record.welcomeTimer = setTimeout(() =>
        {
            this.#FailRecord(record, new CjsRealtimeError(
                "twitch_unavailable",
                "Twitch EventSub welcome timed out",
                { retryable: true },
            ));
        }, this.#welcomeTimeoutMs);
        socket.on("message", data =>
        {
            this.#EnqueueMessage(record, data);
        });
        socket.on("close", () => this.#HandleClose(record));
        socket.on("error", error =>
        {
            if (!record.ready)
            {
                this.#FailRecord(record, error);
            }
        });

        return operation;
    }

    #EnqueueMessage(record, data)
    {
        const operation = record.messageLane.then(async () =>
        {
            if (record.closed || record.failed)
            {
                return;
            }

            try
            {
                await this.#HandleMessage(record, data);
            }
            catch (error)
            {
                this.#FailRecord(record, error);
            }
        });

        record.messageLane = operation;
        this.#Track(operation);
    }

    async #HandleMessage(record, data)
    {
        if (!this.#active || record.closed || record.failed || record.intentional)
        {
            return;
        }

        const text = CjsTwitchEventSubSession.messageText(data);
        let message;

        try
        {
            message = JSON.parse(text);
        }
        catch
        {
            throw new CjsRealtimeError(
                "twitch_invalid_response",
                "Twitch EventSub delivered an invalid message",
                { retryable: true },
            );
        }

        this.#ResetKeepalive(record, message);
        const messageType = message?.metadata?.message_type;

        if (messageType === "session_welcome")
        {
            await this.#HandleWelcome(record, message);
        }
        else if (messageType === "notification" && record.ready)
        {
            await this.#onNotification(message);
        }
        else if (messageType === "session_reconnect" && record.ready)
        {
            this.#HandleReconnectInstruction(record, message);
        }
        else if (messageType === "revocation")
        {
            this.#revoked = true;
            this.#available = false;
            this.#EmitStatus("degraded", "subscription_revoked", false);

            try
            {
                await this.#onRevocation(message);
            }
            finally
            {
                this.#CloseAll();
            }
        }
        else if (messageType !== "session_keepalive")
        {
            throw new CjsRealtimeError(
                "twitch_invalid_response",
                "Twitch EventSub delivered an unexpected message",
                { retryable: true },
            );
        }
    }

    async #HandleWelcome(record, message)
    {
        if (record.ready)
        {
            throw new CjsRealtimeError(
                "twitch_invalid_response",
                "Twitch EventSub delivered a duplicate welcome",
                { retryable: true },
            );
        }

        const sessionId = message?.payload?.session?.id;

        if (typeof sessionId !== "string" || sessionId.length === 0)
        {
            throw new CjsRealtimeError(
                "twitch_invalid_response",
                "Twitch EventSub welcome omitted its session identity",
                { retryable: true },
            );
        }

        clearTimeout(record.welcomeTimer);
        record.welcomeTimer = null;
        await this.#onWelcome(Object.freeze({
            sessionId,
            recreateSubscriptions: record.recreateSubscriptions,
            signal: record.setupAbort.signal,
        }));

        if (!this.#active || record.closed || record.failed || record.intentional)
        {
            return;
        }

        record.ready = true;
        this.#primary = record;
        this.#reconnectAttempt = 0;
        this.#EmitStatus("ready", null, false);

        if (record.migrationSource)
        {
            this.#CloseRecord(record.migrationSource);
        }

        if (!record.settled)
        {
            record.settled = true;
            record.resolve();
        }
    }

    #HandleReconnectInstruction(record, message)
    {
        const url = message?.payload?.session?.reconnect_url;

        if ([ ...this.#records ].some(candidate => candidate.migrationSource === record))
        {
            return;
        }

        this.#EmitStatus("reconnecting", "session_reconnect", true);
        const operation = this.#Open(url, {
            recreateSubscriptions: false,
            migrationSource: record,
        });

        this.#Track(operation, () =>
        {
            this.#EmitStatus("degraded", "session_reconnect_failed", true);

            if (!this.#primary)
            {
                this.#ScheduleReconnect();
            }
        });
    }

    #HandleClose(record)
    {
        clearTimeout(record.keepaliveTimer);
        clearTimeout(record.welcomeTimer);
        record.welcomeTimer = null;
        record.setupAbort.abort();
        record.closed = true;
        this.#records.delete(record);

        if (this.#primary === record)
        {
            this.#primary = null;
        }

        if (!record.settled)
        {
            record.settled = true;
            record.reject(CjsTwitchEventSubSession.connectionError());
        }

        const migrationPending = [ ...this.#records ].some(candidate =>
            candidate.migrationSource === record && !candidate.settled);

        if (this.#active && !record.intentional && !migrationPending
            && this.#available && !this.#revoked && !this.#primary)
        {
            this.#EmitStatus("degraded", "upstream_gap", true);
            this.#ScheduleReconnect();
        }
    }

    #FailRecord(record, error)
    {
        if (record.closed || record.failed)
        {
            return;
        }

        record.failed = true;
        clearTimeout(record.keepaliveTimer);
        clearTimeout(record.welcomeTimer);
        record.welcomeTimer = null;
        record.setupAbort.abort();

        if (!record.settled)
        {
            record.settled = true;
            record.reject(CjsTwitchEventSubSession.connectionError(error));
        }

        CjsTwitchEventSubSession.closeSocket(record.socket, true);
    }

    #ResetKeepalive(record, message)
    {
        const seconds = message?.payload?.session?.keepalive_timeout_seconds;

        if (Number.isSafeInteger(seconds) && seconds > 0)
        {
            record.keepaliveSeconds = seconds;
        }

        if (!Number.isSafeInteger(record.keepaliveSeconds))
        {
            return;
        }

        clearTimeout(record.keepaliveTimer);
        record.keepaliveTimer = setTimeout(() =>
        {
            if (!this.#active || record.intentional)
            {
                return;
            }

            this.#EmitStatus("reconnecting", "keepalive_timeout", true);
            CjsTwitchEventSubSession.closeSocket(record.socket, true);
        }, record.keepaliveSeconds * 1000 + this.#keepaliveGraceMs);
        record.keepaliveTimer.unref?.();
    }

    #ScheduleReconnect()
    {
        if (!this.#active || !this.#available || this.#revoked
            || this.#reconnectTimer || this.#primary
            || [ ...this.#records ].some(record => !record.ready))
        {
            return;
        }

        const delay = Math.min(
            this.#reconnectMaxMs,
            this.#reconnectBaseMs * (2 ** this.#reconnectAttempt),
        );

        this.#reconnectAttempt++;
        this.#EmitStatus("reconnecting", "upstream_reconnecting", true);
        this.#reconnectTimer = setTimeout(() =>
        {
            this.#reconnectTimer = null;

            if (!this.#active || !this.#available || this.#revoked || this.#primary)
            {
                return;
            }

            const operation = this.#Open(this.#endpoint, { recreateSubscriptions: true });

            this.#Track(operation, () => this.#ScheduleReconnect());
        }, delay);
        this.#reconnectTimer.unref?.();
    }

    #CloseAll()
    {
        for (const record of [ ...this.#records ])
        {
            this.#CloseRecord(record);
        }
    }

    #CloseRecord(record)
    {
        record.intentional = true;
        record.closed = true;
        clearTimeout(record.keepaliveTimer);
        clearTimeout(record.welcomeTimer);
        record.welcomeTimer = null;
        record.setupAbort.abort();

        if (!record.settled)
        {
            record.settled = true;
            record.reject(CjsTwitchEventSubSession.connectionError());
        }

        record.socket.close(1000, "provider shutdown");
        this.#records.delete(record);

        if (this.#primary === record)
        {
            this.#primary = null;
        }
    }

    #Track(operation, onError = () => undefined)
    {
        const tracked = Promise.resolve(operation).then(
            () => undefined,
            error => onError(error),
        );

        this.#operations.add(tracked);
        tracked.then(() => this.#operations.delete(tracked));
    }

    #EmitStatus(state, reasonCode, retryable)
    {
        this.#onStatus?.({
            state,
            reasonCode,
            retryable,
            occurredAt: this.#clock(),
        });
    }

    /** Restricts Twitch-directed reconnects to the official EventSub WSS route. */
    static normalizeEndpoint(value, directed)
    {
        let url;

        try
        {
            url = new URL(value);
        }
        catch
        {
            throw new TypeError("Twitch EventSub endpoint is invalid");
        }

        if (url.protocol !== "wss:" || (directed
            && (url.hostname !== "eventsub.wss.twitch.tv" || url.pathname !== "/ws")))
        {
            throw new TypeError("Twitch EventSub endpoint must use the Twitch WSS service");
        }

        return url.href;
    }

    /** Decodes and bounds one WebSocket text message. */
    static messageText(value)
    {
        const text = Buffer.isBuffer(value)
            ? value.toString("utf8")
            : value instanceof ArrayBuffer
                ? Buffer.from(value).toString("utf8")
                : String(value);

        if (Buffer.byteLength(text) > 64 * 1024)
        {
            throw new CjsRealtimeError(
                "twitch_invalid_response",
                "Twitch EventSub message exceeds its configured limit",
                { retryable: true },
            );
        }

        return text;
    }

    /** Closes a provider socket with termination when requested and available. */
    static closeSocket(socket, terminate)
    {
        if (terminate && typeof socket.terminate === "function")
        {
            socket.terminate();
        }
        else
        {
            socket.close();
        }
    }

    /** Creates a sanitized connection failure. */
    static connectionError(error = undefined)
    {
        return new CjsRealtimeError(
            "twitch_unavailable",
            "Twitch EventSub connection is unavailable",
            { retryable: true, cause: error },
        );
    }

    /** Preserves safe startup errors and sanitizes socket implementation failures. */
    static startError(error)
    {
        return error instanceof CjsRealtimeError
            ? error
            : CjsTwitchEventSubSession.connectionError(error);
    }

}
