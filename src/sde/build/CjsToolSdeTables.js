import { CjsToolSdeBuildProfile } from "./CjsToolSdeBuildProfile.js";

/** Assembles decoded and projected SDE tables for one exact target build. */
export class CjsToolSdeTables
{

    #tables;

    /** Creates a SDE build sde tables from caller-supplied configuration. */
    constructor(profile, options = {})
    {
        if (!(profile instanceof CjsToolSdeBuildProfile))
        {
            throw new TypeError("SDE tables require a CjsToolSdeBuildProfile");
        }

        this.profile = profile;
        this.build = NormalizeBuild(options.build);
        this.#tables = new Map();
    }

    /** Returns the names of every decoded table currently held by the build. */
    get tables()
    {
        return Object.freeze([ ...this.#tables.keys() ]);
    }

    /** Adds one decoded source table without applying public projections. */
    AddDecodedTable(table, records)
    {
        const source = this.profile.GetSource(table);

        if (!source)
        {
            const error = new TypeError(`Unknown SDE table for target ${this.profile.target}: ${table}`);

            error.code = "CJS_TOOL_SDE_TABLE_UNKNOWN";
            throw error;
        }
        if (!records || typeof records !== "object")
        {
            const error = new TypeError(`SDE table ${table} requires decoded records`);

            error.code = "CJS_TOOL_SDE_RECORDS_INVALID";
            throw error;
        }

        this.#tables.set(
            source.table,
            records instanceof Map ? Object.fromEntries(records) : records,
        );

        return this;
    }

    /** Returns one decoded source table by its canonical name. */
    GetTable(table)
    {
        return this.#tables.get(String(table)) ?? null;
    }

    /** Returns required source-table names that have not yet been supplied. */
    MissingTables()
    {
        return this.profile.ListSources()
            .filter(source => source.required && !this.#tables.has(source.table))
            .map(source => source.table);
    }

    /** Reports whether every source table required by this profile is present. */
    IsComplete()
    {
        return this.MissingTables().length === 0;
    }

    /** Builds the neutral input object consumed by SDE projection functions. */
    ToSdeData()
    {
        return { build: this.build, ...Object.fromEntries(this.#tables) };
    }

    /** Returns unresolved source descriptors required to complete this build. */
    PendingSources()
    {
        return this.profile.ListSources()
            .filter(source => source.required && source.path && !this.#tables.has(source.table));
    }

}

function NormalizeBuild(value)
{
    if (value === undefined || value === null) return null;

    const build = String(value).trim();

    if (!/^\d+$/u.test(build))
    {
        const error = new TypeError(`SDE tables require an exact numeric build, not ${value}`);

        error.code = "CJS_TOOL_SDE_BUILD_INVALID";
        throw error;
    }

    return build;
}
