import { normalizeLogicalPath } from "./CjsIndexEntry.js";

const MAX_RES_PATH_INSERT_PATHS = 4096;

/** Immutable target/build answers derived from one composed resource view. */
export class CjsIndexAnswerCatalog
{

    #paths;

    #pathSet;

    #hullInserts;

    constructor(source)
    {
        if (!source || typeof source.Match !== "function")
        {
            throw new TypeError("Index answer catalog requires a source with Match(pattern)");
        }

        const paths = new Set(source.Match("res:/**", { root: "res" })
            .map(item => normalizeLogicalPath(item.logicalPath)));

        this.target = source.target ?? null;
        this.game = source.game ?? null;
        this.provider = source.provider ?? null;
        this.buildRef = source.buildRef ?? source.build ?? null;
        this.build = source.build ?? null;
        this.client = source.client ?? null;
        this.#paths = Object.freeze([...paths].sort((left, right) => left.localeCompare(right)));
        this.#pathSet = paths;
        this.#hullInserts = new Map();

        Object.freeze(this);
    }

    /** Checks the composed exact-build view for one logical resource. */
    Has(logicalPath)
    {
        return this.#pathSet.has(normalizeLogicalPath(logicalPath));
    }

    /** Lists indexed billboard resources as complete res:/ paths. */
    ListBillboards()
    {
        return this.#Select(path => path.startsWith("res:/video/billboards/"));
    }

    /** Lists indexed nebula declarations that reference cube environments. */
    ListNebulas()
    {
        return this.#Select(path => path.includes("_cube") && path.endsWith(".black"));
    }

    /** Lists indexed cube resources used by nebula declarations. */
    ListCubes()
    {
        return this.#Select(path => path.endsWith("_cube.cube"));
    }

    /** Lists inserted resource profiles proven to exist for one SOF hull. */
    ListHullResPathInserts(hull)
    {
        const hullName = normalizeName(hull, "SOF hull");
        const cached = this.#hullInserts.get(hullName);

        if (cached)
        {
            return cached;
        }

        const hullNames = hullName.endsWith("_fn")
            ? [ hullName, `${hullName.slice(0, -3)}_t1` ]
            : [ hullName ];
        const inserts = new Set();

        for (const path of this.#paths)
        {
            if (HasIgnoredEffectFolder(path))
            {
                continue;
            }

            const segments = path.split("/");

            if (segments.length < 3)
            {
                continue;
            }

            const fileName = segments.at(-1);
            const insert = segments.at(-2);

            for (const candidateHull of hullNames)
            {
                const insertedMaterial = `${candidateHull}_${insert}_m.dds`;

                if (fileName !== insertedMaterial)
                {
                    continue;
                }

                const baseFileName = `${candidateHull}_m.dds`;
                const basePath = [ ...segments.slice(0, -2), baseFileName ].join("/");

                if (this.#pathSet.has(basePath))
                {
                    inserts.add(insert);
                }
            }
        }

        inserts.delete("base");
        inserts.delete("none");

        const result = Object.freeze([...inserts].sort((left, right) => left.localeCompare(right)));

        this.#hullInserts.set(hullName, result);

        return result;
    }

    /** Resolves caller-supplied SOF paths against one proven insert profile. */
    ResolveHullResPathInserts(hull, insert, paths)
    {
        const hullName = normalizeName(hull, "SOF hull");
        const insertName = normalizeName(insert, "resource path insert");

        if (!Array.isArray(paths))
        {
            throw new TypeError("Resource path insert paths must be an array");
        }

        if (paths.length > MAX_RES_PATH_INSERT_PATHS)
        {
            throw new TypeError(
                `Resource path insert request cannot exceed ${MAX_RES_PATH_INSERT_PATHS} paths`,
            );
        }

        if (![ "base", "none" ].includes(insertName)
            && !this.ListHullResPathInserts(hullName).includes(insertName))
        {
            const error = new Error(
                `Resource path insert is not available for ${hullName}: ${insertName}`,
            );

            error.statusCode = 404;
            throw error;
        }

        return Object.freeze(paths.map((path, index) =>
        {
            if (typeof path !== "string" || !path.trim())
            {
                throw new TypeError(
                    `Resource path insert path at index ${index} must be a non-empty string`,
                );
            }

            const originalPath = normalizeLogicalPath(path);

            if ([ "base", "none" ].includes(insertName)
                || !originalPath.startsWith("res:/")
                || HasIgnoredEffectFolder(originalPath))
            {
                return originalPath;
            }

            const separator = originalPath.lastIndexOf("/");
            const fileName = originalPath.slice(separator + 1);
            const suffix = fileName.lastIndexOf("_");

            if (separator < 0 || suffix < 1)
            {
                return originalPath;
            }

            const insertedFileName = `${fileName.slice(0, suffix)}_${insertName}${fileName.slice(suffix)}`;
            const insertedPath = `${originalPath.slice(0, separator + 1)}${insertName}/${insertedFileName}`;

            return this.#pathSet.has(insertedPath) ? insertedPath : originalPath;
        }));
    }

    #Select(predicate)
    {
        return Object.freeze(this.#paths.filter(predicate));
    }

}

function normalizeName(value, label)
{
    const name = String(value ?? "").trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name))
    {
        throw new TypeError(`${label} must be one safe path segment`);
    }

    return name;
}

function HasIgnoredEffectFolder(logicalPath)
{
    const segments = logicalPath.slice(logicalPath.indexOf(":/") + 2).split("/");

    return segments.includes("effect") || segments.includes("effects");
}
