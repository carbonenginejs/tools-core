import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as utils from "../utils.js";

/** Shared game-compatible cache for every CarbonEngineJS Node tool. */
export class CjsToolCache
{

    /** Creates a cache rooted at `.cache/tool-core` by default. */
    constructor(directory = path.resolve(process.cwd(), ".cache", "tool-core"))
    {
        this.directory = path.resolve(directory);
        Object.freeze(this);
    }

    /** Gets one content-addressed payload path under the shared ResFiles tree. */
    GetRemoteFilePath(storagePath)
    {
        const segments = NormalizeStoragePath(storagePath);

        return SafeJoin(this.directory, "ResFiles", ...segments);
    }

    /** Gets one exact game/provider/build index path. */
    GetIndexPath(game, provider, build, fileName)
    {
        if (fileName === undefined)
        {
            fileName = build;
            build = provider;
            provider = game;
            game = "Eve";
        }

        return SafeJoin(
            this.directory,
            "games",
            SafeToken(game, "game"),
            "providers",
            SafeToken(provider, "provider"),
            "builds",
            utils.normalizeExactBuild(build),
            "indexes",
            SafeFileName(fileName)
        );
    }

    /** Gets a deterministic generated artifact path for one exact build. */
    GetCustomPath({
        game = "Eve",
        provider,
        build,
        name,
        version = "v1",
        extension = "json",
    })
    {
        const fileName = [
            SafeToken(name, "custom name"),
            SafeToken(version, "custom version")
        ].join("_");

        return SafeJoin(
            this.directory,
            "custom",
            "games",
            SafeToken(game, "game"),
            "providers",
            SafeToken(provider, "provider"),
            "builds",
            utils.normalizeExactBuild(build),
            `${fileName}.${SafeExtension(extension)}`,
        );
    }

    /** Reads cached index bytes or returns null when absent. */
    async ReadIndex(game, provider, build, fileName)
    {
        if (fileName === undefined)
        {
            fileName = build;
            build = provider;
            provider = game;
            game = "Eve";
        }

        const cachePath = this.GetIndexPath(game, provider, build, fileName);
        const bytes = await ReadIfPresent(cachePath);

        return bytes ? Object.freeze({ cachePath, bytes }) : null;
    }

    /** Replaces cached index bytes at their exact provider/build path. */
    async WriteIndex(game, provider, build, fileName, bytes)
    {
        if (bytes === undefined)
        {
            bytes = fileName;
            fileName = build;
            build = provider;
            provider = game;
            game = "Eve";
        }

        const cachePath = this.GetIndexPath(game, provider, build, fileName);

        await WriteReplace(cachePath, ToUint8Array(bytes));

        return cachePath;
    }

    /** Reads and optionally validates one shared content-addressed payload. */
    async ReadRemote(storagePath, expected = {})
    {
        const cachePath = this.GetRemoteFilePath(storagePath);
        const bytes = await ReadIfPresent(cachePath);

        if (!bytes)
        {
            return null;
        }

        ValidateBytes(bytes, expected, storagePath);

        return Object.freeze({ bytes, cachePath });
    }

    /** Writes one immutable validated payload into the shared ResFiles tree. */
    async WriteRemote(storagePath, bytes, expected = {})
    {
        const value = ToUint8Array(bytes);
        const cachePath = this.GetRemoteFilePath(storagePath);

        ValidateBytes(value, expected, storagePath);

        const cached = await ReadIfPresent(cachePath);

        if (cached)
        {
            ValidateBytes(cached, expected, storagePath);

            return Object.freeze({ cachePath, cacheHit: true });
        }

        const written = await WriteImmutable(cachePath, value);
        const stored = await fs.readFile(cachePath);

        ValidateBytes(stored, expected, storagePath);

        return Object.freeze({ cachePath, cacheHit: !written });
    }

    /** Writes pretty JSON to a deterministic generated-output path. */
    async WriteCustom(identity, value)
    {
        const filePath = this.GetCustomPath(identity);
        const json = `${JSON.stringify(value, null, 2)}\n`;

        await WriteReplace(filePath, new TextEncoder().encode(json));

        return filePath;
    }

}

function NormalizeStoragePath(value)
{
    const normalized = String(value || "").trim().replaceAll("\\", "/");
    const segments = normalized.split("/");

    if (segments.length < 2
        || segments.some(segment => !segment || segment === "." || segment === ".."))
    {
        throw new TypeError(`Invalid indexed storage path "${value}"`);
    }

    if (!/^[0-9a-f]{2}$/iu.test(segments[0]))
    {
        throw new TypeError(
            `Indexed storage path "${value}" is missing its two-character shard`
        );
    }

    for (const segment of segments)
    {
        if (segment.includes(":") || segment.includes("\0"))
        {
            throw new TypeError(`Invalid indexed storage path "${value}"`);
        }
    }

    return segments;
}

function SafeToken(value, label)
{
    const token = String(value || "").trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9.-]*$/u.test(token))
    {
        throw new TypeError(`Invalid ${label} "${value}"`);
    }

    return token;
}

function SafeFileName(value)
{
    const fileName = String(value || "").trim();

    if (!fileName
        || path.basename(fileName) !== fileName
        || fileName.includes("\0"))
    {
        throw new TypeError(`Invalid index file name "${value}"`);
    }

    return fileName;
}

function SafeExtension(value)
{
    const extension = String(value || "").trim().toLowerCase();

    if (!/^[a-z0-9]+$/u.test(extension))
    {
        throw new TypeError(`Invalid custom extension "${value}"`);
    }

    return extension;
}

function SafeJoin(root, ...segments)
{
    const result = path.resolve(root, ...segments);
    const relative = path.relative(path.resolve(root), result);

    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    {
        throw new Error(`Cache path escaped root: ${result}`);
    }

    return result;
}

async function ReadIfPresent(filePath)
{
    try
    {
        return await fs.readFile(filePath);
    }
    catch (error)
    {
        if (error?.code === "ENOENT")
        {
            return null;
        }

        throw error;
    }
}

async function WriteImmutable(filePath, bytes)
{
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const temporary = TemporaryPath(filePath);

    try
    {
        await fs.writeFile(temporary, bytes, { flag: "wx" });
        await fs.rename(temporary, filePath);

        return true;
    }
    catch (error)
    {
        if (![ "EEXIST", "EPERM" ].includes(error?.code)
            || !await ReadIfPresent(filePath))
        {
            throw error;
        }

        return false;
    }
    finally
    {
        await fs.rm(temporary, { force: true });
    }
}

async function WriteReplace(filePath, bytes)
{
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const temporary = TemporaryPath(filePath);

    try
    {
        await fs.writeFile(temporary, bytes, { flag: "wx" });

        try
        {
            await fs.rename(temporary, filePath);
        }
        catch (error)
        {
            if (![ "EEXIST", "EPERM" ].includes(error?.code))
            {
                throw error;
            }

            await fs.rm(filePath, { force: true });
            await fs.rename(temporary, filePath);
        }
    }
    finally
    {
        await fs.rm(temporary, { force: true });
    }
}

function TemporaryPath(filePath)
{
    return `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
}

function ValidateBytes(bytes, expected, label)
{
    if (expected.size !== undefined && bytes.byteLength !== Number(expected.size))
    {
        throw new Error(
            `${label} size mismatch: expected ${expected.size}, received ${bytes.byteLength}`
        );
    }

    if (expected.md5)
    {
        const actual = crypto.createHash("md5").update(bytes).digest("hex");
        if (actual !== String(expected.md5).toLowerCase())
        {
            throw new Error(
                `${label} MD5 mismatch: expected ${expected.md5}, received ${actual}`
            );
        }
    }
}

function ToUint8Array(value)
{
    if (value instanceof Uint8Array)
    {
        return value;
    }

    if (value instanceof ArrayBuffer)
    {
        return new Uint8Array(value);
    }

    throw new TypeError("Cache bytes must be a Uint8Array or ArrayBuffer");
}
