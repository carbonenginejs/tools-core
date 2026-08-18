/**
 * Where the tool cache lives, decided in one place.
 *
 * The default is derived from the current working directory, and that has cost
 * real money twice over: a tool run from anywhere but the package root silently
 * re-downloads everything, which reads as a slow network rather than a cache
 * miss, and this machine ended up with two ResFiles stores — 61,345 files in one
 * and 23,495 in the other — holding overlapping copies of the same
 * content-addressed data.
 *
 * The default is *not* changed here. There is ~18 GB at the cwd-derived location
 * and a better default silently orphans it into a re-download, which is a
 * migration rather than a default change. What changes is that the root becomes
 * answerable: one resolution order, honoured everywhere, so an operator can
 * point every tool at one store without editing four files.
 *
 *     explicit argument -> CJS_TOOL_CACHE -> the cwd-derived default
 *
 * `CJS_TOOL_CACHE` comes from the environment or from `.env`, which every tool
 * now loads — see `src/env.js`. It is not new vocabulary: other tools in this
 * organization already read it and already told operators to set it. It simply
 * did nothing in tools-core, which is the whole of why the advice did not work.
 */
import path from "node:path";
import process from "node:process";

import { LoadToolEnv } from "../env.js";

/** The environment variable an operator sets to move every tool at once. */
export const CACHE_ROOT_VARIABLE = "CJS_TOOL_CACHE";

/** The path appended to the working directory when nothing else answers. */
export const DEFAULT_CACHE_SEGMENTS = Object.freeze([ ".cache", "tool-core" ]);

/**
 * Resolves the cache root.
 *
 * @param {String} [directory] - an explicit root, which always wins
 * @param {Object} [options]
 * @param {Object} [options.env] - environment to read, for tests
 * @param {String} [options.cwd] - working directory, for tests
 * @returns {String} an absolute path
 */
export function resolveCacheRoot(directory, options = {})
{
    // Loaded here, not only in the bins, so a library consumer constructing a
    // cache in-process gets the operator's configured root too. Idempotent, and
    // it never overrules a variable already set.
    if (!options.env) LoadToolEnv();

    const env = options.env ?? process.env;
    const cwd = options.cwd ?? process.cwd();
    const explicit = NormalizeDirectory(directory);

    if (explicit) return path.resolve(explicit);

    const configured = NormalizeDirectory(env[CACHE_ROOT_VARIABLE]);

    if (configured) return path.resolve(configured);

    return path.resolve(cwd, ...DEFAULT_CACHE_SEGMENTS);
}

/**
 * Whether a resolved root came from the working directory.
 *
 * Callers use this to say so out loud. A cache root that moves with the shell
 * is the one thing about this that surprises people, and it is invisible until
 * a 75 MB download that should have been a cache hit times out.
 */
export function isDefaultCacheRoot(resolved, options = {})
{
    const cwd = options.cwd ?? process.cwd();

    return path.resolve(resolved) === path.resolve(cwd, ...DEFAULT_CACHE_SEGMENTS);
}

function NormalizeDirectory(value)
{
    if (value === undefined || value === null) return null;

    const text = String(value).trim();

    return text.length ? text : null;
}
