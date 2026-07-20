import { CjsIndexProvider, normalizeBuildReference } from "./CjsIndexProvider.js";
import * as utils from "../utils.js";

/**
 * Resolves an exact build or provider channel to one exact remote build.
 */
export class CjsIndexBuildResolver
{

    #fetch;

    #latest;

    #now;

    /**
     * Creates a resolver with an injectable Fetch-compatible function.
     */
    constructor({ fetch = globalThis.fetch, now = Date.now } = {})
    {
        if (typeof fetch !== "function")
        {
            throw new TypeError("CjsIndexBuildResolver requires fetch");
        }

        if (typeof now !== "function")
        {
            throw new TypeError("CjsIndexBuildResolver now must be a function");
        }

        this.#fetch = fetch;
        this.#latest = new Map();
        this.#now = now;
        Object.freeze(this);
    }

    /**
     * Resolves an exact build, latest build, or provider client to one exact build.
     */
    async Resolve(providerValue, buildValue, clientValue = null)
    {
        const provider = CjsIndexProvider.from(providerValue);
        const buildRef = normalizeBuildReference(buildValue ?? provider.defaultBuildRef);
        const clientRef = clientValue === null || clientValue === undefined
            ? null
            : normalizeBuildReference(clientValue);

        if (buildRef === "latest")
        {
            return this.#ResolveCached(provider, clientRef, () =>
            {
                if (clientRef)
                {
                    const client = resolveClient(provider, clientRef);

                    return this.#ResolveClient(provider, client, buildRef);
                }

                return this.#ResolveLatest(provider, buildRef);
            });
        }

        if (utils.isExactBuild(buildRef))
        {
            const client = clientRef ? resolveClient(provider, clientRef) : null;

            return utils.freezeData({
                game: provider.game,
                provider: provider.id,
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

        const client = resolveClient(provider, buildRef);

        return this.#ResolveClient(provider, client, buildRef);
    }

    #ResolveCached(provider, clientRef, resolver)
    {
        const now = Number(this.#now());

        if (!Number.isFinite(now))
        {
            throw new TypeError("CjsIndexBuildResolver now returned an invalid time");
        }

        const key = `${provider.game}\0${provider.id}\0${clientRef ?? "*"}`;
        const cached = this.#latest.get(key);

        if (cached && cached.expiresAt > now)
        {
            return cached.value;
        }

        const ttl = provider.game.toLowerCase() === "eve" && provider.id === "ccp"
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
     * Resolves the highest numeric build exposed by any provider client.
     */
    async #ResolveLatest(provider, buildRef)
    {
        const clients = Object.values(provider.clients);

        if (!clients.length)
        {
            throw new Error(`Provider ${provider.id} has no clients for latest`);
        }

        const candidates = await Promise.all(
            clients.map((client) => this.#ReadClientMetadata(provider, client)),
        );
        candidates.sort((left, right) => compareBuilds(right.build, left.build));

        const latest = candidates[0];

        return utils.freezeData({
            game: provider.game,
            provider: provider.id,
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
     * Resolves one named provider client to its exact remote build.
     */
    async #ResolveClient(provider, client, buildRef)
    {
        const candidate = await this.#ReadClientMetadata(provider, client);

        return utils.freezeData({
            game: provider.game,
            provider: provider.id,
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
     * Reads and validates the metadata document for one provider client.
     */
    async #ReadClientMetadata(provider, client)
    {
        const metadataUrl = utils.joinUrl(
            provider.remote.metadataBaseUrl,
            `eveclient_${client.metadataToken}.json`,
        );
        const response = await this.#fetch(metadataUrl);

        utils.assertOkResponse(response, metadataUrl);

        const metadata = await response.json();
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

function resolveClient(provider, value)
{
    const client = provider.ResolveClient(value);

    if (!client)
    {
        throw new Error(`Unknown client for ${provider.id}: ${value}`);
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
