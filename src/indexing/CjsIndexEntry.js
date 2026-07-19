/**
 * One immutable resource entry from an app/res index.
 */
export class CjsIndexEntry
{

    /**
     * Creates a normalized resource declaration while retaining its source row.
     */
    constructor({
        logicalPath,
        sourceLogicalPath = logicalPath,
        location,
        checksum = null,
        uncompressedSize = null,
        compressedSize = null,
        binaryOperation = null,
        lineNumber = null,
        rawLine = null,
        columns = [],
    })
    {
        const normalizedPath = normalizeLogicalPath(logicalPath);
        const separator = normalizedPath.indexOf(":/");

        this.logicalPath = normalizedPath;
        this.sourceLogicalPath = String(sourceLogicalPath).trim().replaceAll("\\", "/");
        this.prefix = normalizedPath.slice(0, separator);
        this.relativePath = normalizedPath.slice(separator + 2);
        this.location = normalizeStoragePath(location);
        this.checksum = normalizeOptionalMd5(checksum, lineNumber);
        this.uncompressedSize = normalizeOptionalInteger(
            uncompressedSize,
            "uncompressedSize",
            lineNumber,
        );
        this.compressedSize = normalizeOptionalInteger(
            compressedSize,
            "compressedSize",
            lineNumber,
        );
        this.binaryOperation = normalizeOptionalInteger(
            binaryOperation,
            "binaryOperation",
            lineNumber,
        );
        this.lineNumber = lineNumber;
        this.rawLine = rawLine ?? null;
        this.columns = Object.freeze([...columns]);

        // CCP-oriented aliases retained for callers that use index terminology.
        this.storagePath = this.location;
        this.md5 = this.checksum;
        this.size = this.uncompressedSize;
        this.appFile = this.binaryOperation;

        Object.freeze(this);
    }

    /**
     * Creates a resource declaration from an existing value.
     */
    static from(value)
    {
        return value instanceof this ? value : new this(value);
    }

}

/**
 * Parses one two-to-six-column CCP-style index row.
 */
export function parseIndexEntry(line, lineNumber = 1, defaultRoot = "res")
{
    if (typeof line !== "string")
    {
        throw new TypeError("Resource index line must be a string");
    }

    const columns = line.split(",").map((value) => value.trim());

    if (columns.length < 2 || columns.length > 6)
    {
        throw new Error(`Invalid index row at line ${lineNumber}: expected 2 to 6 columns`);
    }

    const [ logicalPath, location, checksum, uncompressedSize, compressedSize, binaryOperation ] = columns;

    if (!logicalPath || !location)
    {
        throw new Error(`Invalid index row at line ${lineNumber}: missing logical path or location`);
    }

    return new CjsIndexEntry({
        logicalPath: normalizeLogicalPath(logicalPath, defaultRoot),
        sourceLogicalPath: logicalPath,
        location,
        checksum,
        uncompressedSize,
        compressedSize,
        binaryOperation,
        lineNumber,
        rawLine: line,
        columns,
    });
}

/**
 * Normalizes a logical resource path while retaining its explicit prefix.
 */
export function normalizeLogicalPath(value, defaultRoot = "res")
{
    const text = String(value ?? "").trim().replaceAll("\\", "/").toLowerCase();

    if (!text || text.includes("\0"))
    {
        throw new Error("Logical path is required");
    }

    const withRoot = text.includes(":/") ? text : `${defaultRoot}:/${text}`;
    const separator = withRoot.indexOf(":/");
    const root = withRoot.slice(0, separator);
    const relativePath = withRoot.slice(separator + 2);

    if (!/^[a-z][a-z0-9+.-]*$/u.test(root))
    {
        throw new Error(`Invalid logical root: ${root}`);
    }

    const segments = normalizeSegments(relativePath, "logical path");

    if (segments.length === 0)
    {
        throw new Error(`Invalid logical path: ${value}`);
    }

    return `${root}:/${segments.join("/")}`;
}

/**
 * Normalizes a provider-relative CDN storage path.
 */
export function normalizeStoragePath(value)
{
    const text = String(value ?? "").trim().replaceAll("\\", "/");
    const segments = normalizeSegments(text, "storage path");

    if (segments.length === 0)
    {
        throw new Error("Storage path is required");
    }

    return segments.join("/");
}

function normalizeSegments(value, name)
{
    const segments = String(value).split("/").filter(Boolean);

    for (const segment of segments)
    {
        if (segment === "." || segment === ".." || segment.includes("\0"))
        {
            throw new Error(`Unsafe ${name}`);
        }
    }

    return segments;
}

function normalizeOptionalMd5(value, lineNumber)
{
    if (value === undefined || value === null || value === "")
    {
        return null;
    }

    const md5 = String(value).trim().toLowerCase();

    if (!/^[a-f0-9]{32}$/u.test(md5))
    {
        throw new Error(`Invalid checksum at line ${lineNumber ?? "unknown"}`);
    }

    return md5;
}

function normalizeOptionalInteger(value, name, lineNumber)
{
    if (value === undefined || value === null || value === "")
    {
        return null;
    }

    const result = Number(value);

    if (!Number.isSafeInteger(result) || result < 0)
    {
        throw new Error(`Invalid ${name} at line ${lineNumber ?? "unknown"}: ${value}`);
    }

    return result;
}
