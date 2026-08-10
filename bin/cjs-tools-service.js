#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
    CjsIndexCache,
    CjsIndexOverlayStore,
    CjsToolAudioPrefetch,
    CjsToolAudioRepository,
    CjsToolIndex,
    CjsToolPrefetch,
    CjsSdeRepository,
    CjsToolCache,
    CjsToolHttpProxy,
    CjsToolSofRepository,
    TOOLS_SERVICE_PROTOCOL,
    TOOLS_SERVICE_PROTOCOL_VERSION,
} from "../src/index.js";
import { CjsToolCharacterRepository } from "../src/character/index.js";
import { CjsToolEsiClient, CjsToolEveSso, CjsToolTokenFile } from "../src/auth/index.js";
import { parseArguments } from "../src/indexing/cli/parseArguments.js";

/**
 * Fixed so an OAuth redirect_uri can be registered against it. EVE SSO matches
 * the callback exactly, so an ephemeral port could never appear in one.
 * Registered callback: http://localhost:5510/v1/auth/esi/callback
 */
const DEFAULT_PORT = 5510;
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

    LoadLocalEnv(args.env);

    const host = normalizeHost(args.host ?? "127.0.0.1");
    // Default to a FIXED port, not an ephemeral one. An OAuth redirect_uri
    // must match its registration exactly, so a port that changes per run can
    // never be registered. The cost is that a second service fails to bind -
    // which is the intended behaviour: one at a time, and the collision says so.
    const port = normalizePort(args.port ?? DEFAULT_PORT);
    const cacheDirectory = path.resolve(String(args.cache ?? path.join(".cache", "tool-core")));
    const dataDirectory = path.resolve(String(
        args.data ?? path.join(packageDirectory, "data.local"),
    ));
    const toolCache = new CjsToolCache(cacheDirectory);
    const prefetchEnabled = args.prefetch !== undefined;
    // Auto-preparation (the default) performs prefetch-grade acquisition on
    // request - whole soundbanks approach 400 MiB - so those runs share the
    // prefetch deadlines and payload ceiling.
    const heavyAcquisition = prefetchEnabled
        || args.noAudioAutoPrepare !== true
        || args.noSdeAutoPrepare !== true;
    const indexes = new CjsToolIndex({
        cache: new CjsIndexCache({ directory: cacheDirectory }),
        overlays: new CjsIndexOverlayStore(dataDirectory),
        requestTimeoutMs: Number(
            args.requestTimeoutMs
            ?? (heavyAcquisition
                ? DEFAULT_PREFETCH_REQUEST_TIMEOUT_MS
                : DEFAULT_REQUEST_TIMEOUT_MS),
        ),
        maxPayloadBytes: Number(
            args.maxPayloadBytes
            ?? (heavyAcquisition
                ? DEFAULT_PREFETCH_MAX_PAYLOAD_BYTES
                : DEFAULT_MAX_PAYLOAD_BYTES),
        ),
    });
    const sde = new CjsSdeRepository({
        cache: toolCache,
        autoPrepare: args.noSdeAutoPrepare !== true,
    });
    const characters = new CjsToolCharacterRepository({ cache: toolCache, indexes });
    const musicLibraryPath = args.musicLibrary
        ? path.resolve(String(args.musicLibrary))
        : null;
    const musicDirectory = args.musicDirectory
        ? path.resolve(String(args.musicDirectory))
        : null;
    if ((musicLibraryPath === null) !== (musicDirectory === null))
    {
        throw new Error(
            "--music-library and --music-directory must be supplied together",
        );
    }
    const musicLibrary = musicLibraryPath === null
        ? null
        : JSON.parse(await fs.readFile(musicLibraryPath, "utf8"));
    const audio = new CjsToolAudioRepository({
        cache: toolCache,
        indexes,
        autoPrepare: args.noAudioAutoPrepare !== true,
        musicLibrary,
        musicDirectory,
    });
    const sof = new CjsToolSofRepository();
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

    const proxy = new CjsToolHttpProxy({
        indexes,
        sof,
        sde,
        characters,
        audio,
        auth: CreateEsiAuth(cacheDirectory, port),
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", error =>
        {
            // Now the expected collision rather than a rare one: the port is
            // fixed so a callback can be registered against it, which means a
            // second service cannot start. Say that, instead of leaving an
            // EADDRINUSE to be interpreted.
            if (error?.code === "EADDRINUSE")
            {
                reject(new Error(
                    `Tools service port ${port} is already in use - another instance is `
                    + "probably running. Run one at a time, or pass --port to use another "
                    + "(note that an OAuth callback is registered against the default).",
                ));

                return;
            }

            reject(error);
        });
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

/**
 * Builds the EVE SSO service from the environment, or null when unconfigured.
 *
 * Null is the normal state and must stay usable: the login exists only while
 * the SKINR endpoints are insider-gated, and every other route works without
 * it. When the gate lifts, unsetting CJS_ESI_CLIENT_ID turns this off with no
 * other change.
 *
 * The refresh token lands in the cache directory, which is gitignored and
 * already where this service keeps per-install state.
 */
function CreateEsiAuth(cacheDirectory, port)
{
    const clientId = String(process.env.CJS_ESI_CLIENT_ID ?? "").trim();

    if (!clientId) return null;

    const callback = String(process.env.CJS_ESI_CALLBACK ?? "").trim()
        || `http://localhost:${port}/v1/auth/esi/callback`;

    // A mismatch here is the single most common SSO failure and EVE reports it
    // only as a generic invalid_request, so it is worth catching up front.
    if (!callback.includes(`:${port}/`) && callback.startsWith("http://localhost"))
    {
        process.stderr.write(
            `Warning: CJS_ESI_CALLBACK is ${callback} but this service is on port ${port}. `
            + "EVE matches the callback exactly, so the login will fail.\n",
        );
    }

    const sso = new CjsToolEveSso({
        clientId,
        callback,
        scopes: String(process.env.CJS_ESI_SCOPES ?? "").split(/\s+/u).filter(Boolean),
    });
    const tokens = new CjsToolTokenFile({ directory: path.join(cacheDirectory, "auth") });

    return { sso, tokens, esi: new CjsToolEsiClient({ sso, tokens }) };
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

/**
 * Loads `.env` from the working directory when one is present.
 *
 * Already-set environment variables win, so a shell export or a container's
 * configuration is never overridden by a stale file left in a checkout.
 *
 * Absent is normal - the file only carries EVE SSO configuration, which is only
 * needed while the SKINR endpoints are insider-gated. process.loadEnvFile
 * arrived in Node 20.12 and this package declares >=18, so an older runtime
 * simply relies on the environment instead of failing to start.
 */
function LoadLocalEnv(file)
{
    const target = path.resolve(String(file ?? ".env"));

    if (typeof process.loadEnvFile !== "function") return;

    try
    {
        process.loadEnvFile(target);
    }
    catch (error)
    {
        // A missing file is the normal case and says nothing. Anything else is
        // worth one line, WITHOUT the contents - this file holds credentials.
        if (error?.code !== "ENOENT")
        {
            process.stderr.write(`Ignoring unreadable env file ${target}\n`);
        }
    }
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
  cjs-tools-service [--host 127.0.0.1] [--port 5510] [--cache <directory>] [--data <directory>]
    [--prefetch audio] [--target eve] [--build latest]

Options:
  --host <address>          Loopback address: 127.0.0.1 or ::1
  --port <number>           Loopback port; default 5510, zero selects any free port
  --cache <path>            Shared tools cache root
  --data <path>             Persistent local overlay root
  --prefetch [profiles]     Prepare profiles before listening; default: audio
  --env <path>              Env file to load; default .env in the working directory
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
  --no-sde-auto-prepare     Disable default on-request EVE SDE preparation
  --no-audio-auto-prepare   Disable default on-request audio-library builds
  --music-library <file>    Optional neutral music-library JSON catalog
  --music-directory <dir>   Local root containing catalog playlist/song files
  --help                    Show this help

Generated artifacts are prepared on their first request by default: the data
is forward-looking, and when a newer EVE SDE cannot be acquired the service
answers from the newest prepared SDE it has (the SDE is never guaranteed to
match the current remote game build).

The first stdout line is a JSON bootstrap record for local clients, including
ccpwgl and Blender. Requested prefetch work finishes before the listener starts.
`);
}
