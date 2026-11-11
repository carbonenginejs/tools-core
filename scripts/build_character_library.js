import path from "node:path";
import { CjsToolCache } from "../src/cache/index.js";
import { CjsToolIndexCache, CjsToolIndex } from "../src/indexing/index.js";
import { CjsToolCharacter, CjsToolCharacterRepository } from "../src/character/index.js";
import { CjsToolLibraryArtifact } from "../src/library/index.js";
import { LoadToolEnv } from "../src/env.js";

const HELP = `Usage:
  node scripts/build_character_library.js --cache <cache-dir> --build <id> [--target <name>] [--out <library.json>]

Builds one exact build's character library from its files, through the runtime's character library builder, and
writes it to the shared custom cache (character_v1.json, with its .json.gz sibling), where the service reads it.

Options:
  --cache <dir>     Tool cache root holding the build's index and files.
  --build <id>      Exact numeric source build.
  --target <name>   Audited library target; defaults to eve.
  --out <file>      Also write the library JSON (and its .json.gz sibling) here.
  --compact         Emit compact JSON for --out.
  --env <file>      Optional .env to load before the cache is opened.
  --help, -h        Show this help.

A running service keeps its loaded library: request /<target>/<build>/character/library.json?refresh=1 after building.
`;

await Main(process.argv.slice(2)).catch(error =>
{
    process.stderr.write(`build-character-library: ${error.message}\n`);
    process.exitCode = 1;
});

async function Main(argv)
{
    const options = ParseArgs(argv);
    if (options.help)
    {
        process.stdout.write(HELP);
        return;
    }
    if (!options.cache || !options.build) throw new Error("--cache and --build are required");

    // The cache root can come from .env, so it is loaded before any cache is constructed.
    LoadToolEnv(options.env);
    const target = new CjsToolCharacter().ResolveTarget({ target: options.target ?? "eve" });
    const cache = new CjsToolCache(path.resolve(options.cache));
    const indexes = new CjsToolIndex({ cache: new CjsToolIndexCache({ cache }) });
    const library = await new CjsToolCharacterRepository({ cache, indexes }).OpenTarget(target.id, options.build, { refresh: true });

    if (options.out)
    {
        const artifact = await CjsToolLibraryArtifact.write(path.resolve(options.out), library.GetValues(), { compact: options.compact });
        process.stdout.write(`${artifact.jsonPath}\n`);
    }
    const counts = Object.entries(library.GetValues().sourceNames).map(([ kind, names ]) => `${kind} ${names.length}`);
    process.stdout.write(`character library ${target.id} ${options.build}: ${counts.join(", ")}\n`);
}

function ParseArgs(argv)
{
    const options = { compact: false };
    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];
        if (argument === "--help" || argument === "-h") options.help = true;
        else if (argument === "--compact") options.compact = true;
        else if ([ "--cache", "--build", "--target", "--out", "--env" ].includes(argument))
        {
            const value = argv[++index];
            if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
            options[argument.slice(2)] = value;
        }
        else throw new Error(`Unknown argument: ${argument}`);
    }
    return options;
}
