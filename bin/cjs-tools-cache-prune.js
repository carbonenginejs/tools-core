#!/usr/bin/env node
/**
 * Prunes the resource cache down to the builds worth keeping.
 *
 * The inverse of `cjs-tools-prefetch`. Given a set of targets and builds, it
 * reads each build's indexes, unions every storage path they reference, and
 * removes everything in the cache that no kept build mentions - plus the
 * per-build sidecars of builds that are not kept.
 *
 * Usage:
 *   node bin/cjs-tools-cache-prune.js                       # every target, window 1
 *   node bin/cjs-tools-cache-prune.js --target eve --target serenity --keep-latest 2
 *   node bin/cjs-tools-cache-prune.js --target eve --keep-latest 3 --apply
 *
 * **Reports only, unless `--apply` is given.** Deleting is the whole point, so
 * the default has to be the safe one.
 *
 * The ledger of build numbers seen legitimate is written *before* anything is
 * removed, so a pruned build can be fetched again deliberately rather than
 * rediscovered.
 */
import { readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { CjsToolBuildAuthority, CjsToolIndexCache, CjsToolCache, CjsToolIndex, resolveDataRoot } from "../src/index.js";
import { parseArguments } from "../src/indexing/cli/parseArguments.js";
import { LoadToolEnv } from "../src/env.js";

/**
 * The ledger of builds seen, in the DURABLE store rather than the cache.
 *
 * It records what this prune is about to delete, and a record that lives inside
 * the thing being deleted is not a record. Nothing here can be re-acquired
 * either: upstream publishes what exists *now*, and build numbers cannot be
 * enumerated, so a pruned build that was never written down is not pruned, it
 * is forgotten.
 */
const LEDGER_NAME = "known-builds.json";

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
        printHelp();
        return;
    }

    // Collected from argv rather than parseArguments: that parser camel-cases
    // keys and assigns rather than accumulates, so `--target a --target b`
    // silently keeps only b - which for a prune means protecting one target and
    // deleting the other's files.
    const requested = repeated(process.argv.slice(2), "target");
    const keepLatest = args.keepLatest === undefined ? null : Number(args.keepLatest);
    const apply = args.apply === true;

    // `--build` is gone. Which build a target is served is a policy decision,
    // and this was the caller making it: an operator naming a build here was
    // being asked a question they had no way to answer correctly, because the
    // right answer depends on pins, holds and what has been verified — none of
    // which are visible from a command line. CjsToolBuildAuthority owns it now, and
    // the keep-set is a consequence of what is served rather than a second
    // decision taken beside it.
    //
    // `--keep-latest` survives with a narrower meaning: the retention window,
    // how many recent builds to keep behind the current one. That is an
    // operational choice about disk, not about which build is correct.
    if (repeated(process.argv.slice(2), "build").length)
    {
        throw new TypeError(
            "--build is no longer accepted. The build a target is served is decided by the "
            + "build authority, from the policy and the observation log; pin it in "
            + "build-policy.json instead, where the decision is recorded with its reason.",
        );
    }

    const cache = new CjsToolCache(args.cache ?? undefined);
    // The ledger is durable; the cache is not. See LEDGER_NAME.
    const dataDirectory = resolveDataRoot(args.data);
    // The index has to read from the same cache this run is pruning. Both arms
    // of the ternary this replaces passed `cache: undefined`, so `--cache` moved
    // the prune root and left the index reading the default one — the keep-set
    // was computed from one cache and applied to another. Content addressing
    // meant the answer was still correct; the downloads went to the wrong place.
    const index = new CjsToolIndex({ cache: new CjsToolIndexCache({ directory: cache.directory }) });

    // EVERY target, always. Resource files are content-addressed and shared, so
    // a file Serenity needs may be one Tranquility never mentions - pruning
    // against a single target deletes another target's cache without saying so.
    // `--target` narrows which builds are pinned explicitly, never which
    // targets are protected.
    const allTargets = index.ListTargets().map(entry => entry.id);
    const targets = requested.length ? requested : allTargets;
    const protectOnly = requested.length && args.onlyTargets === true;

    if (requested.length && !protectOnly)
    {
        for (const id of allTargets) if (!targets.includes(id)) targets.push(id);
    }
    const ledger = await readLedger(dataDirectory);

    // The keep-set, asked for rather than assembled here.
    //
    // Discovery is handed the *observed* build, not the resolved one:
    // ResolveTargetBuild already records an observation and applies policy on
    // its way out, so passing its decided answer back in would apply the policy
    // a second time. `observedLatest` is what upstream actually reported, which
    // is the only thing a discovery function should be saying.
    const authority = await CjsToolBuildAuthority.open({
        dataDirectory,
        discover: async (target) =>
        {
            const resolved = await index.ResolveTargetBuild(target, "latest");

            return {
                build: resolved.observedLatest ?? resolved.build,
                source: resolved.source ?? null,
                url: resolved.metadataUrl ?? null,
            };
        },
    });

    // Refuses rather than answering short, which is the behaviour this file
    // already had and argued for at every other step. It is in one place now
    // instead of being re-argued per loop.
    const keepSet = await authority.KeepSet({
        targets,
        facets: [ "resources" ],
        window: Math.max(1, keepLatest ?? 1),
        refresh: true,
    });

    for (const answer of keepSet.reasons)
    {
        // Every answer says why. A surprising build is now self-describing at
        // the point it is used rather than three files away — which is the
        // whole argument for the reasons, and a prune is exactly where a
        // surprising answer is expensive.
        console.log(`  ${answer.target}/${answer.facet}: ${answer.build} (${answer.reason ?? "no answer"})`
            + (answer.observedLatest && answer.observedLatest !== answer.build
                ? `, upstream has ${answer.observedLatest}`
                : ""));
    }

    const keep = new Set();
    const keptBuilds = [];

    for (const target of targets)
    {
        const wanted = [ ...(keepSet.builds.get(target) ?? []) ];

        for (const build of wanted)
        {
            // Fail closed. A build whose index cannot be read contributes no
            // storage paths, and pruning against a short keep-set does not prune
            // - it wipes. One unreadable index aborts the run.
            let source;
            let entries;

            try
            {
                source = await index.OpenTarget(target, build);
                entries = source.Match("res:/**");
            }
            catch (error)
            {
                // Refusing rather than skipping. A target whose index cannot be
                // read contributes nothing to the keep-set, and its files are
                // shared with every other target - so continuing would delete
                // them on the grounds that nobody claimed them.
                throw new Error(
                    `Cannot read the index for ${target} build ${build}, so its files cannot be `
                    + `protected. Refusing to prune - a target that is unreachable is not a target `
                    + `with no files. Retry when it is reachable, or pass --only-targets to prune `
                    + `against a subset deliberately.
  cause: ${error?.message ?? error}`,
                );
            }

            if (!entries.length)
            {
                throw new Error(
                    `${target} build ${build} produced no index entries. Refusing to prune against `
                    + "an empty keep-set - that would delete everything the cache holds.",
                );
            }

            let counted = 0;

            for (const entry of entries)
            {
                const storagePath = entry.record?.storagePath;

                if (!storagePath) continue;

                keep.add(path.resolve(cache.GetRemoteFilePath(storagePath)).toLowerCase());
                counted += 1;
            }

            keptBuilds.push({ target, build: String(source.build ?? build), files: counted });
            recordLedger(ledger, target, source.build ?? build);
            process.stdout.write(`keep ${target} ${source.build ?? build}: ${counted} files\n`);
        }
    }

    // Most files are shared between builds, so the resource store barely moves.
    // The reclaimable space is here: prepared SDEs and per-build indexes for
    // builds nobody keeps.
    const targetsByPath = {};

    for (const entry of index.ListTargets())
    {
        targetsByPath[`${String(entry.game).toLowerCase()}/${String(entry.provider).toLowerCase()}`] = entry.id;
    }

    const sidecars = await scanSidecars(cache.directory, targetsByPath, ledger);
    const keptByTarget = new Map();

    for (const { target, build } of keptBuilds)
    {
        if (!keptByTarget.has(target)) keptByTarget.set(target, new Set());
        keptByTarget.get(target).add(String(build));
    }

    // Only the resources facet is prunable, because only the resources facet has
    // a keep-set: `keptBuilds` is built from the resource resolution alone.
    //
    // Judging an SDE sidecar against resource builds is not a near-miss, it is
    // the wrong question. An SDE trails the client build for part of most days,
    // so the *current* prepared SDE usually sits at a build no resource keep
    // -set contains, and `--keep-latest 1 --apply` therefore deleted it. It is
    // masked right now only because the two happen to be equal on the build in
    // hand.
    //
    // Held rather than fixed with a second keep rule invented here: which SDE
    // builds are worth keeping is a policy question, and the build authority is
    // where that answer is going to live. Until then the expensive artifact is
    // the one we do not delete.
    const staleSidecars = sidecars.filter(entry =>
        entry.facet === "resources"
        && entry.target !== null
        && !(keptByTarget.get(entry.target)?.has(entry.build) ?? false));

    const heldSidecars = sidecars.filter(entry => entry.facet !== "resources");

    // Written before anything is removed: the ledger is what makes a pruned
    // build recoverable rather than forgotten, and it now records the SDE builds
    // seen on disk, which nothing tracked before.
    await writeLedger(dataDirectory, ledger);

    const resFiles = path.join(cache.directory, "ResFiles");
    const removals = [];
    let freed = 0;
    let present = 0;
    let kept = 0;

    for await (const file of walk(resFiles))
    {
        present += 1;

        if (isKept(file, keep)) { kept += 1; continue; }

        const info = await stat(file).catch(() => null);

        freed += info?.size ?? 0;
        removals.push(file);
    }

    // Referenced and present are very different numbers and confusing them is
    // the easy mistake: an index lists every file the build has, while the cache
    // holds only what was actually fetched. Reporting "125,568 referenced" alone
    // reads as though that many files are about to be kept.
    process.stdout.write(
        `\n${keptBuilds.length} build(s) kept\n`
        + `  ${keep.size} paths referenced by those builds (the index, not the cache)\n`
        + `  ${present} files present in the cache\n`
        + `  ${kept} present and referenced - kept\n`
        + `  ${removals.length} present and unreferenced - ${formatBytes(freed)} reclaimable\n`,
    );

    let sidecarBytes = 0;

    for (const entry of staleSidecars) sidecarBytes += await directorySize(entry.path);

    process.stdout.write(
        `\nsidecars: ${sidecars.length} build director(ies) on disk, `
        + `${staleSidecars.length} for builds not kept - ${formatBytes(sidecarBytes)} reclaimable\n`,
    );

    for (const entry of staleSidecars.slice(0, 8))
    {
        process.stdout.write(`  ${entry.target} ${entry.build} (${entry.facet})\n`);
    }

    if (staleSidecars.length > 8) process.stdout.write(`  ... and ${staleSidecars.length - 8} more\n`);

    // Said out loud, because a prune that quietly skips a whole facet is
    // indistinguishable from one that found nothing there.
    if (heldSidecars.length)
    {
        let heldBytes = 0;

        for (const entry of heldSidecars) heldBytes += await directorySize(entry.path);

        process.stdout.write(
            `\nheld: ${heldSidecars.length} prepared SDE(s) - ${formatBytes(heldBytes)} - `
            + "not prunable until the build authority owns which SDE builds to keep\n",
        );
    }

    if (!apply)
    {
        process.stdout.write("\nreporting only - pass --apply to remove them\n");
        return;
    }

    for (const entry of staleSidecars)
    {
        assertInside(entry.path, cache.directory);
        await rm(entry.path, { recursive: true, force: true });
    }

    for (const file of removals)
    {
        assertInside(file, resFiles);
        await rm(file, { force: true });
    }

    process.stdout.write(
        `removed ${removals.length} file(s) and ${staleSidecars.length} sidecar director(ies), `
        + `freed ${formatBytes(freed + sidecarBytes)}
`,
    );
}

/**
 * Decides whether a cached file survives, following a conversion to its source.
 *
 * A converted file is stored as `<xx>/<original-hash>.<extension>` - the source
 * file's own content address with an extension appended, and nothing else
 * changed. That is what makes conversions collectable: the derivative carries
 * the identity of what it was made from, so it is kept exactly when its source
 * is kept and removed with it, without a second index of what produced what.
 *
 * Original files carry no extension, so a dot means a derivative.
 *
 * @param {string} file Absolute cached path.
 * @param {Set<string>} keep Lower-cased paths the kept builds reference.
 * @returns {boolean} True when the file survives.
 */
function isKept(file, keep)
{
    const normalized = file.toLowerCase();

    if (keep.has(normalized)) return true;

    const extension = path.extname(normalized);

    if (!extension) return false;

    // A conversion lives or dies with the source it was made from.
    return keep.has(normalized.slice(0, -extension.length));
}

/**
 * Refuses a path that does not resolve inside the root it belongs to.
 *
 * The keep-set decides what survives, so a path escaping the cache is a bug in
 * that set rather than a file to delete. This is the last check before an rm.
 */
function assertInside(target, root)
{
    const resolved = path.resolve(target).toLowerCase();

    if (!resolved.startsWith(path.resolve(root).toLowerCase()))
    {
        throw new Error(`Refusing to remove outside the cache: ${target}`);
    }
}

/** Yields every file under a directory, skipping one that does not exist. */
async function* walk(directory)
{
    let entries;

    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries)
    {
        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) yield* walk(full);
        else if (entry.isFile()) yield full;
    }
}

/** Resolves the newest builds to keep for one target. */

/**
 * Records a build against one facet of a target.
 *
 * `latest` resolves to two independent build numbers - the client's resources
 * and its SDE, published on different schedules - so a ledger
 * with one list per target cannot say which it holds. A prepared SDE is
 * identified by its SDE build, and nothing recorded that anywhere until now.
 *
 * @param {object} ledger Ledger document.
 * @param {string} target Target id.
 * @param {string|number} build Resolved build number.
 * @param {string} facet `resources` or `sde`.
 */
function recordLedger(ledger, target, build, facet = "resources")
{
    const entry = ledger[target] ??= {};
    const list = entry[facet] ??= [];
    const value = String(build);

    if (!list.includes(value)) list.push(value);
    list.sort((a, b) => Number(b) - Number(a));
}

/**
 * Reads build numbers already on disk, so the ledger records what we have
 * rather than only what this run asked for.
 *
 * @param {string} directory Cache root.
 * @param {object} targets Map of "game/provider" to target id.
 * @param {object} ledger Ledger to fill.
 * @returns {Promise<object[]>} Sidecar directories, with their build and target.
 */
async function scanSidecars(directory, targets, ledger)
{
    const found = [];

    for (const [ root, facet ] of [ [ "custom", "sde" ], [ "games", "resources" ] ])
    {
        const gamesRoot = root === "custom" ? path.join(directory, root, "games") : path.join(directory, root);

        for (const game of await listDirectories(gamesRoot))
        {
            const providersRoot = path.join(gamesRoot, game, "providers");

            for (const provider of await listDirectories(providersRoot))
            {
                const target = targets[`${game}/${provider}`.toLowerCase()] ?? null;
                const buildsRoot = path.join(providersRoot, provider, "builds");

                for (const build of await listDirectories(buildsRoot))
                {
                    found.push({ path: path.join(buildsRoot, build), build, target, facet });

                    // Recorded even when the target cannot be mapped: knowing an
                    // SDE exists is worth more than the mapping that names it.
                    if (target) recordLedger(ledger, target, build, facet);
                }
            }
        }
    }

    return found;
}

async function listDirectories(directory)
{
    try
    {
        return (await readdir(directory, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    }
    catch { return []; }
}

async function directorySize(directory)
{
    let total = 0;

    for await (const file of walk(directory))
    {
        const info = await stat(file).catch(() => null);

        total += info?.size ?? 0;
    }

    return total;
}

async function readLedger(directory)
{
    let document;

    try { document = JSON.parse(await readFile(path.join(directory, LEDGER_NAME), "utf8")); }
    catch { return {}; }

    // An earlier ledger stored one flat array per target, before it was clear
    // that `latest` is two builds. Assigning a named facet onto an array sets a
    // property JSON.stringify discards, so the new records vanished silently -
    // migrate on read rather than write into a shape that cannot hold them.
    for (const [ target, entry ] of Object.entries(document))
    {
        if (Array.isArray(entry)) document[target] = { resources: [ ...entry ] };
    }

    return document;
}

async function writeLedger(directory, ledger)
{
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, LEDGER_NAME), JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

/**
 * Collects every occurrence of a repeatable option, comma lists included.
 *
 * @param {string[]} argv Raw arguments.
 * @param {string} name Option name.
 * @returns {string[]} Values in order.
 */
function repeated(argv, name)
{
    const values = [];

    for (let index = 0; index < argv.length; index += 1)
    {
        const token = argv[index];
        let value = null;

        if (token === `--${name}` && argv[index + 1] && !argv[index + 1].startsWith("--")) value = argv[++index];
        else if (token.startsWith(`--${name}=`) || token.startsWith(`--${name}:`)) value = token.slice(name.length + 3);

        if (value) values.push(...value.split(",").map(part => part.trim()).filter(Boolean));
    }

    return values;
}

function asList(value)
{
    if (value === undefined || value === null) return [];

    // Assigned first: the package lint reads a line opening with `return (` as a
    // method declaration and fails on its casing.
    const list = Array.isArray(value) ? value : [ value ];

    return list.map(String).filter(Boolean);
}

function formatBytes(bytes)
{
    const units = [ "B", "KB", "MB", "GB", "TB" ];
    let value = bytes;
    let unit = 0;

    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }

    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function printHelp()
{
    process.stdout.write(`Prune the resource cache to the builds worth keeping.

Which build each target is served is decided by the build authority, from the
policy and the observation log — not here. Every answer says why, and the run
prints them before it does anything.

  --target <name>     narrow the run to this target (repeatable). Every OTHER
                      target is still protected, because resource files are
                      shared between them.
  --keep-latest <n>   retention window: keep the n newest known builds per
                      target behind the current one (default 1)
  --only-targets      prune against ONLY the named targets (dangerous: any file
                      another target needs but these do not will be removed)
  --cache <dir>       cache root (default: the tool cache)
  --apply             actually remove; without it, reports only

To keep a specific build, pin it in build-policy.json in the data root. That is
a decision with a reason and a date attached, which a --build flag never was.

Builds seen are recorded in ${LEDGER_NAME} at the cache root before anything is
removed, so a pruned build can be fetched again.
`);
}
