import {
    CjsAudioLibraryBuilder,
} from "@carbonenginejs/runtime-audio/library-builder";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";

const TargetRegistry = new CjsToolTargetRegistry();

/**
 * Node target-policy wrapper around the runtime-owned audio-library builder.
 *
 * Acquisition, cache, CLI, and target policy remain in tools-core. The
 * deterministic multi-source join is shared with browser applications.
 */
export class CjsToolAudioBuilder extends CjsAudioLibraryBuilder
{

    /** Builds one target-validated source catalog. */
    static build(options = {}, { targets = TargetRegistry } = {})
    {
        return CjsAudioLibraryBuilder.build(
            ResolveTargetOptions(options, targets),
        );
    }

    /** Builds one target-validated complete event/media library. */
    static buildFromBanks(options = {}, { targets = TargetRegistry } = {})
    {
        return CjsAudioLibraryBuilder.buildFromBanks(
            ResolveTargetOptions(options, targets),
        );
    }

}

function ResolveTargetOptions(options, targets)
{
    const {
        sourceTarget,
        sourceGame,
        sourceProvider,
    } = options;

    if ([ sourceTarget, sourceGame, sourceProvider ].every(value =>
        value === null || value === undefined))
    {
        return options;
    }
    if (!(targets instanceof CjsToolTargetRegistry))
    {
        throw new TypeError(
            "Audio library targets must be a CjsToolTargetRegistry",
        );
    }

    const target = targets.RequireLibrary(targets.Resolve({
        target: sourceTarget ?? undefined,
        game: sourceGame ?? undefined,
        provider: sourceProvider ?? undefined,
    }), "audio");

    return {
        ...options,
        sourceTarget: target.id,
        sourceGame: target.game,
        sourceProvider: target.provider,
    };
}
