import { CjsRealtimeSerialLane } from "../realtime/internal/CjsRealtimeSerialLane.js";
import { CjsRealtimeHttpRouter } from "../realtime/server/CjsRealtimeHttpRouter.js";
import { CjsRealtimeHub } from "../realtime/server/CjsRealtimeHub.js";
import { CjsRealtimeSessionAuthority } from "../realtime/server/CjsRealtimeSessionAuthority.js";
import { CjsRealtimeWebSocketGateway } from "../realtime/websocket/CjsRealtimeWebSocketGateway.js";
import { CjsToolServiceHost } from "./CjsToolServiceHost.js";

/** Owns a composed realtime hub, HTTP listener, WebSocket gateway, and shutdown order. */
export class CjsRealtimeServer
{

    #host;

    #lane;

    #server;

    constructor({
        services = [],
        grants = [],
        allowedOrigins = [],
        allowMissingOrigin = false,
        loopbackOnly = true,
        limits = {},
        httpRouters = [],
        fallback = null,
    } = {})
    {
        if (!Array.isArray(services))
        {
            throw new TypeError("Realtime server services must be an array");
        }

        this.authority = new CjsRealtimeSessionAuthority({ grants });
        this.hub = new CjsRealtimeHub({ authority: this.authority, limits });

        for (const service of services)
        {
            this.hub.Register(service);
        }

        const realtimeRouter = new CjsRealtimeHttpRouter({
            hub: this.hub,
            allowedOrigins,
            loopbackOnly,
        });
        const realtimeGateway = new CjsRealtimeWebSocketGateway({
            hub: this.hub,
            allowedOrigins,
            allowMissingOrigin,
            loopbackOnly,
        });

        this.#host = new CjsToolServiceHost({
            hub: this.hub,
            realtimeRouter,
            realtimeGateway,
            httpRouters,
            fallback,
        });
        this.#lane = new CjsRealtimeSerialLane();
        this.#server = null;
        this.loopbackOnly = loopbackOnly === true;
        Object.freeze(this);
    }

    /** Starts all services and listens only after the hub is ready. */
    Listen({ host = "127.0.0.1", port = 0 } = {})
    {
        return this.#lane.Enqueue(async () =>
        {
            if (this.#server !== null)
            {
                throw new Error("Realtime server is already listening");
            }

            const normalizedHost = CjsRealtimeServer.normalizeHost(host, this.loopbackOnly);
            const normalizedPort = CjsRealtimeServer.normalizePort(port);

            await this.#host.Start();
            const server = this.#host.CreateServer();

            try
            {
                await new Promise((resolve, reject) =>
                {
                    server.once("error", reject);
                    server.listen(normalizedPort, normalizedHost, resolve);
                });
            }
            catch (error)
            {
                await this.#host.Stop();
                throw error;
            }

            this.#server = server;

            return this.Address();
        });
    }

    /** Returns the bound TCP address without exposing any capability grant. */
    Address()
    {
        const address = this.#server?.address();

        if (!address || typeof address === "string")
        {
            return null;
        }

        return Object.freeze({
            host: address.address,
            port: address.port,
            family: address.family,
        });
    }

    /** Stops HTTP admission, sockets, and services in a deterministic order. */
    Stop()
    {
        return this.#lane.Enqueue(async () =>
        {
            if (this.#server === null)
            {
                await this.#host.Stop();
                return;
            }

            const server = this.#server;

            this.#server = null;
            const closed = new Promise((resolve, reject) =>
            {
                server.close(error => error ? reject(error) : resolve());
            });

            const [ hostResult, closeResult ] = await Promise.allSettled([
                this.#host.Stop(),
                closed,
            ]);

            if (hostResult.status === "rejected")
            {
                throw hostResult.reason;
            }

            if (closeResult.status === "rejected")
            {
                throw closeResult.reason;
            }
        });
    }

    /** Normalizes the listener host and preserves loopback-only defaults. */
    static normalizeHost(value, loopbackOnly)
    {
        const host = String(value ?? "").trim().toLowerCase();

        if (!host || (loopbackOnly && ![ "127.0.0.1", "::1" ].includes(host)))
        {
            throw new TypeError("Realtime server host is invalid for its network policy");
        }

        return host;
    }

    /** Normalizes one TCP listener port. */
    static normalizePort(value)
    {
        const port = Number(value);

        if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
        {
            throw new TypeError("Realtime server port must be between 0 and 65535");
        }

        return port;
    }

}
