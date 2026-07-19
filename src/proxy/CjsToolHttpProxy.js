import crypto from "node:crypto";
import http from "node:http";

import { CjsToolBlack } from "../black/CjsToolBlack.js";
import { CjsIndexAnswerCatalog } from "../indexing/CjsIndexAnswerCatalog.js";
import * as utils from "../utils.js";

export const TOOLS_SERVICE_PROTOCOL = "carbon.tools";
export const TOOLS_SERVICE_PROTOCOL_VERSION = 1;

/** Minimal optional HTTP adapter over a CjsToolCore instance. */
export class CjsToolHttpProxy
{

    #answerCatalogs;

    /** Creates a versioned loopback adapter over optional resource and SOF services. */
    constructor({
        core = null,
        indexes = null,
        sde = null,
        token = null,
        maxRequestBytes = 1024 * 1024,
    } = {})
    {
        if (core !== null && typeof core.BuildSofDocumentAsync !== "function")
        {
            throw new TypeError("CjsToolHttpProxy requires a CjsToolCore-compatible facade");
        }

        if (indexes !== null && typeof indexes.Open !== "function")
        {
            throw new TypeError("CjsToolHttpProxy indexes must provide Open(options)");
        }

        if (sde !== null && typeof sde.OpenTarget !== "function")
        {
            throw new TypeError("CjsToolHttpProxy SDE service must provide OpenTarget(target, build)");
        }

        if (core === null && indexes === null && sde === null)
        {
            throw new TypeError("CjsToolHttpProxy requires a core, index, or SDE service");
        }

        if (token !== null && (typeof token !== "string" || token.length < 16))
        {
            throw new TypeError("CjsToolHttpProxy token must contain at least 16 characters");
        }

        if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1)
        {
            throw new TypeError("CjsToolHttpProxy maxRequestBytes must be a positive integer");
        }

        this.core = core;
        this.indexes = indexes;
        this.sde = sde;
        this.token = token;
        this.maxRequestBytes = maxRequestBytes;
        this.#answerCatalogs = new Map();
        this.capabilities = Object.freeze({
            resources: indexes !== null,
            sde: sde !== null,
            // Recommended boundary: plain model values from GetValues.
            sofValues: core !== null && typeof core.BuildSofValuesAsync === "function",
            // Compatibility/diagnostic boundary: explicit carbon.document graphs.
            sofDocument: core !== null,
        });
        Object.freeze(this);
    }

    /** Creates, but does not start, a Node HTTP server for this adapter. */
    CreateServer()
    {
        return http.createServer((request, response) =>
        {
            this.Handle(request, response).catch(error =>
            {
                WriteError(response, error);
            });
        });
    }

    /** Handles one health or SOF-document HTTP request. */
    async Handle(request, response)
    {
        const url = new URL(request.url || "/", "http://tools-core.local");

        if (!IsLoopback(request.socket?.remoteAddress))
        {
            WriteJson(response, 403, { error: "Loopback connections only" });

            return;
        }

        if (!IsAuthorized(request, this.token))
        {
            WriteJson(response, 401, { error: "Unauthorized" }, {
                "www-authenticate": "Bearer",
            });

            return;
        }

        if (request.method === "GET" && url.pathname === "/v1/health")
        {
            WriteJson(response, 200, {
                ok: true,
                service: "@carbonenginejs/tools-core",
                protocol: TOOLS_SERVICE_PROTOCOL,
                protocolVersion: TOOLS_SERVICE_PROTOCOL_VERSION,
                capabilities: this.capabilities,
            });

            return;
        }

        if (request.method === "GET" && url.pathname === "/targets")
        {
            if (!this.indexes || typeof this.indexes.ListTargets !== "function")
            {
                WriteJson(response, 501, { error: "Target service is not configured" });

                return;
            }

            WriteJson(response, 200, { targets: this.indexes.ListTargets() });

            return;
        }

        const buildRoute = MatchBuildRoute(url.pathname);

        if (request.method === "GET" && buildRoute)
        {
            if (!this.indexes || typeof this.indexes.ResolveBuild !== "function")
            {
                WriteJson(response, 501, { error: "Build service is not configured" });

                return;
            }

            const client = url.searchParams.get("client") ?? undefined;
            const build = await this.indexes.ResolveBuild({
                game: buildRoute.game,
                provider: buildRoute.provider,
                build: buildRoute.build,
                client,
            });

            WriteJson(response, 200, build);

            return;
        }

        const targetRoute = MatchTargetRoute(url.pathname);

        if (request.method === "GET" && targetRoute)
        {
            if (targetRoute.topic === "sof")
            {
                await this.#HandleSofIndexAnswerRoute(request, targetRoute, response);

                return;
            }

            if ([ "billboards", "cubes", "nebulas" ].includes(targetRoute.topic))
            {
                await this.#HandleIndexAnswerRoute(targetRoute, response);

                return;
            }

            if (targetRoute.topic === "sde")
            {
                await this.#HandleSdeRoute(targetRoute, url, response);

                return;
            }

            if (!this.indexes || typeof this.indexes.ResolveTargetBuild !== "function")
            {
                WriteJson(response, 501, { error: "Target service is not configured" });

                return;
            }

            if (targetRoute.topic === null || targetRoute.topic === "build")
            {
                const build = await this.indexes.ResolveTargetBuild(
                    targetRoute.target,
                    targetRoute.build,
                );

                WriteJson(response, 200, build);

                return;
            }

            if ([ "app", "res" ].includes(targetRoute.topic))
            {
                if (!targetRoute.path)
                {
                    const build = await this.indexes.ResolveTargetBuild(
                        targetRoute.target,
                        targetRoute.build,
                    );

                    WriteJson(response, 200, {
                        ...build,
                        topic: targetRoute.topic,
                        logicalRoot: `${targetRoute.topic}:/`,
                        resourcePathTemplate:
                            `/${targetRoute.target}/${build.build}/${targetRoute.topic}/{path}`,
                    });

                    return;
                }

                if (typeof this.indexes.OpenTarget !== "function")
                {
                    WriteJson(response, 501, { error: "Target resource service is not configured" });

                    return;
                }

                const source = await this.indexes.OpenTarget(
                    targetRoute.target,
                    targetRoute.build,
                );
                const file = await source.Fetch(`${targetRoute.topic}:/${targetRoute.path}`, {
                    indexName: url.searchParams.get("index") ?? undefined,
                    refresh: url.searchParams.get("refresh") === "true",
                });
                const headers = {
                    "x-carbon-target": targetRoute.target,
                    "x-carbon-game": file.resolution.game,
                    "x-carbon-provider": file.resolution.provider,
                    "x-carbon-build": file.resolution.build,
                    "x-carbon-logical-path": file.resolution.logicalPath,
                    ...(file.resolution.artifactKind ? {
                        "x-carbon-artifact-kind": file.resolution.artifactKind,
                    } : {}),
                    ...(file.resolution.overlay ? {
                        "x-carbon-overlay": file.resolution.overlay,
                        "x-carbon-storage-kind": file.resolution.storageKind,
                    } : {}),
                };
                const format = url.searchParams.get("format");

                if (format === "json")
                {
                    WriteJson(response, 200, ReadFormatJson(targetRoute.path, file.bytes), headers);

                    return;
                }

                if (format !== null)
                {
                    WriteJson(response, 400, { error: `Unsupported format: ${format}` });

                    return;
                }

                WriteBytes(response, 200, file.bytes, headers);

                return;
            }

            WriteJson(response, 501, {
                error: `Target topic is not configured: ${targetRoute.topic}`,
                target: targetRoute.target,
                build: targetRoute.build,
                topic: targetRoute.topic,
            });

            return;
        }

        if (request.method === "POST" && targetRoute?.topic === "sof")
        {
            await this.#HandleSofIndexAnswerRoute(request, targetRoute, response);

            return;
        }

        if (request.method === "POST" && url.pathname === "/v1/resources/resolve")
        {
            if (!this.indexes)
            {
                WriteJson(response, 501, { error: "Resource service is not configured" });

                return;
            }

            const body = RequireResourceRequest(await ReadJson(request, this.maxRequestBytes));
            const source = await this.indexes.Open(body.source);
            const resolution = source.Resolve(body.logicalPath, body.options);

            WriteJson(response, 200, resolution);

            return;
        }

        if (request.method === "POST" && url.pathname === "/v1/resources/fetch")
        {
            if (!this.indexes)
            {
                WriteJson(response, 501, { error: "Resource service is not configured" });

                return;
            }

            const body = RequireResourceRequest(await ReadJson(request, this.maxRequestBytes));
            const source = await this.indexes.Open(body.source);
            const file = await source.Fetch(body.logicalPath, body.options);

            WriteJson(response, 200, {
                resolution: file.resolution,
                byteLength: file.byteLength,
                cacheHit: file.cacheHit,
                cachePath: file.cachePath,
            });

            return;
        }

        if (request.method === "POST" && url.pathname === "/v1/sof/values")
        {
            if (!this.core || typeof this.core.BuildSofValuesAsync !== "function")
            {
                WriteJson(response, 501, { error: "SOF values service is not configured" });

                return;
            }

            const body = await ReadJson(request, this.maxRequestBytes);
            const values = body.selection
                ? await this.core.BuildTypeSofValuesAsync(body.selection, body.options)
                : await this.core.BuildSofValuesAsync(body.dna, body.options);

            WriteJson(response, 200, values);

            return;
        }

        // Compatibility/diagnostic path; prefer /v1/sof/values.
        if (request.method === "POST" && url.pathname === "/v1/sof/document")
        {
            if (!this.core)
            {
                WriteJson(response, 501, { error: "SOF service is not configured" });

                return;
            }

            const body = await ReadJson(request, this.maxRequestBytes);
            const document = body.selection
                ? await this.core.BuildTypeSofDocumentAsync(body.selection, body.options)
                : await this.core.BuildSofDocumentAsync(body.dna, body.options);

            WriteJson(response, 200, document);

            return;
        }

        WriteJson(response, 404, { error: "Not found" });
    }

    async #HandleIndexAnswerRoute(route, response)
    {
        if (route.path)
        {
            WriteJson(response, 404, { error: `${route.topic} route not found` });

            return;
        }

        const catalog = await this.#GetIndexAnswerCatalog(route.target, route.build);
        let items;

        switch (route.topic)
        {
            case "billboards":
                items = catalog.ListBillboards();
                break;

            case "cubes":
                items = catalog.ListCubes();
                break;

            case "nebulas":
                items = catalog.ListNebulas();
                break;

            default:
                throw new Error(`Unsupported index answer: ${route.topic}`);
        }

        WriteJson(response, 200, items, CreateAnswerHeaders(catalog, route.topic));
    }

    async #HandleSofIndexAnswerRoute(request, route, response)
    {
        const segments = String(route.path ?? "").split("/").filter(Boolean);

        if (request.method === "GET"
            && segments.length === 3
            && segments[0].toLowerCase() === "hulls"
            && segments[2].toLowerCase() === "respathinserts")
        {
            const hull = normalizeRouteSegment(segments[1]);
            const catalog = await this.#GetIndexAnswerCatalog(route.target, route.build);

            WriteJson(
                response,
                200,
                catalog.ListHullResPathInserts(hull),
                CreateAnswerHeaders(catalog, "respathinserts", { hull }),
            );

            return;
        }

        if (request.method === "POST"
            && segments.length === 5
            && segments[0].toLowerCase() === "hulls"
            && segments[2].toLowerCase() === "respathinserts"
            && segments[4].toLowerCase() === "resolve")
        {
            const hull = normalizeRouteSegment(segments[1]);
            const insert = normalizeRouteSegment(segments[3]);
            const body = await ReadJson(request, this.maxRequestBytes);
            const catalog = await this.#GetIndexAnswerCatalog(route.target, route.build);

            WriteJson(
                response,
                200,
                catalog.ResolveHullResPathInserts(hull, insert, body.paths),
                CreateAnswerHeaders(catalog, "respathinserts-resolve", { hull, insert }),
            );

            return;
        }

        WriteJson(response, 404, { error: "SOF index-answer route not found" });
    }

    async #GetIndexAnswerCatalog(target, build)
    {
        if (!this.indexes || typeof this.indexes.OpenTarget !== "function")
        {
            const error = new Error("Target resource service is not configured");

            error.statusCode = 501;
            throw error;
        }

        const source = await this.indexes.OpenTarget(target, build);
        const key = [
            source.target,
            source.game,
            source.provider,
            source.build,
        ].join("\0");
        let catalog = this.#answerCatalogs.get(key);

        if (!catalog)
        {
            catalog = new CjsIndexAnswerCatalog(source);
            this.#answerCatalogs.set(key, catalog);
        }

        return catalog;
    }

    async #HandleSdeRoute(route, url, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const source = await this.sde.OpenTarget(route.target, route.build);

        if (!route.path)
        {
            WriteJson(response, 200, await source.Describe());

            return;
        }

        const segments = route.path.split("/").filter(Boolean);

        if (!segments.length || segments.length > 2)
        {
            WriteJson(response, 404, { error: "SDE route not found" });

            return;
        }

        if (segments[0] === "resolve")
        {
            if (segments.length !== 1)
            {
                WriteJson(response, 404, { error: "SDE resolve route not found" });

                return;
            }

            const selection = Object.fromEntries([
                "name",
                "typeID",
                "graphicID",
                "skinID",
            ].map(name => [ name, url.searchParams.get(name) ]).filter(([, value ]) => value));

            if (!Object.keys(selection).length)
            {
                throw new TypeError(
                    "SDE resolve requires name, typeID, graphicID, or skinID",
                );
            }

            WriteJson(response, 200, {
                target: source.target,
                game: source.game,
                provider: source.provider,
                build: source.build,
                ...await source.Resolve(selection),
            });

            return;
        }

        const table = source.Table(segments[0]);
        const rowCount = await table.Count();

        if (rowCount === null)
        {
            WriteJson(response, 404, {
                error: `SDE table not found: ${segments[0]}`,
                target: route.target,
                build: source.build,
            });

            return;
        }

        if (segments.length === 2)
        {
            const record = await table.Get(segments[1]);

            if (!record)
            {
                WriteJson(response, 404, {
                    error: `SDE record not found: ${segments[0]}/${segments[1]}`,
                    target: route.target,
                    build: source.build,
                });

                return;
            }

            WriteJson(response, 200, {
                target: source.target,
                game: source.game,
                provider: source.provider,
                build: source.build,
                ...record,
            });

            return;
        }

        const options = {
            limit: url.searchParams.get("limit") ?? undefined,
            offset: url.searchParams.get("offset") ?? undefined,
        };
        const query = url.searchParams.get("query");
        const field = url.searchParams.get("field");
        const value = url.searchParams.get("value");
        const contains = url.searchParams.get("contains");

        if (query && field)
        {
            throw new TypeError("SDE table query and field filters cannot be combined");
        }

        if (field && (value === null) === (contains === null))
        {
            throw new TypeError(
                "SDE field filter requires exactly one value or contains parameter",
            );
        }

        if (!field && (value !== null || contains !== null))
        {
            throw new TypeError("SDE value and contains filters require a field parameter");
        }

        let items;

        if (query)
        {
            items = await table.Search(query, options);
        }
        else if (field)
        {
            items = await table.Find(field, value ?? contains, {
                ...options,
                contains: contains !== null,
            });
        }
        else
        {
            items = await table.List(options);
        }

        WriteJson(response, 200, {
            target: source.target,
            game: source.game,
            provider: source.provider,
            build: source.build,
            table: table.name,
            rowCount,
            limit: Number(options.limit ?? 100),
            offset: Number(options.offset ?? 0),
            ...(field ? {
                filter: {
                    field,
                    operator: contains === null ? "equals" : "contains",
                    value: value ?? contains,
                },
            } : {}),
            items,
        });
    }

}

function RequireResourceRequest(value)
{
    if (!value.source || typeof value.source !== "object" || Array.isArray(value.source))
    {
        throw new TypeError("Resource request source must be an object");
    }

    if (typeof value.logicalPath !== "string" || !value.logicalPath.trim())
    {
        throw new TypeError("Resource request logicalPath must be a non-empty string");
    }

    if (value.options !== undefined
        && (!value.options || typeof value.options !== "object" || Array.isArray(value.options)))
    {
        throw new TypeError("Resource request options must be an object");
    }

    const provider = String(value.source.provider ?? "").trim().toLowerCase();
    const build = utils.normalizeExactBuild(value.source.build, {
        message: "Resource request source.build must be an exact numeric build",
    });

    if (!provider)
    {
        throw new TypeError("Resource request source.provider is required");
    }

    return {
        source: {
            ...value.source,
            provider,
            build,
        },
        logicalPath: value.logicalPath,
        options: value.options ?? {},
    };
}

function MatchBuildRoute(pathname)
{
    const match = pathname.match(
        /^\/games\/([^/]+)\/providers\/([^/]+)\/builds\/([^/]+)$/iu,
    );

    if (!match)
    {
        return null;
    }

    try
    {
        return Object.freeze({
            game: decodeURIComponent(match[1]),
            provider: decodeURIComponent(match[2]),
            build: decodeURIComponent(match[3]),
        });
    }
    catch
    {
        throw new TypeError("Build route contains invalid URL encoding");
    }
}

function MatchTargetRoute(pathname)
{
    const match = pathname.match(
        /^\/([^/]+)\/([^/]+)(?:\/([^/]+)(?:\/(.*))?)?\/?$/u,
    );

    if (!match)
    {
        return null;
    }

    try
    {
        return Object.freeze({
            target: decodeURIComponent(match[1]).toLowerCase(),
            build: decodeURIComponent(match[2]).toLowerCase(),
            topic: match[3] ? decodeURIComponent(match[3]).toLowerCase() : null,
            path: match[4] ? decodeURIComponent(match[4]) : null,
        });
    }
    catch
    {
        throw new TypeError("Target route contains invalid URL encoding");
    }
}

function IsAuthorized(request, token)
{
    if (token === null)
    {
        return true;
    }

    const authorization = String(request.headers?.authorization ?? "");
    const prefix = "Bearer ";

    if (!authorization.startsWith(prefix))
    {
        return false;
    }

    const supplied = Buffer.from(authorization.slice(prefix.length), "utf8");
    const expected = Buffer.from(token, "utf8");

    return supplied.byteLength === expected.byteLength
        && crypto.timingSafeEqual(supplied, expected);
}

function IsLoopback(value)
{
    const address = String(value ?? "").toLowerCase();

    return address === "127.0.0.1"
        || address === "::1"
        || address === "::ffff:127.0.0.1";
}

function CreateAnswerHeaders(catalog, answer, values = {})
{
    return {
        "x-carbon-answer": answer,
        "x-carbon-target": catalog.target,
        "x-carbon-game": catalog.game,
        "x-carbon-provider": catalog.provider,
        "x-carbon-build": catalog.build,
        ...(catalog.client ? { "x-carbon-client": catalog.client } : {}),
        ...(values.hull ? { "x-carbon-sof-hull": values.hull } : {}),
        ...(values.insert ? { "x-carbon-respath-insert": values.insert } : {}),
    };
}

function ReadFormatJson(path, bytes)
{
    if (!CjsToolBlack.isBlackPath(path))
    {
        const error = new Error(`format=json is not supported for this resource: ${path}`);

        error.statusCode = 415;
        throw error;
    }

    return CjsToolBlack.readJson(bytes);
}

function normalizeRouteSegment(value)
{
    return String(value).trim().toLowerCase();
}

async function ReadJson(request, maxBytes)
{
    const chunks = [];
    let byteLength = 0;

    for await (const chunk of request)
    {
        byteLength += chunk.byteLength;

        if (byteLength > maxBytes)
        {
            const error = new Error("Request body is too large");

            error.statusCode = 413;
            throw error;
        }

        chunks.push(chunk);
    }

    try
    {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

        if (!value || typeof value !== "object" || Array.isArray(value))
        {
            throw new TypeError("JSON root must be an object");
        }

        return value;
    }
    catch (error)
    {
        if (error.statusCode)
        {
            throw error;
        }

        const wrapped = new Error(`Invalid JSON request: ${error.message}`);

        wrapped.statusCode = 400;
        throw wrapped;
    }
}

function WriteError(response, error)
{
    if (response.headersSent || response.writableEnded)
    {
        response.destroy(error);

        return;
    }

    const statusCode = Number.isInteger(error?.statusCode)
        ? error.statusCode
        : error instanceof TypeError
            ? 400
            : 500;

    WriteJson(response, statusCode, {
        error: statusCode === 500 ? "Internal tool error" : error.message
    });
}

function WriteJson(response, statusCode, value, headers = {})
{
    const body = `${JSON.stringify(value)}\n`;

    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
        ...headers,
    });
    response.end(body);
}

function WriteBytes(response, statusCode, value, headers = {})
{
    const body = Buffer.from(value);

    response.writeHead(statusCode, {
        "content-type": "application/octet-stream",
        "content-length": body.byteLength,
        "cache-control": "no-store",
        ...headers,
    });
    response.end(body);
}
