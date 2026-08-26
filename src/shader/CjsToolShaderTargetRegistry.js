import { CjsToolShaderTarget } from "./CjsToolShaderTarget.js";
import { DefaultShaderTargetData } from "./defaultShaderTargets.js";
import { normalizeTargetId } from "../target/CjsToolTarget.js";

/** Immutable registry of audited compiled-shader targets. */
export class CjsToolShaderTargetRegistry
{

    #targets;

    /**
     * Builds an immutable-by-contract lookup of unique shader target
     * definitions.
     */
    constructor(targets = DefaultShaderTargetData)
    {
        this.#targets = new Map();

        for (const value of targets)
        {
            const target = CjsToolShaderTarget.from(value);

            if (this.#targets.has(target.id))
            {
                throw new TypeError(`Duplicate shader target: ${target.id}`);
            }

            this.#targets.set(target.id, target);
        }

        Object.freeze(this);
    }

    /** Returns a required target definition or throws a coded not-found error. */
    Get(value)
    {
        const id = normalizeTargetId(value);
        const target = this.#targets.get(id);

        if (!target)
        {
            const error = new Error(`Shader target not found: ${id}`);

            error.statusCode = 404;
            throw error;
        }

        return target;
    }

    /** Finds the definition matching a tool target and normalized output profile. */
    Find(target, outputProfile)
    {
        const targetId = normalizeTargetId(target);
        const profile = String(outputProfile ?? "").trim().toLowerCase();

        return this.List().find((entry) =>
            entry.target === targetId && entry.outputProfile === profile) ?? null;
    }

    /** Returns a frozen snapshot of every registered target definition. */
    List()
    {
        return Object.freeze([...this.#targets.values()]);
    }

}
