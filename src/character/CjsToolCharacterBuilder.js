import {
    CjsCharacterLibraryBuilder,
} from "@carbonenginejs/runtime-character/library-builder";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";

const TargetRegistry = new CjsToolTargetRegistry();

/** Node target-policy wrapper around the runtime-owned character builder. */
export class CjsToolCharacterBuilder extends CjsCharacterLibraryBuilder
{

    /** Builds one combined model-shaped document from caller-supplied maps. */
    static build(documents = {}, options = {}, { targets = TargetRegistry } = {})
    {
        return CjsCharacterLibraryBuilder.build(
            documents,
            ResolveTargetOptions(options, targets)
        );
    }

    /** Builds from one acquisition-adapter input object. */
    static buildFromInputs(input = {}, { targets = TargetRegistry } = {})
    {
        if (!input || typeof input !== "object" || Array.isArray(input))
        {
            throw new TypeError("Character library builder input must be an object");
        }

        const { documents, ...options } = input;

        return this.build(documents, options, { targets });
    }

    /** Builds one hydrated library through the runtime-owned resource path. */
    static buildFromResources(options = {}, { targets = TargetRegistry } = {})
    {
        return CjsCharacterLibraryBuilder.buildFromResources(
            ResolveTargetOptions(options, targets)
        );
    }

}

function ResolveTargetOptions(options, targets)
{
    const {
        sourceTarget,
        sourceGame,
        sourceProvider,
        sourceBuild,
    } = options;

    if ([ sourceTarget, sourceGame, sourceProvider ].every(value =>
        value === null || value === undefined))
    {
        return sourceBuild === null || sourceBuild === undefined
            ? options
            : {
                ...options,
                sourceBuild: NormalizeBuild(sourceBuild),
            };
    }

    if (!(targets instanceof CjsToolTargetRegistry))
    {
        throw new TypeError(
            "Character library targets must be a CjsToolTargetRegistry"
        );
    }

    const target = targets.RequireLibrary(targets.Resolve({
        target: sourceTarget ?? undefined,
        game: sourceGame ?? undefined,
        provider: sourceProvider ?? undefined,
    }), "character");

    return {
        ...options,
        sourceTarget: target.id,
        sourceGame: target.game,
        sourceProvider: target.provider,
        sourceBuild: NormalizeBuild(sourceBuild),
    };
}

function NormalizeBuild(value)
{
    return utils.normalizeExactBuild(value, {
        message: `Character library builder requires an exact source build: ${value}`,
    });
}
