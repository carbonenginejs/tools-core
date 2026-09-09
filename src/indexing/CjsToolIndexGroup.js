import { CjsToolIndexEntry, normalizeLogicalPath, parseIndexEntry } from "./CjsToolIndexEntry.js";

/**
 * One immutable appfileindex or resfileindex parsed as an ordered group.
 */
export class CjsToolIndexGroup
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
 * Parses complete index text without reordering its resources.
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

    return new CjsToolIndexGroup({
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

/** The JSON resource-index envelope this package writes and reads. */
export const JsonIndexSchema = "carbon.resource-index";
export const JsonIndexVersion = 1;

/**
 * Parses a JSON resource index: a header plus rows.
 *
 * The comma-separated form is the game's, and it is kept for everything that
 * has to interoperate with a client installation. It has no room for a header,
 * though, so anything an index knows about ITSELF - which build it was made
 * from, by which converter, at which version - has had to be carried in a
 * separate file or not at all. A generated index is not interoperating with
 * anything; it is ours end to end, so it says what it is.
 *
 * Rows carry the same fields either way, so both parse to the same group and
 * nothing downstream can tell which format it came from.
 */
export function parseJsonIndexGroup(text, options = {})
{
    const document = typeof text === "string" ? JSON.parse(text) : text;

    if (document?.schema !== JsonIndexSchema)
    {
        throw new Error(`Unsupported resource index schema: ${document?.schema}`);
    }

    if (document.version !== JsonIndexVersion)
    {
        throw new Error(`Unsupported resource index version: ${document.version}`);
    }

    const root = normalizeRequiredString(
        options.root ?? document.root ?? "res",
        "root",
    ).toLowerCase();
    const rows = document.resources;

    if (!Array.isArray(rows))
    {
        throw new Error("Resource index document must carry a resources array");
    }

    const entries = rows.map((row, index) => new CjsToolIndexEntry({
        logicalPath: normalizeLogicalPath(row?.path ?? row?.logicalPath, root),
        location: row?.location,
        checksum: row?.md5 ?? row?.checksum ?? null,
        uncompressedSize: row?.size ?? row?.uncompressedSize ?? null,
        compressedSize: row?.compressedSize ?? row?.size ?? null,
        binaryOperation: row?.binaryOperation ?? null,
        lineNumber: index + 1,
    }));

    return new CjsToolIndexGroup({
        kind: options.kind ?? `${root}fileindex`,
        name: options.name ?? root,
        root,
        sourceUrl: options.sourceUrl ?? "unknown://index",
        rawText: typeof text === "string" ? text : JSON.stringify(document),
        entries,
        declaration: document.header ?? null,
        cachePath: options.cachePath ?? null,
        cacheHit: options.cacheHit ?? false,
    });
}

/** Serializes index entries as a JSON resource index with a header. */
export function formatJsonIndex(entries, header = {})
{
    const rows = [ ...entries ].map((entry) => ({
        path: entry.logicalPath,
        location: entry.location,
        md5: entry.checksum,
        size: entry.uncompressedSize,
        ...(entry.compressedSize !== null && entry.compressedSize !== entry.uncompressedSize
            ? { compressedSize: entry.compressedSize }
            : {}),
        ...(entry.binaryOperation === null ? {} : { binaryOperation: entry.binaryOperation }),
    }));

    return `${JSON.stringify({
        schema: JsonIndexSchema,
        version: JsonIndexVersion,
        root: "res",
        ...header,
        rowCount: rows.length,
        resources: rows,
    }, null, 2)}\n`;
}

/** Chooses a parser by the index file's name, so callers need not care. */
export function parseIndexGroupNamed(fileName, text, options = {})
{
    return String(fileName).toLowerCase().endsWith(".json")
        ? parseJsonIndexGroup(text, options)
        : parseIndexGroup(text, options);
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
