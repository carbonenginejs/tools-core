import { WriteDerivation } from "../CjsToolSdeDerivations.js";
import { CjsToolSdeTables } from "./CjsToolSdeTables.js";

/** Writes one profile-assembled table set through the canonical SDE database. */
export class CjsToolSdeBuild
{

    #tables;

    /** Creates a SDE build sde build from caller-supplied configuration. */
    constructor(tables, options = {})
    {
        if (!(tables instanceof CjsToolSdeTables))
        {
            throw new TypeError("SDE build requires CjsToolSdeTables");
        }

        this.#tables = tables;
        this.profile = tables.profile;
        this.client = NormalizeOptionalText(options.client);
        this.context = options.context && typeof options.context === "object"
            ? options.context
            : {};
        this.allowIncomplete = options.allowIncomplete === true;
        ValidateIdentity(this.profile, options.target ?? options.identity);
    }

    /** Returns immutable metadata describing this completed SDE build. */
    Metadata()
    {
        if (this.#tables.build === null)
        {
            const error = new TypeError("SDE build requires the exact client build it was assembled from");

            error.code = "CJS_TOOL_SDE_BUILD_MISSING";
            throw error;
        }

        return {
            target: this.profile.target,
            game: this.profile.game,
            provider: this.profile.provider,
            build: this.#tables.build,
            source: {
                kind: "client-static-data",
                client: this.client,
                tables: this.#tables.tables,
            },
        };
    }

    /**
     * Writes every projected SDE artifact beneath the selected target-rooted
     * build directory.
     */
    async WriteTo(database)
    {
        if (!database || typeof database.ImportTables !== "function")
        {
            throw new TypeError("SDE build requires a database exposing ImportTables()");
        }
        if (!this.allowIncomplete && !this.#tables.IsComplete())
        {
            const missingTables = this.#tables.MissingTables();
            const error = new Error(`SDE build is missing required tables: ${missingTables.join(", ")}`);

            error.code = "CJS_TOOL_SDE_INCOMPLETE";
            error.missingTables = missingTables;
            throw error;
        }

        const { build, ...tables } = this.#tables.ToSdeData();
        const metadata = this.Metadata();
        const imported = await database.ImportTables(tables, metadata);
        const derivations = await this.profile.RunDerivations({
            ...this.context,
            database,
            metadata,
            profile: this.profile,
            tables,
        });

        if (derivations.length && !database.filePath)
        {
            throw new TypeError("Named SDE derivations require a database filePath");
        }

        for (const derivation of derivations)
        {
            await WriteDerivation(
                database.filePath,
                derivation.name,
                derivation.document,
                metadata,
            );
        }

        void build;
        return imported;
    }

    /** Returns the stable cache key for this target, build, and profile. */
    CachePathKey(version = "v1")
    {
        return {
            target: this.profile.target,
            build: this.#tables.build,
            name: "sde",
            version,
            extension: "sqlite",
        };
    }

}

function ValidateIdentity(profile, value)
{
    if (value === undefined || value === null) return;

    const identity = typeof value === "string" ? { target: value } : value;
    const target = String(identity?.target ?? identity?.id ?? "").trim().toLowerCase();

    if (target !== profile.target)
    {
        throw new TypeError(`SDE build profile ${profile.target} cannot write target ${target}`);
    }
    if (identity.game !== undefined
        && String(identity.game).trim().toLowerCase() !== profile.game.toLowerCase())
    {
        throw new TypeError(`SDE build target ${target} does not use game ${identity.game}`);
    }
    if (identity.provider !== undefined
        && String(identity.provider).trim().toLowerCase() !== profile.provider)
    {
        throw new TypeError(`SDE build target ${target} does not use provider ${identity.provider}`);
    }
}

function NormalizeOptionalText(value)
{
    if (value === undefined || value === null) return null;

    const text = String(value).trim();

    return text || null;
}
