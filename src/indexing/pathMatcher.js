import { normalizeLogicalPath } from "./CjsIndexEntry.js";

/**
 * Creates an exact, wildcard, or regular-expression logical-path matcher.
 */
export function createPathMatcher(value, options = {})
{
    const type = String(options.type ?? "wildcard").trim().toLowerCase();
    const defaultRoot = String(options.defaultRoot ?? "res").trim().toLowerCase();

    if (type === "regex")
    {
        const flags = normalizeRegexFlags(options.flags ?? "i");
        const expression = new RegExp(String(value), flags);

        return (logicalPath) => expression.test(logicalPath);
    }

    const normalized = normalizeWildcardPath(value, defaultRoot);

    if (type === "exact")
    {
        return (logicalPath) => logicalPath === normalized;
    }

    if (type !== "wildcard" && type !== "glob")
    {
        throw new Error(`Unknown path matcher type: ${type}`);
    }

    const source = [...normalized].map((character) =>
    {
        if (character === "*")
        {
            return ".*";
        }

        if (character === "?")
        {
            return ".";
        }

        return escapeRegexCharacter(character);
    }).join("");
    const expression = new RegExp(`^${source}$`, "u");
    const matcher = (logicalPath) => expression.test(logicalPath);

    return matcher;
}

/**
 * Detects whether a path expression contains wildcard characters.
 */
export function hasPathWildcard(value)
{
    return /[*?]/u.test(String(value));
}

function normalizeWildcardPath(value, defaultRoot)
{
    const text = String(value ?? "").trim().replaceAll("\\", "/").toLowerCase();

    if (!text)
    {
        throw new Error("Path expression is required");
    }

    if (!text.includes("*") && !text.includes("?"))
    {
        return normalizeLogicalPath(text, defaultRoot);
    }

    const withRoot = text.includes(":/") ? text : `${defaultRoot}:/${text}`;
    const separator = withRoot.indexOf(":/");
    const root = withRoot.slice(0, separator);
    const relativePath = withRoot.slice(separator + 2);

    if (!/^[a-z][a-z0-9+.-]*$/u.test(root) || !relativePath)
    {
        throw new Error(`Invalid wildcard path: ${value}`);
    }

    for (const segment of relativePath.split("/"))
    {
        if (segment === "." || segment === ".." || segment.includes("\0"))
        {
            throw new Error(`Unsafe wildcard path: ${value}`);
        }
    }

    return `${root}:/${relativePath}`;
}

function normalizeRegexFlags(value)
{
    const flags = [...new Set(String(value).replace(/[gy]/gu, "").split(""))].join("");

    if ([...flags].some((flag) => !"dimsuv".includes(flag)))
    {
        throw new Error(`Invalid regular-expression flags: ${value}`);
    }

    return flags.includes("u") || flags.includes("v") ? flags : `${flags}u`;
}

function escapeRegexCharacter(value)
{
    return /[\\^$.*+?()[\]{}|]/u.test(value) ? `\\${value}` : value;
}
