import {
    normalizeBuildReference,
    normalizeGame,
    normalizeProviderId,
} from "../indexing/CjsIndexProvider.js";

const TargetIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;

/** Immutable public target alias over one internal game/provider identity. */
export class CjsToolTarget
{

    constructor(data)
    {
        if (!data || typeof data !== "object" || Array.isArray(data))
        {
            throw new TypeError("Tool target must be an object");
        }

        this.id = normalizeTargetId(data.id);
        this.game = normalizeGame(data.game);
        this.provider = normalizeProviderId(data.provider);
        this.client = data.client === undefined || data.client === null
            ? null
            : normalizeBuildReference(data.client);
        this.libraries = Object.freeze(normalizeLibraries(data.libraries ?? []));
        this.topics = Object.freeze(normalizeTopics(data.topics ?? []));

        Object.freeze(this);
    }

    /** Checks whether a library builder has been audited for this target. */
    SupportsLibrary(value)
    {
        return this.libraries.includes(normalizeLibraryName(value));
    }

    /** Checks whether a public data topic exists for this target. */
    SupportsTopic(value)
    {
        return this.topics.includes(normalizeTopicName(value));
    }

    /** Creates internal index options for this target. */
    CreateIndexOptions({ build = "latest", client = this.client } = {})
    {
        return Object.freeze({
            target: this.id,
            game: this.game,
            provider: this.provider,
            build: normalizeBuildReference(build),
            client,
        });
    }

    toJSON()
    {
        return {
            id: this.id,
            game: this.game,
            provider: this.provider,
            client: this.client,
            libraries: this.libraries,
            topics: this.topics,
        };
    }

    static from(value)
    {
        return value instanceof this ? value : new this(value);
    }

}

export function normalizeTargetId(value)
{
    const id = String(value ?? "").trim().toLowerCase();

    if (!TargetIdPattern.test(id))
    {
        throw new TypeError(`Invalid target id: ${value}`);
    }

    return id;
}

function normalizeLibraries(value)
{
    if (!Array.isArray(value))
    {
        throw new TypeError("Tool target libraries must be an array");
    }

    return [...new Set(value.map(normalizeLibraryName))].sort();
}

function normalizeLibraryName(value)
{
    return normalizeProviderId(value);
}

function normalizeTopics(value)
{
    if (!Array.isArray(value))
    {
        throw new TypeError("Tool target topics must be an array");
    }

    return [...new Set(value.map(normalizeTopicName))].sort();
}

function normalizeTopicName(value)
{
    return normalizeProviderId(value);
}
