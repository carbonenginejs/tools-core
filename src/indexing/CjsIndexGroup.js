import { normalizeLogicalPath, parseIndexEntry } from "./CjsIndexEntry.js";

/**
 * One immutable appfileindex or resfileindex parsed as an ordered group.
 */
export class CjsIndexGroup
{

    #resourcesByPath;

    /**
     * Creates one independently retained appfileindex or resfileindex group.
     */
    constructor({
        kind,
        name,
        root,
        sourceUrl,
        rawText,
        entries,
        declaration = null,
        cachePath = null,
        cacheHit = false,
    })
    {
        this.kind = normalizeRequiredString(kind, "kind");
        this.name = normalizeRequiredString(name, "name");
        this.root = normalizeRequiredString(root, "root").toLowerCase();
        this.sourceUrl = normalizeRequiredString(sourceUrl, "sourceUrl");
        this.rawText = String(rawText);
        this.entries = Object.freeze([...entries]);
        this.count = this.entries.length;
        this.declaration = declaration;
        this.cachePath = cachePath;
        this.cacheHit = Boolean(cacheHit);
        this.#resourcesByPath = new Map();

        for (const resource of this.entries)
        {
            if (this.#resourcesByPath.has(resource.logicalPath))
            {
                throw new Error(`Duplicate ${this.name} resource: ${resource.logicalPath}`);
            }

            this.#resourcesByPath.set(resource.logicalPath, resource);
        }

        Object.freeze(this);
    }

    /**
     * Finds a resource by canonical logical path.
     */
    Find(logicalPath)
    {
        return this.#resourcesByPath.get(normalizeLogicalPath(logicalPath, this.root)) ?? null;
    }

    /**
     * Checks whether this group declares a logical path.
     */
    Has(logicalPath)
    {
        return this.Find(logicalPath) !== null;
    }

}

/**
 * Parses complete CCP-style index text without reordering its resources.
 */
export function parseIndexGroup(text, options = {})
{
    if (typeof text !== "string")
    {
        throw new TypeError("Resource index text must be a string");
    }

    const root = normalizeRequiredString(options.root ?? "res", "root").toLowerCase();
    const entries = [];
    const lines = text.split(/\r?\n/u);

    for (let index = 0; index < lines.length; index++)
    {
        const rawLine = lines[index];
        const line = rawLine.trim();

        if (!line)
        {
            continue;
        }

        entries.push(parseIndexEntry(line, index + 1, root));
    }

    return new CjsIndexGroup({
        kind: options.kind ?? `${root}fileindex`,
        name: options.name ?? root,
        root,
        sourceUrl: options.sourceUrl ?? "unknown://index",
        rawText: text,
        entries,
        declaration: options.declaration ?? null,
        cachePath: options.cachePath ?? null,
        cacheHit: options.cacheHit ?? false,
    });
}

/**
 * Compatibility name for parsing one complete file index.
 */
export function parseFileIndex(text, options = {})
{
    return parseIndexGroup(text, options);
}

/**
 * Compatibility name for parsing one file-index row.
 */
export function parseFileIndexLine(line, lineNumber = 1, defaultRoot = "res")
{
    return parseIndexEntry(line, lineNumber, defaultRoot);
}

function normalizeRequiredString(value, name)
{
    if (typeof value !== "string" || !value.trim())
    {
        throw new TypeError(`${name} must be a non-empty string`);
    }

    return value.trim();
}
