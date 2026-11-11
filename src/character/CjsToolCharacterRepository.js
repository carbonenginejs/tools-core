import fs from "node:fs/promises";

import { CjsCharacterLibraryManager } from "@carbonenginejs/runtime/character";
import { CjsToolCache } from "../cache/CjsToolCache.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";
import { CjsToolCharacterBuilder } from "./CjsToolCharacterBuilder.js";

/**
 * Opens exact-build character libraries from the shared tool cache: `character_v1.json` in the exact build's custom
 * cache, the library's values (its items by kind; runtime `CjsCharacterLibrary`, version 1). A missing library is built
 * from the build's files by the runtime's library builder (`CjsToolCharacterBuilder`) and written there, with its gzip
 * sibling. Earlier formats are not read.
 */
export class CjsToolCharacterRepository
{

    #cache = null;

    #memory = null;

    #autoPrepare = false;

    #indexes = null;

    #targets = null;

    #libraries = new Map();

    /** Creates a library repository with optional cache/build services. */
    constructor({
        memory = null,
        cache = new CjsToolCache(),
        indexes = null,
        targets = new CjsToolTargetRegistry(),
        autoPrepare = true
    } = {})
    {
        if (!(cache instanceof CjsToolCache))
        {
            throw new TypeError("CjsToolCharacterRepository cache must be a CjsToolCache");
        }

        if (indexes !== null && typeof indexes.ResolveTargetBuild !== "function")
        {
            throw new TypeError("CjsToolCharacterRepository indexes must resolve target builds");
        }

        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("CjsToolCharacterRepository targets must be a CjsToolTargetRegistry");
        }

        this.#libraries = memory ? memory.CreateMap("character.libraries",
            key => key.split("\0").slice(0, 2)) : new Map();
        this.#memory = memory;
        this.#cache = cache;
        this.#autoPrepare = autoPrepare === true;
        this.#indexes = indexes;
        this.#targets = targets;
        Object.freeze(this);
    }

    /**
     * Opens one exact build's library; refresh rebuilds it from the build's files and rewrites the cache.
     * @param {string} target The target.
     * @param {string} build An exact or friendly build.
     * @param {{ refresh?: boolean }} [options] Options.
     * @returns {Promise<import("@carbonenginejs/runtime/character").CjsCharacterLibrary>} The installed library.
     */
    async OpenTarget(target, build, { refresh = false } = {})
    {
        const resolvedTarget = this.#targets.RequireLibrary(
            this.#targets.Resolve({ target }),
            "character"
        );
        const exactBuild = await this.#ResolveBuild(resolvedTarget.id, build);
        const key = `${resolvedTarget.id}\0${exactBuild}`;
        if (refresh) this.#libraries.delete(key);

        if (this.#memory && build === "latest")
        {
            this.#memory.MarkCurrent(resolvedTarget.id, "resources", exactBuild);
        }
        if (!this.#libraries.has(key))
        {
            const loading = this.#Load(resolvedTarget, exactBuild, refresh).catch(error =>
            {
                if (this.#libraries.get(key) === loading) this.#libraries.delete(key);
                throw error;
            });

            this.#libraries.set(key, loading);
        }

        return this.#libraries.get(key);
    }

    /** Resolves a friendly or exact request to one exact build. */
    async #ResolveBuild(target, build)
    {
        try
        {
            return utils.normalizeExactBuild(build);
        }
        catch (error)
        {
            if (!this.#indexes) throw error;
            const resolved = await this.#indexes.ResolveTargetBuild(target, build);
            return utils.normalizeExactBuild(resolved.build);
        }
    }

    /** The cache entry of one exact build's library. */
    #CacheEntry(target, build)
    {
        return { target: target.id, game: target.game, provider: target.provider, build, name: "character", version: "v1" };
    }

    /** Installs the cached library, or builds and caches it (always on refresh). */
    async #Load(target, build, refresh)
    {
        if (!refresh)
        {
            try
            {
                const values = JSON.parse(await fs.readFile(this.#cache.GetCustomPath(this.#CacheEntry(target, build)), "utf8"));
                return new CjsCharacterLibraryManager().InstallLibrary(values);
            }
            catch (error)
            {
                if (error.code !== "ENOENT") throw error;
            }
        }

        if (!this.#autoPrepare || typeof this.#indexes?.OpenTarget !== "function")
        {
            const missing = new Error(`Character library is not prepared for ${target.id} build ${build}`);
            missing.statusCode = 404;
            throw missing;
        }

        const source = await this.#indexes.OpenTarget(target.id, build, { client: target.client ?? undefined });
        const library = await CjsToolCharacterBuilder.buildFromSource(source);
        await this.#cache.WriteCustomLibrary(this.#CacheEntry(target, build), library.GetValues());
        return library;
    }

}
