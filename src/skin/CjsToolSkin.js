import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";
import { CJS_SKIN_TABLES, CjsToolSkinBuilder } from "./CjsToolSkinBuilder.js";
import { CJS_SKINR_TABLES, CjsToolSkinrBuilder } from "./CjsToolSkinrBuilder.js";

const SkinTables = Object.freeze([ ...new Set([
    ...CJS_SKIN_TABLES,
    ...CJS_SKINR_TABLES,
]) ]);

/** Front-facing exact-build builders for offline SKIN and SKINR libraries. */
export class CjsToolSkin
{

    #targets;

    constructor({ targets = new CjsToolTargetRegistry() } = {})
    {
        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("CjsToolSkin targets must be a CjsToolTargetRegistry");
        }

        this.#targets = targets;
        Object.freeze(this);
    }

    /** Resolves and verifies one target supported by both skin builders. */
    ResolveTarget({ target, game, provider } = {})
    {
        const resolved = this.#targets.Resolve({ target, game, provider });

        this.#targets.RequireLibrary(resolved, "skin");
        this.#targets.RequireLibrary(resolved, "skinr");

        return resolved;
    }

    /** Builds the developer-authored SKIN library from already-loaded tables. */
    BuildSkin(options = {})
    {
        return CjsToolSkinBuilder.build(this.#NormalizeOptions(options));
    }

    /** Builds the player-authored SKINR library from already-loaded tables. */
    BuildSkinr(options = {})
    {
        return CjsToolSkinrBuilder.build(this.#NormalizeOptions(options));
    }

    /** Loads required tables once and builds both exact-source libraries. */
    async BuildAllFromSource(source)
    {
        if (!source || typeof source.LoadTables !== "function")
        {
            throw new TypeError("SKIN source must provide LoadTables(names)");
        }

        const tables = await source.LoadTables(SkinTables);
        const options = {
            tables,
            sourceTarget: source.target,
            sourceGame: source.game,
            sourceProvider: source.provider,
            sourceBuild: source.build,
        };

        return Object.freeze({
            skin: this.BuildSkin(options),
            skinr: this.BuildSkinr(options),
        });
    }

    static buildSkin(options = {})
    {
        return new this().BuildSkin(options);
    }

    static buildSkinr(options = {})
    {
        return new this().BuildSkinr(options);
    }

    static buildAllFromSource(source)
    {
        return new this().BuildAllFromSource(source);
    }

    #NormalizeOptions(options)
    {
        const target = this.ResolveTarget({
            target: options.sourceTarget,
            game: options.sourceGame,
            provider: options.sourceProvider,
        });
        const sourceBuild = utils.normalizeExactBuild(options.sourceBuild, {
            message: `CjsToolSkin requires an exact source build: ${options.sourceBuild}`,
        });

        return {
            ...options,
            sourceTarget: target.id,
            sourceGame: target.game,
            sourceProvider: target.provider,
            sourceBuild,
        };
    }

}
