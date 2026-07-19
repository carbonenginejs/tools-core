#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
    CjsToolCharacter,
} from "../src/index.js";

const HELP = `Usage:
  character-library-json <catalogs.json> --out <character-library.json>
  character-library-json <catalogs.json> [--compact]

Options:
  --out, -o <file>       Write the canonical character library JSON file.
  --source-target <name> Override the input sourceTarget value.
  --source-game <name>   Override the input sourceGame value.
  --source-provider <id> Override the input sourceProvider value.
  --source-build <id>    Override the input sourceBuild value.
  --generated-at <time>  Override the input generatedAt value.
  --include-sources      Retain sourceRefs and source metadata records.
  --compact              Emit compact JSON instead of two-space indentation.
  --help, -h             Show this help.

Input is normalized catalog JSON. It may contain catalog arrays at the root or
under a "catalogs" property. Source-format parsing belongs to build tooling.
Library outputs are target-specific; sourceTarget, sourceGame, sourceProvider,
sourceBuild, and all normalized catalogs must describe the same target/build.
When --out is omitted, JSON is written to stdout.
`;

function ReadArgValue(argv, index, flag)
{
    const value = argv[index];
    if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
    return value;
}

function ParseArgs(argv)
{
    const options = {
        compact: false,
        generatedAt: undefined,
        help: false,
        includeSources: false,
        input: null,
        out: null,
        sourceTarget: undefined,
        sourceGame: undefined,
        sourceProvider: undefined,
        sourceBuild: undefined
    };

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];
        if (argument === "--help" || argument === "-h") options.help = true;
        else if (argument === "--compact") options.compact = true;
        else if (argument === "--include-sources") options.includeSources = true;
        else if (argument === "--out" || argument === "-o")
        {
            options.out = ReadArgValue(argv, ++index, argument);
        }
        else if (argument === "--source-build")
        {
            options.sourceBuild = ReadArgValue(argv, ++index, argument);
        }
        else if (argument === "--source-target")
        {
            options.sourceTarget = ReadArgValue(argv, ++index, argument);
        }
        else if (argument === "--source-game")
        {
            options.sourceGame = ReadArgValue(argv, ++index, argument);
        }
        else if (argument === "--source-provider")
        {
            options.sourceProvider = ReadArgValue(argv, ++index, argument);
        }
        else if (argument === "--generated-at")
        {
            options.generatedAt = ReadArgValue(argv, ++index, argument);
        }
        else if (argument.startsWith("-")) throw new Error(`Unknown option ${argument}`);
        else if (!options.input) options.input = argument;
        else throw new Error(`Unexpected argument ${argument}`);
    }

    return options;
}

function ReadInput(inputPath)
{
    if (!fs.existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);
    try
    {
        const value = JSON.parse(fs.readFileSync(inputPath, "utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value))
        {
            throw new TypeError("root must be an object");
        }
        return value;
    }
    catch (error)
    {
        throw new Error(`Cannot read input JSON ${inputPath}: ${error.message}`);
    }
}

function Main(argv)
{
    const options = ParseArgs(argv);
    if (options.help)
    {
        process.stdout.write(HELP);
        return;
    }
    if (!options.input) throw new Error("Missing normalized catalog JSON input path");

    const input = ReadInput(options.input);
    const catalogs = input.catalogs ?? input;
    const character = new CjsToolCharacter();
    const data = character.Build(catalogs, {
        sourceTarget: options.sourceTarget ?? input.sourceTarget,
        sourceGame: options.sourceGame ?? input.sourceGame,
        sourceProvider: options.sourceProvider ?? input.sourceProvider,
        sourceBuild: options.sourceBuild ?? input.sourceBuild,
        generatedAt: options.generatedAt ?? input.generatedAt,
        includeSources: options.includeSources,
    });
    const json = `${character.Stringify(data, { compact: options.compact })}\n`;

    if (!options.out)
    {
        process.stdout.write(json);
        return;
    }

    const outputPath = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
    process.stdout.write(`Wrote character library JSON to ${outputPath}\n`);
}

try
{
    Main(process.argv.slice(2));
}
catch (error)
{
    process.stderr.write(`character-library-json: ${error.message}\n`);
    process.exitCode = 1;
}
