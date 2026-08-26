import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";
import { CJS_WEAPON_TABLES, CjsToolWeaponBuilder } from "./CjsToolWeaponBuilder.js";

/** Front-facing exact-build builder for the offline weapon library. */
export class CjsToolWeapon
{

    #targets;

    /**
     * Binds offline weapon builds to the registry of targets that support the
     * library.
     */
    constructor({ targets = new CjsToolTargetRegistry() } = {})
    {
        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("CjsToolWeapon targets must be a CjsToolTargetRegistry");
        }

        this.#targets = targets;
        Object.freeze(this);
    }

    /**
     * Resolves target metadata and requires that the selected target supports
     * weapon artifacts.
     */
    ResolveTarget({ target, game, provider } = {})
    {
        const resolved = this.#targets.Resolve({ target, game, provider });

        this.#targets.RequireLibrary(resolved, "weapons");

        return resolved;
    }

    /**
     * Validates source identity and delegates deterministic weapon-library
     * construction to the table builder.
     */
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

    /**
     * Loads the required tables and builds a weapon artifact using the source's
     * exact identity.
     */
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

    /** Runs a one-shot table-backed weapon build with default services. */
    static build(options = {})
    {
        return new this().Build(options);
    }

    /** Runs a one-shot source-backed weapon build with default services. */
    static buildFromSource(source)
    {
        return new this().BuildFromSource(source);
    }

}

