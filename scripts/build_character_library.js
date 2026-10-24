import { CjsSchema } from "@carbonenginejs/runtime/schema";
import fs from "node:fs/promises";
import path from "node:path";

import { CjsCharacterLibrary } from "@carbonenginejs/runtime/character";
import { CjsFileIndex } from "@carbonenginejs/runtime/tools/fileindex";
import { CjsToolCache } from "../src/cache/index.js";
import { CjsToolIndexCache, CjsToolIndex } from "../src/indexing/index.js";
import {
    CjsToolCharacter,
    CjsToolCharacterCatalogGatherer,
} from "../src/character/index.js";
import { CjsToolLibraryArtifact } from "../src/library/index.js";
import * as utils from "../src/utils.js";
import { LoadToolEnv } from "../src/env.js";

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
  --game <name>          Optional target game-metadata assertion.
  --provider <id>        Optional target provider-metadata assertion.
  --generated-at <time>  Optional reproducible generation timestamp.
  --schema-version <n>   11 (default) or opt-in 12; separate v12 cache artifact.
  --compact              Emit compact library JSON.
  --help, -h             Show this help.

The document input may be an existing prepared library or place record maps at
the root or below "documents". A prepared library is hydrated, its retained
definitions are recompiled, and only newly discovered catalog records are
added before serialization. Existing records and graph relationships are not
replaced or removed. Catalog
inputs declare "profiles" and "partSources" without relying on filename or
folder inference. Every supplied decoded definition is retained losslessly;
typed definition catalogs are additive indexes over that retained JSON.
Profile JSON is copied without source-format conversion, and
candidate order is preserved. Omitted version candidate fields inherit from
the single unversioned record; explicit empty arrays remain empty. Effective
version candidates and metadata are materialized before publication. This
command never imports a private source reader. It uses tools-core's normal
validated exact-build resource source to acquire missing indexed PNG
representations, then folds their placement metadata into the prepared schema.
DDS paths remain the render candidates; PNGs are inspection representations only.

Schema 12 accepts sourceTexts and preparation evidence, preserves raw inputs,
and replaces producer-owned projections on rebuild. A prepared input must retain
rawDocuments; schema 11 cannot reconstruct original presence. Explicit output
does not refresh a running repository: request library-v12.json?refresh=1 after
publishing to its cache. The default HTTP routes remain schema 11.
`;

await Main(process.argv.slice(2)).catch(error =>
{
    process.stderr.write(`build-character-library: ${error.message}\n`);
    process.exitCode = 1;
});

async function Main(argv)
{
    const options = ParseArgs(argv);
    const schemaVersion = Number(options.schemaVersion ?? 11);
    if (![11, 12].includes(schemaVersion)) throw new TypeError("--schema-version must be 11 or 12");

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
    // The cache root can come from .env, so it has to be loaded before any
    // cache is constructed - resolveCacheRoot reads the environment, not a file.
    LoadToolEnv(options.env);

    const cache = new CjsToolCache(path.resolve(options.cache));
    const indexes = new CjsToolIndex({
        cache: new CjsToolIndexCache({ cache }),
    });
    const indexPath = path.resolve(options.index);
    const index = CjsFileIndex.decodeResFileIndex(await fs.readFile(indexPath));
    const catalogInputs = ReadCatalogInputs(
        JSON.parse(await fs.readFile(path.resolve(options.catalogInputs), "utf8"))
    );
    const documentValue = JSON.parse(
        await fs.readFile(path.resolve(options.documents), "utf8")
    );
    const preparedLibrary = IsPreparedLibrary(documentValue)
        ? CjsCharacterLibrary.from(documentValue)
        : null;
    if (schemaVersion === 12 && preparedLibrary && !documentValue.rawDocuments)
        throw new Error("Schema-12 preparation requires original input documents; materialized legacy records cannot recover input presence");
    const input = schemaVersion === 12 && preparedLibrary
        ? ReadDocumentInput(documentValue.rawDocuments)
        : preparedLibrary
        ? ReadPreparedCompilerInput(documentValue.documents)
        : ReadDocumentInput(documentValue);
    const definitions = catalogInputs.definitions
        ?? (preparedLibrary
            ? ExtractPreparedDefinitions(input.characterDefinitions ?? {})
            : null);
    const sourceTexts = {
        ...(schemaVersion === 12 && preparedLibrary ? Object.fromEntries(
            Object.values(input.characterDefinitions ?? {}).filter(value => typeof value.sourceText === "string")
                .map(value => [value.sourcePath, value.sourceText])
        ) : {}),
        ...catalogInputs.sourceTexts
    };
    // Explicit new text replaces the earlier decoded projection on rebuild.
    // The compiler still rejects conflicting values supplied together by a caller.
    if (preparedLibrary && !catalogInputs.definitions && definitions)
    {
        for (const path of Object.keys(sourceTexts)) delete definitions[path];
    }
    const partSourcesFromInput = catalogInputs.partSources === undefined
        && Object.keys(input.characterPartSources ?? {}).length > 0;
    const gathered = await new CjsToolCharacterCatalogGatherer({
        cache,
        source: () => indexes.OpenTarget(target.id, sourceBuild),
    }).Gather(
        index,
        {
            sourceBuild,
            ...catalogInputs,
            schemaVersion,
            definitions,
            sourceTexts,
            characterResources: input.characterResources ?? {},
            characterModifierLocations: input.characterModifierLocations ?? {},
            partSources: catalogInputs.partSources
                ?? (schemaVersion === 12 && [...Object.keys(definitions ?? {}), ...Object.keys(sourceTexts)].some(path => /(?:\.type|metadata\.yaml)$/iu.test(path))
                    ? {} : input.characterPartSources ?? {}),
        }
    );
    const preparedResult = preparedLibrary && schemaVersion === 11
        ? AddPreparedCatalogAdditions(preparedLibrary, gathered.documents, {
            target,
            sourceBuild,
        })
        : null;
    const builtValues = preparedResult
        ? preparedResult.data
        : character.Build((schemaVersion === 12 ? ReplacePreparedDocuments : MergeDocuments)(
            partSourcesFromInput
                ? { ...input, characterPartSources: {} }
                : input,
            gathered.documents
        ), {
            sourceTarget: target.id,
            sourceGame: target.game,
            sourceProvider: target.provider,
            sourceBuild,
            generatedAt: options.generatedAt,
            schemaVersion,
            preparation: gathered.preparation,
        });
    const data = CjsSchema.getValues(CjsCharacterLibrary.from(builtValues), {}, { refs: true });
    const artifact = options.out
        ? await CjsToolLibraryArtifact.write(path.resolve(options.out), data, {
            compact: options.compact,
        })
        : await cache.WriteCustomLibrary({
            target: target.id,
            game: target.game,
            provider: target.provider,
            build: sourceBuild,
            name: "character",
            version: schemaVersion === 12 ? "v12" : "v10",
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
        preparedAdditions: preparedResult?.additions ?? null,
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
        ![ "definitions", "sourceTexts", "preparation", "profiles", "partSources" ].includes(key));

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

    return Object.fromEntries(Object.entries(documents).map(
        ([ documentName, records ]) => [
            documentName,
            NormalizeDocumentRecords(records, documentName),
        ]
    ));
}

function ReadPreparedCompilerInput(documents)
{
    const result = {
        characterDefinitions: {},
        characterResources: {},
        characterModifierLocations: {},
        characterPartSources: {},
    };

    for (const documentName of [
        "characterDefinitions",
        "characterResources",
        "characterModifierLocations",
    ])
    {
        const records = documents?.[documentName];

        if (!Array.isArray(records))
        {
            throw new TypeError(
                `Prepared character library requires array ${JSON.stringify(documentName)}`
            );
        }

        for (const record of records)
        {
            if (!record || typeof record !== "object" || Array.isArray(record)) continue;
            if (record.recordID === undefined || record.recordID === null) continue;

            const recordID = String(record.recordID);
            const { recordID: _recordID, ...values } = record;
            result[documentName][recordID] = values;
        }
    }

    return result;
}

function IsPreparedLibrary(value)
{
    return value?.schema === "carbonenginejs.characterLibrary"
        && value.documents
        && Object.values(value.documents).every(Array.isArray);
}

function AddPreparedCatalogAdditions(library, gathered, { target, sourceBuild })
{
    if (library.sourceTarget && library.sourceTarget !== target.id)
    {
        throw new Error(
            `Prepared character library target ${library.sourceTarget} does not match ${target.id}`
        );
    }

    if (library.sourceBuild && String(library.sourceBuild) !== sourceBuild)
    {
        throw new Error(
            `Prepared character library build ${library.sourceBuild} does not match ${sourceBuild}`
        );
    }

    const additions = {};

    for (const documentName of Object.keys(gathered).sort(Compare))
    {
        let added = 0;
        for (const recordID of Object.keys(gathered[documentName]).sort(Compare))
        {
            if (library.Get(documentName, recordID)) continue;

            library.Create(documentName, {
                recordID,
                ...gathered[documentName][recordID],
            });
            added++;
        }
        if (added) additions[documentName] = added;
    }

    return {
        data: CjsSchema.getValues(library, {}, { refs: true }),
        additions,
    };
}

function ExtractPreparedDefinitions(records)
{
    const definitions = {};

    for (const recordID of Object.keys(records).sort(Compare))
    {
        const record = records[recordID];

        if (!record || typeof record !== "object" || Array.isArray(record))
        {
            throw new TypeError(
                `Prepared character definition ${JSON.stringify(recordID)} must be an object`
            );
        }
        if (!Object.hasOwn(record, "values"))
        {
            throw new TypeError(
                `Prepared character definition ${JSON.stringify(recordID)} requires values`
            );
        }

        definitions[recordID] = record.values;
    }

    return definitions;
}

function NormalizeDocumentRecords(records, documentName)
{
    if (!Array.isArray(records))
    {
        return records;
    }

    const result = {};

    for (let index = 0; index < records.length; index++)
    {
        const record = records[index];

        if (!record || typeof record !== "object" || Array.isArray(record))
        {
            throw new TypeError(
                `Character document ${documentName}[${index}] must be an object`
            );
        }

        const recordID = record.recordID;
        if (recordID === undefined || recordID === null || String(recordID) === "")
        {
            throw new TypeError(
                `Character document ${documentName}[${index}] requires recordID`
            );
        }

        const key = String(recordID);
        if (Object.hasOwn(result, key))
        {
            throw new Error(
                `Character document ${documentName} duplicates recordID ${JSON.stringify(key)}`
            );
        }

        const { recordID: _recordID, ...values } = record;

        result[key] = values;
    }

    return result;
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

// Replace the full producer-owned catalog on a rebuild. Supplied profiles
// belong to the caller; conflicting records are rejected rather than skipped.
function ReplacePreparedDocuments(input, gathered)
{
    const result = { ...input };
    for (const [name, records] of Object.entries(gathered))
    {
        if (["characterMaterialProfiles", "characterProjectionProfiles", "characterRecipeProfiles"].includes(name))
        {
            const existing = input[name] ?? {};
            for (const [id, record] of Object.entries(records))
            {
                if (Object.hasOwn(existing, id) && JSON.stringify(existing[id]) !== JSON.stringify(record))
                    throw new Error(`Conflicting supplied ${name} record ${id}`);
            }
            result[name] = { ...existing, ...records };
        }
        else result[name] = records;
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
            "--schema-version",
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
