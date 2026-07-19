import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { CjsIndexOverlayStore } from "../indexing/CjsIndexOverlayStore.js";
import { CjsShaderTargetRegistry } from "./CjsShaderTargetRegistry.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";

const BuilderVersion = "0.1.0";

/** Shared Node orchestration for independently importable shader builders. */
export class CjsToolShaderBuilder
{

    #backend;

    #extension;

    #format;

    #formatPackage;

    #index;

    #overlays;

    #shaderTargets;

    #targets;

    constructor({
        backend,
        extension,
        formatPackage,
        format = null,
        index = null,
        overlays = null,
        shaderTargets = new CjsShaderTargetRegistry(),
        targets = new CjsToolTargetRegistry(),
    })
    {
        if (!(shaderTargets instanceof CjsShaderTargetRegistry))
        {
            throw new TypeError("Shader builder targets must be a CjsShaderTargetRegistry");
        }

        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError("Shader builder tool targets must be a CjsToolTargetRegistry");
        }

        if (overlays !== null && !(overlays instanceof CjsIndexOverlayStore))
        {
            throw new TypeError("Shader builder overlays must be a CjsIndexOverlayStore or null");
        }

        this.#backend = String(backend);
        this.#extension = String(extension);
        this.#formatPackage = String(formatPackage);
        this.#format = format;
        this.#index = index;
        this.#overlays = overlays;
        this.#shaderTargets = shaderTargets;
        this.#targets = targets;
    }

    /**
     * Builds an exact source corpus, stages it, and optionally installs it.
     *
     * @param {object} options Build, selection, output, and publication policy.
     * @returns {Promise<object>} Immutable build result and deterministic report.
     */
    async Build(options = {})
    {
        const shaderTarget = this.#shaderTargets.Get(options.shaderTarget);
        const expectedFormat = this.#backend === "webgl" ? "CEWG" : "CEWGPU";
        const qualificationLevel = normalizeQualificationLevel(
            options.qualificationLevel,
            shaderTarget.qualificationPolicy.level,
        );

        if (shaderTarget.format !== expectedFormat)
        {
            throw new Error(
                `${this.constructor.name} cannot build ${shaderTarget.format} target ${shaderTarget.id}`,
            );
        }

        const toolTarget = this.#targets.RequireLibrary(shaderTarget.target, "shader");
        const { source, exactBuild } = await this.#OpenSource(
            shaderTarget,
            options.build ?? "latest",
            options.source ?? null,
        );
        const resolutions = this.#ResolveSources(source, shaderTarget, options);
        const catalog = shaderTarget.CreateCatalogFromResolutions(resolutions, {
            targets: this.#targets,
        });

        if (catalog.build !== exactBuild)
        {
            throw new Error(`Shader catalog build mismatch: ${catalog.build} and ${exactBuild}`);
        }

        if (options.dryRun === true || options.catalogOnly === true)
        {
            return utils.freezeData({
                status: "catalog",
                catalog,
                report: this.#CreateCatalogReport(
                    shaderTarget,
                    catalog,
                    qualificationLevel,
                ),
                directory: null,
                overlay: null,
            });
        }

        const format = await this.#LoadFormat();
        const outputRoot = path.resolve(options.outputDirectory
            ?? path.join(process.cwd(), "artifacts", "shaders"));
        const stageDirectory = path.join(
            outputRoot,
            `.${shaderTarget.id}-${exactBuild}.stage-${crypto.randomUUID()}`,
        );
        const entries = new Array(catalog.entries.length);
        const staged = [];

        await fs.mkdir(stageDirectory, { recursive: true });

        try
        {
            await runConcurrent(catalog.entries, options.concurrency ?? 4, async (entry, index) =>
            {
                const resolution = resolutions.find((item) =>
                    item.logicalPath === entry.sourcePath);

                entries[index] = await this.#BuildEntry({
                    source,
                    resolution,
                    entry,
                    shaderTarget,
                    toolTarget,
                    exactBuild,
                    format,
                    options,
                    qualificationLevel,
                    stageDirectory,
                    staged,
                });
            });

            const report = this.#CreateReport({
                shaderTarget,
                toolTarget,
                exactBuild,
                entries,
                generatedAt: options.generatedAt ?? null,
                format,
                qualificationLevel,
            });
            const reportText = `${JSON.stringify(report, null, 2)}\n`;
            const reportSha256 = hash("sha256", reportText);
            const overlayName = `${shaderTarget.overlay}-${exactBuild}-b${BuilderVersion}-${reportSha256.slice(0, 12)}`;
            const reportWithIdentity = utils.freezeData({
                ...report,
                reportSha256,
                overlay: overlayName,
            });
            const qualified = reportWithIdentity.counts.failed === 0
                && reportWithIdentity.counts.unsupported === 0
                && reportWithIdentity.counts.unqualified === 0;

            await fs.writeFile(
                path.join(stageDirectory, "build-report.json"),
                `${JSON.stringify(reportWithIdentity, null, 2)}\n`,
                "utf8",
            );

            if (!qualified && options.diagnostic !== true)
            {
                const error = new Error(
                    `Shader build ${shaderTarget.id}/${exactBuild} did not qualify: `
                    + `${reportWithIdentity.counts.failed} failed, `
                    + `${reportWithIdentity.counts.unsupported} unsupported, `
                    + `${reportWithIdentity.counts.unqualified} unqualified`,
                );

                error.report = reportWithIdentity;
                throw error;
            }

            const finalDirectory = path.join(outputRoot, overlayName);
            const directory = await publishDirectory(stageDirectory, finalDirectory, {
                overwrite: options.overwrite === true || options.force === true,
                reuse: options.reuseExisting !== false,
                reportSha256,
            });
            const overlay = qualified
                ? await this.#InstallOverlay({
                    shaderTarget,
                    toolTarget,
                    exactBuild,
                    overlayName,
                    report: reportWithIdentity,
                    sourceDirectory: directory,
                    staged,
                    options,
                })
                : null;

            return utils.freezeData({
                status: qualified ? "qualified" : "diagnostic",
                catalog,
                report: reportWithIdentity,
                directory,
                overlay,
            });
        }
        catch (error)
        {
            await fs.rm(stageDirectory, { recursive: true, force: true });
            throw error;
        }
    }

    async #OpenSource(shaderTarget, build, injectedSource)
    {
        if (injectedSource)
        {
            const exactBuild = utils.normalizeExactBuild(build === "latest"
                ? injectedSource.build
                : build, {
                message: `Injected shader sources require an exact build: ${build}`,
            });

            validateSourceIdentity(injectedSource, shaderTarget, exactBuild, this.#targets);
            return { source: injectedSource, exactBuild };
        }

        if (!this.#index
            || typeof this.#index.ResolveTargetBuild !== "function"
            || typeof this.#index.OpenTarget !== "function")
        {
            throw new TypeError("Shader builder requires a CjsToolIndex-compatible index source");
        }

        const resolution = await this.#index.ResolveTargetBuild(shaderTarget.target, build);
        const exactBuild = utils.normalizeExactBuild(resolution.build);
        const source = await this.#index.OpenTarget(shaderTarget.target, exactBuild);

        validateSourceIdentity(source, shaderTarget, exactBuild, this.#targets);
        return { source, exactBuild };
    }

    #ResolveSources(source, shaderTarget, options)
    {
        let resolutions;

        if (Array.isArray(options.resolutions))
        {
            resolutions = [ ...options.resolutions ];
        }
        else
        {
            const paths = Array.isArray(options.sourcePaths)
                ? options.sourcePaths
                : source.Match("*")
                    .map((resolution) => resolution.logicalPath)
                    .filter((logicalPath) => shaderTarget.SupportsSourcePath(logicalPath));

            resolutions = paths.map((logicalPath) => source.Resolve(logicalPath));
        }

        const requestedTiers = normalizeRequestedTiers(options.qualityTiers);

        if (requestedTiers)
        {
            resolutions = resolutions.filter((resolution) => requestedTiers.some((tier) =>
                resolution.logicalPath.endsWith(`.sm_${tier}`)));
        }

        if (!resolutions.length)
        {
            throw new Error(`Shader target ${shaderTarget.id} has no selected source resources`);
        }

        return resolutions.sort((left, right) =>
            left.logicalPath.localeCompare(right.logicalPath));
    }

    async #BuildEntry({
        source,
        resolution,
        entry,
        shaderTarget,
        toolTarget,
        exactBuild,
        format,
        options,
        qualificationLevel,
        stageDirectory,
        staged,
    })
    {
        const base = {
            sourcePath: entry.sourcePath,
            outputPath: entry.outputPath,
            sourceFamily: shaderTarget.selectionPolicy.sourceFamily,
            shaderModel: shaderTarget.selectionPolicy.sourceFamily.includes("sm5.1")
                ? "5.1"
                : "5.0",
        };

        try
        {
            requireContentIdentity(resolution);
            const payload = await source.Fetch(resolution.logicalPath, {
                indexName: resolution.indexName,
            });
            const sourceBytes = utils.validateResourceBytes(
                payload.bytes,
                resolution.record,
                resolution.logicalPath,
            );
            const sourceMd5 = hash("md5", sourceBytes);
            const sourceSha256 = hash("sha256", sourceBytes);
            const sourceIdentity = {
                filePath: resolution.logicalPath,
                logicalPath: resolution.logicalPath,
                game: toolTarget.game,
                client: toolTarget.client,
                build: exactBuild,
                byteLength: sourceBytes.byteLength,
                md5: sourceMd5,
                sha256: sourceSha256,
            };
            const conversionPolicy = {
                ...shaderTarget.selectionPolicy,
                ...(options.conversionPolicy ?? {}),
            };
            const result = await format.buildEffect(sourceBytes, {
                source: resolution.logicalPath,
                outputPath: entry.outputPath,
                sourceIdentity,
                allPermutations: conversionPolicy.permutationMode === "all",
                allowFailures: options.diagnostic === true,
                permutation: conversionPolicy.permutation ?? undefined,
                selection: conversionPolicy.selection ?? undefined,
                technique: conversionPolicy.technique ?? undefined,
                pass: conversionPolicy.pass ?? undefined,
                stage: conversionPolicy.stage ?? undefined,
                emitterOptions: conversionPolicy.emitterOptions ?? undefined,
                qualificationLevel,
                generatedAt: options.generatedAt ?? null,
            });
            validatePackageProvenance(result, {
                format: shaderTarget.format,
                sourcePath: resolution.logicalPath,
                outputPath: entry.outputPath,
                sourceIdentity,
            });
            let qualification = result.qualification ?? { ok: true, level: "package" };

            if (!qualificationMeets(qualification, qualificationLevel)
                && qualificationLevel === "native-hlslcc")
            {
                const qualifyEffect = options.qualifyEffect ?? format.qualifyEffect;

                if (typeof qualifyEffect !== "function")
                {
                    throw new Error(
                        `${this.#formatPackage} does not expose a format-owned `
                        + "native HLSLcc qualifier",
                    );
                }

                const nativeResult = await qualifyEffect.call(format, sourceBytes, {
                    source: resolution.logicalPath,
                    outputPath: entry.outputPath,
                    sourceIdentity,
                    packageResult: result,
                });

                qualification = nativeResult?.qualification ?? nativeResult;
            }

            const outputBytes = Buffer.from(result.bytes);
            const inspection = format.inspect(outputBytes, { source: entry.outputPath });
            const qualified = qualificationMeets(qualification, qualificationLevel);
            const relativePath = `res/${entry.outputPath.slice("res:/".length)}`;
            const outputFile = safeJoin(stageDirectory, relativePath);

            await fs.mkdir(path.dirname(outputFile), { recursive: true });
            await fs.writeFile(outputFile, outputBytes);
            staged.push({
                logicalPath: entry.outputPath,
                location: relativePath.replaceAll("\\", "/"),
                checksum: hash("md5", outputBytes),
                uncompressedSize: outputBytes.byteLength,
                compressedSize: outputBytes.byteLength,
            });

            return utils.freezeData({
                ...base,
                status: qualified ? "qualified" : "generated",
                sourceSize: sourceBytes.byteLength,
                sourceMd5,
                outputSize: outputBytes.byteLength,
                outputMd5: hash("md5", outputBytes),
                stageProvenance: result.info ?? null,
                permutationProvenance: result.metadata?.selectedOptions
                    ?? result.metadata?.variants
                    ?? null,
                packageInspection: inspection,
                qualification,
                error: null,
            });
        }
        catch (error)
        {
            const unsupported = /not supported|unsupported|unimplementable/iu.test(error.message);

            return utils.freezeData({
                ...base,
                status: unsupported ? "unsupported" : "failed",
                sourceSize: resolution.record?.uncompressedSize ?? null,
                sourceMd5: resolution.record?.checksum ?? null,
                outputSize: null,
                outputMd5: null,
                stageProvenance: null,
                permutationProvenance: null,
                packageInspection: null,
                qualification: null,
                error: {
                    name: error.name,
                    message: error.message,
                },
            });
        }
    }

    #CreateCatalogReport(shaderTarget, catalog, qualificationLevel)
    {
        return {
            schema: "carbon.shader-build-report",
            version: 1,
            status: "catalog",
            builder: this.constructor.name,
            builderVersion: BuilderVersion,
            backend: this.#backend,
            shaderTarget: shaderTarget.id,
            target: catalog.target,
            game: catalog.game,
            provider: catalog.provider,
            client: catalog.client,
            build: catalog.build,
            format: shaderTarget.format,
            sourceProfile: shaderTarget.sourceProfile,
            outputProfile: shaderTarget.outputProfile,
            sourceFamilies: shaderTarget.sourceFamilies,
            selectionPolicy: shaderTarget.selectionPolicy,
            qualificationPolicy: shaderTarget.qualificationPolicy,
            qualificationLevel,
            entries: catalog.entries,
        };
    }

    #CreateReport({
        shaderTarget,
        toolTarget,
        exactBuild,
        entries,
        generatedAt,
        format,
        qualificationLevel,
    })
    {
        const counts = {
            generated: entries.filter((entry) =>
                [ "generated", "qualified" ].includes(entry.status)).length,
            qualified: entries.filter((entry) => entry.status === "qualified").length,
            unsupported: entries.filter((entry) => entry.status === "unsupported").length,
            failed: entries.filter((entry) => entry.status === "failed").length,
        };

        counts.unqualified = counts.generated - counts.qualified;

        return {
            schema: "carbon.shader-build-report",
            version: 1,
            status: counts.failed || counts.unsupported || counts.unqualified
                ? "incomplete"
                : "complete",
            generatedAt: generatedAt === null ? null : new Date(generatedAt).toISOString(),
            builder: this.constructor.name,
            builderVersion: BuilderVersion,
            backend: this.#backend,
            formatPackage: this.#formatPackage,
            formatPackageVersion: format.packageVersion ?? null,
            shaderTarget: shaderTarget.id,
            target: toolTarget.id,
            game: toolTarget.game,
            provider: toolTarget.provider,
            client: toolTarget.client,
            build: exactBuild,
            format: shaderTarget.format,
            extension: this.#extension,
            sourceProfile: shaderTarget.sourceProfile,
            outputProfile: shaderTarget.outputProfile,
            sourceFamilies: shaderTarget.sourceFamilies,
            selectionPolicy: shaderTarget.selectionPolicy,
            qualificationPolicy: shaderTarget.qualificationPolicy,
            qualificationLevel,
            counts,
            entries,
        };
    }

    async #InstallOverlay({
        shaderTarget,
        toolTarget,
        exactBuild,
        overlayName,
        report,
        sourceDirectory,
        staged,
        options,
    })
    {
        const overlays = options.overlays ?? this.#overlays;

        if (!overlays || options.installOverlay === false)
        {
            return null;
        }

        const importOptions = {
            target: toolTarget.id,
            game: toolTarget.game,
            provider: toolTarget.provider,
            name: overlayName,
            mode: "override",
            builds: [ exactBuild ],
            sourceDirectory,
            entries: staged,
            provenance: {
                kind: "shader-build",
                shaderTarget: shaderTarget.id,
                builder: this.constructor.name,
                builderVersion: BuilderVersion,
                reportSha256: report.reportSha256,
            },
        };

        if (options.replaceOverlay === true)
        {
            return overlays.Replace(importOptions);
        }

        try
        {
            return await overlays.Import(importOptions);
        }
        catch (error)
        {
            if (options.reuseExisting !== false && /already exists/u.test(error.message))
            {
                const existing = await overlays.OpenTarget(toolTarget.id, exactBuild, {
                    game: toolTarget.game,
                    provider: toolTarget.provider,
                    client: toolTarget.client,
                });
                const match = existing.find((overlay) => overlay.name === overlayName);

                if (match?.provenance?.reportSha256 === report.reportSha256)
                {
                    return utils.freezeData({
                        directory: match.directory,
                        name: match.name,
                        reused: true,
                    });
                }
            }

            throw error;
        }
    }

    async #LoadFormat()
    {
        if (!this.#format)
        {
            const module = await import(this.#formatPackage);

            this.#format = module.default;
        }

        if (typeof this.#format?.buildEffect !== "function"
            || typeof this.#format?.inspect !== "function")
        {
            throw new TypeError(
                `${this.#formatPackage} must expose buildEffect and inspect`,
            );
        }

        return this.#format;
    }

}

function normalizeQualificationLevel(value, minimum)
{
    const levels = [ "package", "structural", "native-hlslcc" ];
    const level = String(value ?? minimum).trim().toLowerCase();
    const required = String(minimum).trim().toLowerCase();

    if (!levels.includes(level))
    {
        throw new Error(
            `Unsupported shader qualification level ${level}; `
            + "expected package, structural, or native-hlslcc",
        );
    }

    if (levels.indexOf(level) < levels.indexOf(required))
    {
        throw new Error(
            `Shader qualification ${level} cannot weaken target requirement ${required}`,
        );
    }

    return level;
}

function qualificationMeets(qualification, required)
{
    if (!qualification?.ok)
    {
        return false;
    }

    if (required === "package")
    {
        return true;
    }

    if (required === "structural")
    {
        return [ "structural", "native-hlslcc" ].includes(qualification.level);
    }

    return qualification.level === "native-hlslcc"
        && qualification.nativeComparison?.ok === true;
}

function validatePackageProvenance(result, expected)
{
    const info = result?.info;
    const identity = info?.sourceIdentity;
    const embeddedPath = identity?.logicalPath ?? identity?.filePath;

    if (!result?.bytes || !info)
    {
        throw new Error("Shader format result is missing package bytes or INFO provenance");
    }

    if (info.format !== expected.format
        || info.sourcePath !== expected.sourcePath
        || info.outputPath !== expected.outputPath)
    {
        throw new Error("Shader format result does not match source/output package identity");
    }

    if (!identity
        || embeddedPath !== expected.sourceIdentity.logicalPath
        || identity.byteLength !== expected.sourceIdentity.byteLength
        || identity.md5 !== expected.sourceIdentity.md5)
    {
        throw new Error("Shader format result does not match embedded source provenance");
    }
}

function validateSourceIdentity(source, shaderTarget, exactBuild, targets)
{
    const target = targets.RequireLibrary(shaderTarget.target, "shader");

    if (source.target !== target.id
        || source.game !== target.game
        || source.provider !== target.provider
        || String(source.build) !== exactBuild
        || (source.client ?? null) !== target.client)
    {
        throw new Error(
            `Shader source identity does not match ${target.id}/${exactBuild}: `
            + `${source.target}/${source.game}/${source.provider}/${source.build}/${source.client}`,
        );
    }
}

function requireContentIdentity(resolution)
{
    if (!resolution?.record?.checksum
        || resolution.record.uncompressedSize === null
        || resolution.record.uncompressedSize === undefined)
    {
        throw new Error(
            `Shader source lacks declared size/MD5 identity: ${resolution?.logicalPath}`,
        );
    }
}

function normalizeRequestedTiers(value)
{
    if (value === undefined || value === null)
    {
        return null;
    }

    if (!Array.isArray(value) || !value.length)
    {
        throw new TypeError("Shader qualityTiers must be a non-empty array");
    }

    return [ ...new Set(value.map((tier) =>
        String(tier).toLowerCase().replace(/^sm_/u, ""))) ];
}

async function runConcurrent(values, concurrencyValue, worker)
{
    const concurrency = Number(concurrencyValue);

    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64)
    {
        throw new TypeError(`Invalid shader build concurrency: ${concurrencyValue}`);
    }

    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () =>
    {
        while (cursor < values.length)
        {
            const index = cursor++;

            await worker(values[index], index);
        }
    });

    await Promise.all(workers);
}

async function publishDirectory(stageDirectory, finalDirectory, options)
{
    if (!await exists(finalDirectory))
    {
        await fs.mkdir(path.dirname(finalDirectory), { recursive: true });
        await fs.rename(stageDirectory, finalDirectory);
        return finalDirectory;
    }

    if (options.reuse)
    {
        try
        {
            const report = JSON.parse(await fs.readFile(
                path.join(finalDirectory, "build-report.json"),
                "utf8",
            ));

            if (report.reportSha256 === options.reportSha256)
            {
                await fs.rm(stageDirectory, { recursive: true, force: true });
                return finalDirectory;
            }
        }
        catch
        {
            // Explicit overwrite remains available for an unrelated directory.
        }
    }

    if (!options.overwrite)
    {
        throw new Error(`Shader output already exists: ${finalDirectory}`);
    }

    const backupDirectory = `${finalDirectory}.backup-${crypto.randomUUID()}`;

    await fs.rename(finalDirectory, backupDirectory);

    try
    {
        await fs.rename(stageDirectory, finalDirectory);
        await fs.rm(backupDirectory, { recursive: true, force: true });
        return finalDirectory;
    }
    catch (error)
    {
        if (!await exists(finalDirectory) && await exists(backupDirectory))
        {
            await fs.rename(backupDirectory, finalDirectory);
        }

        throw error;
    }
}

function hash(algorithm, bytes)
{
    return crypto.createHash(algorithm).update(bytes).digest("hex");
}

function safeJoin(root, relativePath)
{
    const resolvedRoot = path.resolve(root);
    const result = path.resolve(resolvedRoot, ...String(relativePath).split("/"));
    const relative = path.relative(resolvedRoot, result);

    if (relative.startsWith("..") || path.isAbsolute(relative))
    {
        throw new Error(`Shader staging path escaped its root: ${result}`);
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
