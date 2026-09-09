#!/usr/bin/env node

/**
 * Moves persistent overlays onto content-addressed payloads, and off names that
 * have a build number in them.
 *
 * Two defects, one migration, because they are the same defect seen from either
 * end - an overlay whose identity is in its NAME rather than in its CONTENTS:
 *
 *   data.local/games/eve/overlays/webgl2-3430261/res/graphics/...
 *                                 ^^^^^^^^^^^^^      ^^^^^^^^^^^
 *                                 build in the name  no content identity
 *
 * The stored payload name says nothing about the bytes, so nothing can prove one
 * unchanged and every consumer must assume it changed (`local-exact`). And the
 * overlay name says which build it was built against, so a rebuild files a
 * SECOND overlay beside the first and anything wanting "the WebGL2 shaders" has
 * to work out which of them that is.
 *
 * After migration the payload name is `<shard>/<path-fnv1>_<content-md5>` in one
 * store shared by every target, and the overlay is named `webgl2` with the build
 * where it always belonged, in `builds`. Rebuilding then REVISES that overlay
 * rather than adding to a pile.
 *
 * ## It reports unless told to apply
 *
 * Like `cjs-tools-cache-migrate` and `cjs-tools-cache-prune`, and for the same
 * reason: this rewrites the durable root, so the default has to be the one that
 * cannot cost anything.
 *
 * Payload writes are additive and idempotent - an address either is in the store
 * or is not - so an interrupted run costs a re-hash, never an overlay. The
 * mirrored `res/` tree is kept as `retired-res/` rather than deleted; reclaiming
 * it is a separate decision, taken once the migrated overlay has served.
 *
 * ## Renaming is not automatic
 *
 * `--rename` is per overlay and deliberate. Two build-pinned overlays in one
 * target cannot collapse into one name - they are different sets, and one index
 * cannot hold both - so a collision is reported and left alone rather than
 * guessed at.
 */

import path from "node:path";
import process from "node:process";

import { CjsToolIndexOverlayStore } from "../src/indexing/index.js";
import { resolveDataRoot } from "../src/cache/index.js";

const HELP = `Usage:
  cjs-overlay-migrate [--target <target>] [--name <name>] [--apply]

Options:
  --target <target>   Only this target (default: every target found)
  --name <name>       Only this overlay
  --rename <a=b>      Rename overlay <a> to <b> as it migrates, e.g.
                      --rename webgl2-3430261=webgl2. Repeatable.
  --data <path>       Persistent overlay root (default: CJS_TOOL_DATA)
  --apply             Write. Without it, this only reports.
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

    const dataRoot = options.data ?? resolveDataRoot();
    const store = new CjsToolIndexOverlayStore(dataRoot);
    const overlays = await FindOverlays(dataRoot, options);

    if (overlays.length === 0)
    {
        process.stdout.write(`No persistent overlays found under ${dataRoot}\n`);

        return;
    }

    process.stdout.write(`${options.apply ? "Migrating" : "Would migrate"} in ${dataRoot}\n\n`);

    let migrated = 0;
    let skipped = 0;

    for (const { target, name } of overlays)
    {
        const renameTo = options.rename.get(name) ?? name;
        let result;

        try
        {
            result = await store.Migrate({ target, name, renameTo, apply: options.apply });
        }
        catch (error)
        {
            process.stdout.write(`  ${target}/${name}: ${error.message}\n`);
            skipped += 1;
            continue;
        }

        if (result.alreadyMigrated && renameTo === name)
        {
            process.stdout.write(`  ${target}/${name}: already content-addressed\n`);
            skipped += 1;
            continue;
        }

        const rename = renameTo === name ? "" : ` -> ${renameTo}`;
        const bytes = `${(result.byteLength / 1024 / 1024).toFixed(1)} MiB`;
        const stored = options.apply
            ? `, ${result.written} written, ${result.reused} already stored`
            : "";

        process.stdout.write(
            `  ${target}/${name}${rename}: ${result.rowCount} rows, ${bytes}${stored}\n`,
        );
        migrated += 1;
    }

    process.stdout.write(
        `\n${migrated} overlay(s) ${options.apply ? "migrated" : "to migrate"}`
        + `, ${skipped} skipped\n`,
    );

    if (!options.apply && migrated > 0)
    {
        process.stdout.write("Re-run with --apply to write.\n");
    }
}

/** Lists every persistent overlay under the data root, target by target. */
async function FindOverlays(dataRoot, options)
{
    const fs = await import("node:fs/promises");
    const gamesDirectory = path.join(dataRoot, "games");
    const found = [];
    let targets;

    try
    {
        targets = await fs.readdir(gamesDirectory, { withFileTypes: true });
    }
    catch (error)
    {
        if (error?.code === "ENOENT") return found;
        throw error;
    }

    for (const target of targets)
    {
        if (!target.isDirectory() || (options.target && target.name !== options.target))
        {
            continue;
        }

        const overlayDirectory = path.join(gamesDirectory, target.name, "overlays");
        let names;

        try
        {
            names = await fs.readdir(overlayDirectory, { withFileTypes: true });
        }
        catch (error)
        {
            if (error?.code === "ENOENT") continue;
            throw error;
        }

        for (const entry of names)
        {
            if (!entry.isDirectory() || entry.name.startsWith(".")
                || (options.name && entry.name !== options.name))
            {
                continue;
            }

            found.push({ target: target.name, name: entry.name });
        }
    }

    return found;
}

function ParseArgs(argv)
{
    const options = { apply: false, help: false, rename: new Map() };

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];

        if (argument === "--help" || argument === "-h")
        {
            options.help = true;
        }
        else if (argument === "--apply")
        {
            options.apply = true;
        }
        else if (argument === "--rename")
        {
            const [ from, to ] = String(argv[++index] ?? "").split("=");

            if (!from || !to) throw new Error("--rename takes <from>=<to>");

            options.rename.set(from, to);
        }
        else if (argument === "--target" || argument === "--name" || argument === "--data")
        {
            options[argument.slice(2)] = argv[++index];
        }
        else
        {
            throw new Error(`Unknown option: ${argument}`);
        }
    }

    return options;
}

Main(process.argv.slice(2)).catch((error) =>
{
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
