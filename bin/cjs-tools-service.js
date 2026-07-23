#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
    CjsIndexCache,
    CjsIndexOverlayStore,
    CjsToolAudioPrefetch,
    CjsToolAudioRepository,
    CjsToolCharacterRepository,
    CjsToolIndex,
    CjsToolPrefetch,
    CjsSdeRepository,
    CjsToolCache,
    CjsToolHttpProxy,
    TOOLS_SERVICE_PROTOCOL,
    TOOLS_SERVICE_PROTOCOL_VERSION,
} from "../src/index.js";
import { parseArguments } from "../src/indexing/cli/parseArguments.js";

const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;
const DEFAULT_PREFETCH_MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;
const DEFAULT_PREFETCH_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;

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
    const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

    if (args.help)
    {
        printHelp();
        return;
    }

    const host = normalizeHost(args.host ?? "127.0.0.1");
    const port = normalizePort(args.port ?? 0);
    const cacheDirectory = path.resolve(String(args.cache ?? path.join(".cache", "tool-core")));
    const dataDirectory = path.resolve(String(
        args.data ?? path.join(packageDirectory, "data.local"),
    ));
    const toolCache = new CjsToolCache(cacheDirectory);
    const prefetchEnabled = args.prefetch !== undefined;
    const indexes = new CjsToolIndex({
        cache: new CjsIndexCache({ directory: cacheDirectory }),
        overlays: new CjsIndexOverlayStore(dataDirectory),
        requestTimeoutMs: Number(
            args.requestTimeoutMs
            ?? (prefetchEnabled
                ? DEFAULT_PREFETCH_REQUEST_TIMEOUT_MS
                : DEFAULT_REQUEST_TIMEOUT_MS),
        ),
        maxPayloadBytes: Number(
            args.maxPayloadBytes
            ?? (prefetchEnabled
                ? DEFAULT_PREFETCH_MAX_PAYLOAD_BYTES
                : DEFAULT_MAX_PAYLOAD_BYTES),
        ),
    });
    const sde = new CjsSdeRepository({
        cache: toolCache,
        autoPrepare: args.sdeAutoPrepare === true,
    });
    const characters = new CjsToolCharacterRepository({ cache: toolCache, indexes });
    const audio = new CjsToolAudioRepository({ cache: toolCache, indexes });
    let prefetchReport = null;

    if (args.prefetch !== undefined)
    {
        const prefetch = new CjsToolPrefetch({
            indexes,
            profiles: [ new CjsToolAudioPrefetch({ audio }) ],
        });

        prefetchReport = await prefetch.Prefetch({
            target: args.target ?? "eve",
            build: args.build ?? "latest",
            client: args.client,
            profiles: args.prefetch === true ? "audio" : args.prefetch,
            concurrency: args.prefetchConcurrency ?? 4,
            refresh: args.prefetchRefresh === true,
        });
        process.stderr.write(
            `Prefetch complete: ${JSON.stringify(prefetchReport)}\n`,
        );
    }

    const proxy = new CjsToolHttpProxy({ indexes, sde, characters, audio });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(port, host, resolve);
    });

    const address = server.address();

    if (!address || typeof address === "string")
    {
        throw new Error("Tools service did not expose a TCP address");
    }

    process.stdout.write(`${JSON.stringify({
        schema: "carbon.tools-service.bootstrap",
        protocol: TOOLS_SERVICE_PROTOCOL,
        protocolVersion: TOOLS_SERVICE_PROTOCOL_VERSION,
        host,
        port: address.port,
        pid: process.pid,
        cacheDirectory,
        dataDirectory,
        capabilities: proxy.capabilities,
        ...(prefetchReport ? { prefetch: prefetchReport } : {}),
    })}\n`);

    const close = () =>
    {
        server.close(async () =>
        {
            await sde.Close();
            process.exitCode = 0;
        });
    };

    process.once("SIGINT", close);
    process.once("SIGTERM", close);
}

function normalizeHost(value)
{
    const host = String(value ?? "").trim().toLowerCase();

    if (![ "127.0.0.1", "::1" ].includes(host))
    {
        throw new Error("Tools service host must be 127.0.0.1 or ::1");
    }

    return host;
}

function normalizePort(value)
{
    const port = Number(value);

    if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
    {
        throw new Error(`Invalid tools service port: ${value}`);
    }

    return port;
}

function printHelp()
{
    process.stdout.write(`CarbonEngineJS tools-core service

Usage:
  cjs-tools-service [--host 127.0.0.1] [--port 0] [--cache <directory>] [--data <directory>]
    [--prefetch audio] [--target eve] [--build latest]

Options:
  --host <address>          Loopback address: 127.0.0.1 or ::1
  --port <number>           Loopback port; zero selects an available port
  --cache <path>            Shared tools cache root
  --data <path>             Persistent local overlay root
  --prefetch [profiles]     Prepare profiles before listening; default: audio
  --prefetch-concurrency <number>
                            Parallel resource reads from 1 to 64; default: 4
  --prefetch-refresh        Replace valid cached payloads from the source
  --request-timeout-ms <number>
                            Index request/body deadline; prefetch default: 300000
  --max-payload-bytes <number>
                            Resource ceiling; prefetch default: 536870912
  --target <target>         Prefetch target; default: eve
  --build <build>           Prefetch build; default: latest
  --client <client>         Optional prefetch client/build selector
  --sde-auto-prepare        Prepare a missing EVE SDE on its first request
  --help                    Show this help

The first stdout line is a JSON bootstrap record for local clients, including
ccpwgl and Blender. Requested prefetch work finishes before the listener starts.
`);
}
