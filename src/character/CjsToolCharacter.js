import { CjsToolCharacterAssembler } from "./CjsToolCharacterAssembler.js";
import { CjsToolCharacterCompiler } from "./CjsToolCharacterCompiler.js";
import { CjsToolCharacterSerializer } from "./CjsToolCharacterSerializer.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";

/** Front-facing normalized character-library build tool. */
export class CjsToolCharacter
{

    #targets;

    constructor({ targets = new CjsToolTargetRegistry() } = {})
    {
        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("CjsToolCharacter targets must be a CjsToolTargetRegistry");
        }

        this.#targets = targets;
        Object.freeze(this);
    }

    /** Resolves and verifies one target supported by the character builder. */
    ResolveTarget({ target, game, provider } = {})
    {
        return this.#targets.RequireLibrary(this.#targets.Resolve({
            target,
            game,
            provider,
        }), "character");
    }

    /** Assembles normalized catalogs into the expanded library shape. */
    Assemble(catalogs = {}, options = {})
    {
        const target = this.ResolveTarget({
            target: options.sourceTarget,
            game: options.sourceGame,
            provider: options.sourceProvider,
        });
        const sourceBuild = utils.normalizeExactBuild(options.sourceBuild, {
            message: `CjsToolCharacter requires an exact source build: ${options.sourceBuild}`,
        });

        return CjsToolCharacterAssembler.assemble(catalogs, {
            ...options,
            sourceTarget: target.id,
            sourceGame: target.game,
            sourceProvider: target.provider,
            sourceBuild,
        }, { targets: this.#targets });
    }

    /** Compiles an expanded library into its canonical compact JSON shape. */
    Compile(data, options = {})
    {
        return CjsToolCharacterCompiler.compile(data, options);
    }

    /** Removes source records and source IDs from one freshly assembled library. */
    OmitSourceProvenance(data)
    {
        return CjsToolCharacterCompiler.omitSourceProvenance(data);
    }

    /** Assembles and compiles one target-specific deterministic library. */
    Build(catalogs = {}, options = {})
    {
        const expanded = this.Assemble(catalogs, options);

        if (options.includeSources !== true)
        {
            this.OmitSourceProvenance(expanded);
        }

        return this.Compile(expanded, {
            partSourceResources: options.partSourceResources,
        });
    }

    /** Expands a compact library for runtime hydration or further tooling. */
    Expand(data)
    {
        return CjsToolCharacterCompiler.expand(data);
    }

    /** Serializes a library with deterministic key ordering. */
    Stringify(data, options = {})
    {
        return CjsToolCharacterSerializer.stringify(data, options);
    }

    static build(catalogs = {}, options = {})
    {
        return new this().Build(catalogs, options);
    }

    static assemble(catalogs = {}, options = {})
    {
        return new this().Assemble(catalogs, options);
    }

}
