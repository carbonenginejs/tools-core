#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
    CjsIndexCache,
    CjsIndexProvider,
    CjsIndexProviderRegistry,
    CjsToolIndex,
    CjsToolTargetRegistry,
    DefaultProviderData,
    hasPathWildcard,
} from "../src/index.js";
import { parseArguments } from "../src/indexing/cli/parseArguments.js";

try
{
    await main();
}
catch (error)
{
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
}

async function main()
{
    const args = parseArguments(process.argv.slice(2));
    const command = getCommand(args);

    if (command === "help")
    {
        printHelp();
        return;
    }

    const providers = await createProviderRegistry(args.providerFile);
    const targets = new CjsToolTargetRegistry();
    const explicitTarget = args.target ? targets.Resolve({
        target: args.target,
        game: args.game,
        provider: args.provider,
    }) : null;
    const game = explicitTarget?.game ?? args.game ?? providers.defaultGame;
    const provider = explicitTarget?.provider ?? args.provider ?? providers.defaultProvider;
    const target = explicitTarget ?? targets.Find(game, provider);
    const build = args.build ?? providers.Get(provider, game).defaultBuildRef;
    const client = args.client ?? target?.client;
    const cache = args.noCache
        ? null
        : new CjsIndexCache({
            directory: args.cache
                ? path.resolve(String(args.cache))
                : path.resolve(".cache", "tool-core"),
        });
    const tool = new CjsToolIndex({ providers, cache });

    if (command === "inspect" || command === "indexes")
    {
        const indexes = await tool.ReadIndexes({
            target: target?.id,
            game,
            provider,
            build,
            client,
        });

        if (command === "indexes" && args.out)
        {
            await writeIndexes(indexes, path.resolve(String(args.out)));
        }

        PrintJson(summarizeIndexes(indexes, cache, args.out));
        return;
    }

    const source = await tool.Open({
        target: target?.id,
        game,
        provider,
        build,
        client,
    });
    const selector = getSelector(args, command);
    const options = {
        root: selector.root,
        type: selector.type,
        flags: args.regexFlags,
        indexName: args.index,
        concurrency: args.concurrency,
        refresh: Boolean(args.refresh),
    };

    if (command === "resolve")
    {
        const resolutions = selector.type === "exact"
            ? [ source.Resolve(selector.value, options) ]
            : source.Match(selector.value, options);

        PrintJson(resolutions.length === 1 ? resolutions[0] : resolutions);
        return;
    }

    const matches = selector.type === "exact"
        ? [ source.Resolve(selector.value, options) ]
        : source.Match(selector.value, options);

    AssertDownloadLimit(matches, args);

    const results = selector.type === "exact"
        ? [ await source.Fetch(selector.value, options) ]
        : await source.FetchMatching(selector.value, options);
    const summaries = await writePayloads(results, args.out);

    PrintJson(summaries.length === 1 ? summaries[0] : summaries);
}

function getCommand(args)
{
    const commands = new Set([ "fetch", "get", "help", "indexes", "inspect", "read", "resolve" ]);
    const first = args._[0]?.toLowerCase();

    if (first && commands.has(first))
    {
        args._.shift();
        return [ "get", "read" ].includes(first) ? "fetch" : first;
    }

    if (args.help)
    {
        return "help";
    }

    if (args.indexes)
    {
        return "indexes";
    }

    if ([ args.app, args.res, args.glob, args.regex ].some((value) => value !== undefined))
    {
        return "fetch";
    }

    return "inspect";
}

function getSelector(args, command)
{
    const candidates = [
        args.app !== undefined ? { root: "app", type: "auto", value: args.app } : null,
        args.res !== undefined ? { root: "res", type: "auto", value: args.res } : null,
        args.glob !== undefined ? { root: args.root ?? "res", type: "wildcard", value: args.glob } : null,
        args.regex !== undefined ? { root: args.root ?? "res", type: "regex", value: args.regex } : null,
    ].filter(Boolean);

    if (args._.length > 1)
    {
        throw new Error(`Unexpected arguments: ${args._.slice(1).join(", ")}`);
    }

    if (candidates.length === 0 && args._[0])
    {
        candidates.push({ root: args.root ?? "res", type: "auto", value: args._[0] });
    }

    if (candidates.length !== 1)
    {
        throw new Error(`${command} requires exactly one --app, --res, --glob, or --regex selector`);
    }

    const selector = candidates[0];

    if (selector.value === true || !String(selector.value).trim())
    {
        throw new Error("Path selector requires a value");
    }

    return Object.freeze({
        ...selector,
        value: String(selector.value),
        type: selector.type === "auto"
            ? hasPathWildcard(selector.value) ? "wildcard" : "exact"
            : selector.type,
    });
}

function AssertDownloadLimit(matches, args)
{
    if (matches.length === 0)
    {
        throw new Error("No files matched the requested path expression");
    }

    if (args.all)
    {
        return;
    }

    const limit = Number(args.limit ?? 100);

    if (!Number.isSafeInteger(limit) || limit < 1)
    {
        throw new Error(`Invalid download limit: ${args.limit}`);
    }

    if (matches.length > limit)
    {
        throw new Error(
            `Matched ${matches.length} files; use --limit:${matches.length} or --all to confirm`,
        );
    }
}

async function writePayloads(results, outputDirectory)
{
    const root = outputDirectory ? path.resolve(String(outputDirectory)) : null;
    const summaries = [];

    for (const result of results)
    {
        const resolution = result.resolution;
        const outputPath = root
            ? path.resolve(root, resolution.root, ...resolution.relativePath.split("/"))
            : null;

        if (outputPath)
        {
            const relative = path.relative(root, outputPath);

            if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
            {
                throw new Error(`Unsafe output path: ${resolution.logicalPath}`);
            }

            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, Buffer.from(result.bytes));
        }

        summaries.push({
            target: resolution.target,
            game: resolution.game,
            provider: resolution.provider,
            build: resolution.build,
            client: resolution.client,
            logicalPath: resolution.logicalPath,
            sourceUrl: resolution.sourceUrl,
            indexNames: resolution.indexNames,
            bytes: result.byteLength,
            cacheHit: result.cacheHit,
            cachePath: result.cachePath,
            outputPath,
        });
    }

    return summaries;
}

async function writeIndexes(indexes, outputDirectory)
{
    const groups = [ indexes.app.index, ...Object.values(indexes.indexes) ];

    await fs.mkdir(outputDirectory, { recursive: true });

    for (const group of groups)
    {
        const fileName = group.kind === "appfileindex"
            ? "appfileindex.txt"
            : path.posix.basename(group.declaration.sourceLogicalPath);
        const outputPath = path.resolve(outputDirectory, fileName);

        await fs.writeFile(outputPath, group.rawText, "utf8");
    }
}

function summarizeIndexes(indexes, cache, outputDirectory)
{
    return {
        target: indexes.target,
        game: indexes.game,
        provider: indexes.provider,
        buildRef: indexes.buildRef,
        build: indexes.build,
        client: indexes.client,
        cacheDirectory: cache?.directory ?? null,
        outputDirectory: outputDirectory ? path.resolve(String(outputDirectory)) : null,
        app: summarizeGroup(indexes.app.index),
        res: indexes.res.index ? summarizeGroup(indexes.res.index) : null,
        appExtensions: Object.fromEntries(
            Object.entries(indexes.app.extensions).map(([ name, group ]) => [ name, summarizeGroup(group) ]),
        ),
    };
}

function summarizeGroup(group)
{
    return {
        declaration: group.declaration?.logicalPath ?? null,
        sourceUrl: group.sourceUrl,
        records: group.count,
        cacheHit: group.cacheHit,
        cachePath: group.cachePath,
    };
}

async function createProviderRegistry(providerFile)
{
    if (!providerFile)
    {
        return new CjsIndexProviderRegistry();
    }

    const custom = JSON.parse(await fs.readFile(path.resolve(String(providerFile)), "utf8"));
    const customProfile = new CjsIndexProvider(custom);
    const providers = DefaultProviderData.filter(
        (provider) => provider.id !== customProfile.id || provider.game !== customProfile.game,
    );

    return new CjsIndexProviderRegistry([ ...providers, customProfile ]);
}

function PrintJson(value)
{
    process.stdout.write(`${JSON.stringify(value, null, 4)}\n`);
}

function printHelp()
{
    process.stdout.write(`CarbonEngineJS tools-core index\n\n`);
    process.stdout.write(`Inspect:  node bin/cjs-tool-index.js --target:eve --build:latest\n`);
    process.stdout.write(`Frontier: node bin/cjs-tool-index.js --target:frontier --build:latest\n`);
    process.stdout.write(`Client:   node bin/cjs-tool-index.js --provider:netease --client:infinity --build:latest\n`);
    process.stdout.write(`Indexes:  node bin/cjs-tool-index.js indexes --provider:ccp --build:latest --out:indexes\n`);
    process.stdout.write(`File:     node bin/cjs-tool-index.js --provider:ccp --build:latest --res:path/file.dds --out:files\n`);
    process.stdout.write(`Wildcard: node bin/cjs-tool-index.js --res:audio/*.bnk --out:files\n`);
    process.stdout.write(`Regex:    node bin/cjs-tool-index.js --regex:^res:/audio/.+\\.wem$ --out:files\n\n`);
    process.stdout.write(`Options: --target:name --game:name --provider:name --client:name --index:name --cache:path --concurrency:4 --limit:100 --all --refresh --no-cache\n`);
}
