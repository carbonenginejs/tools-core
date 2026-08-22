import fs from "node:fs/promises";

import { CjsCharacterLibraryManager } from "@carbonenginejs/runtime-character";
import { CjsToolCache } from "../cache/CjsToolCache.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";
import { CjsToolCharacterBuilder } from "./CjsToolCharacterBuilder.js";

/** Opens exact-build prepared character libraries from the shared tool cache. */
export class CjsToolCharacterRepository
{

    #cache;

    #autoPrepare;

    #indexes;

    #targets;

    #libraries = new Map();

    /** Creates a prepared-library repository with optional cache/build services. */
    constructor({
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

        this.#cache = cache;
        this.#autoPrepare = autoPrepare === true;
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

    /** Loads and installs the newest direct document, with compatible migration fallback. */
    async #Load(target, build)
    {
        let data;
        let filePath = null;

        for (const version of [ "v10", "v9", "v8", "v7" ])
        {
            const candidate = this.#cache.GetCustomPath({
                target: target.id,
                game: target.game,
                provider: target.provider,
                build,
                name: "character",
                version
            });

            try
            {
                data = JSON.parse(await fs.readFile(candidate, "utf8"));
                filePath = candidate;
                break;
            }
            catch (error)
            {
                if (error.code === "ENOENT") continue;

                throw error;
            }
        }

        if (filePath === null)
        {
            if (this.#autoPrepare && typeof this.#indexes?.OpenTarget === "function")
            {
                return this.#AutoPrepare(target, build);
            }

            const missing = new Error(
                `Character library is not prepared for ${target.id} build ${build}`
            );
            missing.statusCode = 404;
            throw missing;
        }

        const prepared = data;

        if (!prepared || typeof prepared !== "object" || Array.isArray(prepared))
        {
            throw new TypeError("Prepared character library payload must be an object");
        }

        RequireIdentity("target", prepared.sourceTarget, target.id);
        RequireIdentity("game", prepared.sourceGame, target.game);
        RequireIdentity("provider", prepared.sourceProvider, target.provider);
        RequireIdentity("build", prepared.sourceBuild, build);

        return new CjsCharacterLibraryManager().InstallLibrary(prepared);
    }

    /** Builds a missing base library through runtime-character's resource path. */
    async #AutoPrepare(target, build)
    {
        const source = await this.#indexes.OpenTarget(target.id, build, {
            client: target.client ?? undefined
        });
        const library = await CjsToolCharacterBuilder.buildFromResources({
            source,
            sourceTarget: target.id,
            sourceGame: target.game,
            sourceProvider: target.provider,
            sourceBuild: build,
            generatedAt: new Date().toISOString()
        }, { targets: this.#targets });
        const values = library.GetValues({ refs: true });

        await this.#cache.WriteCustomLibrary({
            target: target.id,
            game: target.game,
            provider: target.provider,
            build,
            name: "character",
            version: "v10"
        }, values);

        return library;
    }

}

function RequireIdentity(label, actual, expected)
{
    if (actual === null || actual === undefined || String(actual).trim() === "")
    {
        throw new Error(`Character library is missing source ${label} identity`);
    }

    if (String(actual).toLowerCase() !== String(expected).toLowerCase())
    {
        throw new Error(`Character library ${label} mismatch: ${actual} !== ${expected}`);
    }
}
