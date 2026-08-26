import { createHash } from "node:crypto";

import { NextCheckDelay } from "./build/CjsToolBuildSchedule.js";

/** Reports whether a value is represented solely by decimal build digits. */
export function isExactBuild(value)
{
    return /^\d+$/u.test(String(value ?? "").trim());
}

/** Validates an exact build reference and returns its canonical decimal string. */
export function normalizeExactBuild(value, options = {})
{
    const build = String(value ?? "").trim();

    if (!isExactBuild(build))
    {
        throw new TypeError(options.message ?? `Invalid exact build "${value}"`);
    }

    return build;
}

/**
 * Validates an exact build reference and returns it as a non-negative safe
 * integer.
 */
export function normalizeExactBuildNumber(value, options = {})
{
    const build = Number(value);

    if (!Number.isSafeInteger(build) || build < 0)
    {
        throw new TypeError(options.message ?? `Invalid exact build "${value}"`);
    }

    return build;
}

/** Requires a non-null, non-array object and returns it unchanged. */
export function requireObject(value, label)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError(`${label} must be an object`);
    }

    return value;
}

/** Normalizes absent and empty values to null while stringifying supplied values. */
export function optionalString(value)
{
    return value === undefined || value === null || value === "" ? null : String(value);
}

/** Joins a base URL and relative path with exactly one separating slash. */
export function joinUrl(baseUrl, relativePath)
{
    return `${String(baseUrl).replace(/\/+$/u, "")}/${String(relativePath).replace(/^\/+/, "")}`;
}

/**
 * Recursively freezes an object graph while safely retaining repeated
 * references.
 */
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

/** Rejects an absent or unsuccessful fetch response with URL and status context. */
export function assertOkResponse(response, url)
{
    if (!response?.ok)
    {
        throw new Error(`Failed to fetch ${url}: ${response?.status ?? "unknown"}`);
    }
}

/** Validates acquired resource bytes against indexed size and MD5 evidence. */
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

/** Copies the visible byte window into a standalone ArrayBuffer. */
export function toArrayBuffer(bytes)
{
    const buffer = Buffer.from(bytes);

    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * Returns how long an observation of the latest build stays good.
 *
 * The rule now lives in `src/build/CjsToolBuildSchedule.js`, which the build
 * authority owns; this stays as the name two callers already use.
 *
 * It moved so the build authority owns it, not because it was wrong: 09:00-12:00
 * UTC bracketed the real window, which is 11:00-12:00 EVE time (UTC).
 */
export function getEveLatestBuildCacheTTL(value = Date.now())
{
    return NextCheckDelay({ now: Number(value) });
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
