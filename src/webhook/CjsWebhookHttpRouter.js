import { CjsRealtimeProtocol } from "../realtime/CjsRealtimeProtocol.js";
import { CjsWebhookError } from "./CjsWebhookError.js";

export const WEBHOOK_ROUTE = "/v1/webhooks";

/** Bounded raw HTTP ingress for independently authenticated webhook endpoints. */
export class CjsWebhookHttpRouter
{

    #activeRequests;

    #clock;

    #endpoints;

    #maxBodyBytes;

    #maxConcurrentRequests;

    #route;

    constructor({
        endpoints = [],
        route = WEBHOOK_ROUTE,
        maxBodyBytes = 256 * 1024,
        maxConcurrentRequests = 64,
        clock = () => Date.now(),
        loopbackOnly = true,
    } = {})
    {
        if (!Array.isArray(endpoints))
        {
            throw new TypeError("Webhook endpoints must be an array");
        }

        if (typeof route !== "string" || !/^\/[A-Za-z0-9/_-]+$/u.test(route)
            || route.endsWith("/"))
        {
            throw new TypeError("Webhook route must be an absolute path without a trailing slash");
        }

        if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1)
        {
            throw new TypeError("Webhook maxBodyBytes must be a positive integer");
        }

        if (!Number.isSafeInteger(maxConcurrentRequests) || maxConcurrentRequests < 1)
        {
            throw new TypeError(
                "Webhook maxConcurrentRequests must be a positive integer",
            );
        }

        if (typeof clock !== "function")
        {
            throw new TypeError("Webhook clock must be a function");
        }

        this.#endpoints = new Map();

        for (const endpoint of endpoints)
        {
            if (!endpoint || typeof endpoint.DescribeWebhook !== "function"
                || typeof endpoint.HandleWebhook !== "function")
            {
                throw new TypeError(
                    "Webhook endpoints require DescribeWebhook() and HandleWebhook()",
                );
            }

            const description = CjsWebhookHttpRouter.normalizeEndpointDescription(
                endpoint.DescribeWebhook(),
            );

            if (this.#endpoints.has(description.id))
            {
                throw new TypeError(`Webhook endpoint is already registered: ${description.id}`);
            }

            this.#endpoints.set(description.id, Object.freeze({ endpoint, description }));
        }

        this.#route = route;
        this.#maxBodyBytes = maxBodyBytes;
        this.#maxConcurrentRequests = maxConcurrentRequests;
        this.#clock = clock;
        this.#activeRequests = 0;
        this.loopbackOnly = loopbackOnly === true;
        Object.freeze(this);
    }

    /** Returns true when this router owns the configured webhook namespace. */
    CanHandle(request)
    {
        const pathname = CjsWebhookHttpRouter.rawPathname(request.url);

        return pathname === this.#route || pathname.startsWith(`${this.#route}/`);
    }

    /** Reads and dispatches one webhook request without decoding its raw body. */
    async Handle(request, response)
    {
        if (this.#activeRequests >= this.#maxConcurrentRequests)
        {
            CjsWebhookHttpRouter.writeJson(response, 429, {
                error: {
                    code: "request_limit_reached",
                    message: "Webhook request limit was reached",
                    retryable: true,
                },
            }, { "cache-control": "no-store" });

            return;
        }

        this.#activeRequests++;

        try
        {
            if (this.loopbackOnly && !CjsWebhookHttpRouter.isLoopback(
                request.socket?.remoteAddress,
            ))
            {
                throw new CjsWebhookError("forbidden", "Loopback connections only", {
                    statusCode: 403,
                });
            }

            const match = CjsWebhookHttpRouter.matchEndpoint(
                request.url,
                this.#route,
            );
            const record = match === null ? null : this.#endpoints.get(match.endpointId);

            if (!record)
            {
                throw new CjsWebhookError(
                    "not_found",
                    "Webhook endpoint was not found",
                    { statusCode: 404 },
                );
            }

            const method = String(request.method ?? "GET").toUpperCase();

            if (!record.description.methods.includes(method))
            {
                CjsWebhookHttpRouter.writeJson(response, 405, {
                    error: {
                        code: "method_not_allowed",
                        message: "Webhook request method is not allowed",
                        retryable: false,
                    },
                }, {
                    allow: record.description.methods.join(", "),
                    "cache-control": "no-store",
                });

                return;
            }

            const body = await CjsWebhookHttpRouter.readBody(request, this.#maxBodyBytes);
            const result = await record.endpoint.HandleWebhook(Object.freeze({
                endpointId: match.endpointId,
                method,
                requestTarget: String(request.url ?? "/"),
                pathname: match.pathname,
                search: match.search,
                headers: CjsWebhookHttpRouter.normalizeHeaders(request.headers),
                body,
                receivedAt: new Date(this.#clock()).toISOString(),
                remoteAddress: request.socket?.remoteAddress ?? null,
            }));

            CjsWebhookHttpRouter.writeResponse(response, result);
        }
        catch (failure)
        {
            const error = CjsWebhookError.from(failure);

            CjsWebhookHttpRouter.writeJson(response, error.statusCode, {
                error: {
                    code: error.code,
                    message: error.message,
                    retryable: error.retryable,
                },
            }, { "cache-control": "no-store" });
        }
        finally
        {
            this.#activeRequests--;
        }
    }

    /** Validates one structural webhook endpoint description. */
    static normalizeEndpointDescription(value)
    {
        if (!CjsRealtimeProtocol.isRecord(value))
        {
            throw new TypeError("Webhook endpoint description must be an object");
        }

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

    /** Matches one exact webhook endpoint while preserving the raw request target. */
    static matchEndpoint(requestTarget, route = WEBHOOK_ROUTE)
    {
        const rawPathname = CjsWebhookHttpRouter.rawPathname(requestTarget);
        const prefix = `${route}/`;

        if (!rawPathname.startsWith(prefix))
        {
            return null;
        }

        const encodedId = rawPathname.slice(prefix.length);

        if (!encodedId || encodedId.includes("/") || /%(?:2f|5c)/iu.test(encodedId))
        {
            return null;
        }

        let endpointId;

        try
        {
            endpointId = decodeURIComponent(encodedId);
        }
        catch
        {
            throw new CjsWebhookError("invalid_path", "Webhook endpoint path is invalid");
        }

        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(endpointId))
        {
            throw new CjsWebhookError("invalid_path", "Webhook endpoint path is invalid");
        }

        const url = new URL(String(requestTarget ?? "/"), "http://tools-core.local");

        return Object.freeze({
            endpointId,
            pathname: rawPathname,
            search: url.search,
        });
    }

    /** Reads one request body as exact bytes under the configured limit. */
    static async readBody(request, maxBodyBytes)
    {
        const contentLength = request.headers?.["content-length"];

        if (contentLength !== undefined)
        {
            if (typeof contentLength !== "string" || !/^\d+$/u.test(contentLength))
            {
                request.resume?.();
                throw new CjsWebhookError(
                    "invalid_content_length",
                    "Webhook Content-Length is invalid",
                );
            }

            if (Number(contentLength) > maxBodyBytes)
            {
                request.resume?.();
                throw new CjsWebhookError(
                    "body_too_large",
                    "Webhook body exceeds the byte limit",
                    { statusCode: 413 },
                );
            }
        }

        const chunks = [];
        let byteLength = 0;

        for await (const value of request)
        {
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);

            byteLength += chunk.byteLength;

            if (byteLength > maxBodyBytes)
            {
                request.resume?.();
                throw new CjsWebhookError(
                    "body_too_large",
                    "Webhook body exceeds the byte limit",
                    { statusCode: 413 },
                );
            }

            chunks.push(chunk);
        }

        return Buffer.concat(chunks, byteLength);
    }

    /** Copies Node request headers without changing values used by signatures. */
    static normalizeHeaders(value)
    {
        const headers = {};

        for (const [ name, entry ] of Object.entries(value ?? {}))
        {
            if (entry === undefined)
            {
                continue;
            }

            headers[name.toLowerCase()] = Array.isArray(entry)
                ? Object.freeze(entry.map(item => String(item)))
                : String(entry);
        }

        return Object.freeze(headers);
    }

    /** Writes one normalized provider acknowledgement. */
    static writeResponse(response, value)
    {
        const result = CjsWebhookHttpRouter.normalizeResponse(value);

        if (result.body === null)
        {
            CjsWebhookHttpRouter.writeEmpty(response, result.statusCode, {
                "cache-control": "no-store",
            });

            return;
        }

        let body;
        let contentType = result.contentType;

        if (result.body instanceof Uint8Array)
        {
            body = Buffer.from(result.body);
            contentType ??= "application/octet-stream";
        }
        else if (typeof result.body === "string")
        {
            body = Buffer.from(result.body);
            contentType ??= "text/plain; charset=utf-8";
        }
        else
        {
            body = Buffer.from(JSON.stringify(result.body));
            contentType ??= "application/json; charset=utf-8";
        }

        response.writeHead(result.statusCode, {
            "cache-control": "no-store",
            "content-type": contentType,
            "content-length": String(body.byteLength),
            "x-content-type-options": "nosniff",
        });
        response.end(body);
    }

    /** Validates one structural endpoint response before network output. */
    static normalizeResponse(value)
    {
        const result = value ?? { statusCode: 204, contentType: null, body: null };

        if (!CjsRealtimeProtocol.isRecord(result)
            || !Number.isSafeInteger(result.statusCode)
            || result.statusCode < 200 || result.statusCode > 299)
        {
            throw new CjsWebhookError(
                "invalid_response",
                "Webhook endpoint returned an invalid response",
                { statusCode: 500 },
            );
        }

        const contentType = result.contentType ?? null;

        if (contentType !== null && (typeof contentType !== "string"
            || contentType.length < 1 || contentType.length > 256
            || /[\r\n]/u.test(contentType)))
        {
            throw new CjsWebhookError(
                "invalid_response",
                "Webhook endpoint returned an invalid content type",
                { statusCode: 500 },
            );
        }

        const body = result.body ?? null;

        if (body !== null && typeof body !== "string" && !(body instanceof Uint8Array))
        {
            CjsRealtimeProtocol.validateJson(body);
        }

        return { statusCode: result.statusCode, contentType, body };
    }

    /** Extracts an origin-form path before URL dot-segment normalization. */
    static rawPathname(requestTarget)
    {
        const value = String(requestTarget ?? "/");
        const queryIndex = value.indexOf("?");
        const pathname = queryIndex === -1 ? value : value.slice(0, queryIndex);

        return pathname.startsWith("/") ? pathname : "/";
    }

    /** Writes one JSON response with stable security headers. */
    static writeJson(response, statusCode, value, headers = {})
    {
        if (response.headersSent)
        {
            response.destroy();

            return;
        }

        const body = Buffer.from(JSON.stringify(value));

        response.writeHead(statusCode, {
            ...headers,
            "content-type": "application/json; charset=utf-8",
            "content-length": String(body.byteLength),
            "x-content-type-options": "nosniff",
        });
        response.end(body);
    }

    /** Writes one empty HTTP response. */
    static writeEmpty(response, statusCode, headers = {})
    {
        response.writeHead(statusCode, {
            ...headers,
            "content-length": "0",
            "x-content-type-options": "nosniff",
        });
        response.end();
    }

    /** Returns true only for loopback peer addresses. */
    static isLoopback(address)
    {
        return [ "127.0.0.1", "::1", "::ffff:127.0.0.1" ].includes(address);
    }

}
