import { CjsToolCharacterBuilder } from "./CjsToolCharacterBuilder.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";

/** Front-facing exact-target character-library build tool. */
export class CjsToolCharacter
{

    #targets;

    /** Creates a character tool with an optional target registry. */
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

    /** Builds one target-specific schema-v6 combined character library. */
    Build(documents = {}, options = {})
    {
        const target = this.ResolveTarget({
            target: options.sourceTarget,
            game: options.sourceGame,
            provider: options.sourceProvider,
        });
        const sourceBuild = utils.normalizeExactBuild(options.sourceBuild, {
            message: `CjsToolCharacter requires an exact source build: ${options.sourceBuild}`,
        });

        return CjsToolCharacterBuilder.build(documents, {
            ...options,
            sourceTarget: target.id,
            sourceGame: target.game,
            sourceProvider: target.provider,
            sourceBuild,
        }, { targets: this.#targets });
    }

    /** Builds through a temporary target-aware character tool. */
    static build(documents = {}, options = {})
    {
        return new this().Build(documents, options);
    }

}
