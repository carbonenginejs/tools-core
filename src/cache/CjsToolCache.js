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
     * Keyed by target, which is the identity. The previous key was
     * `game + provider`, which separated the four targets only by accident:
     * Eve+ccp, Frontier+ccp, Eve+serenity and Eve+infinity happen to be
     * distinct pairs and nothing enforced that they would stay so, while a
     * duplicate target id throws in the registry.
     *
     * Accepts the legacy `(game, provider, build, fileName)` form and resolves
     * it to a target, so a caller that has not been moved yet lands in the same
     * directory as one that has, rather than quietly writing a second copy
     * beside it. That shim is what makes this migratable in steps; it goes when
     * the last caller does.
     */
    GetIndexPath(...args)
    {
        const { target, build, fileName } = NormalizeIndexArguments(args);

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
        const target = ResolveIdentityTarget(identity);
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

/**
 * The four targets, by the `game + provider` pair that used to key them.
 *
 * A translation table for callers still passing the old pair, not a second
 * registry: it exists so a partly-migrated tree cannot end up with two
 * directories for one target, and it is deleted with the last legacy caller.
 * An unknown pair is an error rather than a guess — writing to a directory
 * named after a coincidence is what this change exists to stop.
 */
const LEGACY_TARGETS = Object.freeze({
    "eve/ccp": "eve",
    "frontier/ccp": "frontier",
    "eve/serenity": "serenity",
    "eve/infinity": "infinity",
});

/** Resolves an identity object to a target, accepting the legacy pair. */
function ResolveIdentityTarget(identity)
{
    if (identity?.target) return String(identity.target).toLowerCase();

    const game = identity?.game ?? "Eve";
    const provider = identity?.provider;

    if (!provider)
    {
        throw new TypeError("Cache identity requires a target");
    }

    const key = `${String(game).toLowerCase()}/${String(provider).toLowerCase()}`;

    // A pair with no registered target still needs somewhere to go: the index
    // layer can be opened by provider alone, without the target registry, and
    // a third-party provider profile has no target at all. Those get a compound
    // scope rather than an error or a guess - `eve-test`, never `eve` and never
    // `test`, so an unregistered pair can neither collide with a target's
    // directory nor with another pair's.
    return LEGACY_TARGETS[key] ?? key.replace("/", "-");
}

/** Reads `(target|game, provider, build, fileName)` in either shape. */
function NormalizeIndexArguments(args)
{
    // Legacy: (game, provider, build, fileName), and the three-argument form
    // that omitted the game.
    if (args.length >= 3)
    {
        const [ game, provider, build, fileName ] = args.length === 3
            ? [ "Eve", args[0], args[1], args[2] ]
            : args;

        return { target: ResolveIdentityTarget({ game, provider }), build, fileName };
    }

    const [ identity, fileName ] = args;

    return {
        target: ResolveIdentityTarget(identity),
        build: identity?.build,
        fileName: fileName ?? identity?.fileName,
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
