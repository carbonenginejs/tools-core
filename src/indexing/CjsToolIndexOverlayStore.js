import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { resFileAddress } from "@carbonenginejs/runtime/utils/resfile";

import { CjsToolIndexEntry } from "./CjsToolIndexEntry.js";
import { parseIndexGroup } from "./CjsToolIndexGroup.js";
import { createPathMatcher } from "./pathMatcher.js";
import * as utils from "../utils.js";
import { normalizeTargetId } from "../target/CjsToolTarget.js";

const ManifestSchema = "carbon.resource-overlay";
const ManifestVersion = 1;

/**
 * How a persistent overlay stores its payloads.
 *
 * `logical-path` mirrors `res:/a/b.fx` at `<overlay>/res/a/b.fx`. It is the
 * original layout and its defect is that the stored name says nothing about the
 * contents: edit the file and every row about it is unchanged, so the payload
 * has no identity anything can compare. That is what makes such an overlay
 * `local-exact` - see `docs/architecture/resource-addressing-and-staleness.md`,
 * where the service contract has to treat every `local-exact` input as changed
 * because absence of proof must never present as sameness.
 *
 * `content-address` stores the same bytes under the game's own address,
 * `<shard>/<path-fnv1>_<content-md5>`, in one store shared by every target and
 * every overlay. Three things follow, and they are the whole point:
 *
 *  - the payload becomes `hash-safe`, so staleness can prove it unchanged;
 *  - two overlays naming the same bytes name one file, which is what lets the
 *    EVE and Frontier WebGL2 sets stop being two 150 MB copies; and
 *  - the address changes only when the bytes change, so an HTTP route over it
 *    can be immutable and truthful at the same time.
 *
 * Both layouts are read. Only `content-address` is written, and
 * `cjs-overlay-migrate` moves the ones already on disk.
 */
const PayloadLayouts = Object.freeze([ "logical-path", "content-address" ]);
const DefaultPayloadLayout = "content-address";

/**
 * The shared payload store, named and shaped exactly as an installed client
 * names its own. It sits at the DATA root rather than the cache root because an
 * overlay payload cannot be re-downloaded: losing it costs the fact, not a
 * download.
 */
const PayloadStoreDirectory = "ResFiles";

/** Persistent target-specific resource overlays stored outside disposable caches. */
export class CjsToolIndexOverlayStore
{

    /**
     * Anchors persistent overlay discovery and import beneath one resolved data
     * directory.
     */
    constructor(directory = path.resolve(process.cwd(), "data.local"))
    {
        this.directory = path.resolve(directory);
        this.payloadStore = path.join(this.directory, PayloadStoreDirectory);
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
        const selectedNames = expected.names === undefined
            ? null
            : new Set(normalizeOverlayNames(expected.names));
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
            if (!entry.isDirectory() || entry.name.startsWith(".")
                || (selectedNames && !selectedNames.has(entry.name)))
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
        const layout = normalizePayloadLayout(options?.layout ?? DefaultPayloadLayout);
        const overlayDirectory = this.GetOverlayDirectory(target, name);
        const parentDirectory = path.dirname(overlayDirectory);
        const importDirectory = safeJoin(
            parentDirectory,
            `.${name}.import-${crypto.randomUUID()}`,
        );

        if (await exists(overlayDirectory))
        {
            throw new Error(`Persistent overlay already exists: ${overlayDirectory}`);
        }

        await fs.mkdir(importDirectory, { recursive: true });

        try
        {
            const { records, byteLength } = await this.#WritePayloads({
                entries,
                sourceDirectory,
                layout,
                importDirectory,
            });
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
                payloadDirectory: layout === "logical-path" ? "res" : null,
                payloadLayout: layout,
                revision: 1,
                history: [],
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

    /**
     * Records a new revision of one overlay under the SAME name.
     *
     * This is the difference between an overlay and a build artifact. A shader
     * set rebuilt against a newer client is not a new thing to be filed beside
     * the old one - it is the same overlay, later. Naming it
     * `webgl2-3430261-b7-9f2c1a` said the opposite, and every consumer then had
     * to reconstruct which of those names meant "the WebGL2 shaders" by reading
     * the suffixes. The name is now the human one and the varying parts are
     * revision metadata, which is what makes an overlay re-runnable: apply the
     * same declaration twice and the second run is a no-op rather than a second
     * overlay.
     *
     * Idempotence is decided by the index rows, and it can be decided only
     * because the payloads are content-addressed: identical rows mean identical
     * bytes. A `logical-path` overlay cannot answer the question at all, so it
     * must be migrated before it can be revised.
     */
    async Revise(options)
    {
        const target = normalizeTargetId(options?.target);
        const name = normalizeOverlayName(options?.name);
        const overlayDirectory = this.GetOverlayDirectory(target, name);

        if (!await exists(overlayDirectory))
        {
            return this.Import(options);
        }

        const manifestPath = safeJoin(overlayDirectory, "overlay.json");
        const current = JSON.parse(await fs.readFile(manifestPath, "utf8"));

        if ((current.storageKind ?? "persistent-overlay") !== "persistent-overlay")
        {
            throw new Error(`Overlay ${name} is not stored locally`);
        }

        if (normalizePayloadLayout(current.payloadLayout ?? "logical-path") !== "content-address")
        {
            throw new Error(
                `Overlay ${name} stores payloads by logical path and cannot be revised; `
                + "migrate it with cjs-overlay-migrate first",
            );
        }

        const entries = normalizeImportEntries(options?.entries);
        const sourceDirectory = path.resolve(normalizeRequiredText(
            options?.sourceDirectory,
            "overlay source directory",
        ));
        const stageDirectory = safeJoin(
            path.dirname(overlayDirectory),
            `.${name}.revise-${crypto.randomUUID()}`,
        );

        await fs.mkdir(stageDirectory, { recursive: true });

        try
        {
            const { records, byteLength } = await this.#WritePayloads({
                entries,
                sourceDirectory,
                layout: "content-address",
                importDirectory: stageDirectory,
            });
            const indexText = `${records.map(formatIndexEntry).join("\n")}\n`;
            const currentIndexPath = safeJoin(
                overlayDirectory,
                normalizeSafeFileName(current.indexFile, "overlay index file"),
            );
            const currentIndexText = await fs.readFile(currentIndexPath, "utf8");
            const revision = normalizeRevision(current.revision);
            const mode = options?.mode === undefined
                ? normalizeOverlayMode(current.mode)
                : normalizeOverlayMode(options.mode);
            const builds = options?.builds === undefined
                ? normalizeBuilds(current.builds)
                : normalizeBuilds(options.builds);
            const unchanged = currentIndexText === indexText
                && mode === normalizeOverlayMode(current.mode)
                && sameBuilds(builds, normalizeBuilds(current.builds));

            if (unchanged)
            {
                await fs.rm(stageDirectory, { recursive: true, force: true });

                return utils.freezeData({
                    ...current,
                    directory: overlayDirectory,
                    revision,
                    revised: false,
                });
            }

            const manifest = {
                ...current,
                schema: ManifestSchema,
                version: ManifestVersion,
                target,
                name,
                mode,
                builds,
                game: options?.game === undefined
                    ? current.game
                    : normalizeRequiredText(options.game, "overlay game"),
                provider: options?.provider === undefined
                    ? current.provider
                    : normalizeOverlayName(options.provider),
                storageKind: "persistent-overlay",
                indexFile: "resfileindex.txt",
                payloadDirectory: null,
                payloadLayout: "content-address",
                revision: revision + 1,
                history: [
                    ...normalizeHistory(current.history),
                    {
                        revision,
                        mode: normalizeOverlayMode(current.mode),
                        builds: [ ...normalizeBuilds(current.builds) ],
                        rowCount: current.rowCount,
                        byteLength: current.byteLength,
                        indexChecksum: crypto.createHash("md5")
                            .update(currentIndexText).digest("hex"),
                        provenance: current.provenance ?? null,
                        supersededAt: new Date().toISOString(),
                    },
                ],
                rowCount: records.length,
                byteLength,
                provenance: options?.provenance ?? current.provenance ?? null,
            };

            await fs.writeFile(
                safeJoin(stageDirectory, manifest.indexFile),
                indexText,
                "utf8",
            );
            await fs.writeFile(
                safeJoin(stageDirectory, "overlay.json"),
                `${JSON.stringify(manifest, null, 2)}\n`,
                "utf8",
            );
            await this.#SwapDirectory(stageDirectory, overlayDirectory, name);

            return utils.freezeData({
                directory: overlayDirectory,
                ...manifest,
                revised: true,
            });
        }
        catch (error)
        {
            await fs.rm(stageDirectory, { recursive: true, force: true });
            throw error;
        }
    }

    /**
     * Rewrites one `logical-path` overlay into the shared content-addressed
     * store, keeping its name, mode, builds and provenance.
     *
     * Payload writes are additive and idempotent, so an interrupted run costs a
     * re-hash rather than an overlay: the store either already holds the address
     * or does not, and nothing is removed. The mirrored `res/` tree is left
     * behind for the caller to delete once it is satisfied, because the whole
     * point of the data root is that it holds what cannot be re-downloaded.
     */
    async Migrate(options)
    {
        const target = normalizeTargetId(options?.target);
        const name = normalizeOverlayName(options?.name);
        const renameTo = options?.renameTo === undefined || options.renameTo === null
            ? name
            : normalizeOverlayName(options.renameTo);
        const overlayDirectory = this.GetOverlayDirectory(target, name);
        const manifestPath = safeJoin(overlayDirectory, "overlay.json");
        const current = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        const layout = normalizePayloadLayout(current.payloadLayout ?? "logical-path");

        if ((current.storageKind ?? "persistent-overlay") !== "persistent-overlay")
        {
            throw new Error(`Overlay ${name} is not stored locally`);
        }

        // A translated set cannot be migrated, only rebuilt. Its payloads belong
        // at their SOURCE's address with the backend appended, and the source
        // md5 is not recoverable from the output - it is in the index for the
        // build these were translated against. Self-addressing them here would
        // mint the second identity the scheme exists to avoid, and it would look
        // like it had worked. Rebuilding is cheap; a wrong address is not.
        if (isTranslatedOverlay(current.provenance))
        {
            throw new Error(
                `Overlay ${name} holds translated payloads `
                + `(${current.provenance?.sourceProfile ?? "unknown"} -> `
                + `${current.provenance?.targetProfile ?? "unknown"}); `
                + "rebuild it rather than migrating it",
            );
        }

        const payloadDirectory = safeJoin(
            overlayDirectory,
            normalizeSafeFileName(current.payloadDirectory ?? "res", "overlay payload directory"),
        );
        const indexPath = safeJoin(
            overlayDirectory,
            normalizeSafeFileName(current.indexFile, "overlay index file"),
        );
        const group = parseIndexGroup(await fs.readFile(indexPath, "utf8"), {
            kind: "resfileindex-overlay",
            name,
            root: "res",
            sourceUrl: `local-overlay://${target}/${name}/${current.indexFile}`,
            cachePath: null,
            cacheHit: true,
        });
        const destination = renameTo === name
            ? overlayDirectory
            : this.GetOverlayDirectory(target, renameTo);

        if (destination !== overlayDirectory && await exists(destination))
        {
            throw new Error(
                `Cannot rename overlay ${name} to ${renameTo}: an overlay of that name `
                + "already exists. Two build-pinned sets cannot share one name; keep them "
                + "apart or revise one into the other deliberately.",
            );
        }

        const plan = {
            target,
            name,
            renameTo,
            layout,
            rowCount: group.count,
            alreadyMigrated: layout === "content-address",
            written: 0,
            reused: 0,
            byteLength: 0,
        };

        if (plan.alreadyMigrated && destination === overlayDirectory)
        {
            return utils.freezeData({ ...plan, applied: false });
        }

        const records = [];

        for (const record of group.entries)
        {
            const sourcePath = layout === "content-address"
                ? this.#ResolveStoredPayload(record)
                : safeJoin(payloadDirectory, record.location);
            const bytes = await fs.readFile(sourcePath);
            const checksum = crypto.createHash("md5").update(bytes).digest("hex");
            const migrated = new CjsToolIndexEntry({
                logicalPath: record.logicalPath,
                location: resFileAddress(record.logicalPath, checksum),
                checksum,
                uncompressedSize: bytes.byteLength,
                compressedSize: bytes.byteLength,
                binaryOperation: record.binaryOperation,
            });

            if (options?.apply === true)
            {
                if (await this.#StorePayload(migrated, bytes))
                {
                    plan.written += 1;
                }
                else
                {
                    plan.reused += 1;
                }
            }

            plan.byteLength += bytes.byteLength;
            records.push(migrated);
        }

        if (options?.apply !== true)
        {
            return utils.freezeData({ ...plan, applied: false });
        }

        records.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));

        const stageDirectory = safeJoin(
            path.dirname(overlayDirectory),
            `.${renameTo}.migrate-${crypto.randomUUID()}`,
        );

        await fs.mkdir(stageDirectory, { recursive: true });

        try
        {
            const manifest = {
                ...current,
                schema: ManifestSchema,
                version: ManifestVersion,
                name: renameTo,
                storageKind: "persistent-overlay",
                indexFile: "resfileindex.txt",
                payloadDirectory: null,
                payloadLayout: "content-address",
                revision: normalizeRevision(current.revision),
                history: normalizeHistory(current.history),
                rowCount: records.length,
                byteLength: plan.byteLength,
            };

            await fs.writeFile(
                safeJoin(stageDirectory, manifest.indexFile),
                `${records.map(formatIndexEntry).join("\n")}\n`,
                "utf8",
            );
            await fs.writeFile(
                safeJoin(stageDirectory, "overlay.json"),
                `${JSON.stringify(manifest, null, 2)}\n`,
                "utf8",
            );

            // The mirrored tree comes along rather than being deleted. Its bytes
            // are in the shared store and verified by then, so this is not
            // insurance against loss - it is that a data-root directory is not
            // something a migration gets to remove on the operator's behalf.
            const retiredName = layout === "logical-path"
                ? `retired-${path.basename(payloadDirectory)}`
                : null;

            if (retiredName && await exists(payloadDirectory))
            {
                await fs.rename(payloadDirectory, safeJoin(stageDirectory, retiredName));
            }

            await this.#SwapDirectory(stageDirectory, destination, renameTo, overlayDirectory);

            return utils.freezeData({
                ...plan,
                applied: true,
                directory: destination,
                retiredPayloadDirectory: retiredName
                    ? safeJoin(destination, retiredName)
                    : null,
            });
        }
        catch (error)
        {
            const retired = safeJoin(stageDirectory, `retired-${path.basename(payloadDirectory)}`);

            if (await exists(retired) && !await exists(payloadDirectory))
            {
                await fs.rename(retired, payloadDirectory);
            }

            await fs.rm(stageDirectory, { recursive: true, force: true });
            throw error;
        }
    }

    /**
     * Copies one import's payloads into their stored positions and returns the
     * index records that name them.
     */
    async #WritePayloads({ entries, sourceDirectory, layout, importDirectory })
    {
        const payloadDirectory = layout === "logical-path"
            ? safeJoin(importDirectory, "res")
            : null;
        const records = [];
        let byteLength = 0;

        if (payloadDirectory)
        {
            await fs.mkdir(payloadDirectory, { recursive: true });
        }

        for (const { entry, address } of entries)
        {
            const sourcePath = safeJoin(sourceDirectory, entry.location);
            const bytes = await fs.readFile(sourcePath);
            const checksum = crypto.createHash("md5").update(bytes).digest("hex");
            const sourceRecord = new CjsToolIndexEntry({
                logicalPath: entry.logicalPath,
                location: entry.location,
                checksum: entry.checksum ?? checksum,
                uncompressedSize: entry.uncompressedSize ?? bytes.byteLength,
                compressedSize: entry.compressedSize ?? bytes.byteLength,
            });

            validateContentAddress(sourceRecord);
            const record = new CjsToolIndexEntry({
                logicalPath: sourceRecord.logicalPath,
                location: layout === "logical-path"
                    ? sourceRecord.relativePath
                    : address ?? resFileAddress(sourceRecord.logicalPath, sourceRecord.checksum),
                checksum: sourceRecord.checksum,
                uncompressedSize: sourceRecord.uncompressedSize,
                compressedSize: sourceRecord.compressedSize,
                binaryOperation: sourceRecord.binaryOperation,
            });

            utils.validateResourceBytes(bytes, record, record.logicalPath);

            if (payloadDirectory)
            {
                const targetPath = safeJoin(payloadDirectory, record.location);

                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.copyFile(sourcePath, targetPath);
            }
            else
            {
                // A derived payload's address names its SOURCE, so the same
                // address legitimately holds different bytes when the converter
                // changes. Only a self-addressed payload can be assumed already
                // correct because it is there.
                await this.#StorePayload(record, bytes, { overwrite: Boolean(address) });
            }

            records.push(record);
            byteLength += bytes.byteLength;
        }

        records.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));

        return { records: Object.freeze(records), byteLength };
    }

    /**
     * Writes one payload into the shared content-addressed store, reporting
     * whether it had to.
     *
     * An address names its own contents, so a file already there is already
     * correct and re-writing it would be pure I/O. The write goes through a
     * unique temporary name so two overlays importing the same bytes at once
     * cannot see a half-written file.
     */
    async #StorePayload(record, bytes, options = {})
    {
        const storedPath = this.#ResolveStoredPayload(record);

        if (options.overwrite !== true && await exists(storedPath))
        {
            return false;
        }

        const temporaryPath = `${storedPath}.${crypto.randomUUID()}.part`;

        await fs.mkdir(path.dirname(storedPath), { recursive: true });
        await fs.writeFile(temporaryPath, bytes);

        try
        {
            await fs.rename(temporaryPath, storedPath);
        }
        catch (error)
        {
            await fs.rm(temporaryPath, { force: true });

            if (await exists(storedPath))
            {
                return false;
            }

            throw error;
        }

        return true;
    }

    /** Locates one payload in the shared store without letting a row escape it. */
    #ResolveStoredPayload(record)
    {
        return safeJoin(this.payloadStore, CjsToolIndexEntry.from(record).location);
    }

    /** Puts a staged overlay in place, restoring the old one if it cannot. */
    async #SwapDirectory(stageDirectory, destination, name, retire = destination)
    {
        const backupDirectory = safeJoin(
            path.dirname(destination),
            `.${name}.backup-${crypto.randomUUID()}`,
        );
        const hadPrevious = await exists(retire);

        await fs.mkdir(path.dirname(destination), { recursive: true });

        if (hadPrevious)
        {
            await fs.rename(retire, backupDirectory);
        }

        try
        {
            await fs.rename(stageDirectory, destination);
        }
        catch (error)
        {
            if (hadPrevious)
            {
                await fs.rename(backupDirectory, retire);
            }

            throw error;
        }

        if (hadPrevious)
        {
            await fs.rm(backupDirectory, { recursive: true, force: true });
        }
    }

    /** Transactionally replaces one explicitly named persistent overlay. */
    async Replace(options)
    {
        const target = normalizeTargetId(options?.target);
        const name = normalizeOverlayName(options?.name);
        const overlayDirectory = this.GetOverlayDirectory(target, name);

        if (!await exists(overlayDirectory))
        {
            return this.Import(options);
        }

        const suffix = crypto.randomUUID().toLowerCase();
        const temporaryName = `${name}-replace-${suffix}`;
        const replacement = await this.Import({
            ...options,
            name: temporaryName,
        });
        const replacementDirectory = replacement.directory;
        const backupDirectory = safeJoin(
            path.dirname(overlayDirectory),
            `.${name}.backup-${suffix}`,
        );

        try
        {
            const manifestPath = safeJoin(replacementDirectory, "overlay.json");
            const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

            manifest.name = name;
            await fs.writeFile(
                manifestPath,
                `${JSON.stringify(manifest, null, 2)}\n`,
                "utf8",
            );
            await fs.rename(overlayDirectory, backupDirectory);

            try
            {
                await fs.rename(replacementDirectory, overlayDirectory);
            }
            catch (error)
            {
                await fs.rename(backupDirectory, overlayDirectory);
                throw error;
            }

            await fs.rm(backupDirectory, { recursive: true, force: true });

            return utils.freezeData({
                ...replacement,
                directory: overlayDirectory,
                name,
                replaced: true,
            });
        }
        catch (error)
        {
            await fs.rm(replacementDirectory, { recursive: true, force: true });

            if (await exists(backupDirectory) && !await exists(overlayDirectory))
            {
                await fs.rename(backupDirectory, overlayDirectory);
            }

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
            .map(({ entry }) => entry)
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

    /**
     * Validates an overlay manifest and index before opening an immutable
     * build-compatible view.
     */
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
        const payloadLayout = storageKind === "persistent-overlay"
            ? normalizePayloadLayout(manifest.payloadLayout ?? "logical-path")
            : null;
        const indexPath = safeJoin(directory, manifest.indexFile);
        const payloadDirectory = payloadLayout === "logical-path"
            ? safeJoin(directory, manifest.payloadDirectory)
            : payloadLayout === "content-address"
                ? this.payloadStore
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

        return new CjsToolIndexOverlay({
            ...manifest,
            storageKind,
            payloadLayout,
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
export class CjsToolIndexOverlay
{

    #payloadDirectory;

    /**
     * Freezes an opened overlay's identity, provenance, index, and
     * payload-location contract.
     */
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
        this.payloadLayout = options.payloadLayout ?? null;
        this.revision = normalizeRevision(options.revision);
        this.history = utils.freezeData(normalizeHistory(options.history));
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

    /** Matches overlay paths with the same matcher contract as CjsToolIndexGraph. */
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

        return safeJoin(this.#payloadDirectory, CjsToolIndexEntry.from(record).location);
    }

    /**
     * Projects an index record into the target-qualified resolution shape
     * consumed by readers.
     */
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
                : this.storageKind === "generated-cache"
                    ? `generated-cache://${this.target}/${this.name}/${record.location}`
                    : `local-overlay://${this.target}/${this.name}/${record.location}`,
            // A stored name that carries the contents is what "hash-safe" means.
            // A logical-path overlay has no such name, so it stays local-exact
            // and every consumer keeps treating it as changed.
            artifactKind: this.storageKind === "persistent-overlay"
                && this.payloadLayout !== "content-address"
                ? "local-exact"
                : "hash-safe",
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

/**
 * Normalizes import entries, keeping any caller-supplied stored address.
 *
 * An entry may name the address its payload must be stored under. That is for
 * DERIVED payloads: a translated shader belongs beside the payload it was
 * translated from, under that payload's address with the backend appended, so
 * the caller - which is the only party that knows the source - supplies it.
 * Everything else is addressed by its own logical path and contents.
 */
function normalizeImportEntries(value)
{
    if (!Array.isArray(value) || value.length === 0)
    {
        throw new TypeError("Overlay import requires at least one resource entry");
    }

    const paths = new Set();

    return value.map((item) =>
    {
        const entry = CjsToolIndexEntry.from(item);

        if (entry.prefix !== "res")
        {
            throw new Error(`Overlay entry must use res:/: ${entry.logicalPath}`);
        }

        if (paths.has(entry.logicalPath))
        {
            throw new Error(`Duplicate overlay resource: ${entry.logicalPath}`);
        }

        paths.add(entry.logicalPath);
        return { entry, address: normalizeStoredAddress(item?.address) };
    });
}

/**
 * Validates a caller-supplied stored address, which must be a game address with
 * an optional suffix naming what derived it.
 */
function normalizeStoredAddress(value)
{
    if (value === undefined || value === null)
    {
        return null;
    }

    const address = String(value).trim().toLowerCase();

    if (!/^[a-f0-9]{2}\/[a-f0-9]{16}_[a-f0-9]{32}(?:\.[a-z0-9][a-z0-9._-]*)?$/u.test(address))
    {
        throw new Error(`Invalid overlay payload address: ${value}`);
    }

    if (address.slice(0, 2) !== address.slice(3, 5))
    {
        throw new Error(`Overlay payload address shard does not match its hash: ${value}`);
    }

    return address;
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
        manifest.payloadLayout = normalizePayloadLayout(manifest.payloadLayout ?? "logical-path");

        if (manifest.payloadLayout === "logical-path")
        {
            void normalizeSafeFileName(manifest.payloadDirectory, "overlay payload directory");
        }
        else if (manifest.payloadDirectory !== null && manifest.payloadDirectory !== undefined)
        {
            throw new Error(
                "A content-addressed overlay stores its payloads in the shared store, "
                + `not in ${manifest.payloadDirectory}`,
            );
        }

        manifest.revision = normalizeRevision(manifest.revision);
        manifest.history = normalizeHistory(manifest.history);
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

/**
 * Says whether an overlay's payloads were derived from other indexed payloads.
 *
 * Both spellings are accepted because both are on disk: the shader builder
 * records `kind: "shader-build"`, and the hand-placed sets that predate it
 * record the two profiles they translated between.
 */
function isTranslatedOverlay(provenance)
{
    return provenance?.kind === "shader-build"
        || Boolean(provenance?.sourceProfile && provenance?.targetProfile);
}

function normalizePayloadLayout(value)
{
    const layout = String(value ?? "").trim().toLowerCase();

    if (!PayloadLayouts.includes(layout))
    {
        throw new Error(`Unsupported overlay payload layout: ${value}`);
    }

    return layout;
}

/** An overlay that predates revisions is revision 1, not revision zero. */
function normalizeRevision(value)
{
    if (value === undefined || value === null)
    {
        return 1;
    }

    if (!Number.isSafeInteger(value) || value < 1)
    {
        throw new TypeError(`Invalid overlay revision: ${value}`);
    }

    return value;
}

function normalizeHistory(value)
{
    if (value === undefined || value === null)
    {
        return [];
    }

    if (!Array.isArray(value))
    {
        throw new TypeError("Overlay history must be an array");
    }

    return value.map((item) => ({ ...item }));
}

function sameBuilds(left, right)
{
    return left.length === right.length
        && [ ...left ].sort().join(",") === [ ...right ].sort().join(",");
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

function normalizeOverlayNames(value)
{
    if (!Array.isArray(value) || value.length === 0)
    {
        throw new TypeError("Persistent overlay names must be a non-empty array");
    }

    return [ ...new Set(value.map(normalizeOverlayName)) ];
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
