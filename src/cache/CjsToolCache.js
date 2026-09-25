import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { CjsToolLibraryArtifact } from "../library/CjsToolLibraryArtifact.js";
import * as utils from "../utils.js";
import { resolveCacheRoot } from "./resolveCacheRoot.js";

/** Shared game-compatible cache for every CarbonEngineJS Node tool. */
export class CjsToolCache
{

    /**
     * Creates a cache at the resolved root: explicit, then `CJS_TOOL_CACHE`,
     * then `.cache/tool-core` under the working directory.
     *
     * The default is resolved rather than defaulted in the parameter, because
     * an argument default is evaluated per construction site and this one was
     * copied into three bins besides — so setting the variable moved the cache
     * for none of them.
     */
    constructor(directory)
    {
        this.directory = resolveCacheRoot(directory);
        Object.freeze(this);
    }

    /** Gets one content-addressed payload path under the shared ResFiles tree. */
    GetRemoteFilePath(storagePath)
    {
        const segments = NormalizeStoragePath(storagePath);

        return SafeJoin(this.directory, "ResFiles", ...segments);
    }

    /**
     * Gets one exact target/build index path.
     *
     * Target is the only operational identity; game and provider never select
     * a cache tree.
     */
    GetIndexPath(targetOrIdentity, buildValue, fileNameValue)
    {
        const { target, build, fileName } = NormalizeIndexArguments(
            targetOrIdentity,
            buildValue,
            fileNameValue,
        );

        return SafeJoin(
            this.directory,
            "targets",
            SafeToken(target, "target"),
            "builds",
            utils.normalizeExactBuild(build),
            "indexes",
            SafeFileName(fileName)
        );
    }

    /** Gets a deterministic generated artifact path for one exact build. */
    GetCustomPath(identity)
    {
        const {
            build,
            name,
            version = "v1",
            extension = "json",
        } = identity ?? {};
        const target = identity?.target;
        const fileName = [
            SafeToken(name, "custom name"),
            SafeToken(version, "custom version")
        ].join("_");

        return SafeJoin(
            this.directory,
            "custom",
            "targets",
            SafeToken(target, "target"),
            "builds",
            utils.normalizeExactBuild(build),
            `${fileName}.${SafeExtension(extension)}`,
        );
    }

    /** Reads cached index bytes or returns null when absent. */
    async ReadIndex(target, build, fileName)
    {
        const cachePath = this.GetIndexPath(target, build, fileName);
        const bytes = await ReadIfPresent(cachePath);

        return bytes ? Object.freeze({ cachePath, bytes }) : null;
    }

    /** Replaces cached index bytes at their exact target/build path. */
    async WriteIndex(target, build, fileName, bytes)
    {
        const cachePath = this.GetIndexPath(target, build, fileName);

        await WriteReplace(cachePath, ToUint8Array(bytes));

        return cachePath;
    }

    /**
     * Reads one shared content-addressed payload, or null when absent. Not
     * re-hashed: bytes are validated once, when first downloaded, and written
     * atomically, so a cached payload is either complete or missing.
     */
    async ReadRemote(storagePath)
    {
        const cachePath = this.GetRemoteFilePath(storagePath);
        const bytes = await ReadIfPresent(cachePath);

        if (!bytes)
        {
            return null;
        }

        return Object.freeze({ bytes, cachePath });
    }

    /**
     * Writes one immutable payload into the shared ResFiles tree; an existing
     * payload at the same content address is kept. The caller validated the
     * bytes when it downloaded them.
     */
    async WriteRemote(storagePath, bytes)
    {
        const cachePath = this.GetRemoteFilePath(storagePath);

        if (await Exists(cachePath))
        {
            return Object.freeze({ cachePath, cacheHit: true });
        }

        const written = await WriteImmutable(cachePath, ToUint8Array(bytes));

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

    /** Writes canonical JSON plus a deterministic .json.gz distribution sibling. */
    async WriteCustomLibrary(identity, value, options = {})
    {
        return CjsToolLibraryArtifact.write(this.GetCustomPath(identity), value, options);
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

/** Reads a target/build/file identity in object or positional form. */
function NormalizeIndexArguments(targetOrIdentity, buildValue, fileNameValue)
{
    if (targetOrIdentity && typeof targetOrIdentity === "object")
    {
        return {
            target: targetOrIdentity.target,
            build: targetOrIdentity.build,
            fileName: buildValue ?? targetOrIdentity.fileName,
        };
    }

    return {
        target: targetOrIdentity,
        build: buildValue,
        fileName: fileNameValue,
    };
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

async function Exists(filePath)
{
    try
    {
        await fs.access(filePath);
        return true;
    }
    catch (error)
    {
        if (error?.code === "ENOENT")
        {
            return false;
        }

        throw error;
    }
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
