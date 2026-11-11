import { CjsToolCharacterBuilder } from "./CjsToolCharacterBuilder.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";

/** Front-facing exact-target character-library build tool. */
export class CjsToolCharacter
{

    #targets = null;

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

    /**
     * Builds the character library of one exact build's source, after checking its target is character-capable.
     * @param {object} source The exact-build source (`CjsToolIndex.OpenTarget`), with its `target`.
     * @returns {Promise<import("@carbonenginejs/runtime/character").CjsCharacterLibrary>} The library.
     */
    async Build(source)
    {
        this.ResolveTarget({ target: source.target ?? undefined });
        return CjsToolCharacterBuilder.buildFromSource(source);
    }

}
