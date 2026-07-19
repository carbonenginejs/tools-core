import fs from "node:fs/promises";
import path from "node:path";

import {
    CjsIndexOverlayStore,
    CjsShaderTargetRegistry,
    CjsToolIndex,
} from "../src/index.js";

/** Runs one offline shader-builder CLI with shared strict argument handling. */
export async function RunShaderBuilder(Builder, backend, argv = process.argv.slice(2))
{
    const options = await ParseArguments(argv);

    if (options.help)
    {
        process.stdout.write(Help(backend));
        return null;
    }

    if (!options.shaderTarget)
    {
        throw new Error("Missing --shader-target");
    }

    const shaderTargets = new CjsShaderTargetRegistry();
    const shaderTarget = shaderTargets.Get(options.shaderTarget);

    if (options.target && options.target !== shaderTarget.target)
    {
        throw new Error(
            `--target ${options.target} does not match ${shaderTarget.id} target ${shaderTarget.target}`,
        );
    }

    const overlays = options.overlayDirectory
        ? new CjsIndexOverlayStore(options.overlayDirectory)
        : null;
    const index = new CjsToolIndex({ overlays });
    const builder = new Builder({ index, overlays, shaderTargets });
    const logger = await CreateRunLogger(options, backend, shaderTarget);

    await logger.Write({
        event: "cli-start",
        backend,
        shaderTarget: shaderTarget.id,
        target: shaderTarget.target,
        requestedBuild: String(options.build ?? "latest"),
        force: options.overwrite,
    });

    try
    {
        const result = await builder.Build({
            shaderTarget: shaderTarget.id,
            build: options.build ?? "latest",
            sourcePaths: options.sourcePaths.length ? options.sourcePaths : undefined,
            qualityTiers: options.qualityTiers.length ? options.qualityTiers : undefined,
            conversionPolicy: options.conversionPolicy,
            qualificationLevel: options.qualificationLevel,
            concurrency: options.concurrency ?? 4,
            generatedAt: options.generatedAt ?? null,
            outputDirectory: options.outputDirectory,
            installOverlay: overlays !== null,
            dryRun: options.dryRun,
            catalogOnly: options.catalogOnly,
            diagnostic: options.diagnostic,
            overwrite: options.overwrite,
            force: options.overwrite,
            replaceOverlay: options.replaceOverlay,
            reuseExisting: options.reuseExisting,
            onProgress: (event) => logger.Write(event),
        });

        await logger.Write({
            event: "cli-complete",
            status: result.status,
            build: result.report.build,
            counts: result.report.counts ?? null,
            directory: result.directory,
        });

        process.stdout.write(`${JSON.stringify({
            status: result.status,
            shaderTarget: shaderTarget.id,
            target: shaderTarget.target,
            build: result.report.build,
            counts: result.report.counts ?? null,
            durationMs: logger.Elapsed(),
            directory: result.directory,
            overlay: result.overlay?.name ?? result.report.overlay ?? null,
            logFile: logger.logFile,
        }, null, 2)}\n`);

        return result;
    }
    catch (error)
    {
        const failure = SerializeFailure(error, {
            backend,
            shaderTarget: shaderTarget.id,
            target: shaderTarget.target,
            requestedBuild: String(options.build ?? "latest"),
            durationMs: logger.Elapsed(),
            logFile: logger.logFile,
        });

        await logger.Write({
            event: "cli-error",
            error: failure.error,
            counts: failure.report?.counts ?? null,
        });
        await logger.WriteError(failure);
        error.shaderBuildLogFile = logger.logFile;
        error.shaderBuildErrorReport = logger.errorReport;
        throw error;
    }
}

async function ParseArguments(argv)
{
    const options = {
        sourcePaths: [],
        qualityTiers: [],
        dryRun: false,
        catalogOnly: false,
        diagnostic: false,
        overwrite: false,
        replaceOverlay: false,
        reuseExisting: true,
        conversionPolicy: {},
    };

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];

        if (argument === "--help" || argument === "-h")
        {
            options.help = true;
        }
        else if (argument === "--dry-run")
        {
            options.dryRun = true;
        }
        else if (argument === "--catalog-only")
        {
            options.catalogOnly = true;
        }
        else if (argument === "--diagnostic")
        {
            options.diagnostic = true;
        }
        else if (argument === "--overwrite" || argument === "--force")
        {
            options.overwrite = true;
        }
        else if (argument === "--replace-overlay")
        {
            options.replaceOverlay = true;
        }
        else if (argument === "--no-reuse")
        {
            options.reuseExisting = false;
        }
        else if (argument === "--source")
        {
            options.sourcePaths.push(RequireValue(argv, ++index, argument));
        }
        else if (argument === "--quality")
        {
            options.qualityTiers.push(RequireValue(argv, ++index, argument));
        }
        else
        {
            const key = ({
                "--shader-target": "shaderTarget",
                "--target": "target",
                "--build": "build",
                "--out": "outputDirectory",
                "--overlay-dir": "overlayDirectory",
                "--log": "logFile",
                "--error-report": "errorReport",
                "--log-interval": "logInterval",
                "--concurrency": "concurrency",
                "--generated-at": "generatedAt",
                "--source-manifest": "sourceManifest",
                "--conversion-policy": "conversionPolicyFile",
                "--qualification": "qualificationLevel",
            })[argument];

            if (!key)
            {
                throw new Error(`Unknown shader-builder option: ${argument}`);
            }

            options[key] = RequireValue(argv, ++index, argument);
        }
    }

    if (options.concurrency !== undefined)
    {
        options.concurrency = Number(options.concurrency);
    }

    if (options.logInterval !== undefined)
    {
        options.logInterval = Number(options.logInterval);

        if (!Number.isSafeInteger(options.logInterval) || options.logInterval < 1)
        {
            throw new Error("--log-interval requires a positive integer");
        }
    }

    if (options.sourceManifest)
    {
        const manifest = JSON.parse(await fs.readFile(
            path.resolve(options.sourceManifest),
            "utf8",
        ));
        const paths = Array.isArray(manifest) ? manifest : manifest.entries;

        if (!Array.isArray(paths))
        {
            throw new Error("Shader source manifest must be an array or contain entries");
        }

        options.sourcePaths.push(...paths.map((entry) =>
            typeof entry === "string" ? entry : entry.sourcePath ?? entry.logicalPath));
    }

    if (options.conversionPolicyFile)
    {
        options.conversionPolicy = JSON.parse(await fs.readFile(
            path.resolve(options.conversionPolicyFile),
            "utf8",
        ));
    }

    return options;
}

function RequireValue(argv, index, option)
{
    const value = argv[index];

    if (!value || value.startsWith("--"))
    {
        throw new Error(`${option} requires a value`);
    }

    return value;
}

async function CreateRunLogger(options, backend, shaderTarget)
{
    const startedAt = Date.now();
    const outputRoot = path.resolve(options.outputDirectory
        ?? path.join(process.cwd(), "artifacts", "shaders"));
    const runStamp = new Date(startedAt).toISOString().replace(/[:.]/gu, "-");
    const runName = `${shaderTarget.id}-${runStamp}-${process.pid}`;
    const logFile = path.resolve(options.logFile
        ?? path.join(outputRoot, "logs", `${runName}.jsonl`));
    const errorReport = path.resolve(options.errorReport
        ?? path.join(path.dirname(logFile), `${runName}.error.json`));
    const logInterval = options.logInterval ?? 25;
    let completed = 0;
    let pending = Promise.resolve();

    await fs.mkdir(path.dirname(logFile), { recursive: true });
    await fs.writeFile(logFile, "", {
        encoding: "utf8",
        flag: options.overwrite ? "w" : "wx",
    });

    const Write = (event) =>
    {
        if (event.event === "entry-complete")
        {
            completed++;
        }

        const record = {
            schema: "carbon.shader-build-log",
            version: 1,
            timestamp: new Date().toISOString(),
            elapsedMs: Date.now() - startedAt,
            backend,
            shaderTarget: shaderTarget.id,
            ...event,
            ...(event.event === "entry-complete" ? { completed } : {}),
        };
        const line = `${JSON.stringify(record)}\n`;
        const print = event.event !== "entry-start"
            && (event.event !== "entry-complete"
                || event.status === "failed"
                || event.status === "unsupported"
                || completed % logInterval === 0
                || completed === event.total);

        pending = pending.then(async () =>
        {
            await fs.appendFile(logFile, line, "utf8");

            if (print)
            {
                process.stderr.write(line);
            }
        });

        return pending;
    };

    const WriteError = async (failure) =>
    {
        await pending;
        await fs.mkdir(path.dirname(errorReport), { recursive: true });
        await fs.writeFile(errorReport, `${JSON.stringify(failure, null, 2)}\n`, {
            encoding: "utf8",
            flag: options.overwrite ? "w" : "wx",
        });
    };

    return {
        logFile,
        errorReport,
        Elapsed: () => Date.now() - startedAt,
        Write,
        WriteError,
    };
}

function SerializeFailure(error, context)
{
    return {
        schema: "carbon.shader-build-error",
        version: 1,
        timestamp: new Date().toISOString(),
        ...context,
        error: {
            name: error?.name ?? "Error",
            message: error?.message ?? String(error),
            stack: error?.stack ?? null,
            cause: error?.cause ? {
                name: error.cause.name ?? "Error",
                message: error.cause.message ?? String(error.cause),
            } : null,
        },
        report: error?.report ?? null,
    };
}

export function ReportShaderBuilderFatal(error, backend)
{
    process.stderr.write(`${JSON.stringify({
        schema: "carbon.shader-build-fatal",
        version: 1,
        timestamp: new Date().toISOString(),
        backend,
        error: {
            name: error?.name ?? "Error",
            message: error?.message ?? String(error),
        },
        logFile: error?.shaderBuildLogFile ?? null,
        errorReport: error?.shaderBuildErrorReport ?? null,
    })}\n`);
}

function Help(backend)
{
    return `Usage:
  node scripts/build_${backend}_shaders.js --shader-target <id> [options]

Options:
  --target <id>                 Assert the public game target.
  --build <latest|number>       Resolve once, then retain the exact build.
  --source <res:/path>          Select one source; repeatable.
  --source-manifest <file>      JSON source-path array or catalog entries.
  --quality <tier>              Select hi/depth/lo; repeatable.
  --conversion-policy <file>    JSON format-package selection policy.
  --concurrency <count>         Bounded source conversion concurrency.
  --qualification <level>       package, structural, or native-hlslcc.
  --out <directory>             Immutable build output parent.
  --overlay-dir <directory>     Install a qualified persistent overlay.
  --log <file>                  JSONL progress log; defaults under <out>/logs.
  --error-report <file>         Structured failure report path.
  --log-interval <count>        Print progress every N completed files (25).
  --generated-at <time>         Optional reproducible report timestamp.
  --dry-run, --catalog-only     Inventory only; perform no conversion.
  --diagnostic                  Retain partial output without activating it.
  --overwrite, --force          Transactionally replace an output directory.
  --replace-overlay             Transactionally replace the named overlay.
  --no-reuse                    Error instead of reusing identical output.
  --help, -h                    Show this help.
`;
}
