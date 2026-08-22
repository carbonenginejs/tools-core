import { normalizeTargetId } from "../../target/CjsToolTarget.js";
import {
    normalizeGame,
    normalizeProviderId,
} from "../../indexing/CjsToolIndexTargetProfile.js";
import { ProjectRecords } from "./projectRecords.js";

/**
 * Immutable policy for assembling one target's exact-build SDE.
 *
 * Target selects the profile. Game and provider are provenance metadata only;
 * neither is consulted to choose sources, readers, projections or outputs.
 */
export class CjsToolSdeBuildProfile
{

    #derivations;

    #projectors;

    #readers;

    #sources;

    /** Creates a SDE build sde build profile from caller-supplied configuration. */
    constructor(data = {})
    {
        this.target = normalizeTargetId(data.target);
        this.game = normalizeGame(data.game);
        this.provider = normalizeProviderId(data.provider);
        this.#sources = NormalizeSources(data.sources ?? []);
        this.#readers = NormalizeNamedValues(data.readers ?? {}, "reader");
        this.projections = NormalizeNamedValues(data.projections ?? {}, "projection");
        this.#projectors = NormalizeFunctions(data.projectors ?? {}, "projector");
        this.#derivations = NormalizeDerivations(data.derivations ?? []);

        Object.freeze(this);
    }

    /** Returns all source descriptors in deterministic declaration order. */
    ListSources()
    {
        return Object.freeze([ ...this.#sources.values() ]);
    }

    /** Returns one source descriptor, or null when this profile does not supply it. */
    GetSource(table)
    {
        return this.#sources.get(NormalizeName(table, "table")) ?? null;
    }

    /** Returns all source descriptors carried by one container family. */
    SourcesByContainer(container)
    {
        const value = container === null ? null : NormalizeName(container, "container");

        return Object.freeze(this.ListSources().filter(source => source.container === value));
    }

    /** Returns the reviewed reader selection for a table, or null. */
    GetReader(table)
    {
        return this.#readers[NormalizeName(table, "table")] ?? null;
    }

    /** Projects decoded records according to this target profile. */
    Project(table, records, context = {})
    {
        const name = NormalizeName(table, "table");
        const projector = this.#projectors[name];

        if (projector) return projector(records, context);

        const projection = this.projections[name];

        return projection ? ProjectRecords(records, projection, context) : records;
    }

    /** Runs profile-specific named derivations after the canonical import. */
    async RunDerivations(context)
    {
        const documents = [];

        for (const derivation of this.#derivations)
        {
            const document = await derivation.Build(context);

            if (document !== null && document !== undefined)
            {
                documents.push(Object.freeze({ name: derivation.name, document }));
            }
        }

        return Object.freeze(documents);
    }

    /** Returns public, serializable profile metadata. */
    toJSON()
    {
        return {
            target: this.target,
            game: this.game,
            provider: this.provider,
            sources: this.ListSources(),
            derivations: this.#derivations.map(({ name }) => name),
        };
    }

    /** Creates a validated profile or target value from plain caller input. */
    static from(value)
    {
        return value instanceof this ? value : new this(value);
    }

}

function NormalizeSources(values)
{
    if (!Array.isArray(values))
    {
        throw new TypeError("SDE build profile sources must be an array");
    }

    const result = new Map();

    for (const value of values)
    {
        if (!value || typeof value !== "object" || Array.isArray(value))
        {
            throw new TypeError("SDE build profile source must be an object");
        }

        const table = NormalizeName(value.table, "table");

        if (result.has(table))
        {
            throw new TypeError(`Duplicate SDE build source: ${table}`);
        }

        result.set(table, Object.freeze({
            ...value,
            table,
            path: value.path === null ? null : String(value.path),
            container: value.container === null
                ? null
                : NormalizeName(value.container, "container"),
            required: value.required === true,
        }));
    }

    if (!result.size)
    {
        throw new TypeError("SDE build profile requires at least one source");
    }

    return result;
}

function NormalizeNamedValues(value, label)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError(`SDE build profile ${label}s must be an object`);
    }

    return Object.freeze(Object.fromEntries(Object.entries(value).map(([ name, item ]) => [
        NormalizeName(name, `${label} table`),
        item,
    ])));
}

function NormalizeFunctions(value, label)
{
    const result = NormalizeNamedValues(value, label);

    for (const [ name, item ] of Object.entries(result))
    {
        if (typeof item !== "function")
        {
            throw new TypeError(`SDE build profile ${label} ${name} must be a function`);
        }
    }

    return result;
}

function NormalizeDerivations(value)
{
    if (!Array.isArray(value))
    {
        throw new TypeError("SDE build profile derivations must be an array");
    }

    const names = new Set();

    return Object.freeze(value.map(item =>
    {
        if (!item || typeof item !== "object" || Array.isArray(item))
        {
            throw new TypeError("SDE build profile derivation must be an object");
        }

        const name = NormalizeName(item.name, "derivation");

        if (names.has(name))
        {
            throw new TypeError(`Duplicate SDE build derivation: ${name}`);
        }
        if (typeof item.Build !== "function")
        {
            throw new TypeError(`SDE build derivation ${name} requires Build()`);
        }

        names.add(name);
        return Object.freeze({ name, Build: item.Build });
    }));
}

function NormalizeName(value, label)
{
    const name = String(value ?? "").trim();

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name))
    {
        throw new TypeError(`Invalid SDE build ${label}: ${value}`);
    }

    return name;
}
