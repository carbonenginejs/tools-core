import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
    isResFileAddressFor,
    parseResFileAddress,
} from "@carbonenginejs/runtime-utils/resfile";

import { CjsIndexCache } from "./CjsIndexCache.js";
import { CjsIndexEntry } from "./CjsIndexEntry.js";
import { parseIndexGroup } from "./CjsIndexGroup.js";
import { CjsIndexOverlay } from "./CjsIndexOverlayStore.js";
import { normalizeTargetId } from "../target/CjsToolTarget.js";
import * as utils from "../utils.js";

const ManifestSchema = "carbon.generatedResourceIndexes";
const ManifestVersion = 1;
const ManifestName = "resource-indexes";
const ManifestArtifactVersion = "v1";

/** Exact-build generated resfileindex groups backed by shared ResFiles bytes. */
export class CjsIndexGeneratedStore
{

    #cache;

    /** Creates an exact-build generated-index store over the shared cache. */
    constructor({ cache } = {})
    {
        if (!(cache instanceof CjsIndexCache))
        {
            throw new TypeError(
                "CjsIndexGeneratedStore cache must be a CjsIndexCache",
            );
        }

        this.#cache = cache;
        this.directory = cache.directory;
        Object.freeze(this);
    }

    /** Installs or replaces one exact-build generated index group. */
    async Install(options = {})
    {
        const target = normalizeTargetId(options.target);
        const game = RequiredText(options.game, "generated index game");
        const provider = SafeToken(options.provider, "generated index provider");
        const build = utils.normalizeExactBuild(options.build, {
            message: `Generated indexes require an exact build: ${options.build}`,
        });
        const name = SafeToken(options.name, "generated index name");
        const entries = NormalizeEntries(options.entries);

        for (const entry of entries)
        {
            const cached = await this.#cache.ReadPayload(
                provider,
                "res",
                entry.location,
            );

            if (!cached)
            {
                throw new Error(
                    `Generated index payload is absent from ResFiles: ${entry.location}`,
                );
            }

            utils.validateResourceBytes(
                cached.bytes,
                entry,
                entry.logicalPath,
            );
        }

        const indexFile = `resfileindex_${name}.txt`;
        const indexText = `${entries.map(FormatEntry).join("\n")}\n`;
        const indexBytes = new TextEncoder().encode(indexText);
        const indexSha256 = Sha256(indexBytes);
        const current = await this.#ReadManifest({
            target,
            game,
            provider,
            build,
        }) ?? {
            schema: ManifestSchema,
            version: ManifestVersion,
            target,
            game,
            provider,
            build,
            groups: {},
        };
        const groups = {
            ...current.groups,
            [name]: {
                name,
                mode: "fallback",
                storageKind: "generated-cache",
                indexFile,
                indexSha256,
                rowCount: entries.length,
                byteLength: entries.reduce(
                    (total, entry) => total + entry.uncompressedSize,
                    0,
                ),
                provenance: options.provenance ?? null,
            },
        };
        const manifest = {
            ...current,
            groups: Object.fromEntries(Object.entries(groups)
                .sort(([ left ], [ right ]) => left.localeCompare(right, "en"))),
        };

        await this.#cache.WriteIndex(
            game,
            provider,
            build,
            indexFile,
            indexBytes,
        );
        await this.#cache.cache.WriteCustom({
            game,
            provider,
            build,
            name: ManifestName,
            version: ManifestArtifactVersion,
        }, manifest);

        return Object.freeze({
            target,
            game,
            provider,
            build,
            ...manifest.groups[name],
        });
    }

    /** Opens every installed generated group for one exact target build. */
    async OpenTarget(targetValue, buildValue, expected = {})
    {
        const target = normalizeTargetId(targetValue);
        const game = RequiredText(expected.game, "generated index game");
        const provider = SafeToken(
            expected.provider,
            "generated index provider",
        );
        const build = utils.normalizeExactBuild(buildValue, {
            message: `Generated indexes require an exact build: ${buildValue}`,
        });
        const manifest = await this.#ReadManifest({
            target,
            game,
            provider,
            build,
        });

        if (!manifest)
        {
            return Object.freeze([]);
        }

        const groups = [];

        for (const descriptor of Object.values(manifest.groups))
        {
            const cached = await this.#cache.ReadIndex(
                game,
                provider,
                build,
                descriptor.indexFile,
            );

            if (!cached)
            {
                throw new Error(
                    `Generated index is absent: ${descriptor.indexFile}`,
                );
            }
            if (Sha256(cached.bytes) !== descriptor.indexSha256)
            {
                throw new Error(
                    `Generated index checksum mismatch: ${descriptor.indexFile}`,
                );
            }

            const indexText = Buffer.from(cached.bytes).toString("utf8");
            const group = parseIndexGroup(indexText, {
                kind: "resfileindex-generated",
                name: descriptor.name,
                root: "res",
                sourceUrl: `generated-index://${target}/${build}/${descriptor.indexFile}`,
                cachePath: cached.cachePath,
                cacheHit: true,
            });

            if (group.count !== descriptor.rowCount)
            {
                throw new Error(
                    `Generated index ${descriptor.name} row count mismatch`,
                );
            }

            groups.push(new CjsIndexOverlay({
                schema: ManifestSchema,
                version: ManifestVersion,
                target,
                game,
                provider,
                buildRef: expected.buildRef ?? build,
                build,
                client: expected.client ?? null,
                name: descriptor.name,
                mode: "fallback",
                storageKind: "generated-cache",
                baseUrl: null,
                builds: [ build ],
                directory: path.dirname(cached.cachePath),
                payloadDirectory: null,
                group,
                rowCount: descriptor.rowCount,
                byteLength: descriptor.byteLength,
                provenance: descriptor.provenance,
            }));
        }

        return Object.freeze(groups);
    }

    /** Reads and validates the generated-index commit manifest when present. */
    async #ReadManifest(identity)
    {
        const manifestPath = this.#cache.cache.GetCustomPath({
            game: identity.game,
            provider: identity.provider,
            build: identity.build,
            name: ManifestName,
            version: ManifestArtifactVersion,
        });
        let manifest;

        try
        {
            manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        }
        catch (error)
        {
            if (error?.code === "ENOENT")
            {
                return null;
            }

            throw error;
        }

        ValidateManifest(manifest, identity);
        return manifest;
    }

}

function NormalizeEntries(value)
{
    if (!Array.isArray(value) || value.length === 0)
    {
        throw new TypeError(
            "Generated index installation requires at least one entry",
        );
    }

    const paths = new Set();
    const entries = value.map(item => CjsIndexEntry.from(item));

    for (const entry of entries)
    {
        if (entry.prefix !== "res")
        {
            throw new Error(
                `Generated index entry must use res:/: ${entry.logicalPath}`,
            );
        }
        if (paths.has(entry.logicalPath))
        {
            throw new Error(
                `Duplicate generated resource: ${entry.logicalPath}`,
            );
        }
        paths.add(entry.logicalPath);

        const address = parseResFileAddress(entry.location);

        if (!address
            || !isResFileAddressFor(entry.location, entry.logicalPath)
            || !entry.checksum
            || address.checksum !== entry.checksum)
        {
            throw new Error(
                `Generated resource is not content-addressed: ${entry.logicalPath}`,
            );
        }
        if (!Number.isSafeInteger(entry.uncompressedSize)
            || entry.uncompressedSize < 0
            || entry.compressedSize !== entry.uncompressedSize)
        {
            throw new Error(
                `Generated resource requires one exact byte length: ${entry.logicalPath}`,
            );
        }
    }

    return entries.sort((left, right) =>
        left.logicalPath.localeCompare(right.logicalPath, "en"));
}

function ValidateManifest(manifest, expected)
{
    if (manifest?.schema !== ManifestSchema
        || manifest?.version !== ManifestVersion)
    {
        throw new Error("Unsupported generated-index manifest");
    }
    if (normalizeTargetId(manifest.target) !== expected.target
        || String(manifest.game) !== expected.game
        || SafeToken(manifest.provider, "generated index provider")
            !== expected.provider
        || utils.normalizeExactBuild(manifest.build) !== expected.build)
    {
        throw new Error("Generated-index manifest identity mismatch");
    }
    if (!manifest.groups
        || typeof manifest.groups !== "object"
        || Array.isArray(manifest.groups))
    {
        throw new Error("Generated-index manifest groups must be an object");
    }

    for (const [ name, descriptor ] of Object.entries(manifest.groups))
    {
        if (SafeToken(name, "generated index name") !== name
            || descriptor?.name !== name
            || descriptor.mode !== "fallback"
            || descriptor.storageKind !== "generated-cache"
            || descriptor.indexFile !== `resfileindex_${name}.txt`
            || !/^[a-f0-9]{64}$/u.test(descriptor.indexSha256)
            || !Number.isSafeInteger(descriptor.rowCount)
            || descriptor.rowCount < 1
            || !Number.isSafeInteger(descriptor.byteLength)
            || descriptor.byteLength < 0)
        {
            throw new Error(`Invalid generated-index descriptor: ${name}`);
        }
    }
}

function FormatEntry(entry)
{
    return [
        entry.logicalPath,
        entry.location,
        entry.checksum,
        entry.uncompressedSize,
        entry.compressedSize,
        entry.binaryOperation ?? "",
    ].join(",");
}

function Sha256(value)
{
    return crypto.createHash("sha256").update(value).digest("hex");
}

function RequiredText(value, label)
{
    const text = String(value ?? "").trim();

    if (!text)
    {
        throw new TypeError(`${label} is required`);
    }

    return text;
}

function SafeToken(value, label)
{
    const token = RequiredText(value, label).toLowerCase();

    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(token))
    {
        throw new TypeError(`Invalid ${label}: ${value}`);
    }

    return token;
}
