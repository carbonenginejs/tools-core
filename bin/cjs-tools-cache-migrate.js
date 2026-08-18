#!/usr/bin/env node
/**
 * Moves a cache from the game/provider layout to the target layout.
 *
 *   games/<game>/providers/<provider>/builds/<build>/   ->  targets/<target>/builds/<build>/
 *   custom/games/<game>/providers/<provider>/builds/... ->  custom/targets/<target>/builds/...
 *
 * Target is the identity; game and provider are things a target has. The old
 * layout separated the four targets only by accident - Eve+ccp, Frontier+ccp,
 * Eve+serenity and Eve+infinity happen to be distinct pairs, and nothing
 * enforced that they would stay so.
 *
 * Usage:
 *   node bin/cjs-tools-cache-migrate.js
 *   node bin/cjs-tools-cache-migrate.js --apply
 *
 * **Reports only, unless `--apply` is given.**
 *
 * ResFiles is untouched. It is content-addressed and carries no identity in its
 * paths, which is why splitting one provider into two cost no downloads and why
 * this migration cannot cost any either: the expensive half does not
 * move. What moves is indexes and prepared SDEs - cheap to re-acquire, but
 * pointless to re-acquire.
 *
 * Directories are moved rather than copied, and a destination that already
 * exists is left alone and reported. A rename within one volume is atomic per
 * directory, so an interrupted run leaves every directory either moved or not,
 * and re-running finishes the job.
 */
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { CjsToolCache, CjsToolIndex } from "../src/index.js";
import { parseArguments } from "../src/indexing/cli/parseArguments.js";
import { LoadToolEnv } from "../src/env.js";

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

    LoadToolEnv(args.env);

    if (args.help)
    {
        process.stdout.write(
            "cjs-tools-cache-migrate [--cache <directory>] [--apply]\n\n"
            + "Moves games/<game>/providers/<provider>/builds to targets/<target>/builds.\n"
            + "Reports only unless --apply is given.\n",
        );

        return;
    }

    const cache = new CjsToolCache(args.cache ?? undefined);
    const index = new CjsToolIndex({ cache: undefined });
    const apply = args.apply === true;

    // The registry is the only thing that may say which target a pair is. A
    // pair it does not know is reported and left in place: a directory named
    // after a coincidence is what this migration exists to remove, so inventing
    // one here would be self-defeating.
    const targets = new Map();

    for (const entry of index.ListTargets())
    {
        targets.set(`${String(entry.game).toLowerCase()}/${String(entry.provider).toLowerCase()}`, entry.id);
    }

    process.stdout.write(`cache ${cache.directory}\n`);

    const moves = [
        ...await Plan(path.join(cache.directory, "games"), path.join(cache.directory, "targets"), targets),
        ...await Plan(
            path.join(cache.directory, "custom", "games"),
            path.join(cache.directory, "custom", "targets"),
            targets,
        ),
    ];

    if (!moves.length)
    {
        process.stdout.write("nothing to migrate\n");

        return;
    }

    let moved = 0;
    let skipped = 0;

    for (const move of moves)
    {
        if (move.reason)
        {
            process.stdout.write(`  skip ${move.from} - ${move.reason}\n`);
            skipped += 1;
            continue;
        }

        process.stdout.write(`  ${apply ? "move" : "would move"} ${move.pair} -> ${move.target}/${move.build}\n`);

        if (!apply) continue;

        try
        {
            // rename does not create the destination's parent, and on the first
            // build of a target there is none.
            await mkdir(path.dirname(move.to), { recursive: true });
            await rename(move.from, move.to);
            moved += 1;
        }
        catch (error)
        {
            // EXDEV would mean the two halves are on different volumes, which
            // they are not: both are inside one cache root.
            process.stdout.write(`  FAILED ${move.from}: ${error?.message ?? error}\n`);
            skipped += 1;
        }
    }

    if (!apply)
    {
        process.stdout.write("\nreporting only - pass --apply to move them\n");

        return;
    }

    await PruneEmpty(path.join(cache.directory, "games"));
    await PruneEmpty(path.join(cache.directory, "custom", "games"));

    process.stdout.write(`\nmoved ${moved}, skipped ${skipped}\n`);
}

/** Lists the per-build directories under one games root and where each goes. */
async function Plan(gamesRoot, targetsRoot, targets)
{
    const moves = [];

    for (const game of await Directories(gamesRoot))
    {
        const providersRoot = path.join(gamesRoot, game, "providers");

        for (const provider of await Directories(providersRoot))
        {
            const pair = `${game.toLowerCase()}/${provider.toLowerCase()}`;
            const target = targets.get(pair);
            const buildsRoot = path.join(providersRoot, provider, "builds");

            for (const build of await Directories(buildsRoot))
            {
                const from = path.join(buildsRoot, build);
                const to = path.join(targetsRoot, target ?? "", "builds", build);

                if (!target)
                {
                    moves.push({ from, reason: `no target for ${pair}` });
                    continue;
                }

                if (await Exists(to))
                {
                    moves.push({ from, reason: `${target}/${build} already migrated` });
                    continue;
                }

                moves.push({ from, to, pair, target, build });
            }
        }
    }

    return moves;
}

async function Directories(directory)
{
    try
    {
        const entries = await readdir(directory, { withFileTypes: true });

        return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    }
    catch (error)
    {
        if (error?.code === "ENOENT") return [];

        throw error;
    }
}

async function Exists(target)
{
    try
    {
        await stat(target);

        return true;
    }
    catch
    {
        return false;
    }
}

/** Removes the old tree once it holds nothing but empty directories. */
async function PruneEmpty(root)
{
    if (!await Exists(root)) return;

    const remaining = [];

    for (const game of await Directories(root))
    {
        for (const provider of await Directories(path.join(root, game, "providers")))
        {
            const builds = await Directories(path.join(root, game, "providers", provider, "builds"));

            if (builds.length) remaining.push(`${game}/${provider}`);
        }
    }

    if (remaining.length)
    {
        process.stdout.write(`kept ${root} - still holds ${remaining.join(", ")}\n`);

        return;
    }

    await rm(root, { recursive: true, force: true });
    process.stdout.write(`removed empty ${root}\n`);
}
