import {
    CJS_INDEX_EXTERNAL_RESOLUTION,
    CjsIndexSource,
} from "./CjsIndexSource.js";
import { normalizeLogicalPath } from "./CjsIndexEntry.js";
import { CjsIndexOverlay } from "./CjsIndexOverlayStore.js";
import * as utils from "../utils.js";

/** Composes persistent target overlays around one official immutable index source. */
export class CjsIndexOverlaySource
{

    #overlaysByName;

    #source;

    constructor({ source, overlays })
    {
        if (!(source instanceof CjsIndexSource))
        {
            throw new TypeError("CjsIndexOverlaySource requires a CjsIndexSource");
        }

        if (!Array.isArray(overlays) || overlays.some(
            (overlay) => !(overlay instanceof CjsIndexOverlay),
        ))
        {
            throw new TypeError("CjsIndexOverlaySource overlays must be CjsIndexOverlay values");
        }

        const officialNames = new Set(source.indexes.availableIndexes);
        const overlayNames = new Set();

        for (const overlay of overlays)
        {
            if (officialNames.has(overlay.name))
            {
                throw new Error(`Overlay name conflicts with an official index: ${overlay.name}`);
            }

            if (overlayNames.has(overlay.name))
            {
                throw new Error(`Duplicate overlay name: ${overlay.name}`);
            }

            overlayNames.add(overlay.name);
        }

        this.#source = source;
        this.#overlaysByName = new Map(overlays.map((overlay) => [ overlay.name, overlay ]));
        this.indexes = source.indexes;
        this.target = source.target;
        this.game = source.game;
        this.provider = source.provider;
        this.buildRef = source.buildRef;
        this.build = source.build;
        this.client = source.client;
        this.app = source.app;
        this.res = source.res;
        this.cacheDirectory = source.cacheDirectory;
        this.overlays = Object.freeze([ ...overlays ]);
        this.availableIndexes = Object.freeze([
            ...source.indexes.availableIndexes,
            ...this.#overlaysByName.keys(),
        ]);
        Object.freeze(this);
    }

    /** Resolves override overlays, the official graph, then fallback overlays. */
    Resolve(logicalPath, options = {})
    {
        const normalizedPath = normalizeLogicalPath(logicalPath, options.root ?? "res");
        const indexName = normalizeOptionalIndexName(options.indexName);

        if (!normalizedPath.startsWith("res:/"))
        {
            return this.#source.Resolve(normalizedPath, options);
        }

        if (indexName && indexName !== "all")
        {
            const overlay = this.#overlaysByName.get(indexName);

            if (overlay)
            {
                const resolution = overlay.Resolve(normalizedPath);

                if (!resolution)
                {
                    throw createMissingError(normalizedPath, overlay.name);
                }

                return resolution;
            }

            return this.#source.Resolve(normalizedPath, options);
        }

        const override = this.#ResolveOverlay(normalizedPath, "override");

        if (override)
        {
            return override;
        }

        let sourceError;

        try
        {
            return this.#source.Resolve(normalizedPath, options);
        }
        catch (error)
        {
            if (error?.code !== "CJS_RESOURCE_NOT_FOUND")
            {
                throw error;
            }

            sourceError = error;
        }

        const fallback = this.#ResolveOverlay(normalizedPath, "fallback");

        if (fallback)
        {
            return fallback;
        }

        throw sourceError;
    }

    /** Matches the composed resource view without duplicating shadowed paths. */
    Match(pattern, options = {})
    {
        const root = String(options.root ?? "res").trim().toLowerCase();
        const indexName = normalizeOptionalIndexName(options.indexName);

        if (root === "app")
        {
            return this.#source.Match(pattern, options);
        }

        if (![ "all", "res" ].includes(root))
        {
            return this.#source.Match(pattern, options);
        }

        if (indexName && indexName !== "all")
        {
            const overlay = this.#overlaysByName.get(indexName);

            return overlay ? overlay.Match(pattern, options) : this.#source.Match(pattern, options);
        }

        const sourceResults = this.#source.Match(pattern, options);
        const overrideResults = this.#MatchOverlays(pattern, "override", options);
        const fallbackResults = this.#MatchOverlays(pattern, "fallback", options);
        const overridePaths = new Set(overrideResults.map((item) => item.logicalPath));
        const sourcePaths = new Set(sourceResults.map((item) => item.logicalPath));
        const results = [ ...overrideResults ];

        results.push(...sourceResults.filter((item) => !overridePaths.has(item.logicalPath)));
        results.push(...fallbackResults.filter((item) =>
            !overridePaths.has(item.logicalPath) && !sourcePaths.has(item.logicalPath)));

        return Object.freeze(results.sort((left, right) =>
            left.logicalPath.localeCompare(right.logicalPath)));
    }

    /** Fetches one composed resource, reading overlays from persistent storage. */
    async Fetch(logicalPath, options = {})
    {
        const resolution = this.Resolve(logicalPath, options);

        return this.#FetchResolution(resolution, options);
    }

    /** Reads one composed resource as an ArrayBuffer. */
    async Read(logicalPath, options = {})
    {
        return (await this.Fetch(logicalPath, options)).bytes;
    }

    /** Fetches every composed wildcard or regular-expression match. */
    async FetchMatching(pattern, options = {})
    {
        const matches = this.Match(pattern, options);
        const concurrency = normalizeConcurrency(options.concurrency ?? 4);
        const results = new Array(matches.length);
        const paths = new Set();

        for (const match of matches)
        {
            if (paths.has(match.logicalPath))
            {
                throw new Error(
                    `Matched path has conflicting declarations; select an index: `
                    + match.logicalPath,
                );
            }

            paths.add(match.logicalPath);
        }

        let cursor = 0;
        const workers = Array.from(
            { length: Math.min(concurrency, matches.length) },
            async () =>
            {
                while (cursor < matches.length)
                {
                    const index = cursor++;

                    results[index] = await this.#FetchResolution(matches[index], options);
                }
            },
        );

        await Promise.all(workers);

        return Object.freeze(results);
    }

    async #FetchResolution(resolution, options)
    {
        if (!resolution.overlay)
        {
            return this.#source.Fetch(resolution.logicalPath, {
                ...options,
                indexName: resolution.indexName,
            });
        }

        const overlay = this.#overlaysByName.get(resolution.overlay);

        if (overlay.storageKind === "remote-overlay")
        {
            return this.#source.FetchResolution(
                resolution,
                options,
                CJS_INDEX_EXTERNAL_RESOLUTION,
            );
        }

        const payload = await overlay.Read(resolution.record);

        return Object.freeze({
            resolution,
            bytes: utils.toArrayBuffer(payload.bytes),
            byteLength: payload.bytes.byteLength,
            cacheHit: true,
            cachePath: null,
            persistentPath: payload.payloadPath,
        });
    }

    #ResolveOverlay(logicalPath, mode)
    {
        // Later overlays clobber earlier records of the same logical path:
        // the last defined overlay declaring the path owns the record.
        const matches = this.overlays
            .filter((overlay) => overlay.mode === mode)
            .map((overlay) => overlay.Resolve(logicalPath))
            .filter(Boolean);

        return matches.length ? matches[matches.length - 1] : null;
    }

    #MatchOverlays(pattern, mode, options)
    {
        const resultsByPath = new Map();

        for (const overlay of this.overlays.filter((item) => item.mode === mode))
        {
            for (const resolution of overlay.Match(pattern, options))
            {
                // Later overlays clobber earlier records of the same path.
                resultsByPath.set(resolution.logicalPath, resolution);
            }
        }

        return [ ...resultsByPath.values() ];
    }

}

function normalizeOptionalIndexName(value)
{
    if (value === undefined || value === null || value === "")
    {
        return null;
    }

    const name = String(value).trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name))
    {
        throw new Error(`Invalid resource index name: ${value}`);
    }

    return name;
}

function normalizeConcurrency(value)
{
    const result = Number(value);

    if (!Number.isSafeInteger(result) || result < 1 || result > 64)
    {
        throw new Error(`Invalid concurrency: ${value}`);
    }

    return result;
}

function createMissingError(logicalPath, overlay)
{
    const error = new Error(`Resource file not found in overlay ${overlay}: ${logicalPath}`);

    error.code = "CJS_RESOURCE_NOT_FOUND";
    error.statusCode = 404;

    return error;
}
