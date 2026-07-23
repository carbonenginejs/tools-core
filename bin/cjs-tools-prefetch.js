#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import {
    CjsIndexCache,
    CjsToolAudioPrefetch,
    CjsToolAudioRepository,
    CjsToolCache,
    CjsToolIndex,
    CjsToolPrefetch,
} from "../src/index.js";
import { parseArguments } from "../src/indexing/cli/parseArguments.js";

const DEFAULT_MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

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

    if (args.help)
    {
        printHelp();
        return;
    }

    if (args._.length > 1)
    {
        throw new Error("Prefetch accepts at most one positional profile");
    }

    if (args._.length && args.profile !== undefined)
    {
        throw new Error("Select profiles positionally or with --profile, not both");
    }

    const cacheDirectory = path.resolve(
        String(args.cache ?? path.join(".cache", "tool-core")),
    );
    const toolCache = new CjsToolCache(cacheDirectory);
    const indexes = new CjsToolIndex({
        cache: new CjsIndexCache({ directory: cacheDirectory }),
        requestTimeoutMs: Number(
            args.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        ),
        maxPayloadBytes: Number(
            args.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
        ),
    });
    const audio = new CjsToolAudioRepository({ cache: toolCache, indexes });
    const prefetch = new CjsToolPrefetch({
        indexes,
        profiles: [ new CjsToolAudioPrefetch({ audio }) ],
    });
    const report = await prefetch.Prefetch({
        target: args.target ?? "eve",
        build: args.build ?? "latest",
        client: args.client,
        profiles: args.profile ?? args._[0] ?? "audio",
        concurrency: args.concurrency ?? 4,
        refresh: args.refresh === true,
    });

    process.stdout.write(`${JSON.stringify(report)}\n`);
}

function printHelp()
{
    process.stdout.write(`CarbonEngineJS exact-build cache prefetch

Usage:
  cjs-tools-prefetch [audio] [--target eve] [--build latest] [--cache <directory>]

Options:
  --profile <names>       Comma-separated prefetch profiles; default: audio
  --target <target>       Public tools-core target; default: eve
  --build <build>         Friendly or exact build; default: latest
  --client <client>       Optional provider client/build selector
  --cache <path>          Shared tools cache root
  --concurrency <number>  Parallel resource reads from 1 to 64; default: 4
  --request-timeout-ms <number>
                          Per-request/body deadline; default: 300000
  --max-payload-bytes <number>
                          Per-resource byte ceiling; default: 536870912
  --refresh               Replace valid cached payloads from the source
  --help                  Show this help

Profiles produce explicit app:/ or res:/ paths. Each payload is acquired and
validated through the normal exact-build index cache.
`);
}
