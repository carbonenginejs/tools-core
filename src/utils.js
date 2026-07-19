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
