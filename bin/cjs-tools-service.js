#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
    CjsIndexCache,
    CjsIndexOverlayStore,
    CjsToolCharacterRepository,
    CjsToolIndex,
    CjsSdeRepository,
    CjsToolCache,
    CjsToolHttpProxy,
    TOOLS_SERVICE_PROTOCOL,
    TOOLS_SERVICE_PROTOCOL_VERSION,
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
    const indexes = new CjsToolIndex({
        cache: new CjsIndexCache({ directory: cacheDirectory }),
        overlays: new CjsIndexOverlayStore(dataDirectory),
    });
    const sde = new CjsSdeRepository({
        cache: toolCache,
        autoPrepare: args.sdeAutoPrepare === true,
    });
    const characters = new CjsToolCharacterRepository({ cache: toolCache, indexes });
    const proxy = new CjsToolHttpProxy({ indexes, sde, characters });
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

Options:
  --host <address>   Loopback address: 127.0.0.1 or ::1
  --port <number>    Loopback port; zero selects an available port
  --cache <path>     Shared tools cache root
  --data <path>      Persistent local overlay root; never removed by cache cleanup
  --sde-auto-prepare Download a missing EVE SDE database on its first request
  --help             Show this help

The first stdout line is a JSON bootstrap record for local clients, including
ccpwgl and Blender.
`);
}
