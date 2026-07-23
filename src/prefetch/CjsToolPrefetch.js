import { normalizeLogicalPath } from "../indexing/CjsIndexEntry.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";

const PLAN_SCHEMA = "carbon.tools-prefetch.plan";
const REPORT_SCHEMA = "carbon.tools-prefetch.report";
const SCHEMA_VERSION = 1;

/**
 * Plans and acquires exact-build resource sets supplied by named profiles.
 */
export class CjsToolPrefetch
{

    #indexes;

    #profiles;

    #targets;

    constructor({
        indexes,
        profiles = [],
        targets = new CjsToolTargetRegistry(),
    } = {})
    {
        if (!indexes
            || typeof indexes.ResolveTargetBuild !== "function"
            || typeof indexes.OpenTarget !== "function")
        {
            throw new TypeError(
                "CjsToolPrefetch indexes must resolve and open target builds",
            );
        }

        if (!Array.isArray(profiles))
        {
            throw new TypeError("CjsToolPrefetch profiles must be an array");
        }

        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError(
                "CjsToolPrefetch targets must be a CjsToolTargetRegistry",
            );
        }

        this.#indexes = indexes;
        this.#targets = targets;
        this.#profiles = new Map();

        for (const profile of profiles)
        {
            const name = NormalizeProfileName(profile?.name);

            if (typeof profile?.Resolve !== "function")
            {
                throw new TypeError(
                    `Prefetch profile ${name} must provide Resolve(context)`,
                );
            }

            if (this.#profiles.has(name))
            {
                throw new TypeError(`Duplicate prefetch profile: ${name}`);
            }

            this.#profiles.set(name, profile);
        }

        Object.freeze(this);
    }

    /** Lists registered profile names in deterministic order. */
    ListProfiles()
    {
        return Object.freeze([ ...this.#profiles.keys() ].sort());
    }

    /** Resolves a friendly build once and creates an immutable exact-path plan. */
    async Plan({
        target = this.#targets.defaultTarget,
        build = "latest",
        client,
        profiles,
    } = {})
    {
        const selectedNames = SelectProfileNames(this.#profiles, profiles);
        const selectedProfiles = selectedNames.map(
            name => this.#profiles.get(name),
        );
        const targetRecord = this.#targets.Get(target);
        const resolution = await this.#indexes.ResolveTargetBuild(
            targetRecord.id,
            build,
            { client: client ?? targetRecord.client ?? undefined },
        );
        const identity = utils.freezeData({
            target: targetRecord.id,
            game: String(resolution.game ?? targetRecord.game),
            provider: String(resolution.provider ?? targetRecord.provider),
            buildRef: String(resolution.buildRef ?? build),
            build: utils.normalizeExactBuild(resolution.build),
            client: resolution.client ?? client ?? targetRecord.client ?? null,
        });
        const requirements = new Map();

        for (let index = 0; index < selectedProfiles.length; index++)
        {
            const profile = selectedProfiles[index];
            const profileName = selectedNames[index];
            const resolved = await profile.Resolve(identity);

            if (!Array.isArray(resolved))
            {
                throw new TypeError(
                    `Prefetch profile ${profileName} must resolve to an array`,
                );
            }

            for (const value of resolved)
            {
                const requirement = NormalizeRequirement(value);
                const key = `${requirement.indexName ?? ""}\0${requirement.logicalPath}`;
                const previous = requirements.get(key);

                if (previous)
                {
                    previous.profiles.add(profileName);
                    continue;
                }

                requirements.set(key, {
                    logicalPath: requirement.logicalPath,
                    indexName: requirement.indexName,
                    profiles: new Set([ profileName ]),
                });
            }
        }

        const plannedRequirements = [ ...requirements.values() ]
            .map(requirement => ({
                logicalPath: requirement.logicalPath,
                indexName: requirement.indexName,
                profiles: [ ...requirement.profiles ].sort(),
            }))
            .sort((left, right) =>
                left.logicalPath.localeCompare(right.logicalPath, "en")
                || String(left.indexName ?? "").localeCompare(
                    String(right.indexName ?? ""),
                    "en",
                ));

        return utils.freezeData({
            schema: PLAN_SCHEMA,
            schemaVersion: SCHEMA_VERSION,
            ...identity,
            profiles: selectedNames,
            requirements: plannedRequirements,
        });
    }

    /** Acquires a planned resource set through the normal validated index cache. */
    async Prefetch(options = {})
    {
        const concurrency = NormalizeConcurrency(options.concurrency ?? 4);
        const onProgress = NormalizeProgressCallback(options.onProgress);
        const plan = await this.Plan(options);
        let cacheHits = 0;
        let byteLength = 0;
        let completed = 0;

        if (plan.requirements.length)
        {
            const source = await this.#indexes.OpenTarget(
                plan.target,
                plan.build,
                { client: plan.client ?? undefined },
            );
            let cursor = 0;
            const workers = Array.from(
                {
                    length: Math.min(concurrency, plan.requirements.length),
                },
                async () =>
                {
                    while (cursor < plan.requirements.length)
                    {
                        const requirement = plan.requirements[cursor++];
                        const fetchOptions = {
                            refresh: options.refresh === true,
                        };

                        if (requirement.indexName)
                        {
                            fetchOptions.indexName = requirement.indexName;
                        }

                        const result = await source.Fetch(
                            requirement.logicalPath,
                            fetchOptions,
                        );
                        const resultByteLength = NormalizeByteLength(result);

                        byteLength += resultByteLength;
                        cacheHits += result.cacheHit === true ? 1 : 0;
                        completed++;

                        if (onProgress)
                        {
                            await onProgress(utils.freezeData({
                                completed,
                                total: plan.requirements.length,
                                logicalPath: requirement.logicalPath,
                                indexName: requirement.indexName,
                                profiles: requirement.profiles,
                                cacheHit: result.cacheHit === true,
                                byteLength: resultByteLength,
                            }));
                        }
                    }
                },
            );

            await Promise.all(workers);
        }

        return utils.freezeData({
            schema: REPORT_SCHEMA,
            schemaVersion: SCHEMA_VERSION,
            target: plan.target,
            game: plan.game,
            provider: plan.provider,
            buildRef: plan.buildRef,
            build: plan.build,
            client: plan.client,
            profiles: plan.profiles,
            resources: {
                total: plan.requirements.length,
                cacheHits,
                acquired: plan.requirements.length - cacheHits,
                byteLength,
            },
        });
    }

    /** Creates a one-use executor and acquires its selected profiles. */
    static async prefetch({
        indexes,
        registeredProfiles = [],
        targets,
        ...options
    } = {})
    {
        return new this({
            indexes,
            profiles: registeredProfiles,
            targets,
        }).Prefetch(options);
    }

}

function NormalizeProfileName(value)
{
    const name = String(value ?? "").trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name))
    {
        throw new TypeError(`Invalid prefetch profile name: ${value}`);
    }

    return name;
}

function SelectProfileNames(profiles, value)
{
    const values = value === undefined || value === null || value === ""
        ? [ ...profiles.keys() ]
        : Array.isArray(value)
            ? value
            : String(value).split(",");
    const names = [ ...new Set(values.map(NormalizeProfileName)) ].sort();

    if (!names.length)
    {
        throw new TypeError("At least one prefetch profile is required");
    }

    for (const name of names)
    {
        if (!profiles.has(name))
        {
            throw new Error(`Prefetch profile not found: ${name}`);
        }
    }

    return names;
}

function NormalizeRequirement(value)
{
    const record = typeof value === "string"
        ? { logicalPath: value }
        : utils.requireObject(value, "Prefetch requirement");
    const sourcePath = String(record.logicalPath ?? "");

    if (/[*?]/u.test(sourcePath))
    {
        throw new TypeError(
            `Prefetch requirements must use exact logical paths: ${sourcePath}`,
        );
    }

    const logicalPath = normalizeLogicalPath(sourcePath);
    const root = logicalPath.slice(0, logicalPath.indexOf(":/"));

    if (![ "app", "res" ].includes(root))
    {
        throw new TypeError(
            `Prefetch requirements must use app:/ or res:/ paths: ${sourcePath}`,
        );
    }

    return Object.freeze({
        logicalPath,
        indexName: NormalizeIndexName(record.indexName),
    });
}

function NormalizeIndexName(value)
{
    if (value === undefined || value === null || value === "")
    {
        return null;
    }

    const name = String(value).trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name))
    {
        throw new TypeError(`Invalid prefetch index name: ${value}`);
    }

    return name;
}

function NormalizeConcurrency(value)
{
    const concurrency = Number(value);

    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64)
    {
        throw new TypeError("Prefetch concurrency must be an integer from 1 to 64");
    }

    return concurrency;
}

function NormalizeProgressCallback(value)
{
    if (value === undefined || value === null)
    {
        return null;
    }

    if (typeof value !== "function")
    {
        throw new TypeError("Prefetch onProgress must be a function");
    }

    return value;
}

function NormalizeByteLength(result)
{
    const value = result?.byteLength ?? result?.bytes?.byteLength;

    if (!Number.isSafeInteger(value) || value < 0)
    {
        throw new TypeError("Prefetched resource did not report a valid byte length");
    }

    return value;
}
