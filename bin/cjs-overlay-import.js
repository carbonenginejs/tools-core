#!/usr/bin/env node

/**
 * Imports a directory of resource files as a persistent overlay.
 *
 * `CjsToolIndexOverlayStore.Import` has always done the work - copying payloads,
 * checksumming, writing `resfileindex.txt` and the manifest - but nothing
 * outside the tests could reach it, so every overlay on disk was placed by hand.
 * This is the missing front door, and it is deliberately generic: an overlay is
 * a directory of files plus a mode, and nothing about that is specific to
 * shaders, celestials, or whatever the next drop turns out to be.
 *
 * ## The mode is the whole decision
 *
 *   --mode override    OVERRIDE_ALWAYS. Resolves BEFORE the official index, so
 *                      these files win. For replacing something that ships and
 *                      is wrong for us - a dx9 template a web renderer cannot
 *                      consume.
 *
 *   --mode fallback    INSERT_WHEN_MISSING. Resolves AFTER the official index,
 *                      so these files are inert wherever the index already
 *                      answers. For filling gaps, and for insurance: ship the
 *                      whole set and a future index dropping one of them is
 *                      already covered rather than becoming a bug.
 *
 * Note what fallback means for authoring: importing files the official index
 * already serves is not wasted, it is the point - they sit dormant until the
 * day the index stops serving one. But importing files READ FROM that index is
 * useless, because anything it can serve is by definition never missing. A fill
 * overlay has to come from outside.
 *
 * The directory is laid out by logical path: `res/dx9/model/...` under the root
 * becomes `res:/dx9/model/...`.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { CjsToolIndexOverlayStore } from "../src/indexing/index.js";

const HELP = `Usage:
  cjs-overlay-import --name <name> --mode <override|fallback> --dir <directory>

Options:
  --name <name>       Overlay name, e.g. celestial-templates
  --mode <mode>       override (always wins) or fallback (only when missing)
  --dir <directory>   Root laid out by logical path; res/... becomes res:/...
  --target <target>   Tool target (default: eve)
  --game <game>       Game label (default: Eve)
  --provider <id>     Provider id recorded for the payloads (default: ccp)
  --builds <list>     Comma-separated builds, or * for any (default: *)
  --purpose <text>    Recorded in the manifest's provenance
  --source-url <url>  Where these payloads can be re-fetched from. Record it:
                      an overlay without one cannot be rebuilt or verified.
  --source-build <b>  The build the payloads came from, if known
  --data <path>       Persistent local overlay root (default: ./data.local)
  --replace           Replace an overlay of this name if one exists
  --dry-run           List what would be imported and write nothing
  --help, -h          Show this help
`;

async function Main(argv)
{
    const options = ParseArgs(argv);

    if (options.help)
    {
        process.stdout.write(HELP);

        return;
    }

    for (const required of [ "name", "mode", "dir" ])
    {
        if (!options[required]) throw new Error(`--${required} is required`);
    }

    if (![ "override", "fallback" ].includes(options.mode))
    {
        throw new Error(`--mode must be override or fallback, not ${options.mode}`);
    }

    const root = path.resolve(options.dir);
    const entries = await Collect(root);

    if (!entries.length) throw new Error(`No files found under ${root}`);

    const byteLength = entries.reduce((total, entry) => total + entry.byteLength, 0);

    Say(`${entries.length} files, ${(byteLength / 1048576).toFixed(1)} MB`);
    Say(`${options.name} (${options.mode === "override" ? "OVERRIDE_ALWAYS" : "INSERT_WHEN_MISSING"})`);

    if (options.dryRun)
    {
        for (const entry of entries.slice(0, 20)) Say(`   ${entry.logicalPath}`);
        if (entries.length > 20) Say(`   ... and ${entries.length - 20} more`);
        Say("dry run - nothing written");

        return;
    }

    // Takes the data root directly, not an options bag: overlays are persistent
    // local data, not cache, and live under `data.local/games/<target>/overlays`.
    const store = options.data
        ? new CjsToolIndexOverlayStore(options.data)
        : new CjsToolIndexOverlayStore();

    const request = {
        target: options.target,
        name: options.name,
        mode: options.mode,
        game: options.game,
        provider: options.provider,
        builds: options.builds.split(",").map(entry => entry.trim()).filter(Boolean),
        sourceDirectory: root,
        entries: entries.map(({ logicalPath, location }) => ({ logicalPath, location })),
        provenance: {
            purpose: options.purpose ?? null,
            // Where the bytes came from, and where they could be got again.
            // `importedFrom` is a path on one machine and stops meaning
            // anything the moment the overlay leaves it; `sourceUrl` and
            // `sourceBuild` are what let someone else re-acquire or verify the
            // contents. The two overlays that predate this record neither, so
            // `legacy-gles` now points at a local cache directory that no
            // longer exists anywhere, and its 1806 files cannot be rebuilt.
            importedFrom: root,
            ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
            ...(options.sourceBuild ? { sourceBuild: options.sourceBuild } : {}),
            builtBy: "cjs-overlay-import"
        }
    };

    // `Replace` because `Import` refuses to overwrite an existing overlay -
    // the right default for a one-way operation, the wrong one for a drop you
    // are iterating on. `Replace` falls back to `Import` when none exists.
    const result = options.replace
        ? await store.Replace(request)
        : await store.Import(request);

    process.stdout.write(`${JSON.stringify({
        name: options.name,
        mode: options.mode,
        target: options.target,
        rowCount: result?.rowCount ?? entries.length,
        byteLength
    }, null, 2)}\n`);
}

/** Every file under the root, addressed by its path relative to it. */
async function Collect(root)
{
    const entries = [];

    const Walk = async (current) =>
    {
        for (const item of await fs.readdir(current, { withFileTypes: true }))
        {
            // Dot directories are editor and VCS noise, never payload.
            if (item.name.startsWith(".")) continue;

            const full = path.join(current, item.name);

            if (item.isDirectory())
            {
                await Walk(full);
                continue;
            }

            const location = path.relative(root, full).split(path.sep).join("/");
            const stat = await fs.stat(full);

            entries.push({
                // Lower cased because the source mixes case freely and the
                // resource layer addresses in lower case; an overlay recorded
                // under a capitalised path silently never matches.
                logicalPath: `res:/${location}`.toLowerCase(),
                location,
                byteLength: stat.size
            });
        }
    };

    await Walk(root);
    entries.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));

    return entries;
}

function Say(message)
{
    process.stderr.write(`${message}\n`);
}

function ParseArgs(argv)
{
    const options = {
        builds: "*",
        data: undefined,
        dir: null,
        dryRun: false,
        game: "Eve",
        help: false,
        mode: null,
        name: null,
        provider: "ccp",
        purpose: undefined,
        replace: false,
        sourceBuild: undefined,
        sourceUrl: undefined,
        target: "eve"
    };

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];

        if (argument === "--help" || argument === "-h")
        {
            options.help = true;
            continue;
        }

        if (argument === "--dry-run")
        {
            options.dryRun = true;
            continue;
        }

        if (argument === "--replace")
        {
            options.replace = true;
            continue;
        }

        const name = ({
            "--builds": "builds",
            "--data": "data",
            "--dir": "dir",
            "--game": "game",
            "--mode": "mode",
            "--name": "name",
            "--provider": "provider",
            "--purpose": "purpose",
            "--source-build": "sourceBuild",
            "--source-url": "sourceUrl",
            "--target": "target"
        })[argument];

        if (!name) throw new Error(`Unknown option ${argument}`);

        const value = argv[++index];

        if (value === undefined) throw new Error(`${argument} requires a value`);

        options[name] = value;
    }

    return options;
}

Main(process.argv.slice(2)).catch((error) =>
{
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
});
