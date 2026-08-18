/**
 * Local configuration, loaded from `.env` by every tool that starts up.
 *
 * The service already did this for its EVE SSO settings; nothing else did, so a
 * setting an operator wrote once applied to one binary. Anything an operator
 * configures per machine belongs here — most importantly the cache root, which
 * otherwise defaults to a path derived from the working directory and follows
 * the shell around.
 *
 * ## Two files, deliberately
 *
 * A tool is run from wherever it is convenient, and `.env` beside the shell is
 * not the same file as `.env` beside the package. Both are read: the working
 * directory first so a per-run override is possible, then the package root so a
 * setting made once keeps working when the tool is invoked from elsewhere. This
 * is the whole point — a configuration that only works from one directory has
 * the same failure as the default it was meant to fix.
 *
 * Values already in the environment always win. An operator exporting a
 * variable, or CI setting one, is being explicit and a file must not overrule
 * that.
 *
 * Loading is idempotent and happens once per process.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PACKAGE_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));

let loaded = false;

/**
 * Loads `.env`, at most once per process.
 *
 * @param {String} [file] - an explicit env file, which is read instead
 * @param {Object} [options]
 * @param {String} [options.cwd] - working directory, for tests
 * @param {Boolean} [options.force] - reload even if already loaded, for tests
 * @returns {Array<String>} the files actually read
 */
export function LoadToolEnv(file, options = {})
{
    if (loaded && !options.force) return [];

    loaded = true;

    const cwd = options.cwd ?? process.cwd();
    const candidates = file
        ? [ path.resolve(String(file)) ]
        : [ path.resolve(cwd, ".env"), path.join(PACKAGE_DIRECTORY, ".env") ];
    const read = [];

    for (const candidate of Unique(candidates))
    {
        if (LoadOne(candidate)) read.push(candidate);
    }

    return read;
}

/** Resets the once-per-process guard. Tests only. */
export function ResetToolEnv()
{
    loaded = false;
}

function LoadOne(target)
{
    // `process.loadEnvFile` overwrites what is already set, which is the
    // opposite of what a config file should do, so the existing environment is
    // captured and restored over the top.
    if (typeof process.loadEnvFile !== "function") return false;

    const before = { ...process.env };

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

        return false;
    }

    for (const [ key, value ] of Object.entries(before))
    {
        if (value !== undefined) process.env[key] = value;
    }

    return true;
}

function Unique(values)
{
    return [ ...new Set(values.map(value => path.resolve(value))) ];
}
