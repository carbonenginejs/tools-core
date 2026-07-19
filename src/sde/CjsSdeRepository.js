import fs from "node:fs/promises";

import { CjsToolCache } from "../cache/CjsToolCache.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import { CjsSde } from "./CjsSde.js";
import { CjsSdeArchive, CJS_SDE_PREPARED_TABLES } from "./CjsSdeArchive.js";
import { CjsSdeDatabase } from "./CjsSdeDatabase.js";
import * as utils from "../utils.js";

/** Resolves target/build SDE requests to exact cached SQLite databases. */
export class CjsSdeRepository
{

    #archive;

    #cache;

    #open;

    #targets;

    constructor(options = {})
    {
        this.#archive = options.archive ?? new CjsSdeArchive();
        this.#cache = options.cache ?? new CjsToolCache();
        this.#targets = options.targets ?? new CjsToolTargetRegistry();
        this.#open = new Map();
        this.autoPrepare = options.autoPrepare === true;
        this.version = NormalizeVersion(options.version ?? "v1");

        if (!(this.#cache instanceof CjsToolCache))
        {
            throw new TypeError("CjsSdeRepository cache must be a CjsToolCache");
        }

        if (!(this.#targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("CjsSdeRepository targets must be a CjsToolTargetRegistry");
        }
    }

    /** Resolves `latest` independently against the official EVE SDE channel. */
    async ResolveTargetBuild(targetValue, buildValue = "latest")
    {
        const target = this.#targets.RequireTopic(targetValue, "sde");
        const buildRef = NormalizeBuildReference(buildValue);
        const latest = buildRef === "latest"
            ? await this.#archive.ResolveLatest()
            : null;
        const build = String(latest?.build ?? utils.normalizeExactBuildNumber(buildRef, {
            message: `Invalid exact SDE build "${buildRef}"`,
        }));

        return Object.freeze({
            target: target.id,
            game: target.game,
            provider: target.provider,
            buildRef,
            build,
            releaseDate: latest?.releaseDate ?? null,
            source: latest?.source ?? "exact-build",
        });
    }

    /** Opens one cached database, optionally preparing it on first request. */
    async OpenTarget(targetValue, buildValue = "latest")
    {
        const resolution = await this.ResolveTargetBuild(targetValue, buildValue);
        const key = `${resolution.target}:${resolution.build}:${this.version}`;

        if (!this.#open.has(key))
        {
            const opening = this.#Open(resolution).catch(error =>
            {
                this.#open.delete(key);
                throw error;
            });

            this.#open.set(key, opening);
        }

        return this.#open.get(key);
    }

    /** Closes every cached database handle. */
    async Close()
    {
        const sources = await Promise.allSettled(this.#open.values());

        this.#open.clear();

        for (const result of sources)
        {
            if (result.status === "fulfilled")
            {
                await result.value.Close();
            }
        }
    }

    async #Open(resolution)
    {
        const databasePath = this.#cache.GetCustomPath({
            game: resolution.game,
            provider: resolution.provider,
            build: resolution.build,
            name: "sde",
            version: this.version,
            extension: "sqlite",
        });
        let database;

        if (await FileExists(databasePath))
        {
            try
            {
                database = await CjsSdeDatabase.open(databasePath);
            }
            catch (error)
            {
                if (!this.autoPrepare)
                {
                    throw error;
                }

                database = await this.#archive.PrepareDatabase({
                    build: resolution.build,
                    releaseDate: resolution.releaseDate,
                    databasePath,
                });
            }
        }
        else if (this.autoPrepare)
        {
            database = await this.#archive.PrepareDatabase({
                build: resolution.build,
                releaseDate: resolution.releaseDate,
                databasePath,
            });
        }
        else
        {
            const error = new Error(
                `EVE SDE build ${resolution.build} is not prepared; run cjs-sde-prepare`,
            );

            error.statusCode = 404;
            throw error;
        }

        try
        {
            const metadata = await database.GetMetadata();

            if (String(metadata.build) !== resolution.build)
            {
                throw new Error(
                    `SDE database build mismatch: expected ${resolution.build}, `
                    + `received ${metadata.build}`,
                );
            }

            return new CjsSdeSource(database, resolution);
        }
        catch (error)
        {
            await database.Close();
            throw error;
        }
    }

}

/** Open exact-build SDE source used by service and direct callers. */
export class CjsSdeSource
{

    #database;

    #identity;

    constructor(database, resolution)
    {
        this.#database = database;
        this.#identity = null;
        Object.assign(this, resolution);
        Object.freeze(this);
    }

    /** Describes exact provenance and every available table. */
    async Describe()
    {
        const description = await this.#database.Describe();

        return Object.freeze({
            ...description,
            target: this.target,
            game: this.game,
            provider: this.provider,
            buildRef: this.buildRef,
            build: this.build,
        });
    }

    /** Returns a minimal wrapper over one official table. */
    Table(name)
    {
        return this.#database.Table(name);
    }

    /** Loads selected tables for specialized in-memory helpers. */
    async LoadTables(names)
    {
        return this.#database.LoadTables(names);
    }

    /** Resolves a type, graphic, skin, or name through the prepared identity view. */
    async Resolve(selection)
    {
        return (await this.#GetIdentity()).Resolve(selection);
    }

    /** Returns every exact name candidate from the prepared identity view. */
    async LookupName(name)
    {
        return (await this.#GetIdentity()).LookupName(name);
    }

    /** Returns punctuation-normalized name candidates from the identity view. */
    async SearchName(name)
    {
        return (await this.#GetIdentity()).SearchName(name);
    }

    /** Closes this source's database handle. */
    async Close()
    {
        await this.#database.Close();
    }

    async #GetIdentity()
    {
        if (!this.#identity)
        {
            this.#identity = this.LoadTables(CJS_SDE_PREPARED_TABLES)
                .then(tables => new CjsSde(tables));
        }

        return this.#identity;
    }

}

async function FileExists(filePath)
{
    try
    {
        await fs.access(filePath);
        return true;
    }
    catch (error)
    {
        if (error?.code === "ENOENT")
        {
            return false;
        }

        throw error;
    }
}

function NormalizeBuildReference(value)
{
    const build = String(value ?? "").trim().toLowerCase();

    if (build === "latest" || utils.isExactBuild(build))
    {
        return build;
    }

    throw new TypeError(`Invalid SDE build reference "${value}"`);
}

function NormalizeVersion(value)
{
    const version = String(value ?? "").trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(version))
    {
        throw new TypeError(`Invalid SDE database version token "${value}"`);
    }

    return version;
}
