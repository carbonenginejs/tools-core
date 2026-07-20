import { createHash } from "node:crypto";

export function isExactBuild(value)
{
    return /^\d+$/u.test(String(value ?? "").trim());
}

export function normalizeExactBuild(value, options = {})
{
    const build = String(value ?? "").trim();

    if (!isExactBuild(build))
    {
        throw new TypeError(options.message ?? `Invalid exact build "${value}"`);
    }

    return build;
}

export function normalizeExactBuildNumber(value, options = {})
{
    const build = Number(value);

    if (!Number.isSafeInteger(build) || build < 0)
    {
        throw new TypeError(options.message ?? `Invalid exact build "${value}"`);
    }

    return build;
}

export function requireObject(value, label)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError(`${label} must be an object`);
    }

    return value;
}

export function optionalString(value)
{
    return value === undefined || value === null || value === "" ? null : String(value);
}

export function joinUrl(baseUrl, relativePath)
{
    return `${String(baseUrl).replace(/\/+$/u, "")}/${String(relativePath).replace(/^\/+/, "")}`;
}

export function freezeData(value, seen = new Set())
{
    if (!value || typeof value !== "object" || seen.has(value))
    {
        return value;
    }

    seen.add(value);

    for (const item of Object.values(value))
    {
        freezeData(item, seen);
    }

    return Object.freeze(value);
}

export function assertOkResponse(response, url)
{
    if (!response?.ok)
    {
        throw new Error(`Failed to fetch ${url}: ${response?.status ?? "unknown"}`);
    }
}

export function validateResourceBytes(bytes, resource, label = resource?.logicalPath ?? "resource")
{
    const buffer = Buffer.from(bytes);

    if (resource?.uncompressedSize !== null
        && resource?.uncompressedSize !== undefined
        && buffer.byteLength !== resource.uncompressedSize)
    {
        throw new Error(
            `Invalid byte length for ${label}: expected ${resource.uncompressedSize}, got ${buffer.byteLength}`,
        );
    }

    if (resource?.checksum)
    {
        const checksum = createHash("md5").update(buffer).digest("hex");

        if (checksum !== resource.checksum)
        {
            throw new Error(`Invalid checksum for ${label}`);
        }
    }

    return buffer;
}

export function toArrayBuffer(bytes)
{
    const buffer = Buffer.from(bytes);

    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * Returns the cache lifetime for EVE latest-build metadata.
 * CCP's normal deployment window is approximately 09:00-12:00 UTC
 * (22:00-01:00 NZDT), so polling is frequent only inside that window.
 */
export function getEveLatestBuildCacheTTL(value = Date.now())
{
    const now = Number(value);

    if (!Number.isFinite(now))
    {
        throw new TypeError(`Invalid latest-build cache time: ${value}`);
    }

    const date = new Date(now);
    const hour = date.getUTCHours();

    if (hour >= 9 && hour < 12)
    {
        return 5 * 60 * 1000;
    }

    let nextWindow = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        9,
    );

    if (nextWindow <= now)
    {
        nextWindow += 24 * 60 * 60 * 1000;
    }

    return nextWindow - now;
}

/** Converts a plain generated JSON tree to upstream-style snake_case keys. */
export function toSnakeCaseValue(value)
{
    if (Array.isArray(value))
    {
        return value.map(toSnakeCaseValue);
    }

    if (!value || typeof value !== "object")
    {
        return value;
    }

    const output = {};

    for (const [ key, item ] of Object.entries(value))
    {
        const normalized = String(key)
            .replace(/IDs\b/gu, "Ids")
            .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
            .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
            .replace(/([A-Za-z])(\d+)/gu, "$1_$2")
            .replace(/(\d+)([A-Za-z])/gu, "$1_$2")
            .toLowerCase();

        if (Object.hasOwn(output, normalized))
        {
            throw new Error(`Generated API key collision: ${key} -> ${normalized}`);
        }

        output[normalized] = toSnakeCaseValue(item);
    }

    return output;
}
