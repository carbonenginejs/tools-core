#!/usr/bin/env node

import { CjsToolCache } from "../src/cache/index.js";
import { CjsSdeArchive } from "../src/sde/index.js";

const HELP = `Usage:
  cjs-sde-prepare [--build <exact-build>] [--cache <directory>]

Options:
  --build <number>            Prepare one exact numeric build. When omitted,
                              resolve CCP latest once and retain its exact build.
  --cache <directory>         Shared tools cache directory.
  --latest-url <url>          Override the CCP latest metadata URL.
  --archive-url-template <u>  Override the archive template containing {build}.
  --source <url>              Override the exact archive URL; requires --build.
  --version <token>           Generated artifact version (default: v1).
  --help, -h                  Show this help.

Writes custom/games/eve/providers/ccp/builds/<build>/sde_<version>.sqlite
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

    const archive = new CjsSdeArchive({
        latestUrl: options.latestUrl,
        archiveUrlTemplate: options.archiveUrlTemplate
    });
    const latest = options.build ? null : await archive.ResolveLatest();
    const requestedBuild = options.build ?? latest.build;
    const cache = new CjsToolCache(options.cache);
    const outputPath = cache.GetCustomPath({
        game: "Eve",
        provider: "ccp",
        build: requestedBuild,
        name: "sde",
        version: options.version,
        extension: "sqlite",
    });
    const database = await archive.PrepareDatabase({
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
