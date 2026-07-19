import { CjsToolCache } from "../cache/CjsToolCache.js";

/**
 * Index-module adapter over tools-core's one shared cache.
 */
export class CjsIndexCache
{

    /**
     * Creates an index cache backed by the shared tools-core cache.
     */
    constructor({ directory, cache = new CjsToolCache(directory) } = {})
    {
        if (!(cache instanceof CjsToolCache))
        {
            throw new TypeError("CjsIndexCache cache must be a CjsToolCache");
        }

        this.cache = cache;
        this.directory = cache.directory;
        Object.freeze(this);
    }

    /**
     * Gets the deterministic cache path for one build index.
     */
    GetIndexPath(...identity)
    {
        return this.cache.GetIndexPath(...identity);
    }

    /**
     * Gets the deterministic cache path for one content-addressed payload.
     */
    GetPayloadPath(_provider, _root, location)
    {
        return this.cache.GetRemoteFilePath(location);
    }

    /**
     * Reads cached build-index bytes or returns null when absent.
     */
    async ReadIndex(...identity)
    {
        return this.cache.ReadIndex(...identity);
    }

    /**
     * Writes immutable build-index bytes to their deterministic location.
     */
    async WriteIndex(...identity)
    {
        return this.cache.WriteIndex(...identity);
    }

    /**
     * Reads cached payload bytes or returns null when absent.
     */
    async ReadPayload(_provider, _root, location)
    {
        return this.cache.ReadRemote(location);
    }

    /**
     * Writes immutable payload bytes to their content-addressed location.
     */
    async WritePayload(_provider, _root, location, bytes)
    {
        return (await this.cache.WriteRemote(location, bytes)).cachePath;
    }

}
