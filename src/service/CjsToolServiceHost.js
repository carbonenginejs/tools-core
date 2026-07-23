import http from "node:http";

/** Composes realtime routes and upgrades with an optional existing HTTP adapter. */
export class CjsToolServiceHost
{

    #gateway;

    #hub;

    #httpRouters;

    #router;

    constructor({
        hub,
        realtimeRouter,
        realtimeGateway,
        httpRouters = [],
        fallback = null,
    } = {})
    {
        if (!hub || !realtimeRouter || !realtimeGateway)
        {
            throw new TypeError(
                "CjsToolServiceHost requires a hub, realtimeRouter, and realtimeGateway",
            );
        }

        if (fallback !== null && typeof fallback.Handle !== "function")
        {
            throw new TypeError("CjsToolServiceHost fallback must provide Handle()");
        }

        if (!Array.isArray(httpRouters) || httpRouters.some(router =>
            !router || typeof router.CanHandle !== "function"
            || typeof router.Handle !== "function"))
        {
            throw new TypeError(
                "CjsToolServiceHost httpRouters must provide CanHandle() and Handle()",
            );
        }

        this.#hub = hub;
        this.#router = realtimeRouter;
        this.#gateway = realtimeGateway;
        this.#httpRouters = Object.freeze([ ...httpRouters ]);
        this.fallback = fallback;
        Object.freeze(this);
    }

    /** Starts registered services before accepting traffic. */
    Start()
    {
        return this.#hub.Start();
    }

    /** Creates, but does not listen on, the composed Node HTTP server. */
    CreateServer()
    {
        const server = http.createServer((request, response) =>
        {
            this.Handle(request, response).catch(() =>
            {
                CjsToolServiceHost.writeInternalError(response);
            });
        });

        this.#gateway.Attach(server);

        return server;
    }

    /** Routes realtime HTTP first and delegates all other requests. */
    async Handle(request, response)
    {
        if (this.#router.CanHandle(request))
        {
            await this.#router.Handle(request, response);

            return;
        }

        for (const router of this.#httpRouters)
        {
            if (router.CanHandle(request))
            {
                await router.Handle(request, response);

                return;
            }
        }

        if (this.fallback)
        {
            await this.fallback.Handle(request, response);

            return;
        }

        const body = Buffer.from(JSON.stringify({ error: "Not found" }));

        response.writeHead(404, {
            "content-type": "application/json; charset=utf-8",
            "content-length": String(body.byteLength),
        });
        response.end(body);
    }

    /** Stops the WebSocket gateway and registered services. */
    async Stop()
    {
        await this.#gateway.Stop();
        await this.#hub.Stop();
    }

    /** Writes a stable secret-free HTTP failure. */
    static writeInternalError(response)
    {
        if (response.headersSent)
        {
            response.destroy();

            return;
        }

        const body = Buffer.from(JSON.stringify({ error: "Internal service error" }));

        response.writeHead(500, {
            "content-type": "application/json; charset=utf-8",
            "content-length": String(body.byteLength),
        });
        response.end(body);
    }

}
