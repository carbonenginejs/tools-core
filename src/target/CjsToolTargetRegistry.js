import { CjsToolTarget, normalizeTargetId } from "./CjsToolTarget.js";
import { DefaultTargetData } from "./defaultTargets.js";
import { normalizeGame, normalizeProviderId } from "../indexing/CjsIndexProvider.js";

/** Immutable registry for short public target aliases. */
export class CjsToolTargetRegistry
{

    #targets;

    constructor(targets = DefaultTargetData)
    {
        this.#targets = new Map();

        for (const value of targets)
        {
            const target = CjsToolTarget.from(value);

            if (this.#targets.has(target.id))
            {
                throw new TypeError(`Duplicate target: ${target.id}`);
            }

            this.#targets.set(target.id, target);
        }

        if (!this.#targets.size)
        {
            throw new TypeError("Target registry requires at least one target");
        }

        this.defaultTarget = this.#targets.keys().next().value;
        Object.freeze(this);
    }

    Get(value = this.defaultTarget)
    {
        const id = normalizeTargetId(value);
        const target = this.#targets.get(id);

        if (!target)
        {
            const error = new Error(`Target not found: ${id}`);

            error.statusCode = 404;
            throw error;
        }

        return target;
    }

    Find(game, provider)
    {
        const normalizedGame = normalizeGame(game);
        const normalizedProvider = normalizeProviderId(provider);

        return this.List().find((target) =>
            target.game === normalizedGame && target.provider === normalizedProvider) ?? null;
    }

    Resolve({ target, game, provider } = {})
    {
        if (target !== undefined && target !== null)
        {
            const resolved = this.Get(target);

            if (game !== undefined && normalizeGame(game) !== resolved.game)
            {
                throw new Error(`Target ${resolved.id} does not use game ${game}`);
            }

            if (provider !== undefined && normalizeProviderId(provider) !== resolved.provider)
            {
                throw new Error(`Target ${resolved.id} does not use provider ${provider}`);
            }

            return resolved;
        }

        if (game === undefined && provider === undefined)
        {
            return this.Get();
        }

        if (game === undefined || provider === undefined)
        {
            throw new TypeError("Target resolution requires both game and provider");
        }

        const resolved = this.Find(game, provider);

        if (!resolved)
        {
            throw new Error(`Target not found for ${game}/${provider}`);
        }

        return resolved;
    }

    RequireLibrary(target, library)
    {
        const resolved = typeof target === "string" ? this.Get(target) : CjsToolTarget.from(target);

        if (!resolved.SupportsLibrary(library))
        {
            throw new Error(`${library} library builder does not support target ${resolved.id}`);
        }

        return resolved;
    }

    /** Requires a public data topic audited for one target. */
    RequireTopic(target, topic)
    {
        const resolved = typeof target === "string" ? this.Get(target) : CjsToolTarget.from(target);

        if (!resolved.SupportsTopic(topic))
        {
            const error = new Error(`Topic ${topic} is not available for target ${resolved.id}`);

            error.statusCode = 404;
            throw error;
        }

        return resolved;
    }

    List()
    {
        return Object.freeze([...this.#targets.values()]);
    }

}
