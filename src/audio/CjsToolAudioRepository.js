import fs from "node:fs/promises";

import { CjsToolCache } from "../cache/CjsToolCache.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";
import { CjsToolAudioSource } from "./CjsToolAudioSource.js";

/** Opens exact-build prepared audio libraries and their indexed byte sources. */
export class CjsToolAudioRepository
{

    #cache;

    #defaultLanguage;

    #indexes;

    #libraries = new Map();

    #targets;

    constructor({
        cache = new CjsToolCache(),
        indexes,
        targets = new CjsToolTargetRegistry(),
        defaultLanguage = null,
    } = {})
    {
        if (!(cache instanceof CjsToolCache))
        {
            throw new TypeError("CjsToolAudioRepository cache must be a CjsToolCache");
        }

        if (!indexes
            || typeof indexes.OpenTarget !== "function"
            || typeof indexes.ResolveTargetBuild !== "function")
        {
            throw new TypeError(
                "CjsToolAudioRepository indexes must open and resolve target builds",
            );
        }

        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError(
                "CjsToolAudioRepository targets must be a CjsToolTargetRegistry",
            );
        }

        this.#cache = cache;
        this.#indexes = indexes;
        this.#targets = targets;
        this.#defaultLanguage = defaultLanguage === null
            || defaultLanguage === undefined
            ? null
            : String(defaultLanguage).trim().toLowerCase();
        Object.freeze(this);
    }

    /** Opens one prepared library together with its immutable indexed source. */
    async OpenTarget(target, build)
    {
        const resolvedTarget = this.#targets.RequireLibrary(
            this.#targets.Resolve({ target }),
            "audio",
        );
        const sourceIdentity = await this.#ResolveBuild(resolvedTarget, build);
        const key = `${resolvedTarget.id}\0${sourceIdentity.build}`;

        if (!this.#libraries.has(key))
        {
            const loading = this.#Load(resolvedTarget, sourceIdentity).catch(error =>
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
            return Object.freeze({
                build: utils.normalizeExactBuild(build),
                client: target.client,
            });
        }
        catch
        {
            const resolved = await this.#indexes.ResolveTargetBuild(target.id, build);

            return Object.freeze({
                build: utils.normalizeExactBuild(resolved.build),
                client: resolved.client ?? target.client,
            });
        }
    }

    async #Load(target, sourceIdentity)
    {
        let data = null;

        for (const version of [ "v2", "v1" ])
        {
            const filePath = this.#cache.GetCustomPath({
                game: target.game,
                provider: target.provider,
                build: sourceIdentity.build,
                name: "audio",
                version,
            });

            try
            {
                data = JSON.parse(await fs.readFile(filePath, "utf8"));
                break;
            }
            catch (error)
            {
                if (error?.code !== "ENOENT")
                {
                    throw error;
                }
            }
        }

        if (data === null)
        {
            const missing = new Error(
                `Audio library is not prepared for ${target.id} build `
                + sourceIdentity.build,
            );

            missing.statusCode = 404;
            throw missing;
        }

        const library = data
            && typeof data === "object"
            && !Array.isArray(data)
            && data.audio
            && typeof data.audio === "object"
            && !Array.isArray(data.audio)
            && data.audio.schema === "carbonenginejs.audioLibrary"
                ? data.audio
                : data;
        const source = await this.#indexes.OpenTarget(
            target.id,
            sourceIdentity.build,
            { client: sourceIdentity.client ?? undefined },
        );

        return new CjsToolAudioSource({
            library,
            source,
            defaultLanguage: this.#defaultLanguage,
        });
    }

}
