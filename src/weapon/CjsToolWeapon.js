import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";
import { CJS_WEAPON_TABLES, CjsToolWeaponBuilder } from "./CjsToolWeaponBuilder.js";

/** Front-facing exact-build builder for the offline weapon library. */
export class CjsToolWeapon
{

    #targets;

    constructor({ targets = new CjsToolTargetRegistry() } = {})
    {
        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("CjsToolWeapon targets must be a CjsToolTargetRegistry");
        }

        this.#targets = targets;
        Object.freeze(this);
    }

    ResolveTarget({ target, game, provider } = {})
    {
        const resolved = this.#targets.Resolve({ target, game, provider });

        this.#targets.RequireLibrary(resolved, "weapons");

        return resolved;
    }

    Build(options = {})
    {
        const target = this.ResolveTarget({
            target: options.sourceTarget,
            game: options.sourceGame,
            provider: options.sourceProvider,
        });
        const sourceBuild = utils.normalizeExactBuild(options.sourceBuild, {
            message: `CjsToolWeapon requires an exact source build: ${options.sourceBuild}`,
        });

        return CjsToolWeaponBuilder.build({
            ...options,
            sourceTarget: target.id,
            sourceGame: target.game,
            sourceProvider: target.provider,
            sourceBuild,
        });
    }

    async BuildFromSource(source)
    {
        if (!source || typeof source.LoadTables !== "function")
        {
            throw new TypeError("Weapon source must provide LoadTables(names)");
        }

        return this.Build({
            tables: await source.LoadTables(CJS_WEAPON_TABLES),
            sourceTarget: source.target,
            sourceGame: source.game,
            sourceProvider: source.provider,
            sourceBuild: source.build,
        });
    }

    static build(options = {})
    {
        return new this().Build(options);
    }

    static buildFromSource(source)
    {
        return new this().BuildFromSource(source);
    }

}

