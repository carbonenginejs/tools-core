import fs from "node:fs/promises";
import path from "node:path";

import { CjsFileIndex } from "@carbonenginejs/tools-browser/fileindex";
import { CjsToolCache } from "../src/cache/index.js";
import {
    CjsToolCharacter,
    CjsToolCharacterCatalogGatherer,
} from "../src/character/index.js";
import { CjsToolLibraryArtifact } from "../src/library/index.js";
import * as utils from "../src/utils.js";

const HELP = `Usage:
  node scripts/build_character_library.js --documents <documents.json> --catalog-inputs <catalog-inputs.json> --index <resfileindex.txt> --cache <cache-dir> --build <id> [--out <library.json>]

Options:
  --documents <file>     Source-neutral JSON containing the direct document maps.
  --catalog-inputs <file>
                         JSON manifest declaring cached model-shaped records
                         and sparse external-candidate authoring records.
  --index <file>         Resource file index for the selected exact build.
  --cache <dir>          Hash-addressed cache root containing indexed inputs.
  --out <file>           Optional JSON output; defaults to the shared custom cache.
  --report <file>        Build report output; defaults beside the JSON artifact.
  --build <id>           Exact numeric source build.
  --target <name>        Audited library target; defaults to eve.
  --game <name>          Optional target game selector.
  --provider <id>        Optional target provider selector.
  --generated-at <time>  Optional reproducible generation timestamp.
  --compact              Emit compact library JSON.
  --help, -h             Show this help.

The document input may place maps at the root or below "documents". Catalog
inputs declare "profiles" and "partSources" without relying on filename or
folder inference. Profile JSON is copied without source-format conversion, and
candidate order is preserved. Omitted version candidate fields inherit from
the single unversioned record; explicit empty arrays remain empty. Effective
version candidates and metadata are materialized before publication. This
command performs no remote reads and never
imports a private source reader. It uses the supplied file index and cache only
to fold declared JSON definitions and exact external candidates into schema v6.
`;

await Main(process.argv.slice(2)).catch(error =>
{
    process.stderr.write(`build-character-library: ${error.message}\n`);
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

    for (const name of [ "documents", "catalogInputs", "index", "cache", "build" ])
    {
        if (!options[name])
        {
            throw new Error(`Missing --${name}`);
        }
    }

    const sourceBuild = utils.normalizeExactBuild(options.build, {
        message: "--build requires an exact numeric build",
    });
    const character = new CjsToolCharacter();
    const target = character.ResolveTarget({
        target: options.target,
        game: options.game,
        provider: options.provider,
    });
    const cache = new CjsToolCache(path.resolve(options.cache));
    const indexPath = path.resolve(options.index);
    const index = CjsFileIndex.decodeResFileIndex(await fs.readFile(indexPath));
    const catalogInputs = ReadCatalogInputs(
        JSON.parse(await fs.readFile(path.resolve(options.catalogInputs), "utf8"))
    );
    const gathered = await new CjsToolCharacterCatalogGatherer({ cache }).Gather(
        index,
        { sourceBuild, ...catalogInputs }
    );
    const input = ReadDocumentInput(
        JSON.parse(await fs.readFile(path.resolve(options.documents), "utf8"))
    );
    const documents = MergeDocuments(input, gathered.documents);
    const data = character.Build(documents, {
        sourceTarget: target.id,
        sourceGame: target.game,
        sourceProvider: target.provider,
        sourceBuild,
        generatedAt: options.generatedAt,
    });
    const artifact = options.out
        ? await CjsToolLibraryArtifact.write(path.resolve(options.out), data, {
            compact: options.compact,
        })
        : await cache.WriteCustomLibrary({
            game: target.game,
            provider: target.provider,
            build: sourceBuild,
            name: "character",
            version: "v6",
        }, data, { compact: options.compact });
    const reportPath = path.resolve(options.report || DefaultReportPath(artifact.jsonPath));
    const report = {
        ...gathered.report,
        sourceTarget: target.id,
        sourceGame: target.game,
        sourceProvider: target.provider,
        sourceBuild,
        output: artifact.jsonPath,
        jsonBytes: artifact.jsonBytes,
        gzipBytes: artifact.gzipBytes,
        documents: Object.fromEntries(Object.entries(data.documents).map(
            ([ name, records ]) => [ name, records.length ]
        )),
    };

    await WriteJson(reportPath, report);
    process.stdout.write(`Wrote character library JSON to ${artifact.jsonPath}\n`);
    process.stdout.write(`Wrote character library gzip to ${artifact.gzipPath}\n`);
    process.stdout.write(`Wrote character library build report to ${reportPath}\n`);
    process.stdout.write(`${JSON.stringify(report.documents)}\n`);
}

function ReadCatalogInputs(value)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError("Character catalog inputs must be a JSON object");
    }

    const unknown = Object.keys(value).filter(key =>
        ![ "profiles", "partSources" ].includes(key));

    if (unknown.length)
    {
        throw new TypeError(`Unsupported character catalog input ${unknown.sort()[0]}`);
    }

    return value;
}

function ReadDocumentInput(value)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError("Character document input must be a JSON object");
    }

    const documents = value.documents ?? value;

    if (!documents || typeof documents !== "object" || Array.isArray(documents))
    {
        throw new TypeError("Character documents must be a JSON object");
    }

    return documents;
}

function MergeDocuments(input, gathered)
{
    const result = {};

    for (const [ documentName, records ] of Object.entries(input))
    {
        result[documentName] = records;
    }

    for (const [ documentName, records ] of Object.entries(gathered))
    {
        const existing = result[documentName] ?? {};

        if (!existing || typeof existing !== "object" || Array.isArray(existing))
        {
            throw new TypeError(`Character document ${documentName} must be a record map`);
        }

        const merged = {};

        for (const recordID of Object.keys(existing))
        {
            merged[recordID] = existing[recordID];
        }

        for (const recordID of Object.keys(records).sort(Compare))
        {
            if (Object.hasOwn(merged, recordID))
            {
                throw new Error(
                    `Character document ${documentName} duplicates gathered record `
                    + JSON.stringify(recordID)
                );
            }

            merged[recordID] = records[recordID];
        }

        result[documentName] = merged;
    }

    return result;
}

async function WriteJson(filePath, value)
{
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function DefaultReportPath(outputPath)
{
    const extension = path.extname(outputPath);

    return `${outputPath.slice(0, outputPath.length - extension.length)}.report.json`;
}

function ParseArgs(argv)
{
    const options = { compact: false };

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
        else if ([
            "--documents",
            "--catalog-inputs",
            "--index",
            "--cache",
            "--out",
            "--report",
            "--build",
            "--target",
            "--game",
            "--provider",
            "--generated-at",
        ].includes(argument))
        {
            const value = argv[++index];

            if (!value || value.startsWith("--"))
            {
                throw new Error(`Missing value for ${argument}`);
            }

            options[ToOptionName(argument)] = value;
        }
        else
        {
            throw new Error(`Unknown argument ${argument}`);
        }
    }

    return options;
}

function ToOptionName(argument)
{
    return argument.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}

function Compare(left, right)
{
    return String(left).localeCompare(String(right), "en", { numeric: true });
}
