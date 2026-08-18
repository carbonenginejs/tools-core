/**
 * Where the things that must survive a cache wipe live.
 *
 * There are two stores, and the difference is not size, it is whether losing it
 * costs a download or costs the fact itself:
 *
 * | Store | Holds | Losing it |
 * | --- | --- | --- |
 * | cache (`CJS_TOOL_CACHE`) | ResFiles, per-build indexes, prepared SDEs | a download |
 * | data (`CJS_TOOL_DATA`) | the build ledger, build policy, persistent overlays | the fact |
 *
 * Everything in the cache can be re-acquired from upstream, which is what makes
 * `cjs-tools-cache-prune` safe to run. Nothing in the data root can: a record of
 * which builds we have seen cannot be rebuilt by downloading, because upstream
 * publishes what exists *now* and build numbers cannot be enumerated. A pruned
 * build that was never written down is not pruned, it is forgotten.
 *
 * The data root already existed for persistent overlays, which live outside the
 * disposable cache for the same reason. This names it, gives it a variable, and
 * puts the ledger and the policy in it.
 *
 * Resolution mirrors the cache root exactly:
 *
 *     explicit argument -> CJS_TOOL_DATA -> <package>/data.local
 *
 * The default is package-relative rather than cwd-relative, deliberately: this
 * is the store whose whole purpose is to still be there later, so it must not
 * move with the shell the way the cache root's default does.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { LoadToolEnv } from "../env.js";

/** The environment variable an operator sets to move the durable store. */
export const DATA_ROOT_VARIABLE = "CJS_TOOL_DATA";

const PACKAGE_DIRECTORY = fileURLToPath(new URL("../..", import.meta.url));

/** The durable store's default, beside the package rather than the shell. */
export const DEFAULT_DATA_DIRECTORY = path.join(PACKAGE_DIRECTORY, "data.local");

/**
 * Resolves the durable data root.
 *
 * @param {String} [directory] - an explicit root, which always wins
 * @param {Object} [options]
 * @param {Object} [options.env] - environment to read, for tests
 * @returns {String} an absolute path
 */
export function resolveDataRoot(directory, options = {})
{
    if (!options.env) LoadToolEnv();

    const env = options.env ?? process.env;
    const explicit = Normalize(directory);

    if (explicit) return path.resolve(explicit);

    const configured = Normalize(env[DATA_ROOT_VARIABLE]);

    if (configured) return path.resolve(configured);

    return DEFAULT_DATA_DIRECTORY;
}

function Normalize(value)
{
    if (value === undefined || value === null) return null;

    const text = String(value).trim();

    return text.length ? text : null;
}
