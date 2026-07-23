import { CjsRealtimeError } from "../../realtime/CjsRealtimeError.js";
import { CjsBoundedFetch } from "../../internal/CjsBoundedFetch.js";

const DEFAULT_ENDPOINT = "https://api.twitch.tv/helix/";

/** Applies shared Twitch OAuth identity, scope, and reactive refresh to Helix requests. */
export class CjsTwitchHelixClient
{

    #endpoint;

    #fetch;

    #oauth;

    #requestTimeoutMs;

    constructor({
        oauth,
        fetch: fetchImplementation = globalThis.fetch,
        endpoint = DEFAULT_ENDPOINT,
        requestTimeoutMs = 10000,
    } = {})
    {
        if (!oauth || typeof oauth.Acquire !== "function"
            || typeof oauth.Invalidate !== "function")
        {
            throw new TypeError("Twitch Helix client requires an OAuth token provider");
        }

        if (typeof fetchImplementation !== "function")
        {
            throw new TypeError("Twitch Helix fetch option must be a function");
        }

        CjsBoundedFetch.normalizeLimit(requestTimeoutMs, "requestTimeoutMs");

        this.#oauth = oauth;
        this.#fetch = fetchImplementation;
        this.#endpoint = CjsTwitchHelixClient.normalizeEndpoint(endpoint);
        this.#requestTimeoutMs = requestTimeoutMs;
        Object.freeze(this);
    }

    /** Sends one authenticated Helix request and retries one reactive OAuth rejection. */
    async Request(route, {
        method = "GET",
        query = null,
        body = undefined,
        requiredScopes = [],
        expectedUserId = null,
        signal = undefined,
    } = {})
    {
        if (signal !== undefined && !(signal instanceof AbortSignal))
        {
            throw new TypeError("Twitch Helix signal must be an AbortSignal");
        }

        try
        {
            return await CjsBoundedFetch.run(async requestSignal =>
            {
                const url = CjsTwitchHelixClient.createUrl(this.#endpoint, route, query);
                const normalizedMethod = CjsTwitchHelixClient.normalizeMethod(method);
                let credentials = await this.#oauth.Acquire({
                    requiredScopes,
                    expectedUserId,
                });

                CjsBoundedFetch.requireActive(requestSignal, "Twitch Helix request");
                let response = await this.#Send(
                    url,
                    normalizedMethod,
                    body,
                    credentials,
                    requestSignal,
                );

                if (response.status === 401)
                {
                    this.#oauth.Invalidate();
                    credentials = await this.#oauth.Acquire({
                        requiredScopes,
                        expectedUserId,
                        force: true,
                    });
                    CjsBoundedFetch.requireActive(requestSignal, "Twitch Helix request");
                    response = await this.#Send(
                        url,
                        normalizedMethod,
                        body,
                        credentials,
                        requestSignal,
                    );
                }

                return response;
            }, {
                timeoutMs: this.#requestTimeoutMs,
                signal,
                label: "Twitch Helix request",
            });
        }
        catch (error)
        {
            if (error instanceof CjsRealtimeError)
            {
                throw error;
            }

            throw new CjsRealtimeError(
                "twitch_unavailable",
                "Twitch Helix is unavailable",
                { retryable: true, cause: error },
            );
        }
    }

    async #Send(url, method, body, credentials, signal)
    {
        const headers = {
            authorization: `Bearer ${credentials.accessToken}`,
            "client-id": credentials.clientId,
        };
        const options = { method, headers, signal };

        try
        {
            if (body !== undefined)
            {
                headers["content-type"] = "application/json";
                options.body = JSON.stringify(body);
            }

            const response = await this.#fetch(url, options);

            if (!response || !Number.isSafeInteger(response.status))
            {
                throw new TypeError("Twitch Helix fetch returned an invalid response");
            }

            return response;
        }
        catch (error)
        {
            throw new CjsRealtimeError(
                "twitch_unavailable",
                "Twitch Helix is unavailable",
                { retryable: true, cause: error },
            );
        }
    }

    /** Validates an HTTPS Helix root while allowing injected offline endpoints. */
    static normalizeEndpoint(value)
    {
        let url;

        try
        {
            url = new URL(value);
        }
        catch
        {
            throw new TypeError("Twitch Helix endpoint is invalid");
        }

        if (url.protocol !== "https:")
        {
            throw new TypeError("Twitch Helix endpoint must use HTTPS");
        }

        url.search = "";
        url.hash = "";

        if (!url.pathname.endsWith("/"))
        {
            url.pathname += "/";
        }

        return url.href;
    }

    /** Constructs one contained Helix URL with a deterministic query string. */
    static createUrl(endpoint, route, query)
    {
        if (typeof route !== "string" || route.length === 0 || route.startsWith("/")
            || route.includes("..") || !/^[a-z0-9/_-]+$/iu.test(route))
        {
            throw new TypeError("Twitch Helix route is invalid");
        }

        const url = new URL(route, endpoint);

        if (query !== null)
        {
            if (query instanceof URLSearchParams)
            {
                url.search = query.toString();
            }
            else if (query && typeof query === "object" && !Array.isArray(query))
            {
                for (const [ name, source ] of Object.entries(query)
                    .sort(([ left ], [ right ]) => left.localeCompare(right)))
                {
                    for (const value of Array.isArray(source) ? source : [ source ])
                    {
                        if ([ "string", "number", "boolean" ].includes(typeof value))
                        {
                            url.searchParams.append(name, String(value));
                        }
                    }
                }
            }
            else
            {
                throw new TypeError("Twitch Helix query must be an object or URLSearchParams");
            }
        }

        return url.href;
    }

    /** Restricts requests to the verbs currently used by Twitch Helix. */
    static normalizeMethod(value)
    {
        const method = String(value).toUpperCase();

        if (![ "DELETE", "GET", "PATCH", "POST", "PUT" ].includes(method))
        {
            throw new TypeError("Twitch Helix method is invalid");
        }

        return method;
    }

}
