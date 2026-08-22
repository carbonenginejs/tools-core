import fs from "node:fs/promises";
import path from "node:path";

import { CjsToolCache } from "../cache/CjsToolCache.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import { CjsToolBuildObservations } from "../build/CjsToolBuildObservations.js";
import { resolveDataRoot } from "../cache/resolveDataRoot.js";
import { CjsToolSde } from "./CjsToolSde.js";
import { BuildDnaIndex, QueryDnaIndex } from "./CjsToolSdeDnaIndex.js";
import { CjsToolSdeArchive, CJS_SDE_PREPARED_TABLES } from "./CjsToolSdeArchive.js";
import { CjsToolSdeDatabase } from "./CjsToolSdeDatabase.js";
import * as utils from "../utils.js";

/**
 * A syntactically valid build, used only to ask the cache for a path and then
 * discard the last two segments. Scanning needs the directory builds live in,
 * and the cache is the only thing that should know its shape.
 */
const PLACEHOLDER_BUILD = "0";

/** Resolves target/build SDE requests to exact cached SQLite databases. */
export class CjsToolSdeRepository
{

    #archive;

    #cache;

    #open;

    #preparers;

    #targets;

    constructor(options = {})
    {
        this.#archive = options.archive ?? new CjsToolSdeArchive();
        this.#cache = options.cache ?? new CjsToolCache();
        this.#targets = options.targets ?? new CjsToolTargetRegistry();
        this.#open = new Map();
        // Auto-preparation is the default: the archive is addressable per build,
        // so a missing database is prepared on first request unless explicitly
        // disabled. Only the *latest* channel is a single record; older builds
        // are addressable by number, which is what makes trailing to a specific
        // older build possible at all.
        this.autoPrepare = options.autoPrepare !== false;
        this.version = NormalizeVersion(options.version ?? "v1");
        // Which providers have an acquisition channel of their own. The archive
        // answers for those; a provider absent here has no channel to acquire
        // from and can only be answered by a database already prepared on disk,
        // however it was built.
        this.#preparers = new Map(Object.entries(
            options.preparers ?? { ccp: this.#archive },
        ));

        if (!(this.#cache instanceof CjsToolCache))
        {
            throw new TypeError("CjsToolSdeRepository cache must be a CjsToolCache");
        }

        if (!(this.#targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("CjsToolSdeRepository targets must be a CjsToolTargetRegistry");
        }
    }

    /**
     * Resolves `latest` independently against the SDE channel.
     *
     * The SDE is never guaranteed to match the current remote game build: it
     * moves on its own schedule, usually trailing the resource build but not
     * required to. When the channel is unreachable, `latest` falls back to the
     * newest prepared database on disk rather than failing.
     *
     * This answers for the SDE alone and is free to lead the resources. Pairing
     * it with a resource build is a separate act, and the side that pairs them
     * is responsible for the rule that the SDE is never the newer of the two.
     * See the build route, which clamps.
     */
    async ResolveTargetBuild(targetValue, buildValue = "latest")
    {
        const buildRef = NormalizeBuildReference(buildValue);
        const own = await this.#ResolveOwnExport(targetValue, buildRef);

        if (own)
        {
            return own;
        }

        const target = this.#targets.ResolveTopicSource(targetValue, "sde");
        let latest = null;
        let fallback = null;

        if (buildRef === "latest")
        {
            try
            {
                latest = await this.#archive.ResolveLatest();
            }
            catch (error)
            {
                fallback = await this.#NewestPreparedBuild(target);

                if (fallback === null)
                {
                    throw error;
                }
            }
        }

        const build = String(latest?.build ?? fallback ?? utils.normalizeExactBuildNumber(buildRef, {
            message: `Invalid exact SDE build "${buildRef}"`,
        }));

        const requested = this.#targets.RequireTopic(targetValue, "sde");

        // The SDE facet records its own observations. The resource facet does
        // this in CjsToolIndex; the two channels are independent, because the
        // SDE moves on its own schedule and is resolved through a different
        // remote, so an observation of one says nothing about the other.
        //
        // `releaseDate` is upstream's publish time, which is the fact that makes
        // a cadence measurable. Best effort: a read-only data root must not fail
        // a resolution that already succeeded.
        try
        {
            const observations = await CjsToolBuildObservations.read(resolveDataRoot());

            await observations.Record({
                target: target.id,
                facet: "sde",
                build,
                released: latest?.releaseDate ?? null,
                source: fallback !== null ? "newest-prepared-fallback" : latest?.source ?? "exact-build",
                url: latest?.url ?? null,
            });
        }
        catch
        {
            // Recording is not the caller's business.
        }

        return Object.freeze({
            target: target.id,
            game: target.game,
            provider: target.provider,
            buildRef,
            build,
            releaseDate: latest?.releaseDate ?? null,
            source: fallback !== null ? "newest-prepared-fallback" : latest?.source ?? "exact-build",
            // A target answered by another target's SDE says so, so a caller
            // can tell borrowed data from its own. Absent when they are the same.
            borrowedFrom: requested.id === target.id ? null : target.id,
        });
    }

    /**
     * Selects a target's own SDE when it has one, before any borrowing.
     *
     * A target whose provider has an acquisition channel always goes through
     * that channel, so nothing here changes for it. A target without one can
     * still have a database on disk under its own game and provider, prepared
     * by hand. When it does, that database is the answer, because a target
     * declaring another target as its topic source is stating a fallback, not
     * a preference: borrowed data is the least-wrong answer available, never
     * the right one.
     *
     * A pinned build is matched **exactly**, and deliberately does not trail to
     * an older SDE the way an acquired one does. Trailing exists because an
     * acquired SDE moves on a schedule of its own, so the newest one at or
     * below the request is the closest obtainable answer. A manually generated
     * SDE has no such freedom: its data and its build are fixed together, so
     * its build always equals the resource build. Asking for a build either has
     * that SDE or does not, and answering with a different one would pair
     * an SDE with resources it was never generated from.
     *
     * Returns null when the target has an acquisition channel of its own, or
     * when nothing is prepared for it, leaving the caller on the borrowing path.
     */
    async #ResolveOwnExport(targetValue, buildRef)
    {
        const requested = this.#targets.RequireTopic(targetValue, "sde");

        if (this.#preparers.has(requested.provider))
        {
            return null;
        }

        const build = buildRef === "latest"
            ? await this.#NewestPreparedBuild(requested)
            : await this.#PreparedBuild(requested, utils.normalizeExactBuildNumber(buildRef, {
                message: `Invalid exact SDE build "${buildRef}"`,
            }));

        if (build === null)
        {
            return null;
        }

        return Object.freeze({
            target: requested.id,
            game: requested.game,
            provider: requested.provider,
            buildRef,
            build: String(build),
            releaseDate: null,
            source: "prepared-export",
            borrowedFrom: null,
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
        // Only a provider with its own channel may be auto-prepared. Without
        // this guard a request for a provider with nothing on disk would
        // acquire another provider's archive and write it into the requesting
        // provider's path, producing a file whose location claims one provider
        // and whose contents are another's.
        const preparer = this.#preparers.get(resolution.provider) ?? null;
        let database;

        if (await FileExists(databasePath))
        {
            try
            {
                database = await CjsToolSdeDatabase.open(databasePath);

                // A database prepared before the locality indexes existed gains
                // them here, once, rather than by being thrown away and
                // re-downloaded. Checked through the open read-only handle so
                // the common case — already indexed — costs one catalog query
                // and never opens the file for writing at all.
                if (!database.HasQueryIndexes())
                {
                    const upgrade = CjsToolSdeDatabase.upgradeQueryIndexes(databasePath);

                    if (upgrade.error)
                    {
                        this.onWarning?.(
                            `SDE query indexes not created for ${databasePath}: `
                            + `${upgrade.error.message} — map queries will scan`
                        );
                    }
                }
            }
            catch (error)
            {
                if (!this.autoPrepare || !preparer)
                {
                    throw error;
                }

                database = await preparer.PrepareDatabase({
                    build: resolution.build,
                    releaseDate: resolution.releaseDate,
                    databasePath,
                });
            }
        }
        else if (this.autoPrepare && preparer)
        {
            try
            {
                database = await preparer.PrepareDatabase({
                    build: resolution.build,
                    releaseDate: resolution.releaseDate,
                    databasePath,
                });
            }
            catch (error)
            {
                // A stale SDE is the expected steady state between releases:
                // when the requested SDE cannot be acquired, answer from
                // the newest prepared database at or below it instead of
                // failing. The returned source reports the build that actually
                // answered. Bounded by the request, so the pair can only ever
                // be stale, never ahead of the resources it will be used with.
                const fallback = await this.#NewestPreparedBuild(
                    resolution,
                    resolution.build,
                );

                if (fallback === null || fallback === resolution.build)
                {
                    throw error;
                }

                return this.#Open(Object.freeze({
                    ...resolution,
                    build: fallback,
                    requestedBuild: resolution.build,
                    source: "newest-prepared-fallback",
                }));
            }
        }
        else
        {
            const error = new Error(
                preparer
                    ? `EVE SDE build ${resolution.build} is not prepared; run cjs-sde-prepare`
                    : `No ${resolution.provider} SDE is prepared for build ${resolution.build}; `
                        + `${resolution.provider} has no acquisition channel, so one must be `
                        + "generated and placed on disk",
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

            return new CjsToolSdeSource(database, resolution);
        }
        catch (error)
        {
            await database.Close();
            throw error;
        }
    }

    /**
     * Returns one exact build when its database is prepared on disk, or null.
     *
     * The exact-match counterpart to the newest-prepared search, for a manually
     * generated SDE whose build is fixed by the data it was built from. Does
     * not scan and does not trail.
     */
    async #PreparedBuild(identity, build)
    {
        const databasePath = this.#cache.GetCustomPath({
            game: identity.game,
            provider: identity.provider,
            build,
            name: "sde",
            version: this.version,
            extension: "sqlite",
        });

        return await FileExists(databasePath) ? String(build) : null;
    }

    /**
     * Finds the newest prepared database, optionally no newer than one build.
     *
     * The ceiling is what makes a fallback safe rather than merely available.
     * An SDE describes the types, skins, and graphics that exist as of its own
     * build, so one taken from *ahead* of the resources it is paired with names
     * things the resource index cannot provide — a lookup resolves and then the
     * model behind it 404s, which reads as a broken resource rather than a
     * mismatched pair. Trailing is the safe direction: an older SDE can only
     * omit things, never invent them.
     *
     * So a pinned build passes itself as the ceiling and gets the closest SDE
     * at or below it. Only `latest` asks without one, because there is
     * nothing above it to be wrong about.
     */
    async #NewestPreparedBuild(identity, maxBuild = null)
    {
        // Derived from the cache rather than rebuilt here. This directory was
        // spelled out a second time and drifted the moment the layout changed
        // from game/provider to target; asking the cache for a path inside it
        // keeps one owner for the shape.
        const buildsDirectory = path.dirname(path.dirname(this.#cache.GetCustomPath({
            ...identity,
            build: PLACEHOLDER_BUILD,
            name: "sde",
            version: this.version,
            extension: "sqlite",
        })));
        let names;

        try
        {
            names = await fs.readdir(buildsDirectory);
        }
        catch (error)
        {
            if (error?.code === "ENOENT")
            {
                return null;
            }

            throw error;
        }

        const ceiling = maxBuild === null ? null : Number(maxBuild);
        const builds = names
            .filter(name => utils.isExactBuild(name))
            .filter(name => ceiling === null || Number(name) <= ceiling)
            .sort((left, right) => Number(right) - Number(left));

        for (const build of builds)
        {
            const databasePath = path.join(
                buildsDirectory,
                build,
                `sde_${this.version}.sqlite`,
            );

            if (await FileExists(databasePath))
            {
                return build;
            }
        }

        return null;
    }

}

/** Open exact-build SDE source used by service and direct callers. */
export class CjsToolSdeSource
{

    #database;

    #identity;

    #dnaIndex;

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

    /**
     * Where this source's database sits, for readers of its derived artifacts.
     *
     * Exposed as a path rather than a handle deliberately: a derivation is a
     * file beside the database, and a consumer that wanted the database itself
     * should be going through `Table` and `LoadTables` instead of reopening it.
     */
    DatabaseFile()
    {
        return this.#database.filePath;
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

    /**
     * Answers a DNA, or any part of one, with the hulls and skins that produce
     * it.
     *
     * The index is built once per open source and kept, like the identity view
     * it is derived from: it is a pure function of tables that cannot change
     * while this source is open, and rebuilding it per request would be one
     * pass over seven thousand skins for an answer that is already known.
     */
    async QueryDna(query, options = {})
    {
        this.#dnaIndex ??= this.#GetIdentity().then(BuildDnaIndex);

        return QueryDnaIndex(await this.#dnaIndex, query, options);
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
                .then(tables => new CjsToolSde(tables));
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
