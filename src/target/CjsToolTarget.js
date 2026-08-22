import {
    normalizeBuildReference,
    normalizeGame,
    normalizeProviderId,
} from "../indexing/CjsToolIndexTargetProfile.js";

const TargetIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;

/** Immutable public target identity with game/provider provenance metadata. */
export class CjsToolTarget
{

    /** Creates a target profile target from caller-supplied configuration. */
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
        this.overlaySources = Object.freeze(normalizeOverlaySources(data.overlaySources ?? []));
        this.topicSources = Object.freeze(normalizeTopicSources(
            data.topicSources ?? {},
            this.topics,
        ));

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

    /** Resolves the target that supplies one advertised topic. */
    ResolveTopicSource(value)
    {
        const topic = normalizeTopicName(value);

        if (!this.topics.includes(topic))
        {
            const error = new Error(`Topic ${topic} is not available for target ${this.id}`);

            error.statusCode = 404;
            throw error;
        }

        return this.topicSources[topic] ?? this.id;
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

    /** Returns the serializable metadata form of this target profile. */
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

    /** Creates a validated profile or target value from plain caller input. */
    static from(value)
    {
        return value instanceof this ? value : new this(value);
    }

}

/** Validates and canonicalizes one caller-supplied target identifier. */
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

function normalizeOverlaySources(value)
{
    if (!Array.isArray(value))
    {
        throw new TypeError("Tool target overlay sources must be an array");
    }

    const targets = new Set();

    return value.map(item =>
    {
        if (!item || typeof item !== "object" || Array.isArray(item))
        {
            throw new TypeError("Tool target overlay source must be an object");
        }

        const target = normalizeTargetId(item.target);

        if (targets.has(target))
        {
            throw new TypeError(`Duplicate tool target overlay source: ${target}`);
        }
        if (!Array.isArray(item.names) || item.names.length === 0)
        {
            throw new TypeError("Tool target overlay source names must be a non-empty array");
        }

        targets.add(target);

        return Object.freeze({
            target,
            names: Object.freeze([...new Set(item.names.map(normalizeProviderId))].sort()),
        });
    });
}

function normalizeTopicSources(value, topics)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError("Tool target topic sources must be an object");
    }

    const result = {};

    for (const [ topicValue, targetValue ] of Object.entries(value))
    {
        const topic = normalizeTopicName(topicValue);

        if (!topics.includes(topic))
        {
            throw new TypeError(`Tool target topic source is not advertised: ${topic}`);
        }

        result[topic] = normalizeTargetId(targetValue);
    }

    return result;
}

function normalizeTopicName(value)
{
    return normalizeProviderId(value);
}
