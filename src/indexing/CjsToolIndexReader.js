import path from "node:path";
import { pathToFileURL } from "node:url";
import { CjsToolPayloadCheck } from "../cache/CjsToolPayloadCheck.js";
import { CjsToolBoundedFetch } from "../internal/CjsToolBoundedFetch.js";
import { CjsToolIndexBuildResolver } from "./CjsToolIndexBuildResolver.js";
import { CjsToolIndexCache } from "./CjsToolIndexCache.js";
import { parseIndexGroup } from "./CjsToolIndexGroup.js";
import { CjsToolIndexTargetProfileRegistry } from "./CjsToolIndexTargetProfileRegistry.js";
import { CjsToolIndexGraph } from "./CjsToolIndexGraph.js";
import { CjsToolIndexSuppliedStore } from "./CjsToolIndexSuppliedStore.js";
import * as utils from "../utils.js";

/**
 * Reads the complete immutable app/res index graph for one target/build.
 */
export class CjsToolIndexReader
{

    #profiles;

    #fetch;

    #builds;

    #cache;

    #supplied;

    #maxIndexBytes;

    #requestTimeoutMs;

    /**
     * Creates a complete remote index reader with optional local caching.
     */
    constructor({
        profiles = new CjsToolIndexTargetProfileRegistry(),
        fetch = globalThis.fetch,
        cache = null,
        supplied = null,
        requestTimeoutMs = 30000,
        maxMetadataBytes = 64 * 1024,
        maxIndexBytes = 64 * 1024 * 1024,
    } = {})
    {
        if (!(profiles instanceof CjsToolIndexTargetProfileRegistry))
        {
            throw new TypeError("CjsToolIndexReader profiles must be a CjsToolIndexTargetProfileRegistry");
        }

        if (typeof fetch !== "function")
        {
            throw new TypeError("CjsToolIndexReader requires fetch");
        }

        if (cache !== null && !(cache instanceof CjsToolIndexCache))
        {
            throw new TypeError("CjsToolIndexReader cache must be a CjsToolIndexCache or null");
        }

        if (supplied !== null && !(supplied instanceof CjsToolIndexSuppliedStore))
        {
            throw new TypeError(
                "CjsToolIndexReader supplied must be a CjsToolIndexSuppliedStore or null",
            );
        }

        CjsToolBoundedFetch.normalizeLimit(requestTimeoutMs, "requestTimeoutMs");
        CjsToolBoundedFetch.normalizeLimit(maxMetadataBytes, "maxMetadataBytes");
        CjsToolBoundedFetch.normalizeLimit(maxIndexBytes, "maxIndexBytes");

        this.#profiles = profiles;
        this.#fetch = fetch;
        this.#builds = new CjsToolIndexBuildResolver({
            fetch,
            requestTimeoutMs,
            maxMetadataBytes,
        });
        this.#cache = cache;
        this.#supplied = supplied;
        this.#requestTimeoutMs = requestTimeoutMs;
        this.#maxIndexBytes = maxIndexBytes;
        Object.freeze(this);
    }

    /**
     * Resolves a friendly or exact build without opening its file indexes.
     */
    async ResolveBuild({ target, game, provider, build, client } = {})
    {
        const profile = this.#ResolveProfile({ target, game, provider });

        return this.#builds.Resolve(
            profile,
            await this.#ResolveBuildReference(profile, build),
            client,
        );
    }

    /**
     * The build reference to resolve, which a supplied target answers itself.
     *
     * "latest" means the newest build that can be READ, and on a supplied
     * target that is the newest index somebody handed us - not whatever the
     * publisher shipped this morning, which we have no index for and cannot
     * serve. Reporting the publisher's number would put a build in every URL
     * that answers 404 on every route.
     */
    async #ResolveBuildReference(profile, build)
    {
        const requested = build ?? profile.defaultBuildRef;

        if (profile.indexSource !== "supplied" || utils.isExactBuild(requested))
        {
            return requested;
        }

        const supplied = await this.#RequireSuppliedStore(profile)
            .ResolveBuild(profile.target, requested);

        if (!supplied)
        {
            // 404 rather than a bare throw, so the proxy says WHERE to put the
            // file instead of answering "Internal tool error". A target with no
            // index yet is a state to act on, not a fault.
            throw NotFound(
                `No resource index has been supplied for target ${profile.target}: `
                + `place one at ${this.#RequireSuppliedStore(profile)
                    .GetRoot(profile.target)}/<build>/resfileindex.txt`,
            );
        }

        return supplied;
    }

    /** Returns the supplied-index store or rejects an unconfigured target. */
    #RequireSuppliedStore(profile)
    {
        if (!this.#supplied)
        {
            throw new Error(
                `Target ${profile.target} supplies its own resource index, `
                + "and no supplied-index store is configured",
            );
        }

        return this.#supplied;
    }

    /**
     * Reads the app index, main res index, and every declared app extension.
     */
    async Read({ target, game, provider, build, client } = {})
    {
        const profile = this.#ResolveProfile({ target, game, provider });
        const buildReference = await this.#builds.Resolve(
            profile,
            await this.#ResolveBuildReference(profile, build),
            client,
        );

        if (profile.indexSource === "supplied")
        {
            return this.#ReadSupplied(profile, buildReference);
        }

        const appIndexUrl = utils.joinUrl(profile.remote.indexBaseUrl, `eveonline_${buildReference.build}.txt`);
        const appIndex = await this.#ReadGroup({
            target: profile.target,
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
                target: profile.target,
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

        return new CjsToolIndexGraph({
            profile,
            buildReference,
            appIndex,
            mainResIndex: main,
            extensions,
        });
    }

    /**
     * Reads one build's supplied resource indexes, with no app index at all.
     *
     * The app index is not merely skipped as an optimisation: on a target that
     * supplies its indexes it is typically unreachable, which is why the
     * indexes are supplied. Its place in the graph is an EMPTY app group, so
     * an `app:/` lookup answers "not found" rather than throwing on a null -
     * the honest answer, since no application file can be addressed here.
     */
    async #ReadSupplied(profile, buildReference)
    {
        const store = this.#RequireSuppliedStore(profile);
        const directory = store.GetDirectory(profile.target, buildReference.build);
        const groups = await store.ReadGroups(profile.target, buildReference.build);

        if (!groups)
        {
            throw NotFound(
                `No resource index has been supplied for ${profile.target} build `
                + `${buildReference.build}: expected ${directory}/resfileindex.txt`,
            );
        }

        const { main, ...extensions } = groups;

        return new CjsToolIndexGraph({
            profile,
            buildReference,
            appIndex: parseIndexGroup("", {
                kind: "appfileindex",
                name: "app",
                root: "app",
                sourceUrl: pathToFileURL(directory).href,
            }),
            mainResIndex: main,
            extensions,
        });
    }

    /** Reads group data through the active exact-build index boundary. */
    async #ReadGroup(options)
    {
        const cached = await this.#cache?.ReadIndex(
            options.target,
            options.build,
            options.cacheFileName,
        );

        if (cached)
        {
            try
            {
                // Validated when downloaded below; the cached copy is not
                // re-hashed.
                return parseIndexGroup(Buffer.from(cached.bytes).toString("utf8"), {
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

        const response = await CjsToolBoundedFetch.request(
            this.#fetch,
            options.sourceUrl,
            {},
            {
                timeoutMs: this.#requestTimeoutMs,
                label: "Index file request",
            },
        );

        utils.assertOkResponse(response, options.sourceUrl);

        const bytes = CjsToolPayloadCheck.validateBytes(
            await CjsToolBoundedFetch.readBytes(response, {
                maxBytes: CjsToolIndexReader.responseLimit(
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
                options.target,
                options.build,
                options.cacheFileName,
            ) ?? null,
            cacheHit: false,
        });

        await this.#cache?.WriteIndex(
            options.target,
            options.build,
            options.cacheFileName,
            bytes,
        );

        return group;
    }

    /** Selects the profile result from available exact-build index evidence. */
    #ResolveProfile({ target, game, provider })
    {
        const profile = this.#profiles.Get(target);

        if (game !== undefined && game !== null
            && String(game).toLowerCase() !== profile.game.toLowerCase())
        {
            throw new Error(`Target ${profile.target} does not use game ${game}`);
        }

        if (provider !== undefined && provider !== null
            && String(provider).toLowerCase() !== profile.provider)
        {
            throw new Error(`Target ${profile.target} does not use provider ${provider}`);
        }

        return profile;
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

/** An absent supplied index, reported as the state it is. */
function NotFound(message)
{
    const error = new Error(message);

    error.statusCode = 404;

    return error;
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
