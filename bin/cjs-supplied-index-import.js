#!/usr/bin/env node

/**
 * Copies an installed client's resource indexes in, for a target that supplies
 * them rather than discovering them from an app file index.
 *
 * EVE Frontier is the case this exists for: its binaries host answers 401 to
 * every hashed payload, `resfileindex.txt` among them, while every resource
 * that index names is served publicly. Whoever has the client has the index -
 * so this reads it from there, and nothing else about the target changes.
 *
 * ## The build comes from the client, not from a person
 *
 * `start.ini` in the client folder carries `build = <n>`, which is the number
 * the index belongs to. Typing it by hand is the one part of this that can be
 * silently wrong: an index filed under a build it did not come from still
 * resolves, because resources are content-addressed, and quietly answers for
 * files that build never had. So it is read, and `--build` exists only for a
 * drop that arrived without a `start.ini`.
 *
 * A shared cache holds one folder per client - `<shared>/tq`, `<shared>/sisi`,
 * `<shared>/stillness` - which is what `localFolder` on each client profile
 * names. Pass `--shared-cache` and the target's client is found in it, or pass
 * `--dir` and point straight at the folder.
 */

import fs from "node:fs/promises";
import path from "node:path";

import {
    CjsToolIndexSuppliedStore,
    CjsToolIndexTargetProfileRegistry,
    resolveDataRoot,
} from "../src/index.js";

const HELP = `Usage:
  cjs-supplied-index-import --target <target> --shared-cache <directory>
  cjs-supplied-index-import --target <target> --dir <client directory>

Options:
  --target <target>     Tool target (default: frontier)
  --shared-cache <dir>  A client shared cache; the target's client folder is
                        found inside it
  --dir <dir>           The client folder itself, holding start.ini and
                        resfileindex.txt
  --client <id>         Which client, when the target publishes more than one
  --build <n>           Use this build instead of the one in start.ini. For a
                        drop with no start.ini; otherwise leave it alone
  --data <path>         Persistent local data root (default: ./data.local)
  --replace             Overwrite the build if it is already supplied
  --dry-run             Say what would be copied and write nothing
  --help, -h            Show this help
`;

async function Main(argv)
{
    const options = ParseArgs(argv);

    if (options.help)
    {
        process.stdout.write(HELP);

        return;
    }

    if (!options.dir && !options.sharedCache)
    {
        throw new Error("--shared-cache or --dir is required");
    }

    const profile = new CjsToolIndexTargetProfileRegistry().Get(options.target);
    const directory = options.dir
        ? path.resolve(options.dir)
        : path.join(path.resolve(options.sharedCache), ResolveClientFolder(profile, options.client));

    if (profile.indexSource !== "supplied")
    {
        // Importing one would be inert: the target reads its index from the app
        // file index and would never look here.
        throw new Error(
            `Target ${profile.target} discovers its resource index from its app`
            + " file index; nothing reads a supplied one",
        );
    }

    const build = options.build ?? await ReadBuild(path.join(directory, "start.ini"));
    const indexes = (await fs.readdir(directory))
        .filter(name => /^resfileindex(?:_[^/]+)?\.txt$/iu.test(name))
        .sort();

    if (!indexes.some(name => name.toLowerCase() === "resfileindex.txt"))
    {
        throw new Error(`No resfileindex.txt in ${directory}`);
    }

    const store = options.data
        ? new CjsToolIndexSuppliedStore(options.data)
        : new CjsToolIndexSuppliedStore(resolveDataRoot());
    const destination = store.GetDirectory(profile.target, build);

    Say(`${profile.target} build ${build}, from ${directory}`);
    for (const name of indexes) Say(`   ${name}`);

    if (options.dryRun)
    {
        Say(`dry run - would write ${destination}`);

        return;
    }

    if (await Exists(destination) && !options.replace)
    {
        throw new Error(
            `Build ${build} is already supplied: ${destination}`
            + " (pass --replace to overwrite)",
        );
    }

    await fs.mkdir(destination, { recursive: true });
    for (const name of indexes)
    {
        // Lower cased on the way in, because a client writes
        // `resfileindex_Windows.txt` and the group name is read off the file
        // name. Two casings of one index would otherwise be two groups on a
        // case-sensitive filesystem and one on this machine's.
        await fs.copyFile(
            path.join(directory, name),
            path.join(destination, name.toLowerCase()),
        );
    }

    Say(`written ${destination}`);
}

/** The folder this target's client installs into, under a shared cache. */
function ResolveClientFolder(profile, requested)
{
    const client = requested
        ? profile.ResolveClient(requested)
        : profile.ResolveClient(Object.keys(profile.clients)[0] ?? "");

    if (!client)
    {
        throw new Error(
            `Target ${profile.target} has no client ${requested}: `
            + Object.keys(profile.clients).join(", "),
        );
    }

    return client.localFolder;
}

/** The build a client is installed at. */
async function ReadBuild(startIniPath)
{
    let text;

    try
    {
        text = await fs.readFile(startIniPath, "utf8");
    }
    catch
    {
        throw new Error(
            `No start.ini at ${startIniPath}, so the build is unknown.`
            + " Pass --build if you know it",
        );
    }

    const build = text
        .split(/\r?\n/u)
        .map(line => line.match(/^\s*build\s*=\s*(\d+)\s*$/iu))
        .find(Boolean)?.[1];

    if (!build) throw new Error(`No build in ${startIniPath}`);

    return build;
}

async function Exists(target)
{
    try
    {
        await fs.access(target);

        return true;
    }
    catch
    {
        return false;
    }
}

function Say(message)
{
    process.stderr.write(`${message}\n`);
}

function ParseArgs(argv)
{
    const options = {
        build: undefined,
        client: undefined,
        data: undefined,
        dir: null,
        dryRun: false,
        help: false,
        replace: false,
        sharedCache: null,
        target: "frontier",
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
            "--build": "build",
            "--client": "client",
            "--data": "data",
            "--dir": "dir",
            "--shared-cache": "sharedCache",
            "--target": "target",
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
