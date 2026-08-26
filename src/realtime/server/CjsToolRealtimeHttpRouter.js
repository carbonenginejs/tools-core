import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { CjsToolRealtimeError } from "../CjsToolRealtimeError.js";
import { CjsToolRealtimeProtocol, REALTIME_ROUTE } from "../CjsToolRealtimeProtocol.js";
import { CjsToolRealtimeSessionAuthority } from "./CjsToolRealtimeSessionAuthority.js";

/** Authenticated HTTP discovery, snapshots, and service-owned content. */
export class CjsToolRealtimeHttpRouter
{

    #allowedOrigins;

    #hub;

    /**
     * Binds discovery, snapshots, and content reads to explicit origins and
     * optional loopback policy.
     */
    constructor({ hub, allowedOrigins = [], loopbackOnly = true } = {})
    {
        if (!hub || typeof hub.Discover !== "function")
        {
            throw new TypeError("CjsToolRealtimeHttpRouter requires a realtime hub");
        }

        if (!Array.isArray(allowedOrigins))
        {
            throw new TypeError("Realtime HTTP allowedOrigins must be an array");
        }

        this.#hub = hub;
        this.#allowedOrigins = Object.freeze(allowedOrigins.map(origin =>
            CjsToolRealtimeSessionAuthority.normalizeOrigin(origin)));
        this.loopbackOnly = loopbackOnly === true;
        Object.freeze(this);
    }

    /** Returns true when this router owns the request namespace. */
    CanHandle(request)
    {
        const pathname = CjsToolRealtimeHttpRouter.rawPathname(request.url);

        return pathname === REALTIME_ROUTE || pathname.startsWith(`${REALTIME_ROUTE}/`);
    }

    /** Handles one authenticated realtime HTTP request. */
    async Handle(request, response)
    {
        const origin = request.headers.origin ?? null;

        try
        {
            if (this.loopbackOnly && !CjsToolRealtimeHttpRouter.isLoopback(
                request.socket?.remoteAddress,
            ))
            {
                throw new CjsToolRealtimeError("forbidden", "Loopback connections only", {
                    statusCode: 403,
                });
            }

            if (origin !== null && !this.#IsAllowedOrigin(origin))
            {
                throw new CjsToolRealtimeError("forbidden", "Realtime origin is not allowed", {
                    statusCode: 403,
                });
            }

            if (request.method === "OPTIONS")
            {
                if (origin === null)
                {
                    throw new CjsToolRealtimeError("forbidden", "Realtime preflight requires Origin", {
                        statusCode: 403,
                    });
                }

                CjsToolRealtimeHttpRouter.writeEmpty(response, 204, {
                    ...this.#CorsHeaders(origin),
                    "access-control-max-age": "600",
                });

                return;
            }

            const capability = CjsToolRealtimeHttpRouter.parseBearer(
                request.headers.authorization,
            );
            const session = this.#hub.Authenticate(capability, { origin });
            const url = new URL(request.url || "/", "http://tools-core.local");

            if (request.method === "GET" && url.pathname === REALTIME_ROUTE
                && url.search === "")
            {
                CjsToolRealtimeHttpRouter.writeJson(
                    response,
                    200,
                    this.#hub.Discover(session),
                    { ...this.#CorsHeaders(origin), "cache-control": "no-store" },
                );

                return;
            }

            const snapshot = CjsToolRealtimeHttpRouter.matchSnapshot(url, request.url);

            if (request.method === "GET" && snapshot)
            {
                const value = await this.#hub.GetSnapshot(session, snapshot.serviceId);

                CjsToolRealtimeHttpRouter.writeJson(
                    response,
                    200,
                    value,
                    { ...this.#CorsHeaders(origin), "cache-control": "no-store" },
                );

                return;
            }

            const content = CjsToolRealtimeHttpRouter.matchContent(url, request.url);

            if ([ "GET", "HEAD" ].includes(request.method) && content)
            {
                const resource = await this.#hub.OpenResource(
                    session,
                    content.serviceId,
                    content.path,
                    {
                        method: request.method,
                        revision: content.revision,
                    },
                );

                if (!CjsToolRealtimeProtocol.isRecord(resource)
                    || resource.revision !== content.revision)
                {
                    throw new CjsToolRealtimeError(
                        "revision_mismatch",
                        "Realtime resource revision does not match",
                        { statusCode: 409, retryable: true },
                    );
                }

                await CjsToolRealtimeHttpRouter.writeResource(response, request, resource, {
                    ...this.#CorsHeaders(origin),
                    "cache-control": "private, no-cache",
                });

                return;
            }

            throw new CjsToolRealtimeError("not_found", "Realtime HTTP route was not found", {
                statusCode: 404,
            });
        }
        catch (failure)
        {
            const error = CjsToolRealtimeError.from(failure);

            CjsToolRealtimeHttpRouter.writeJson(response, error.statusCode, {
                error: {
                    code: error.code,
                    message: error.message,
                    retryable: error.retryable,
                },
            }, {
                ...(origin !== null && this.#IsAllowedOrigin(origin)
                    ? this.#CorsHeaders(origin)
                    : {}),
                ...(error.statusCode === 401
                    ? { "www-authenticate": "Bearer realm=\"carbon-tools-realtime\"" }
                    : {}),
                "cache-control": "no-store",
            });
        }
    }

    /**
     * Normalizes a candidate browser origin and tests exact membership in the
     * allowlist.
     */
    #IsAllowedOrigin(origin)
    {
        try
        {
            return this.#allowedOrigins.includes(
                CjsToolRealtimeSessionAuthority.normalizeOrigin(origin),
            );
        }
        catch
        {
            return false;
        }
    }

    /** Creates the private-network CORS response headers for one accepted origin. */
    #CorsHeaders(origin)
    {
        if (origin === null)
        {
            return {};
        }

        return {
            "access-control-allow-origin": origin,
            "access-control-allow-methods": "GET, HEAD, OPTIONS",
            "access-control-allow-headers": "Authorization, If-None-Match",
            "access-control-allow-private-network": "true",
            "access-control-expose-headers": "Content-Length, Content-Type, ETag, Last-Modified",
            "vary": "Origin",
        };
    }

    /** Extracts one bearer capability without reflecting it in an error. */
    static parseBearer(value)
    {
        const match = typeof value === "string" ? value.match(/^Bearer ([^\s]+)$/u) : null;

        if (!match)
        {
            throw CjsToolRealtimeSessionAuthority.unauthorized();
        }

        return match[1];
    }

    /** Matches one exact service snapshot route. */
    static matchSnapshot(url, requestTarget = url.pathname)
    {
        if (url.search !== "")
        {
            return null;
        }

        const match = CjsToolRealtimeHttpRouter.rawPathname(requestTarget)
            .match(/^\/v1\/realtime\/services\/([^/]+)\/snapshot$/u);

        if (!match)
        {
            return null;
        }

        const serviceId = CjsToolRealtimeHttpRouter.decodeComponent(match[1], "service ID");

        CjsToolRealtimeProtocol.assertServiceId(serviceId);

        return Object.freeze({ serviceId });
    }

    /** Matches one exact revisioned service-content route. */
    static matchContent(url, requestTarget = url.pathname)
    {
        const match = CjsToolRealtimeHttpRouter.rawPathname(requestTarget)
            .match(/^\/v1\/realtime\/services\/([^/]+)\/content\/(.+)$/u);

        if (!match || [ ...url.searchParams.keys() ].some(key => key !== "revision"))
        {
            return null;
        }

        const revisions = url.searchParams.getAll("revision");
        const revision = revisions.length === 1 ? revisions[0] : null;

        if (revision === null || revision.length === 0 || revision.length > 256)
        {
            throw new CjsToolRealtimeError(
                "revision_required",
                "Realtime content requires an opaque revision",
            );
        }

        const serviceId = CjsToolRealtimeHttpRouter.decodeComponent(match[1], "service ID");

        CjsToolRealtimeProtocol.assertServiceId(serviceId);
        const segments = match[2].split("/").map(segment =>
        {
            if (/%(?:2f|5c)/iu.test(segment))
            {
                throw new CjsToolRealtimeError("invalid_path", "Encoded path separators are not allowed");
            }

            const decoded = CjsToolRealtimeHttpRouter.decodeComponent(segment, "content path");

            if (!decoded || [ ".", ".." ].includes(decoded)
                || decoded.includes("\\") || decoded.includes(":")
                || decoded.includes("\0"))
            {
                throw new CjsToolRealtimeError("invalid_path", "Realtime content path is invalid");
            }

            return decoded;
        });

        return Object.freeze({
            serviceId,
            path: segments.join("/"),
            revision,
        });
    }

    /** Writes one source-owned resource without exposing physical paths. */
    static async writeResource(response, request, resource, headers = {})
    {
        if (!CjsToolRealtimeProtocol.isRecord(resource)
            || (request.method !== "HEAD" && resource.body === undefined))
        {
            throw new CjsToolRealtimeError("resource_not_found", "Realtime resource was not found", {
                statusCode: 404,
            });
        }

        const resultHeaders = {
            ...headers,
            "content-type": resource.contentType ?? "application/octet-stream",
        };

        if (resource.etag)
        {
            resultHeaders.etag = resource.etag;

            if (request.headers["if-none-match"] === resource.etag)
            {
                resource.body?.destroy?.();
                CjsToolRealtimeHttpRouter.writeEmpty(response, 304, resultHeaders);

                return;
            }
        }

        if (resource.lastModified)
        {
            resultHeaders["last-modified"] = new Date(resource.lastModified).toUTCString();
        }

        if (resource.contentLength !== undefined)
        {
            resultHeaders["content-length"] = String(resource.contentLength);
        }

        response.writeHead(200, resultHeaders);

        if (request.method === "HEAD")
        {
            resource.body?.destroy?.();
            response.end();

            return;
        }

        if (resource.body instanceof Readable)
        {
            await pipeline(resource.body, response);

            return;
        }

        response.end(resource.body);
    }

    /** Decodes one URL component exactly once with a stable client error. */
    static decodeComponent(value, label)
    {
        try
        {
            return decodeURIComponent(value);
        }
        catch
        {
            throw new CjsToolRealtimeError("invalid_path", `Invalid realtime ${label}`);
        }
    }

    /** Extracts an origin-form raw path before WHATWG dot-segment normalization. */
    static rawPathname(requestTarget)
    {
        const value = String(requestTarget ?? "/");
        const queryIndex = value.indexOf("?");
        const pathname = queryIndex === -1 ? value : value.slice(0, queryIndex);

        return pathname.startsWith("/") ? pathname : "/";
    }

    /** Writes one JSON response. */
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
        });
        response.end(body);
    }

    /** Writes one empty HTTP response. */
    static writeEmpty(response, statusCode, headers = {})
    {
        response.writeHead(statusCode, { ...headers, "content-length": "0" });
        response.end();
    }

    /** Returns true only for loopback peer addresses. */
    static isLoopback(address)
    {
        return [ "127.0.0.1", "::1", "::ffff:127.0.0.1" ].includes(address);
    }

}
