#!/usr/bin/env node

import { CjsToolCache } from "../src/cache/index.js";
import { CjsToolSdeArchive, CjsToolSdeDatabase } from "../src/sde/index.js";
import { LoadToolEnv } from "../src/env.js";

const HELP = `Usage:
  cjs-sde-prepare [--build <exact-build>] [--cache <directory>] [--refresh]

Options:
  --build <number>            Prepare one exact numeric build. When omitted,
                              resolve latest once and retain its exact build.
  --cache <directory>         Shared tools cache directory.
  --latest-url <url>          Override the latest metadata URL.
  --archive-url-template <u>  Override the archive template containing {build}.
  --source <url>              Override the exact archive URL; requires --build.
  --version <token>           Generated artifact version (default: v1).
  --refresh                   Recompute the derived artifacts and query indexes
                              of a database already on disk, without
                              re-acquiring the archive. Requires --build.
  --help, -h                  Show this help.

Writes custom/targets/eve/builds/<build>/sde_<version>.sqlite
with every official JSONL table and prints a JSON summary.
`;

async function Main(argv)
{
    const options = ParseArgs(argv);

    if (options.help)
    {
        process.stdout.write(HELP);
        return;
    }

    if (options.source && !options.build)
    {
        throw new Error("--source requires --build so archive identity stays exact");
    }

    if (options.refresh && !options.build)
    {
        throw new Error("--refresh requires --build: it operates on one database already on disk");
    }

    const archive = new CjsToolSdeArchive({
        latestUrl: options.latestUrl,
        archiveUrlTemplate: options.archiveUrlTemplate
    });
    const latest = options.build ? null : await archive.ResolveLatest();
    const requestedBuild = options.build ?? latest.build;
    // The cache root can come from .env, so it has to be loaded before any
    // cache is constructed - resolveCacheRoot reads the environment, not a file.
    LoadToolEnv(options.env);

    const cache = new CjsToolCache(options.cache);
    const outputPath = cache.GetCustomPath({
        game: "Eve",
        provider: "ccp",
        build: requestedBuild,
        name: "sde",
        version: options.version,
        extension: "sqlite",
    });
    // Recomputing is not re-preparing. A derived artifact is a pure function of
    // rows already in the database, so adding a derivation — or fixing one —
    // should not cost a fresh several-hundred-megabyte download of an archive
    // that has not changed. Without this, every change to the derivation
    // register would strand every database already on disk.
    const database = options.refresh
        ? await CjsToolSdeDatabase.refresh(outputPath)
        : await archive.PrepareDatabase({
            archiveUrl: options.source,
            build: requestedBuild,
            releaseDate: latest?.releaseDate,
            databasePath: outputPath,
        });

    try
    {
        const prepared = await database.Describe();

        process.stdout.write(`${JSON.stringify({
            schema: prepared.schema,
            version: prepared.version,
            target: prepared.target,
            game: prepared.game,
            provider: prepared.provider,
            build: prepared.build,
            source: prepared.source,
            outputPath,
            tableCount: prepared.tables.length,
            tables: Object.fromEntries(prepared.tables.map(table => [
                table.name,
                table.rowCount,
            ])),
        }, null, 2)}\n`);
    }
    finally
    {
        await database.Close();
    }
}

function ParseArgs(argv)
{
    const options = {
        archiveUrlTemplate: undefined,
        build: null,
        cache: undefined,
        help: false,
        latestUrl: undefined,
        refresh: false,
        source: undefined,
        version: "v1"
    };

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];

        if (argument === "--help" || argument === "-h")
        {
            options.help = true;
            continue;
        }

        if (argument === "--refresh")
        {
            options.refresh = true;
            continue;
        }

        const name = ({
            "--archive-url-template": "archiveUrlTemplate",
            "--build": "build",
            "--cache": "cache",
            "--latest-url": "latestUrl",
            "--source": "source",
            "--version": "version"
        })[argument];

        if (!name)
        {
            throw new Error(`Unknown option ${argument}`);
        }

        const value = argv[++index];

        if (!value || value.startsWith("--"))
        {
            throw new Error(`Missing value for ${argument}`);
        }

        options[name] = value;
    }

    return options;
}

try
{
    await Main(process.argv.slice(2));
}
catch (error)
{
    process.stderr.write(`cjs-sde-prepare: ${error.message}\n`);
    process.exitCode = 1;
}
