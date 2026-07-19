import { normalizeLogicalPath } from "./CjsIndexEntry.js";
import { CjsIndexProvider } from "./CjsIndexProvider.js";
import { normalizeTargetId } from "../target/CjsToolTarget.js";
import { createPathMatcher } from "./pathMatcher.js";
import * as utils from "../utils.js";

/**
 * Complete immutable app/res index graph for one provider and exact build.
 */
export class CjsIndex
{

    #providerProfile;

    /**
     * Creates a complete build index without merging its component groups.
     */
    constructor({ target = null, provider, buildReference, appIndex, mainResIndex = null, extensions = {} })
    {
        this.#providerProfile = CjsIndexProvider.from(provider);
        this.target = target === null ? null : normalizeTargetId(target);
        this.game = this.#providerProfile.game;
        this.provider = this.#providerProfile.id;
        this.buildRef = buildReference.buildRef;
        this.build = buildReference.build;
        this.client = buildReference.client;
        this.metadataToken = buildReference.metadataToken;
        this.metadata = buildReference.metadata;
        this.metadataUrl = buildReference.metadataUrl;
        this.app = Object.freeze({
            index: appIndex,
            extensions: Object.freeze({ ...extensions }),
        });
        this.res = Object.freeze({
            index: mainResIndex,
        });
        this.indexes = Object.freeze({
            ...(mainResIndex ? { main: mainResIndex } : {}),
            ...extensions,
        });
        this.availableIndexes = Object.freeze(Object.keys(this.indexes));

        Object.freeze(this);
    }

    /**
     * Gets one independently retained app-declared resource index.
     */
    GetIndex(name = "main")
    {
        const indexName = normalizeIndexName(name);
        const index = this.indexes[indexName];

        if (!index)
        {
            throw new Error(`Resource index is not available: ${indexName}`);
        }

        return index;
    }

    /**
     * Resolves one exact logical path across the complete index graph.
     */
    Resolve(logicalPath, options = {})
    {
        const normalizedPath = normalizeLogicalPath(logicalPath, options.root ?? "res");
        const [ root ] = normalizedPath.split(":/");

        if (root === "app")
        {
            const resource = this.app.index.Find(normalizedPath);

            if (!resource)
            {
                throw createMissingError(`Application file not found: ${normalizedPath}`);
            }

            return this.#CreateResolution(resource, [ this.app.index ]);
        }

        if (root !== "res")
        {
            throw new Error(`Unsupported resource root: ${root}`);
        }

        const matches = this.#FindExactResourceMatches(normalizedPath, options.indexName);

        if (matches.length === 0)
        {
            throw createMissingError(`Resource file not found: ${normalizedPath}`);
        }

        if (matches.length > 1)
        {
            throw new Error(
                `Resource has conflicting declarations; select an index: ${normalizedPath}`,
            );
        }

        return matches[0];
    }

    /**
     * Matches logical paths without layering or reordering source groups.
     */
    Match(pattern, options = {})
    {
        const root = String(options.root ?? "res").trim().toLowerCase();
        const matcher = createPathMatcher(pattern, {
            type: options.type ?? "wildcard",
            defaultRoot: root === "all" ? "res" : root,
            flags: options.flags,
        });
        const results = [];

        if (root === "app" || root === "all")
        {
            for (const resource of this.app.index.entries)
            {
                if (matcher(resource.logicalPath))
                {
                    results.push(this.#CreateResolution(resource, [ this.app.index ]));
                }
            }
        }

        if (root === "res" || root === "all")
        {
            results.push(...this.#FindResourceMatches(matcher, options.indexName));
        }

        if (![ "all", "app", "res" ].includes(root))
        {
            throw new Error(`Unsupported match root: ${root}`);
        }

        return Object.freeze(results.sort((left, right) =>
            left.logicalPath.localeCompare(right.logicalPath)));
    }

    #FindResourceMatches(matcher, indexName)
    {
        const groups = indexName === undefined || indexName === null || indexName === "all"
            ? Object.values(this.indexes)
            : [ this.GetIndex(indexName) ];
        const matchesByPath = new Map();

        for (const group of groups)
        {
            for (const resource of group.entries)
            {
                if (!matcher(resource.logicalPath))
                {
                    continue;
                }

                let variants = matchesByPath.get(resource.logicalPath);

                if (!variants)
                {
                    variants = new Map();
                    matchesByPath.set(resource.logicalPath, variants);
                }

                const key = getResourceIdentity(resource);
                const variant = variants.get(key);

                if (variant)
                {
                    variant.groups.push(group);
                }
                else
                {
                    variants.set(key, { resource, groups: [ group ] });
                }
            }
        }

        const results = [];

        for (const variants of matchesByPath.values())
        {
            for (const variant of variants.values())
            {
                results.push(this.#CreateResolution(variant.resource, variant.groups));
            }
        }

        return results;
    }

    #FindExactResourceMatches(logicalPath, indexName)
    {
        const groups = indexName === undefined || indexName === null || indexName === "all"
            ? Object.values(this.indexes)
            : [ this.GetIndex(indexName) ];
        const variants = new Map();

        for (const group of groups)
        {
            const resource = group.Find(logicalPath);

            if (!resource)
            {
                continue;
            }

            const key = getResourceIdentity(resource);
            const variant = variants.get(key);

            if (variant)
            {
                variant.groups.push(group);
            }
            else
            {
                variants.set(key, { resource, groups: [ group ] });
            }
        }

        return [...variants.values()].map((variant) =>
            this.#CreateResolution(variant.resource, variant.groups));
    }

    #CreateResolution(resource, groups)
    {
        const root = resource.prefix;
        const baseUrl = root === "app"
            ? this.#providerProfile.remote.appBaseUrl
            : this.#providerProfile.remote.resBaseUrl;
        const indexNames = groups.map((group) => group.name);

        return utils.freezeData({
            target: this.target,
            game: this.game,
            provider: this.provider,
            buildRef: this.buildRef,
            build: this.build,
            client: this.client,
            logicalPath: resource.logicalPath,
            root,
            relativePath: resource.relativePath,
            sourceUrl: utils.joinUrl(baseUrl, resource.location),
            artifactKind: "hash-safe",
            record: resource,
            indexKind: groups[0].kind,
            indexName: groups[0].name,
            indexNames,
            indexUrl: groups[0].sourceUrl,
            indexUrls: groups.map((group) => group.sourceUrl),
            indexLogicalPaths: groups.map((group) => group.declaration?.logicalPath ?? null),
        });
    }

}

function getResourceIdentity(resource)
{
    return [
        resource.location,
        resource.checksum,
        resource.uncompressedSize,
        resource.compressedSize,
        resource.binaryOperation,
    ].join("|");
}

function normalizeIndexName(value)
{
    const name = String(value ?? "").trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name))
    {
        throw new Error(`Invalid resource index name: ${value}`);
    }

    return name;
}

function createMissingError(message)
{
    const error = new Error(message);

    error.code = "CJS_RESOURCE_NOT_FOUND";
    error.statusCode = 404;

    return error;
}
