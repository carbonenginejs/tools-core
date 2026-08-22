import { CjsToolIndexTargetProfile, normalizeBuildReference } from "./CjsToolIndexTargetProfile.js";
import { CjsToolBoundedFetch } from "../internal/CjsToolBoundedFetch.js";
import * as utils from "../utils.js";

/**
 * Resolves an exact build or target client to one exact remote build.
 */
export class CjsToolIndexBuildResolver
{

    #fetch;

    #latest;

    #maxMetadataBytes;

    #now;

    #requestTimeoutMs;

    /**
     * Creates a resolver with an injectable Fetch-compatible function.
     */
    constructor({
        fetch = globalThis.fetch,
        now = Date.now,
        requestTimeoutMs = 15000,
        maxMetadataBytes = 64 * 1024,
    } = {})
    {
        if (typeof fetch !== "function")
        {
            throw new TypeError("CjsToolIndexBuildResolver requires fetch");
        }

        if (typeof now !== "function")
        {
            throw new TypeError("CjsToolIndexBuildResolver now must be a function");
        }

        CjsToolBoundedFetch.normalizeLimit(requestTimeoutMs, "requestTimeoutMs");
        CjsToolBoundedFetch.normalizeLimit(maxMetadataBytes, "maxMetadataBytes");

        this.#fetch = fetch;
        this.#latest = new Map();
        this.#now = now;
        this.#requestTimeoutMs = requestTimeoutMs;
        this.#maxMetadataBytes = maxMetadataBytes;
        Object.freeze(this);
    }

    /**
     * Resolves an exact build, latest build, or target client to one exact build.
     */
    async Resolve(profileValue, buildValue, clientValue = null)
    {
        const profile = CjsToolIndexTargetProfile.from(profileValue);
        const buildRef = normalizeBuildReference(buildValue ?? profile.defaultBuildRef);
        const clientRef = clientValue === null || clientValue === undefined
            ? null
            : normalizeBuildReference(clientValue);

        if (buildRef === "latest")
        {
            return this.#ResolveCached(profile, clientRef, () =>
            {
                if (clientRef)
                {
                    const client = resolveClient(profile, clientRef);

                    return this.#ResolveClient(profile, client, buildRef);
                }

                return this.#ResolveLatest(profile, buildRef);
            });
        }

        if (utils.isExactBuild(buildRef))
        {
            const client = clientRef ? resolveClient(profile, clientRef) : null;

            return utils.freezeData({
                target: profile.target,
                game: profile.game,
                provider: profile.provider,
                buildRef,
                build: buildRef,
                client: client?.id ?? null,
                metadataToken: client?.metadataToken ?? null,
                metadataUrl: null,
                metadata: null,
                source: "exact",
            });
        }

        if (clientRef)
        {
            throw new Error("Use either a client option or a friendly build reference, not both");
        }

        const client = resolveClient(profile, buildRef);

        return this.#ResolveClient(profile, client, buildRef);
    }

    /** Selects the cached result from available exact-build index evidence. */
    #ResolveCached(profile, clientRef, resolver)
    {
        const now = Number(this.#now());

        if (!Number.isFinite(now))
        {
            throw new TypeError("CjsToolIndexBuildResolver now returned an invalid time");
        }

        const key = `${profile.target}\0${clientRef ?? "*"}`;
        const cached = this.#latest.get(key);

        if (cached && cached.expiresAt > now)
        {
            return cached.value;
        }

        const ttl = profile.target === "eve"
            ? utils.getEveLatestBuildCacheTTL(now)
            : 5 * 60 * 1000;
        const value = Promise.resolve().then(resolver);
        const entry = Object.freeze({ expiresAt: now + ttl, value });

        this.#latest.set(key, entry);
        value.catch(() =>
        {
            if (this.#latest.get(key) === entry)
            {
                this.#latest.delete(key);
            }
        });

        return value;
    }

    /**
     * Resolves the highest numeric build exposed by any target client.
     */
    async #ResolveLatest(profile, buildRef)
    {
        const clients = Object.values(profile.clients);

        if (!clients.length)
        {
            throw new Error(`Target ${profile.target} has no clients for latest`);
        }

        const candidates = await Promise.all(
            clients.map((client) => this.#ReadClientMetadata(profile, client)),
        );
        candidates.sort((left, right) => compareBuilds(right.build, left.build));

        const latest = candidates[0];

        return utils.freezeData({
            target: profile.target,
            game: profile.game,
            provider: profile.provider,
            buildRef,
            build: latest.build,
            client: latest.client.id,
            metadataToken: latest.client.metadataToken,
            metadataUrl: latest.metadataUrl,
            metadata: latest.metadata,
            source: "latest-remote-metadata",
        });
    }

    /**
     * Resolves one named target client to its exact remote build.
     */
    async #ResolveClient(profile, client, buildRef)
    {
        const candidate = await this.#ReadClientMetadata(profile, client);

        return utils.freezeData({
            target: profile.target,
            game: profile.game,
            provider: profile.provider,
            buildRef,
            build: candidate.build,
            client: candidate.client.id,
            metadataToken: candidate.client.metadataToken,
            metadataUrl: candidate.metadataUrl,
            metadata: candidate.metadata,
            source: "remote-metadata",
        });
    }

    /**
     * Reads and validates the metadata document for one target client.
     */
    async #ReadClientMetadata(profile, client)
    {
        const metadataUrl = utils.joinUrl(
            profile.remote.metadataBaseUrl,
            `eveclient_${client.metadataToken}.json`,
        );
        const response = await CjsToolBoundedFetch.request(
            this.#fetch,
            metadataUrl,
            {},
            {
                timeoutMs: this.#requestTimeoutMs,
                label: "Index build metadata request",
            },
        );

        utils.assertOkResponse(response, metadataUrl);

        const metadata = await CjsToolBoundedFetch.readJson(response, {
            maxBytes: this.#maxMetadataBytes,
            label: "Index build metadata response",
            timeoutMs: this.#requestTimeoutMs,
        });
        const build = parseRemoteBuild(metadata);

        return {
            build,
            client,
            metadataUrl,
            metadata,
        };
    }

}

function parseRemoteBuild(metadata)
{
    return utils.normalizeExactBuild(metadata?.build ?? metadata?.buildNumber, {
        message: "Remote metadata does not contain a numeric build",
    });
}

function resolveClient(profile, value)
{
    const client = profile.ResolveClient(value);

    if (!client)
    {
        throw new Error(`Unknown client for ${profile.target}: ${value}`);
    }

    return client;
}

function compareBuilds(left, right)
{
    const leftBuild = BigInt(left);
    const rightBuild = BigInt(right);

    if (leftBuild > rightBuild) return 1;
    if (leftBuild < rightBuild) return -1;
    return 0;
}
