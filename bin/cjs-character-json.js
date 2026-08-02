#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
    CjsToolCharacter,
} from "../src/character/index.js";
import { CjsToolLibraryArtifact } from "../src/library/index.js";

const HELP = `Usage:
  cjs-character-json <documents.json> --out <character-library.json>
  cjs-character-json <documents.json> --source-target <name> --source-build <id>

Options:
  --out, -o <file>       Write canonical JSON and a deterministic .json.gz sibling.
  --source-target <name> Audited library target; defaults to eve.
  --source-game <name>   Optional target game selector.
  --source-provider <id> Optional target provider selector.
  --source-build <id>    Exact numeric source build.
  --generated-at <time>  Optional reproducible generation timestamp.
  --compact              Emit compact JSON.
  --help, -h             Show this help.

Input is a source-neutral JSON object containing the character document maps,
either at the root or under a "documents" property. The twelve direct source
documents are required; prepared catalogs may be supplied in the same object.
When --out is omitted, JSON is written to stdout without an artifact sibling.
`;

await Main(process.argv.slice(2)).catch(error =>
{
    process.stderr.write(`cjs-character-json: ${error.message}\n`);
    process.exitCode = 1;
});

async function Main(argv)
{
    const options = ParseArgs(argv);

    if (options.help)
    {
        process.stdout.write(HELP);
        return;
    }

    if (!options.input)
    {
        throw new Error("Missing character document JSON input path");
    }

    const input = ReadJsonObject(path.resolve(options.input), "Character document input");
    const documents = input.documents ?? input;
    const data = CjsToolCharacter.build(documents, {
        sourceTarget: options.sourceTarget ?? input.sourceTarget ?? "eve",
        sourceGame: options.sourceGame ?? input.sourceGame,
        sourceProvider: options.sourceProvider ?? input.sourceProvider,
        sourceBuild: options.sourceBuild ?? input.sourceBuild,
        generatedAt: options.generatedAt ?? input.generatedAt,
    });

    if (!options.out)
    {
        process.stdout.write(`${JSON.stringify(data, null, options.compact ? 0 : 2)}\n`);
        return;
    }

    const artifact = await CjsToolLibraryArtifact.write(
        path.resolve(options.out),
        data,
        { compact: options.compact }
    );

    process.stdout.write(`Wrote character library JSON to ${artifact.jsonPath}\n`);
    process.stdout.write(`Wrote character library gzip to ${artifact.gzipPath}\n`);
}

function ParseArgs(argv)
{
    const options = {
        compact: false,
        generatedAt: undefined,
        help: false,
        input: null,
        out: null,
        sourceTarget: undefined,
        sourceGame: undefined,
        sourceProvider: undefined,
        sourceBuild: undefined,
    };

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];

        if (argument === "--help" || argument === "-h")
        {
            options.help = true;
        }
        else if (argument === "--compact")
        {
            options.compact = true;
        }
        else if (argument === "--out" || argument === "-o")
        {
            options.out = ReadArgValue(argv, ++index, argument);
        }
        else if ([
            "--source-target",
            "--source-game",
            "--source-provider",
            "--source-build",
            "--generated-at",
        ].includes(argument))
        {
            options[ToOptionName(argument)] = ReadArgValue(argv, ++index, argument);
        }
        else if (argument.startsWith("-"))
        {
            throw new Error(`Unknown option ${argument}`);
        }
        else if (!options.input)
        {
            options.input = argument;
        }
        else
        {
            throw new Error(`Unexpected argument ${argument}`);
        }
    }

    return options;
}

function ReadArgValue(argv, index, flag)
{
    const value = argv[index];

    if (!value || value.startsWith("-"))
    {
        throw new Error(`Missing value for ${flag}`);
    }

    return value;
}

function ReadJsonObject(filePath, label)
{
    if (!fs.existsSync(filePath))
    {
        throw new Error(`${label} file not found: ${filePath}`);
    }

    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));

    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError(`${label} must contain a JSON object`);
    }

    return value;
}

function ToOptionName(argument)
{
    return argument.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}
