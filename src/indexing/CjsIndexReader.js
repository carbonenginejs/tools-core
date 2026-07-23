import path from "node:path";
import { CjsBoundedFetch } from "../internal/CjsBoundedFetch.js";
import { CjsIndexBuildResolver } from "./CjsIndexBuildResolver.js";
import { CjsIndexCache } from "./CjsIndexCache.js";
import { parseIndexGroup } from "./CjsIndexGroup.js";
import { CjsIndexProviderRegistry } from "./CjsIndexProviderRegistry.js";
import { CjsIndex } from "./CjsIndex.js";
import * as utils from "../utils.js";

/**
 * Reads the complete immutable app/res index graph for one provider/build.
 */
export class CjsIndexReader
{

    #providers;

    #fetch;

    #builds;

    #cache;

    #maxIndexBytes;

    #requestTimeoutMs;

    /**
     * Creates a complete remote index reader with optional local caching.
     */
    constructor({
        providers = new CjsIndexProviderRegistry(),
        fetch = globalThis.fetch,
        cache = null,
        requestTimeoutMs = 30000,
        maxMetadataBytes = 64 * 1024,
        maxIndexBytes = 64 * 1024 * 1024,
    } = {})
    {
        if (!(providers instanceof CjsIndexProviderRegistry))
        {
            throw new TypeError("CjsIndexReader providers must be a CjsIndexProviderRegistry");
        }

        if (typeof fetch !== "function")
        {
            throw new TypeError("CjsIndexReader requires fetch");
        }

        if (cache !== null && !(cache instanceof CjsIndexCache))
        {
            throw new TypeError("CjsIndexReader cache must be a CjsIndexCache or null");
        }

        CjsBoundedFetch.normalizeLimit(requestTimeoutMs, "requestTimeoutMs");
        CjsBoundedFetch.normalizeLimit(maxMetadataBytes, "maxMetadataBytes");
        CjsBoundedFetch.normalizeLimit(maxIndexBytes, "maxIndexBytes");

        this.#providers = providers;
        this.#fetch = fetch;
        this.#builds = new CjsIndexBuildResolver({
            fetch,
            requestTimeoutMs,
            maxMetadataBytes,
        });
        this.#cache = cache;
        this.#requestTimeoutMs = requestTimeoutMs;
        this.#maxIndexBytes = maxIndexBytes;
        Object.freeze(this);
    }

    /**
     * Resolves a friendly or exact build without opening its file indexes.
     */
    async ResolveBuild({ game, provider, build, client } = {})
    {
        const profile = this.#providers.Get(provider, game);

        return this.#builds.Resolve(profile, build ?? profile.defaultBuildRef, client);
    }

    /**
     * Reads the app index, main res index, and every declared app extension.
     */
    async Read({ target, game, provider, build, client } = {})
    {
        const profile = this.#providers.Get(provider, game);
        const buildReference = await this.#builds.Resolve(profile, build ?? profile.defaultBuildRef, client);
        const appIndexUrl = utils.joinUrl(profile.remote.indexBaseUrl, `eveonline_${buildReference.build}.txt`);
        const appIndex = await this.#ReadGroup({
            game: profile.game,
            provider: profile.id,
            build: buildReference.build,
            cacheFileName: "appfileindex.txt",
            sourceUrl: appIndexUrl,
            kind: "appfileindex",
            name: "app",
            root: "app",
        });
        const declarations = discoverIndexDeclarations(appIndex);
        const groups = await Promise.all(declarations.map(async ({ name, resource }) =>
        {
            const sourceUrl = utils.joinUrl(profile.remote.appBaseUrl, resource.location);
            const group = await this.#ReadGroup({
                game: profile.game,
                provider: profile.id,
                build: buildReference.build,
                cacheFileName: path.posix.basename(resource.relativePath),
                sourceUrl,
                kind: "resfileindex",
                name,
                root: "res",
                declaration: resource,
                expectedResource: resource,
            });

            return [ name, group ];
        }));
        const indexes = Object.fromEntries(groups);
        const { main = null, ...extensions } = indexes;

        return new CjsIndex({
            target,
            provider: profile,
            buildReference,
            appIndex,
            mainResIndex: main,
            extensions,
        });
    }

    async #ReadGroup(options)
    {
        const cached = await this.#cache?.ReadIndex(
            options.game,
            options.provider,
            options.build,
            options.cacheFileName,
        );

        if (cached)
        {
            try
            {
                const bytes = utils.validateResourceBytes(
                    cached.bytes,
                    options.expectedResource,
                    options.sourceUrl,
                );

                return parseIndexGroup(bytes.toString("utf8"), {
                    ...options,
                    cachePath: cached.cachePath,
                    cacheHit: true,
                });
            }
            catch
            {
                // An invalid cache entry is replaced from the immutable source.
            }
        }

        const response = await CjsBoundedFetch.request(
            this.#fetch,
            options.sourceUrl,
            {},
            {
                timeoutMs: this.#requestTimeoutMs,
                label: "Index file request",
            },
        );

        utils.assertOkResponse(response, options.sourceUrl);

        const bytes = utils.validateResourceBytes(
            await CjsBoundedFetch.readBytes(response, {
                maxBytes: CjsIndexReader.responseLimit(
                    options.expectedResource,
                    this.#maxIndexBytes,
                ),
                label: "Index file response",
                timeoutMs: this.#requestTimeoutMs,
            }),
            options.expectedResource,
            options.sourceUrl,
        );
        const group = parseIndexGroup(bytes.toString("utf8"), {
            ...options,
            cachePath: this.#cache?.GetIndexPath(
                options.game,
                options.provider,
                options.build,
                options.cacheFileName,
            ) ?? null,
            cacheHit: false,
        });

        await this.#cache?.WriteIndex(
            options.game,
            options.provider,
            options.build,
            options.cacheFileName,
            bytes,
        );

        return group;
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

function discoverIndexDeclarations(appIndex)
{
    const declarations = [];
    const names = new Set();

    for (const resource of appIndex.entries)
    {
        const match = resource.logicalPath.match(/^app:\/resfileindex(?:_([^/]+))?\.txt$/u);

        if (!match)
        {
            continue;
        }

        const name = match[1] ?? "main";

        if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name) || names.has(name))
        {
            throw new Error(`Invalid or duplicate app index extension: ${name}`);
        }

        names.add(name);
        declarations.push(Object.freeze({ name, resource }));
    }

    return Object.freeze(declarations);
}
