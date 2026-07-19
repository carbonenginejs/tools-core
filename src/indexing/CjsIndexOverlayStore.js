import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { CjsIndexEntry } from "./CjsIndexEntry.js";
import { parseIndexGroup } from "./CjsIndexGroup.js";
import { createPathMatcher } from "./pathMatcher.js";
import * as utils from "../utils.js";
import { normalizeTargetId } from "../target/CjsToolTarget.js";

const ManifestSchema = "carbon.resource-overlay";
const ManifestVersion = 1;

/** Persistent target-specific resource overlays stored outside disposable caches. */
export class CjsIndexOverlayStore
{

    constructor(directory = path.resolve(process.cwd(), "data.local"))
    {
        this.directory = path.resolve(directory);
        Object.freeze(this);
    }

    /** Gets one deterministic persistent overlay directory. */
    GetOverlayDirectory(targetValue, nameValue)
    {
        const target = normalizeTargetId(targetValue);
        const name = normalizeOverlayName(nameValue);

        return safeJoin(this.directory, "games", target, "overlays", name);
    }

    /** Opens every compatible overlay for one exact target build. */
    async OpenTarget(targetValue, buildValue, expected = {})
    {
        const target = normalizeTargetId(targetValue);
        const build = utils.normalizeExactBuild(buildValue, {
            message: `Persistent overlays require an exact build: ${buildValue}`,
        });
        const directory = safeJoin(this.directory, "games", target, "overlays");
        let entries;

        try
        {
            entries = await fs.readdir(directory, { withFileTypes: true });
        }
        catch (error)
        {
            if (error?.code === "ENOENT")
            {
                return Object.freeze([]);
            }

            throw error;
        }

        const overlays = [];

        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name)))
        {
            if (!entry.isDirectory() || entry.name.startsWith("."))
            {
                continue;
            }

            const overlay = await this.#OpenOverlay(
                safeJoin(directory, entry.name),
                target,
                build,
                expected,
            );

            if (overlay)
            {
                overlays.push(overlay);
            }
        }

        return Object.freeze(overlays);
    }

    /** Imports validated payloads and a resfileindex-style manifest transactionally. */
    async Import(options)
    {
        const target = normalizeTargetId(options?.target);
        const name = normalizeOverlayName(options?.name);
        const mode = normalizeOverlayMode(options?.mode ?? "fallback");
        const game = normalizeRequiredText(options?.game, "overlay game");
        const provider = normalizeOverlayName(options?.provider);
        const builds = normalizeBuilds(options?.builds ?? [ "*" ]);
        const entries = normalizeImportEntries(options?.entries);
        const sourceDirectory = path.resolve(normalizeRequiredText(
            options?.sourceDirectory,
            "overlay source directory",
        ));
        const overlayDirectory = this.GetOverlayDirectory(target, name);
        const parentDirectory = path.dirname(overlayDirectory);
        const importDirectory = safeJoin(
            parentDirectory,
            `.${name}.import-${crypto.randomUUID()}`,
        );
        const payloadDirectory = safeJoin(importDirectory, "res");

        if (await exists(overlayDirectory))
        {
            throw new Error(`Persistent overlay already exists: ${overlayDirectory}`);
        }

        await fs.mkdir(payloadDirectory, { recursive: true });

        try
        {
            const records = [];
            let byteLength = 0;

            for (const entry of entries)
            {
                const sourcePath = safeJoin(sourceDirectory, entry.location);
                const bytes = await fs.readFile(sourcePath);
                const checksum = crypto.createHash("md5").update(bytes).digest("hex");
                const sourceRecord = new CjsIndexEntry({
                    logicalPath: entry.logicalPath,
                    location: entry.location,
                    checksum: entry.checksum ?? checksum,
                    uncompressedSize: entry.uncompressedSize ?? bytes.byteLength,
                    compressedSize: entry.compressedSize ?? bytes.byteLength,
                });

                validateContentAddress(sourceRecord);
                const record = new CjsIndexEntry({
                    logicalPath: sourceRecord.logicalPath,
                    location: sourceRecord.relativePath,
                    checksum: sourceRecord.checksum,
                    uncompressedSize: sourceRecord.uncompressedSize,
                    compressedSize: sourceRecord.compressedSize,
                    binaryOperation: sourceRecord.binaryOperation,
                });

                utils.validateResourceBytes(bytes, record, record.logicalPath);

                const targetPath = safeJoin(payloadDirectory, record.location);

                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.copyFile(sourcePath, targetPath);

                records.push(record);
                byteLength += bytes.byteLength;
            }

            records.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));

            const indexText = `${records.map(formatIndexEntry).join("\n")}\n`;
            const manifest = {
                schema: ManifestSchema,
                version: ManifestVersion,
                target,
                game,
                provider,
                name,
                mode,
                builds,
                storageKind: "persistent-overlay",
                indexFile: "resfileindex.txt",
                payloadDirectory: "res",
                payloadLayout: "logical-path",
                rowCount: records.length,
                byteLength,
                provenance: options?.provenance ?? null,
            };

            await fs.writeFile(
                safeJoin(importDirectory, manifest.indexFile),
                indexText,
                "utf8",
            );
            await fs.writeFile(
                safeJoin(importDirectory, "overlay.json"),
                `${JSON.stringify(manifest, null, 2)}\n`,
                "utf8",
            );
            await fs.mkdir(parentDirectory, { recursive: true });
            await fs.rename(importDirectory, overlayDirectory);

            return utils.freezeData({
                directory: overlayDirectory,
                ...manifest,
            });
        }
        catch (error)
        {
            await fs.rm(importDirectory, { recursive: true, force: true });
            throw error;
        }
    }

    /** Registers a remote resfileindex-style fallback without copying payloads. */
    async ImportRemote(options)
    {
        const target = normalizeTargetId(options?.target);
        const name = normalizeOverlayName(options?.name);
        const mode = normalizeOverlayMode(options?.mode ?? "fallback");
        const game = normalizeRequiredText(options?.game, "overlay game");
        const provider = normalizeOverlayName(options?.provider);
        const builds = normalizeBuilds(options?.builds ?? [ "*" ]);
        const entries = normalizeImportEntries(options?.entries)
            .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
        const baseUrl = normalizeRemoteBaseUrl(options?.baseUrl);
        const overlayDirectory = this.GetOverlayDirectory(target, name);
        const parentDirectory = path.dirname(overlayDirectory);
        const importDirectory = safeJoin(
            parentDirectory,
            `.${name}.import-${crypto.randomUUID()}`,
        );

        if (entries.some((entry) => !entry.checksum))
        {
            throw new Error("Remote overlay entries require payload checksums");
        }

        for (const entry of entries)
        {
            validateContentAddress(entry);
        }

        if (await exists(overlayDirectory))
        {
            throw new Error(`Persistent overlay already exists: ${overlayDirectory}`);
        }

        await fs.mkdir(importDirectory, { recursive: true });

        try
        {
            const manifest = {
                schema: ManifestSchema,
                version: ManifestVersion,
                target,
                game,
                provider,
                name,
                mode,
                builds,
                storageKind: "remote-overlay",
                baseUrl,
                indexFile: "resfileindex.txt",
                payloadDirectory: null,
                payloadLayout: null,
                rowCount: entries.length,
                byteLength: null,
                provenance: options?.provenance ?? null,
            };
            const indexText = `${entries.map(formatIndexEntry).join("\n")}\n`;

            await fs.writeFile(
                safeJoin(importDirectory, manifest.indexFile),
                indexText,
                "utf8",
            );
            await fs.writeFile(
                safeJoin(importDirectory, "overlay.json"),
                `${JSON.stringify(manifest, null, 2)}\n`,
                "utf8",
            );
            await fs.mkdir(parentDirectory, { recursive: true });
            await fs.rename(importDirectory, overlayDirectory);

            return utils.freezeData({
                directory: overlayDirectory,
                ...manifest,
            });
        }
        catch (error)
        {
            await fs.rm(importDirectory, { recursive: true, force: true });
            throw error;
        }
    }

    async #OpenOverlay(directory, target, build, expected)
    {
        const manifestPath = safeJoin(directory, "overlay.json");
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

        validateManifest(manifest, target, expected, path.basename(directory));

        if (!manifest.builds.includes("*") && !manifest.builds.includes(build))
        {
            return null;
        }

        const storageKind = manifest.storageKind ?? "persistent-overlay";
        const indexPath = safeJoin(directory, manifest.indexFile);
        const payloadDirectory = storageKind === "persistent-overlay"
            ? safeJoin(directory, manifest.payloadDirectory)
            : null;
        const indexText = await fs.readFile(indexPath, "utf8");
        const group = parseIndexGroup(indexText, {
            kind: "resfileindex-overlay",
            name: manifest.name,
            root: "res",
            sourceUrl: `local-overlay://${target}/${manifest.name}/${manifest.indexFile}`,
            cachePath: null,
            cacheHit: true,
        });

        if (group.count !== manifest.rowCount)
        {
            throw new Error(
                `Overlay ${manifest.name} row count mismatch: `
                + `expected ${manifest.rowCount}, received ${group.count}`,
            );
        }

        return new CjsIndexOverlay({
            ...manifest,
            storageKind,
            buildRef: expected.buildRef ?? build,
            build,
            client: expected.client ?? null,
            directory,
            payloadDirectory,
            group,
        });
    }

}

/** One opened persistent or remote overlay and its immutable resource index. */
export class CjsIndexOverlay
{

    #payloadDirectory;

    constructor(options)
    {
        this.schema = options.schema;
        this.version = options.version;
        this.target = options.target;
        this.game = options.game;
        this.provider = options.provider;
        this.buildRef = options.buildRef;
        this.build = options.build;
        this.client = options.client;
        this.name = options.name;
        this.mode = options.mode;
        this.storageKind = options.storageKind;
        this.baseUrl = options.baseUrl ?? null;
        this.builds = Object.freeze([ ...options.builds ]);
        this.directory = options.directory;
        this.group = options.group;
        this.rowCount = options.rowCount;
        this.byteLength = options.byteLength;
        this.provenance = utils.freezeData(options.provenance);
        this.#payloadDirectory = options.payloadDirectory;
        Object.freeze(this);
    }

    /** Resolves one overlay path without reading its payload. */
    Resolve(logicalPath)
    {
        const record = this.group.Find(logicalPath);

        return record ? this.#CreateResolution(record) : null;
    }

    /** Matches overlay paths with the same matcher contract as CjsIndex. */
    Match(pattern, options = {})
    {
        const matcher = createPathMatcher(pattern, {
            type: options.type ?? "wildcard",
            defaultRoot: "res",
            flags: options.flags,
        });

        return Object.freeze(this.group.entries
            .filter((record) => matcher(record.logicalPath))
            .map((record) => this.#CreateResolution(record)));
    }

    /** Reads and validates one persistent overlay payload. */
    async Read(record)
    {
        if (this.storageKind !== "persistent-overlay")
        {
            throw new Error(`Overlay ${this.name} is not stored locally`);
        }

        const payloadPath = this.GetPayloadPath(record);
        const bytes = await fs.readFile(payloadPath);

        return Object.freeze({
            bytes: utils.validateResourceBytes(bytes, record, record.logicalPath),
            payloadPath,
        });
    }

    /** Gets one payload path without allowing an index entry to escape the store. */
    GetPayloadPath(record)
    {
        if (this.storageKind !== "persistent-overlay")
        {
            throw new Error(`Overlay ${this.name} is not stored locally`);
        }

        return safeJoin(this.#payloadDirectory, CjsIndexEntry.from(record).location);
    }

    #CreateResolution(record)
    {
        return utils.freezeData({
            target: this.target,
            game: this.game,
            provider: this.provider,
            buildRef: this.buildRef,
            build: this.build,
            client: this.client,
            logicalPath: record.logicalPath,
            root: record.prefix,
            relativePath: record.relativePath,
            sourceUrl: this.storageKind === "remote-overlay"
                ? utils.joinUrl(this.baseUrl, record.location)
                : `local-overlay://${this.target}/${this.name}/${record.location}`,
            artifactKind: this.storageKind === "remote-overlay"
                ? "hash-safe"
                : "local-exact",
            record,
            indexKind: this.group.kind,
            indexName: this.name,
            indexNames: [ this.name ],
            indexUrl: this.group.sourceUrl,
            indexUrls: [ this.group.sourceUrl ],
            indexLogicalPaths: [ null ],
            overlay: this.name,
            overlayMode: this.mode,
            storageKind: this.storageKind,
        });
    }

}

function normalizeImportEntries(value)
{
    if (!Array.isArray(value) || value.length === 0)
    {
        throw new TypeError("Overlay import requires at least one resource entry");
    }

    const paths = new Set();

    return value.map((item) =>
    {
        const entry = CjsIndexEntry.from(item);

        if (entry.prefix !== "res")
        {
            throw new Error(`Overlay entry must use res:/: ${entry.logicalPath}`);
        }

        if (paths.has(entry.logicalPath))
        {
            throw new Error(`Duplicate overlay resource: ${entry.logicalPath}`);
        }

        paths.add(entry.logicalPath);
        return entry;
    });
}

function validateContentAddress(entry)
{
    const fileName = path.posix.basename(entry.location);
    const match = fileName.match(/^([a-f0-9]{16})_([a-f0-9]{32})(?:\..*)?$/iu);

    if (!match)
    {
        return;
    }

    const expectedPathHash = fnv1(entry.logicalPath);
    const expectedChecksum = match[2].toLowerCase();

    if (match[1].toLowerCase() !== expectedPathHash)
    {
        throw new Error(`Invalid content-address path hash for ${entry.logicalPath}`);
    }

    if (entry.checksum && entry.checksum !== expectedChecksum)
    {
        throw new Error(`Invalid content-address checksum for ${entry.logicalPath}`);
    }
}

function fnv1(value)
{
    let hash = 0xcbf29ce484222325n;

    for (const byte of Buffer.from(value, "utf8"))
    {
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
        hash ^= BigInt(byte);
    }

    return hash.toString(16).padStart(16, "0");
}

function formatIndexEntry(entry)
{
    return [
        entry.logicalPath,
        entry.location,
        entry.checksum ?? "",
        entry.uncompressedSize ?? "",
        entry.compressedSize ?? "",
        entry.binaryOperation ?? "",
    ].join(",");
}

function validateManifest(manifest, target, expected, directoryName)
{
    if (manifest?.schema !== ManifestSchema || manifest?.version !== ManifestVersion)
    {
        throw new Error("Unsupported persistent overlay manifest");
    }

    if (normalizeTargetId(manifest.target) !== target)
    {
        throw new Error(`Overlay target mismatch: ${manifest.target}`);
    }

    manifest.name = normalizeOverlayName(manifest.name);
    manifest.provider = normalizeOverlayName(manifest.provider);
    manifest.mode = normalizeOverlayMode(manifest.mode);
    manifest.builds = normalizeBuilds(manifest.builds);

    if (manifest.name !== normalizeOverlayName(directoryName))
    {
        throw new Error(
            `Overlay manifest name does not match its directory: ${manifest.name}`,
        );
    }
    void normalizeSafeFileName(manifest.indexFile, "overlay index file");
    const storageKind = manifest.storageKind ?? "persistent-overlay";

    if (![ "persistent-overlay", "remote-overlay" ].includes(storageKind))
    {
        throw new Error(`Unsupported overlay storage kind: ${storageKind}`);
    }

    if (storageKind === "persistent-overlay")
    {
        void normalizeSafeFileName(manifest.payloadDirectory, "overlay payload directory");

        if (manifest.payloadLayout !== undefined
            && manifest.payloadLayout !== "logical-path")
        {
            throw new Error(`Unsupported overlay payload layout: ${manifest.payloadLayout}`);
        }
    }
    else
    {
        void normalizeRemoteBaseUrl(manifest.baseUrl);
    }

    if (!Number.isSafeInteger(manifest.rowCount) || manifest.rowCount < 1)
    {
        throw new Error("Overlay rowCount must be a positive integer");
    }

    if (manifest.byteLength !== null
        && (!Number.isSafeInteger(manifest.byteLength) || manifest.byteLength < 0))
    {
        throw new Error("Overlay byteLength must be a non-negative integer");
    }

    if (expected.game !== undefined && String(expected.game) !== manifest.game)
    {
        throw new Error(`Overlay game mismatch: ${manifest.game}`);
    }

    if (expected.provider !== undefined && String(expected.provider) !== manifest.provider)
    {
        throw new Error(`Overlay provider mismatch: ${manifest.provider}`);
    }
}

function normalizeBuilds(value)
{
    if (!Array.isArray(value) || value.length === 0)
    {
        throw new TypeError("Overlay builds must be a non-empty array");
    }

    return Object.freeze([ ...new Set(value.map((build) =>
    {
        const normalized = String(build).trim();

        if (normalized !== "*" && !utils.isExactBuild(normalized))
        {
            throw new TypeError(`Invalid overlay build: ${build}`);
        }

        return normalized;
    })) ]);
}

function normalizeOverlayName(value)
{
    const name = String(value ?? "").trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(name))
    {
        throw new TypeError(`Invalid overlay name: ${value}`);
    }

    return name;
}

function normalizeOverlayMode(value)
{
    const mode = String(value ?? "").trim().toLowerCase();

    if (![ "fallback", "override" ].includes(mode))
    {
        throw new TypeError(`Invalid overlay mode: ${value}`);
    }

    return mode;
}

function normalizeSafeFileName(value, label)
{
    const name = String(value ?? "").trim();

    if (!name || path.basename(name) !== name || name === "." || name === "..")
    {
        throw new TypeError(`Invalid ${label}: ${value}`);
    }

    return name;
}

function normalizeRequiredText(value, label)
{
    const text = String(value ?? "").trim();

    if (!text)
    {
        throw new TypeError(`${label} is required`);
    }

    return text;
}

function normalizeRemoteBaseUrl(value)
{
    const text = normalizeRequiredText(value, "overlay remote base URL");
    const url = new URL(text);

    if (![ "http:", "https:" ].includes(url.protocol)
        || url.username
        || url.password
        || url.search
        || url.hash)
    {
        throw new TypeError(`Invalid overlay remote base URL: ${value}`);
    }

    return url.href.replace(/\/+$/u, "");
}

function safeJoin(root, ...segments)
{
    const resolvedRoot = path.resolve(root);
    const result = path.resolve(resolvedRoot, ...segments);
    const relative = path.relative(resolvedRoot, result);

    if (relative.startsWith("..") || path.isAbsolute(relative))
    {
        throw new Error(`Overlay path escaped its root: ${result}`);
    }

    return result;
}

async function exists(filePath)
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
