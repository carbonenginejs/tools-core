import { CjsIndexCache } from "./CjsIndexCache.js";
import { CjsIndex } from "./CjsIndex.js";
import { CjsBoundedFetch } from "../internal/CjsBoundedFetch.js";
import * as utils from "../utils.js";

/** Internal capability used by the composed overlay source. */
export const CJS_INDEX_EXTERNAL_RESOLUTION = Symbol("CjsIndexExternalResolution");

/**
 * Cached, read-only remote payload source opened from one complete index graph.
 */
export class CjsIndexSource
{

    #fetch;

    #cache;

    #inflight;

    #maxPayloadBytes;

    #requestTimeoutMs;

    /**
     * Opens cached payload reads over one immutable provider/build index.
     */
    constructor({
        indexes,
        fetch = globalThis.fetch,
        cache = null,
        requestTimeoutMs = 30000,
        maxPayloadBytes = 256 * 1024 * 1024,
    })
    {
        if (!(indexes instanceof CjsIndex))
        {
            throw new TypeError("CjsIndexSource requires a CjsIndex");
        }

        if (typeof fetch !== "function")
        {
            throw new TypeError("CjsIndexSource requires fetch");
        }

        if (cache !== null && !(cache instanceof CjsIndexCache))
        {
            throw new TypeError("CjsIndexSource cache must be a CjsIndexCache or null");
        }

        CjsBoundedFetch.normalizeLimit(requestTimeoutMs, "requestTimeoutMs");
        CjsBoundedFetch.normalizeLimit(maxPayloadBytes, "maxPayloadBytes");

        this.indexes = indexes;
        this.target = indexes.target;
        this.game = indexes.game;
        this.provider = indexes.provider;
        this.buildRef = indexes.buildRef;
        this.build = indexes.build;
        this.client = indexes.client;
        this.app = indexes.app;
        this.res = indexes.res;
        this.cacheDirectory = cache?.directory ?? null;
        this.#fetch = fetch;
        this.#cache = cache;
        this.#inflight = new Map();
        this.#requestTimeoutMs = requestTimeoutMs;
        this.#maxPayloadBytes = maxPayloadBytes;

        Object.freeze(this);
    }

    /**
     * Resolves one exact logical path without downloading it.
     */
    Resolve(logicalPath, options = {})
    {
        return this.indexes.Resolve(logicalPath, options);
    }

    /**
     * Matches logical paths without downloading them.
     */
    Match(pattern, options = {})
    {
        return this.indexes.Match(pattern, options);
    }

    /**
     * Fetches one exact file, reusing validated cached bytes when available.
     */
    async Fetch(logicalPath, options = {})
    {
        const resolution = this.Resolve(logicalPath, options);

        return this.FetchResolution(resolution, options);
    }

    /** Fetches one already-resolved immutable resource declaration. */
    async FetchResolution(resolution, options = {}, capability = null)
    {
        if (!resolution?.record || !resolution?.logicalPath || !resolution?.sourceUrl)
        {
            throw new TypeError("Resolved resource declaration is required");
        }

        if (capability !== CJS_INDEX_EXTERNAL_RESOLUTION
            && !this.#OwnsResolution(resolution))
        {
            throw new TypeError("Resolved resource declaration does not belong to this source");
        }

        return this.#FetchResolution(resolution, options);
    }

    /**
     * Reads one exact file as an ArrayBuffer.
     */
    async Read(logicalPath, options = {})
    {
        return (await this.Fetch(logicalPath, options)).bytes;
    }

    /**
     * Fetches every wildcard/regex match with bounded concurrency.
     */
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
                    `Matched path has conflicting declarations; select an index: ${match.logicalPath}`,
                );
            }

            paths.add(match.logicalPath);
        }

        let cursor = 0;
        const workers = Array.from({ length: Math.min(concurrency, matches.length) }, async () =>
        {
            while (cursor < matches.length)
            {
                const index = cursor++;

                results[index] = await this.#FetchResolution(matches[index], options);
            }
        });

        await Promise.all(workers);

        return Object.freeze(results);
    }

    async #FetchResolution(resolution, options)
    {
        const key = CreateInflightKey(resolution, options);
        let promise = this.#inflight.get(key);

        if (!promise)
        {
            promise = this.#ReadOrFetchPayload(resolution, options);
            this.#inflight.set(key, promise);
        }

        try
        {
            const payload = await promise;

            return Object.freeze({
                resolution,
                bytes: utils.toArrayBuffer(payload.bytes),
                byteLength: payload.bytes.byteLength,
                cacheHit: payload.cacheHit,
                cachePath: payload.cachePath,
            });
        }
        finally
        {
            if (this.#inflight.get(key) === promise)
            {
                this.#inflight.delete(key);
            }
        }
    }

    #OwnsResolution(resolution)
    {
        let owned;

        try
        {
            owned = this.Resolve(resolution.logicalPath, {
                indexName: resolution.indexName,
            });
        }
        catch
        {
            return false;
        }

        return owned.record === resolution.record
            && owned.sourceUrl === resolution.sourceUrl
            && owned.root === resolution.root
            && owned.target === resolution.target
            && owned.game === resolution.game
            && owned.provider === resolution.provider
            && owned.buildRef === resolution.buildRef
            && owned.build === resolution.build
            && owned.client === resolution.client;
    }

    async #ReadOrFetchPayload(resolution, options)
    {
        if (!options.refresh)
        {
            const cached = await this.#cache?.ReadPayload(
                this.provider,
                resolution.root,
                resolution.record.location,
            );

            if (cached)
            {
                try
                {
                    const bytes = utils.validateResourceBytes(
                        cached.bytes,
                        resolution.record,
                        resolution.logicalPath,
                    );

                    return Object.freeze({ bytes, cacheHit: true, cachePath: cached.cachePath });
                }
                catch
                {
                    // An invalid cache entry is replaced from the immutable source.
                }
            }
        }

        const response = await CjsBoundedFetch.request(
            this.#fetch,
            resolution.sourceUrl,
            options.fetchOptions ?? {},
            {
                timeoutMs: this.#requestTimeoutMs,
                label: "Index payload request",
            },
        );

        utils.assertOkResponse(response, resolution.sourceUrl);

        const bytes = utils.validateResourceBytes(
            await CjsBoundedFetch.readBytes(response, {
                maxBytes: CjsIndexSource.responseLimit(
                    resolution.record,
                    this.#maxPayloadBytes,
                ),
                label: "Index payload response",
                timeoutMs: this.#requestTimeoutMs,
                signal: options.fetchOptions?.signal,
            }),
            resolution.record,
            resolution.logicalPath,
        );
        const cachePath = await this.#cache?.WritePayload(
            this.provider,
            resolution.root,
            resolution.record.location,
            bytes,
        ) ?? null;

        return Object.freeze({ bytes, cacheHit: false, cachePath });
    }

    /** Applies both the configured ceiling and an exact declared byte length. */
    static responseLimit(resource, maximum)
    {
        const source = resource?.uncompressedSize;

        if (source === undefined || source === null || source === "")
        {
            return maximum;
        }

        const declared = Number(source);

        return Number.isSafeInteger(declared) && declared >= 0
            ? Math.min(maximum, Math.max(1, declared))
            : maximum;
    }

}

function CreateInflightKey(resolution, options)
{
    const record = resolution.record;

    return [
        resolution.target ?? "",
        resolution.game ?? "",
        resolution.provider ?? "",
        resolution.build ?? "",
        resolution.root,
        resolution.logicalPath,
        record.location,
        record.checksum ?? "",
        record.uncompressedSize ?? "",
        resolution.sourceUrl,
        options.refresh === true ? "refresh" : "cached",
    ].join("\0");
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
