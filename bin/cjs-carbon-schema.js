#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import CjsFormatCarbon from "../src/schema/index.js";

const HELP = `Usage:
  carbon-schema <input.json> --out <schema-dir>
  carbon-schema <input.json|schema-dir> --black-out <definition-dir>
  carbon-schema <input.json> --inspect
  carbon-schema <input.json>

Options:
  --out <dir>        Write index.json, enums.json, family indexes, and class schemas.
  --black-out <dir>  Write a named Black/public-facing schema bundle.
  --clean            Remove output directories before writing. Requires --out or --black-out.
  --inspect          Print a compact schema summary.
  --strict-schema    Fail with all unresolved/ambiguous hydratable fields after applying resolutions.
  --field-resolutions <json>
                     Merge additional field resolutions over the bundled registry.
  --quiet            Print one-line write summaries instead of full manifests.
  --version <n>      Schema version to emit. Only the current version is supported.
  --help, -h         Show this help.
`;

function readArgValue(argv, index, flag)
{
    const value = argv[index];
    if (!value || value.startsWith("--"))
    {
        throw new Error(`Missing value for ${flag}`);
    }
    return value;
}

function parseArgs(argv)
{
    const options = {
        clean: false,
        blackOut: null,
        inspect: false,
        fieldResolutions: null,
        out: null,
        quiet: false,
        strictSchema: false,
        version: undefined,
        input: null
    };

    for (let i = 0; i < argv.length; i++)
    {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h")
        {
            options.help = true;
        }
        else if (arg === "--clean")
        {
            options.clean = true;
        }
        else if (arg === "--inspect")
        {
            options.inspect = true;
        }
        else if (arg === "--strict-schema")
        {
            options.strictSchema = true;
        }
        else if (arg === "--field-resolutions")
        {
            options.fieldResolutions = readArgValue(argv, ++i, arg);
        }
        else if (arg === "--out")
        {
            options.out = readArgValue(argv, ++i, arg);
        }
        else if (arg === "--black-out")
        {
            options.blackOut = readArgValue(argv, ++i, arg);
        }
        else if (arg === "--version")
        {
            options.version = readArgValue(argv, ++i, arg);
        }
        else if (arg === "--quiet")
        {
            options.quiet = true;
        }
        else if (arg.startsWith("--"))
        {
            throw new Error(`Unknown option ${arg}`);
        }
        else if (!options.input)
        {
            options.input = arg;
        }
        else
        {
            throw new Error(`Unexpected argument ${arg}`);
        }
    }

    return options;
}

function cleanOutputRoot(outputRoot)
{
    const resolved = path.resolve(outputRoot);
    const root = path.parse(resolved).root;
    const cwd = path.resolve(process.cwd());

    if (!resolved || resolved === root || resolved === cwd)
    {
        throw new Error(`Refusing to clean unsafe output directory: ${outputRoot}`);
    }

    fs.rmSync(resolved, { recursive: true, force: true });
}

function main()
{
    const options = parseArgs(process.argv.slice(2));
    if (options.help)
    {
        process.stdout.write(HELP);
        return;
    }

    if (!options.input)
    {
        throw new Error("Missing input JSON path");
    }

    if (!fs.existsSync(options.input))
    {
        throw new Error(`Input file not found: ${options.input}`);
    }

    if (options.clean && !options.out && !options.blackOut)
    {
        throw new Error("--clean requires --out or --black-out");
    }

    const values = {
        ...(options.version === undefined ? {} : { version: options.version }),
        strictSchema: options.strictSchema
    };
    if (options.fieldResolutions)
    {
        if (!fs.existsSync(options.fieldResolutions))
        {
            throw new Error(`Field resolution file not found: ${options.fieldResolutions}`);
        }
        values.fieldResolutions = JSON.parse(fs.readFileSync(options.fieldResolutions, "utf8"));
    }
    if (options.inspect)
    {
        process.stdout.write(`${JSON.stringify(CjsFormatCarbon.inspect(options.input, values), null, 2)}\n`);
        return;
    }

    if (options.out || options.blackOut)
    {
        const manifests = [];
        // Compile and validate before --clean can remove an existing output.
        const source = options.strictSchema
            ? CjsFormatCarbon.read(options.input, values)
            : options.input;

        if (options.out)
        {
            if (options.clean)
            {
                cleanOutputRoot(options.out);
            }

            manifests.push({
                label: "schema",
                manifest: CjsFormatCarbon.write(source, options.out, values)
            });
        }

        if (options.blackOut)
        {
            if (options.clean)
            {
                cleanOutputRoot(options.blackOut);
            }

            manifests.push({
                label: "black definition",
                manifest: CjsFormatCarbon.writeBlackDefinitions(source, options.blackOut, values)
            });
        }

        if (options.quiet)
        {
            for (const item of manifests)
            {
                process.stdout.write(`Wrote ${item.manifest.files.length} ${item.label} files to ${item.manifest.outputRoot}\n`);
            }
        }
        else
        {
            process.stdout.write(`${JSON.stringify(manifests.length === 1 ? manifests[0].manifest : manifests, null, 2)}\n`);
        }
        return;
    }

    process.stdout.write(`${JSON.stringify(CjsFormatCarbon.read(options.input, values), null, 2)}\n`);
}

try
{
    main();
}
catch (error)
{
    process.stderr.write(`carbon-schema: ${error.message}\n`);
    process.exitCode = 1;
}
