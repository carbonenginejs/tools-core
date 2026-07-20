import fs from "node:fs/promises";

import { CjsToolCache } from "../cache/CjsToolCache.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";
import { CjsToolCharacterLibrary } from "./CjsToolCharacterLibrary.js";

/** Opens exact-build prepared character libraries from the shared tool cache. */
export class CjsToolCharacterRepository
{

    #cache;

    #indexes;

    #targets;

    #libraries = new Map();

    constructor({
        cache = new CjsToolCache(),
        indexes = null,
        targets = new CjsToolTargetRegistry()
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

        this.#cache = cache;
        this.#indexes = indexes;
        this.#targets = targets;
        Object.freeze(this);
    }

    /** Opens and validates one prepared character library. */
    async OpenTarget(target, build)
    {
        const resolvedTarget = this.#targets.RequireLibrary(
            this.#targets.Resolve({ target }),
            "character"
        );
        const exactBuild = await this.#ResolveBuild(resolvedTarget.id, build);
        const key = `${resolvedTarget.id}\0${exactBuild}`;

        if (!this.#libraries.has(key))
        {
            const loading = this.#Load(resolvedTarget, exactBuild).catch(error =>
            {
                this.#libraries.delete(key);
                throw error;
            });

            this.#libraries.set(key, loading);
        }

        return this.#libraries.get(key);
    }

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

    async #Load(target, build)
    {
        const filePath = this.#cache.GetCustomPath({
            game: target.game,
            provider: target.provider,
            build,
            name: "character",
            version: "v1"
        });
        let data;

        try
        {
            data = JSON.parse(await fs.readFile(filePath, "utf8"));
        }
        catch (error)
        {
            if (error.code === "ENOENT")
            {
                const missing = new Error(`Character library is not prepared for ${target.id} build ${build}`);
                missing.statusCode = 404;
                throw missing;
            }

            throw error;
        }

        const prepared = data
            && typeof data === "object"
            && !Array.isArray(data)
            && data.character
            && typeof data.character === "object"
            && !Array.isArray(data.character)
            && data.character.schema === "carbonenginejs.characterLibrary"
                ? data.character
                : data;

        if (!prepared || typeof prepared !== "object" || Array.isArray(prepared))
        {
            throw new TypeError("Prepared character library payload must be an object");
        }

        if (prepared.sourceTarget && prepared.sourceTarget !== target.id)
        {
            throw new Error(`Character library target mismatch: ${prepared.sourceTarget}`);
        }

        if (prepared.sourceBuild && String(prepared.sourceBuild) !== String(build))
        {
            throw new Error(`Character library build mismatch: ${prepared.sourceBuild}`);
        }

        return new CjsToolCharacterLibrary(prepared);
    }

}
