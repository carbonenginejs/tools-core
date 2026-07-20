import http from "node:http";

import { CjsToolBlack } from "../black/CjsToolBlack.js";
import { CjsIndexAnswerCatalog } from "../indexing/CjsIndexAnswerCatalog.js";
import { CjsToolSkin } from "../skin/CjsToolSkin.js";
import { CjsToolWeapon } from "../weapon/CjsToolWeapon.js";
import * as utils from "../utils.js";

export const TOOLS_SERVICE_PROTOCOL = "carbon.tools";
export const TOOLS_SERVICE_PROTOCOL_VERSION = 1;
const CORS_HEADERS = Object.freeze({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "access-control-allow-private-network": "true",
    "access-control-expose-headers": [
        "X-Carbon-Answer",
        "X-Carbon-Target",
        "X-Carbon-Game",
        "X-Carbon-Provider",
        "X-Carbon-Build",
        "X-Carbon-Client",
        "X-Carbon-Logical-Path",
        "X-Carbon-Artifact-Kind",
        "X-Carbon-Overlay",
        "X-Carbon-Storage-Kind",
        "X-Carbon-SOF-Hull",
        "X-Carbon-Respath-Insert",
        "ETag",
    ].join(", "),
});

/** Minimal optional HTTP adapter over a CjsToolCore instance. */
export class CjsToolHttpProxy
{

    #answerCatalogs;

    #targetSources;

    #skinLibraries;

    #weaponLibraries;

    /** Creates a versioned loopback adapter over optional resource and SOF services. */
    constructor({
        core = null,
        indexes = null,
        sde = null,
        characters = null,
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

        if (characters !== null && typeof characters.OpenTarget !== "function")
        {
            throw new TypeError("CjsToolHttpProxy character service must provide OpenTarget(target, build)");
        }

        if (core === null && indexes === null && sde === null && characters === null)
        {
            throw new TypeError(
                "CjsToolHttpProxy requires a core, index, SDE, or character service"
            );
        }

        if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1)
        {
            throw new TypeError("CjsToolHttpProxy maxRequestBytes must be a positive integer");
        }

        this.core = core;
        this.indexes = indexes;
        this.sde = sde;
        this.characters = characters;
        this.maxRequestBytes = maxRequestBytes;
        this.#answerCatalogs = new Map();
        this.#targetSources = new Map();
        this.#skinLibraries = new Map();
        this.#weaponLibraries = new Map();
        this.capabilities = Object.freeze({
            resources: indexes !== null,
            character: characters !== null,
            sde: sde !== null,
            skin: sde !== null,
            skinr: sde !== null,
            weapons: sde !== null,
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

    /** Handles one local tools-core HTTP request. */
    async Handle(request, response)
    {
        const url = new URL(request.url || "/", "http://tools-core.local");

        if (!IsLoopback(request.socket?.remoteAddress))
        {
            WriteJson(response, 403, { error: "Loopback connections only" });

            return;
        }

        if (request.method === "OPTIONS")
        {
            WriteEmpty(response, 204, {
                "access-control-max-age": "600",
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

        let targetRoute = MatchTargetRoute(url.pathname);

        if (request.method === "GET" && targetRoute)
        {
            if (targetRoute.topic === "resources")
            {
                const catalog = await this.#GetIndexAnswerCatalog(
                    targetRoute.target,
                    targetRoute.build,
                );
                const resource = catalog.DescribeResourcePath(targetRoute.path ?? "");

                if (resource.type === "directory")
                {
                    WriteJson(
                        response,
                        200,
                        resource,
                        CreateAnswerHeaders(catalog, "resource"),
                    );

                    return;
                }

                targetRoute = Object.freeze({ ...targetRoute, topic: "res" });
            }

            if (targetRoute.topic === "sof")
            {
                await this.#HandleSofIndexAnswerRoute(request, targetRoute, response);

                return;
            }

            if ([ "billboards", "cubes", "nebulas", "resfiles" ]
                .includes(targetRoute.topic))
            {
                await this.#HandleIndexAnswerRoute(targetRoute, response);

                return;
            }

            if (targetRoute.topic === "sde")
            {
                await this.#HandleSdeRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "character")
            {
                await this.#HandleCharacterRoute(targetRoute, url, response);

                return;
            }

            if ([ "skin", "skinr" ].includes(targetRoute.topic))
            {
                await this.#HandleSkinRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "weapons")
            {
                await this.#HandleWeaponRoute(targetRoute, url, response);

                return;
            }

            if (targetRoute.topic === "resource")
            {
                const catalog = await this.#GetIndexAnswerCatalog(
                    targetRoute.target,
                    targetRoute.build,
                );

                WriteJson(
                    response,
                    200,
                    catalog.DescribeResourcePath(targetRoute.path ?? ""),
                    CreateAnswerHeaders(catalog, "resource"),
                );

                return;
            }

            if (targetRoute.topic === "res"
                && String(targetRoute.path ?? "").toLowerCase() === "resfiles")
            {
                await this.#HandleIndexAnswerRoute({
                    ...targetRoute,
                    topic: "resfiles",
                    path: null,
                }, response);

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

                const source = await this.#OpenTargetSource(
                    targetRoute.target,
                    targetRoute.build,
                );
                const refresh = url.searchParams.get("refresh") === "true";
                const file = await source.Fetch(`${targetRoute.topic}:/${targetRoute.path}`, {
                    indexName: url.searchParams.get("index") ?? undefined,
                    refresh,
                });
                const format = url.searchParams.get("format");
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
                    ...(format === null
                        ? CreateResourceCacheHeaders(targetRoute.build, file.resolution, refresh)
                        : {}),
                };

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

                if (IsNotModified(request, headers.etag))
                {
                    WriteEmpty(response, 304, headers);

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

            case "resfiles":
                items = catalog.ListResFiles();
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

        const source = await this.#OpenTargetSource(target, build);
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

    async #OpenTargetSource(target, build)
    {
        if (!this.indexes || typeof this.indexes.OpenTarget !== "function")
        {
            const error = new Error("Target resource service is not configured");

            error.statusCode = 501;
            throw error;
        }

        const resolution = typeof this.indexes.ResolveTargetBuild === "function"
            ? await this.indexes.ResolveTargetBuild(target, build)
            : null;
        const exactBuild = resolution?.build ?? build;
        const key = [
            target,
            resolution?.game ?? "",
            resolution?.provider ?? "",
            exactBuild,
            resolution?.client ?? "",
        ].join("\0");
        let loading = this.#targetSources.get(key);

        if (!loading)
        {
            loading = Promise.resolve().then(() => this.indexes.OpenTarget(
                target,
                exactBuild,
                { client: resolution?.client ?? undefined },
            ));
            this.#targetSources.set(key, loading);
            RetainNewest(this.#targetSources, 4);
            loading.catch(() =>
            {
                if (this.#targetSources.get(key) === loading)
                {
                    this.#targetSources.delete(key);
                }
            });
        }
        else
        {
            this.#targetSources.delete(key);
            this.#targetSources.set(key, loading);
        }

        return loading;
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

    async #HandleSkinRoute(route, url, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const libraries = await this.#GetSkinLibraries(route.target, route.build);
        const library = libraries[route.topic];
        const segments = String(route.path ?? "").split("/").filter(Boolean);

        if (route.topic === "skin"
            && segments.length === 1
            && [ "lookup", "search" ].includes(segments[0].toLowerCase()))
        {
            const name = url.searchParams.get("name");

            if (!name)
            {
                throw new TypeError(`SKIN ${segments[0]} requires name`);
            }

            const candidates = segments[0].toLowerCase() === "lookup"
                ? LookupSkinName(library, name)
                : SearchSkinName(library, name);

            WriteJson(response, 200, candidates, CreateSkinHeaders(library, route.topic));

            return;
        }

        if (segments.length > 2)
        {
            WriteJson(response, 404, { error: `${route.topic} route not found` });

            return;
        }

        let value = library;

        for (const segment of segments)
        {
            if (!value
                || typeof value !== "object"
                || Array.isArray(value)
                || !Object.hasOwn(value, segment))
            {
                WriteJson(response, 404, {
                    error: `${route.topic} record not found: ${segments.join("/")}`,
                    target: route.target,
                    build: library.sourceBuild,
                });

                return;
            }

            value = value[segment];
        }

        WriteJson(response, 200, value, CreateSkinHeaders(library, route.topic));
    }

    async #HandleWeaponRoute(route, url, response)
    {
        if (!this.sde)
        {
            WriteJson(response, 501, { error: "SDE service is not configured" });

            return;
        }

        const library = await this.#GetWeaponLibrary(route.target, route.build);
        const headers = CreateWeaponHeaders(library);
        const segments = String(route.path ?? "").split("/").filter(Boolean);

        if (!segments.length)
        {
            WriteJson(response, 200, library, headers);

            return;
        }

        const kind = segments[0].toLowerCase();

        if ([ "lookup", "search" ].includes(kind))
        {
            if (segments.length !== 1)
            {
                WriteJson(response, 404, { error: `Weapons ${kind} route not found` }, headers);

                return;
            }

            const name = url.searchParams.get("name");

            if (!name) throw new TypeError(`Weapons ${kind} requires name`);

            const candidates = kind === "lookup"
                ? LookupWeaponName(library, name)
                : SearchWeaponName(library, name);

            WriteJson(response, 200, candidates, headers);

            return;
        }

        if (kind === "types")
        {
            const weapon = segments.length >= 2 ? library.types[segments[1]] : null;

            if (segments.length === 1)
            {
                WriteJson(response, 200, library.types, headers);

                return;
            }

            if (!weapon)
            {
                WriteJson(response, 404, {
                    error: `Weapon type not found: ${segments[1]}`,
                }, headers);

                return;
            }

            if (segments.length === 2)
            {
                WriteJson(response, 200, weapon, headers);

                return;
            }

            if (segments[2].toLowerCase() === "ammunition")
            {
                if (segments.length === 3)
                {
                    WriteJson(response, 200, weapon.ammunitionTypeIDs.map(
                        typeID => library.ammunition[typeID],
                    ), headers);

                    return;
                }

                const ammunitionTypeID = Number(segments[3]);

                if (segments.length === 4
                    && weapon.ammunitionTypeIDs.includes(ammunitionTypeID))
                {
                    WriteJson(response, 200, library.ammunition[ammunitionTypeID], headers);

                    return;
                }
            }

            WriteJson(response, 404, {
                error: `Weapon type route not found: ${segments.slice(1).join("/")}`,
            }, headers);

            return;
        }

        if (kind === "ammunition")
        {
            WriteWeaponMapRoute(
                response,
                headers,
                segments,
                library.ammunition,
                "Ammunition type",
            );

            return;
        }

        if (kind === "projectiles")
        {
            WriteWeaponMapRoute(
                response,
                headers,
                segments,
                library.projectiles,
                "Projectile graphic",
            );

            return;
        }

        if (kind === "groups")
        {
            WriteWeaponMapRoute(
                response,
                headers,
                segments,
                library.groups,
                "Weapon group",
            );

            return;
        }

        WriteJson(response, 404, { error: "Weapons route not found" }, headers);
    }

    async #HandleCharacterRoute(route, url, response)
    {
        if (!this.characters)
        {
            WriteJson(response, 501, { error: "Character service is not configured" });

            return;
        }

        const library = await this.characters.OpenTarget(route.target, route.build);
        const request = ParseCharacterRequest(route.path, url);
        const headers = CreateCharacterHeaders(library, route);

        if (!request.segments.length)
        {
            if (request.lod !== null)
            {
                throw new TypeError("Character LOD requires a type, name, or category lookup");
            }

            const document = typeof library.GetDocument === "function"
                ? library.GetDocument()
                : library.GetValues();

            WriteJson(response, 200, document, headers);

            return;
        }

        const kind = request.segments[0].toLowerCase();

        if ([ "lookup", "search" ].includes(kind))
        {
            if (request.segments.length !== 1)
            {
                WriteJson(response, 404, { error: `Character ${kind} route not found` }, headers);

                return;
            }

            if (request.lod !== null)
            {
                throw new TypeError(`Character ${kind} does not select a LOD`);
            }

            const name = url.searchParams.get("name");

            if (!name)
            {
                throw new TypeError(`Character ${kind} requires name`);
            }

            const candidates = kind === "lookup"
                ? library.LookupName(name)
                : library.SearchName(name);

            WriteJson(response, 200, candidates, headers);

            return;
        }

        if (kind === "resolve")
        {
            if (request.segments.length !== 1)
            {
                WriteJson(response, 404, { error: "Character resolve route not found" }, headers);

                return;
            }

            const name = url.searchParams.get("name");

            if (!name)
            {
                throw new TypeError("Character resolve requires name");
            }

            const identity = library.ResolveName(name);
            const part = library.GetPart(identity.partID);

            WriteJson(response, 200, CreateCharacterPartResponse(library, part, request.lod), headers);

            return;
        }

        if (kind === "types")
        {
            if (request.segments.length !== 2)
            {
                WriteJson(response, 404, { error: `Character ${kind} route not found` }, headers);

                return;
            }

            const part = library.ResolvePart({ typeID: request.segments[1] });

            if (!part)
            {
                WriteJson(response, 404, {
                    error: `Character type not found: ${request.segments[1]}`
                }, headers);

                return;
            }

            WriteJson(response, 200, CreateCharacterPartResponse(library, part, request.lod), headers);

            return;
        }

        if (kind === "parts")
        {
            if (request.segments.length < 2)
            {
                WriteJson(response, 404, { error: "Character parts route not found" }, headers);

                return;
            }

            const partID = request.segments.slice(1).join("/");
            const part = library.GetPart(partID);

            if (!part)
            {
                WriteJson(response, 404, {
                    error: `Character part not found: ${partID}`
                }, headers);

                return;
            }

            WriteJson(response, 200, CreateCharacterPartResponse(library, part, request.lod), headers);

            return;
        }

        const category = request.segments.join("/");
        const parts = library.GetPartsByCategory(category, { recursive: true });

        if (!parts.length)
        {
            WriteJson(response, 404, { error: `Character category not found: ${category}` }, headers);

            return;
        }

        WriteJson(response, 200, {
            category,
            ...(request.lod === null ? {} : { requestedLod: request.lod }),
            items: parts.map(part => CreateCharacterPartResponse(library, part, request.lod))
        }, headers);
    }

    async #GetSkinLibraries(target, build)
    {
        const source = await this.sde.OpenTarget(target, build);
        const key = [
            source.target,
            source.game,
            source.provider,
            source.build,
        ].join("\0");

        if (!this.#skinLibraries.has(key))
        {
            const loading = CjsToolSkin.buildAllFromSource(source).catch(error =>
            {
                this.#skinLibraries.delete(key);
                throw error;
            });

            this.#skinLibraries.set(key, loading);
        }

        return this.#skinLibraries.get(key);
    }

    async #GetWeaponLibrary(target, build)
    {
        const source = await this.sde.OpenTarget(target, build);
        const key = [
            source.target,
            source.game,
            source.provider,
            source.build,
        ].join("\0");

        if (!this.#weaponLibraries.has(key))
        {
            const loading = CjsToolWeapon.buildFromSource(source).catch(error =>
            {
                this.#weaponLibraries.delete(key);
                throw error;
            });

            this.#weaponLibraries.set(key, loading);
        }

        return this.#weaponLibraries.get(key);
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
        const requestedTarget = decodeURIComponent(match[1]).toLowerCase();
        const topic = match[3] ? decodeURIComponent(match[3]).toLowerCase() : null;

        return Object.freeze({
            target: requestedTarget === "ccp" ? "eve" : requestedTarget,
            build: decodeURIComponent(match[2]).toLowerCase(),
            topic,
            path: match[4] ? decodeURIComponent(match[4]) : null,
        });
    }
    catch
    {
        throw new TypeError("Target route contains invalid URL encoding");
    }
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

function CreateSkinHeaders(library, topic)
{
    return {
        "x-carbon-answer": topic,
        "x-carbon-target": library.sourceTarget,
        "x-carbon-game": library.sourceGame,
        "x-carbon-provider": library.sourceProvider,
        "x-carbon-build": library.sourceBuild,
    };
}

function CreateWeaponHeaders(library)
{
    return {
        "x-carbon-answer": "weapons",
        "x-carbon-target": library.sourceTarget,
        "x-carbon-game": library.sourceGame,
        "x-carbon-provider": library.sourceProvider,
        "x-carbon-build": library.sourceBuild,
    };
}

function WriteWeaponMapRoute(response, headers, segments, records, label)
{
    if (segments.length === 1)
    {
        WriteJson(response, 200, records, headers);

        return;
    }

    if (segments.length === 2 && Object.hasOwn(records, segments[1]))
    {
        WriteJson(response, 200, records[segments[1]], headers);

        return;
    }

    WriteJson(response, 404, {
        error: segments.length === 2
            ? `${label} not found: ${segments[1]}`
            : `${label} route not found`,
    }, headers);
}

function LookupWeaponName(library, name)
{
    return library.names?.[NormalizeSkinName(name)] ?? [];
}

function SearchWeaponName(library, name)
{
    const expected = NormalizeSkinSearchName(name);
    const candidates = new Map();

    for (const [ candidateName, values ] of Object.entries(library.names ?? {}))
    {
        if (NormalizeSkinSearchName(candidateName) !== expected) continue;

        for (const value of values)
        {
            candidates.set(`${value.kind}:${value.typeID}`, value);
        }
    }

    return [ ...candidates.values() ].sort((left, right) =>
        String(left.kind).localeCompare(String(right.kind), "en")
        || Number(left.typeID) - Number(right.typeID));
}

function LookupSkinName(library, name)
{
    return library.names?.[NormalizeSkinName(name)] ?? [];
}

function SearchSkinName(library, name)
{
    const expected = NormalizeSkinSearchName(name);
    const candidates = new Map();

    for (const [ candidateName, values ] of Object.entries(library.names ?? {}))
    {
        if (NormalizeSkinSearchName(candidateName) !== expected) continue;

        for (const value of values)
        {
            const key = `${value.kind}:${value.typeID}:${value.skinID ?? ""}`;

            candidates.set(key, value);
        }
    }

    return [ ...candidates.values() ].sort((left, right) =>
        String(left.kind).localeCompare(String(right.kind), "en")
        || Number(left.typeID) - Number(right.typeID)
        || Number(left.skinID ?? -1) - Number(right.skinID ?? -1));
}

function NormalizeSkinName(value)
{
    const name = String(value ?? "").trim();

    if (!name)
    {
        throw new TypeError("SKIN name must be non-empty");
    }

    return name.toLocaleLowerCase("en-US");
}

function NormalizeSkinSearchName(value)
{
    return NormalizeSkinName(value)
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .replace(/\s+/gu, " ");
}

function CreateCharacterHeaders(library, route)
{
    const data = typeof library.GetSourceIdentity === "function"
        ? library.GetSourceIdentity()
        : library.GetValues();

    return {
        "x-carbon-answer": "character",
        "x-carbon-target": data.sourceTarget || route.target,
        "x-carbon-game": data.sourceGame || "",
        "x-carbon-provider": data.sourceProvider || "",
        "x-carbon-build": data.sourceBuild || route.build,
    };
}

function CreateCharacterPartResponse(library, part, lod)
{
    return {
        ...part,
        ...(lod === null ? {} : {
            lodBundle: library.ResolvePartLodBundle(part.id, lod)
        })
    };
}

function ParseCharacterRequest(path, url)
{
    const segments = String(path ?? "").split("/").filter(Boolean);
    let pathLod = null;

    if (segments[0]?.toLowerCase() === "lod")
    {
        if (segments.length < 2)
        {
            throw new TypeError("Character LOD route requires a level");
        }

        pathLod = ParseCharacterLod(segments[1]);
        segments.splice(0, 2);
    }

    const queryLod = url.searchParams.has("lod")
        ? ParseCharacterLod(url.searchParams.get("lod"))
        : null;

    if (pathLod !== null && queryLod !== null && pathLod !== queryLod)
    {
        throw new TypeError("Character path and query LOD values disagree");
    }

    return {
        segments,
        lod: pathLod ?? queryLod
    };
}

function ParseCharacterLod(value)
{
    const text = String(value ?? "");

    if (!/^\d+$/u.test(text))
    {
        throw new TypeError(`Character LOD must be a non-negative integer, received ${value}`);
    }

    const lod = Number(text);

    if (!Number.isSafeInteger(lod))
    {
        throw new TypeError(`Character LOD is outside the supported integer range: ${value}`);
    }

    return lod;
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

function RetainNewest(cache, limit)
{
    while (cache.size > limit)
    {
        cache.delete(cache.keys().next().value);
    }
}

function CreateResourceCacheHeaders(build, resolution, refresh)
{
    if (refresh)
    {
        return { "cache-control": "no-store" };
    }

    const checksum = resolution?.record?.checksum ?? resolution?.record?.md5 ?? null;

    return {
        "cache-control": utils.isExactBuild(build)
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300, must-revalidate",
        ...(checksum ? { etag: `"${checksum}"` } : {}),
    };
}

function IsNotModified(request, etag)
{
    if (!etag)
    {
        return false;
    }

    const candidates = String(request.headers?.["if-none-match"] ?? "")
        .split(",")
        .map(value => value.trim().replace(/^W\//u, ""));

    return candidates.includes("*") || candidates.includes(etag);
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
        ...CORS_HEADERS,
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
        ...CORS_HEADERS,
        "content-type": "application/octet-stream",
        "content-length": body.byteLength,
        "cache-control": "no-store",
        ...headers,
    });
    response.end(body);
}

function WriteEmpty(response, statusCode, headers = {})
{
    response.writeHead(statusCode, {
        ...CORS_HEADERS,
        "content-length": 0,
        "cache-control": "no-store",
        ...headers,
    });
    response.end();
}
