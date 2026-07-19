import { CjsToolAudioBuilder } from "./CjsToolAudioBuilder.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";

/** Front-facing audio-library build tool. */
export class CjsToolAudio
{

    #targets;

    constructor({ targets = new CjsToolTargetRegistry() } = {})
    {
        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("CjsToolAudio targets must be a CjsToolTargetRegistry");
        }

        this.#targets = targets;
        Object.freeze(this);
    }

    /** Resolves and verifies one target supported by the audio builder. */
    ResolveTarget({ target, game, provider } = {})
    {
        return this.#targets.RequireLibrary(this.#targets.Resolve({
            target,
            game,
            provider,
        }), "audio");
    }

    /** Builds one target-specific deterministic audio library. */
    Build(options = {})
    {
        const target = this.ResolveTarget({
            target: options.sourceTarget,
            game: options.sourceGame,
            provider: options.sourceProvider,
        });
        const sourceBuild = utils.normalizeExactBuild(options.sourceBuild, {
            message: `CjsToolAudio requires an exact source build: ${options.sourceBuild}`,
        });

        return CjsToolAudioBuilder.build({
            ...options,
            sourceTarget: target.id,
            sourceGame: target.game,
            sourceProvider: target.provider,
            sourceBuild,
        }, { targets: this.#targets });
    }

    static build(options = {})
    {
        return new this().Build(options);
    }

}
