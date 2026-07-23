import { WebSocketServer } from "ws";

import { CjsRealtimeHttpRouter } from "../server/CjsRealtimeHttpRouter.js";
import { CjsRealtimeSessionAuthority } from "../server/CjsRealtimeSessionAuthority.js";
import { REALTIME_ROUTE, REALTIME_SUBPROTOCOL } from "../CjsRealtimeProtocol.js";
import { CjsRealtimeWebSocketTransport } from "./CjsRealtimeWebSocketTransport.js";

/** Secure ws transport adapter for the transport-neutral realtime hub. */
export class CjsRealtimeWebSocketGateway
{

    #allowedOrigins;

    #draining;

    #heartbeatTimer;

    #hub;

    #maxPayload;

    #records;

    #server;

    #upgradeHandler;

    #webSocketServer;

    constructor({
        hub,
        allowedOrigins = [],
        allowMissingOrigin = false,
        loopbackOnly = true,
        route = REALTIME_ROUTE,
        subprotocol = REALTIME_SUBPROTOCOL,
        maxPayload = hub?.limits?.maxMessageBytes ?? 64 * 1024,
        maxBufferedBytes = hub?.limits?.maxOutboundBytes ?? 1024 * 1024,
        stopGraceMs = 250,
    } = {})
    {
        if (!hub || typeof hub.OpenConnection !== "function")
        {
            throw new TypeError("CjsRealtimeWebSocketGateway requires a realtime hub");
        }

        if (!Array.isArray(allowedOrigins))
        {
            throw new TypeError("Realtime WebSocket allowedOrigins must be an array");
        }

        if (typeof route !== "string" || !route.startsWith("/")
            || route.includes("?") || route.includes("#"))
        {
            throw new TypeError("Realtime WebSocket route must be an absolute path");
        }

        if (typeof subprotocol !== "string"
            || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(subprotocol))
        {
            throw new TypeError("Realtime WebSocket subprotocol is invalid");
        }

        for (const [ name, value ] of Object.entries({
            maxPayload,
            maxBufferedBytes,
            stopGraceMs,
        }))
        {
            if (!Number.isSafeInteger(value) || value < 1)
            {
                throw new TypeError(`Realtime WebSocket ${name} must be a positive integer`);
            }
        }

        this.#hub = hub;
        this.#allowedOrigins = Object.freeze(allowedOrigins.map(origin =>
            CjsRealtimeSessionAuthority.normalizeOrigin(origin)));
        this.allowMissingOrigin = allowMissingOrigin === true;
        this.loopbackOnly = loopbackOnly === true;
        this.route = route;
        this.subprotocol = subprotocol;
        this.#maxPayload = maxPayload;
        this.maxBufferedBytes = maxBufferedBytes;
        this.stopGraceMs = stopGraceMs;
        this.#records = new Map();
        this.#server = null;
        this.#heartbeatTimer = null;
        this.#draining = false;
        this.#upgradeHandler = (request, socket, head) =>
            this.#HandleUpgrade(request, socket, head);
        this.#webSocketServer = null;
    }

    /** Attaches this gateway to one existing Node HTTP server. */
    Attach(server)
    {
        if (this.#server !== null)
        {
            throw new Error("Realtime WebSocket gateway is already attached");
        }

        this.#server = server;
        this.#draining = false;
        this.#CreateWebSocketServer();
        server.on("upgrade", this.#upgradeHandler);
        this.#heartbeatTimer = setInterval(() =>
        {
            this.#Heartbeat();
        }, this.#hub.limits.heartbeatIntervalMs);
        this.#heartbeatTimer.unref?.();

        return server;
    }

    /** Detaches the upgrade listener without closing the HTTP server. */
    Detach()
    {
        this.#server?.off("upgrade", this.#upgradeHandler);
        this.#server = null;
        clearInterval(this.#heartbeatTimer);
        this.#heartbeatTimer = null;
    }

    /** Drains active sockets and stops accepting upgrades. */
    async Stop()
    {
        this.#draining = true;
        this.Detach();

        for (const { connection } of [ ...this.#records.values() ])
        {
            connection.Close(1001, "server_shutdown");
        }

        await CjsRealtimeWebSocketGateway.waitFor(
            () => this.#records.size === 0,
            this.stopGraceMs,
        );

        for (const [ socket, record ] of [ ...this.#records ])
        {
            this.#CleanupSocket(socket, record.connection);
            socket.terminate();
        }

        if (this.#webSocketServer)
        {
            await new Promise(resolve => this.#webSocketServer.close(() => resolve()));
            this.#webSocketServer.removeAllListeners();
            this.#webSocketServer = null;
        }
    }

    #HandleUpgrade(request, socket, head)
    {
        if (this.#draining)
        {
            CjsRealtimeWebSocketGateway.rejectUpgrade(socket, 503, "Service Unavailable");

            return;
        }

        let url;

        try
        {
            url = new URL(request.url || "/", "http://tools-core.local");
        }
        catch
        {
            CjsRealtimeWebSocketGateway.rejectUpgrade(socket, 404, "Not Found");

            return;
        }

        if (CjsRealtimeHttpRouter.rawPathname(request.url) !== this.route || url.search !== "")
        {
            CjsRealtimeWebSocketGateway.rejectUpgrade(socket, 404, "Not Found");

            return;
        }

        if (this.loopbackOnly && !CjsRealtimeHttpRouter.isLoopback(
            request.socket?.remoteAddress,
        ))
        {
            CjsRealtimeWebSocketGateway.rejectUpgrade(socket, 403, "Forbidden");

            return;
        }

        const origin = request.headers.origin ?? null;

        if (!this.#IsAllowedOrigin(origin))
        {
            CjsRealtimeWebSocketGateway.rejectUpgrade(socket, 403, "Forbidden");

            return;
        }

        const protocols = String(request.headers["sec-websocket-protocol"] ?? "")
            .split(",")
            .map(value => value.trim())
            .filter(Boolean);

        if (!protocols.includes(this.subprotocol))
        {
            CjsRealtimeWebSocketGateway.rejectUpgrade(
                socket,
                426,
                "Upgrade Required",
                { "Sec-WebSocket-Protocol": this.subprotocol },
            );

            return;
        }

        if (this.#records.size >= this.#hub.limits.maxConnections)
        {
            CjsRealtimeWebSocketGateway.rejectUpgrade(socket, 429, "Too Many Requests");

            return;
        }

        this.#webSocketServer.handleUpgrade(request, socket, head, webSocket =>
        {
            this.#webSocketServer.emit("connection", webSocket, request);
        });
    }

    #HandleConnection(socket, request)
    {
        const transport = new CjsRealtimeWebSocketTransport({
            socket,
            maxBufferedBytes: this.maxBufferedBytes,
        });
        let connection;

        try
        {
            connection = this.#hub.OpenConnection({
                transport,
                origin: request.headers.origin ?? null,
                clientAddress: request.socket?.remoteAddress ?? null,
            });
        }
        catch
        {
            socket.close(1013, "try_again_later");

            return;
        }

        const record = {
            connection,
            lastPongAt: Date.now(),
        };

        this.#records.set(socket, record);
        socket.on("message", (data, isBinary) =>
        {
            if (isBinary)
            {
                connection.RejectBinary();

                return;
            }

            connection.ReceiveText(data.toString("utf8")).catch(() =>
            {
                connection.Close(1011, "protocol_failure");
            });
        });
        socket.on("pong", () =>
        {
            record.lastPongAt = Date.now();
        });
        socket.on("close", () =>
        {
            this.#CleanupSocket(socket, connection);
        });
        socket.on("error", () =>
        {
            this.#CleanupSocket(socket, connection);
            socket.terminate();
        });
    }

    #Heartbeat()
    {
        const now = Date.now();

        for (const [ socket, record ] of this.#records)
        {
            if (!record.connection.ValidateSession())
            {
                continue;
            }

            if (now - record.lastPongAt > this.#hub.limits.idleTimeoutMs)
            {
                this.#records.delete(socket);
                record.connection.TransportClosed();
                socket.terminate();

                continue;
            }

            socket.ping();
        }
    }

    #IsAllowedOrigin(origin)
    {
        if (origin === null || origin === undefined || origin === "")
        {
            return this.allowMissingOrigin;
        }

        try
        {
            return this.#allowedOrigins.includes(
                CjsRealtimeSessionAuthority.normalizeOrigin(origin),
            );
        }
        catch
        {
            return false;
        }
    }

    #CreateWebSocketServer()
    {
        if (this.#webSocketServer !== null)
        {
            return;
        }

        this.#webSocketServer = new WebSocketServer({
            noServer: true,
            clientTracking: false,
            perMessageDeflate: false,
            maxPayload: this.#maxPayload,
            handleProtocols: protocols => protocols.has(this.subprotocol)
                ? this.subprotocol
                : false,
        });
        this.#webSocketServer.on("connection", (socket, request) =>
            this.#HandleConnection(socket, request));
    }

    #CleanupSocket(socket, connection)
    {
        if (this.#records.delete(socket))
        {
            connection.TransportClosed();
        }
    }

    /** Rejects an HTTP upgrade without exposing protocol internals. */
    static rejectUpgrade(socket, statusCode, statusText, headers = {})
    {
        const lines = [
            `HTTP/1.1 ${statusCode} ${statusText}`,
            "Connection: close",
            "Content-Length: 0",
            ...Object.entries(headers).map(([ name, value ]) => `${name}: ${value}`),
            "",
            "",
        ];

        socket.end(lines.join("\r\n"));
    }

    /** Waits briefly for a shutdown condition without retaining the process. */
    static waitFor(predicate, timeoutMs)
    {
        if (predicate())
        {
            return Promise.resolve(true);
        }

        return new Promise(resolve =>
        {
            const startedAt = Date.now();
            const timer = setInterval(() =>
            {
                if (predicate() || Date.now() - startedAt >= timeoutMs)
                {
                    clearInterval(timer);
                    resolve(predicate());
                }
            }, Math.min(10, timeoutMs));
        });
    }

}
