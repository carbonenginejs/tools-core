// Builds one exact-source offline weapon JSON library from the prepared SDE.
//
// Usage:
//   npm run build:weapons -- [--cache <dir>] [--build <id|latest>]
//     [--target <eve>] [--version <v1>] [--sde-version <v1>]
//     [--auto-prepare]
import { CjsToolCache } from "../src/cache/index.js";
import { CjsSdeRepository } from "../src/sde/index.js";
import { CjsToolWeapon } from "../src/weapon/index.js";

function ParseArguments(argv)
{
    const options = {
        autoPrepare: false,
        build: "latest",
        cache: undefined,
        sdeVersion: "v1",
        target: "eve",
        version: "v1",
    };

    for (let index = 0; index < argv.length; index++)
    {
        const flag = argv[index];

        if (flag === "--help" || flag === "-h")
        {
            options.help = true;
            continue;
        }

        if (flag === "--auto-prepare")
        {
            options.autoPrepare = true;
            continue;
        }

        if (!flag.startsWith("--")) throw new Error(`Unknown argument: ${flag}`);

        const value = argv[++index];

        if (value === undefined) throw new Error(`Missing value for ${flag}`);

        const name = flag.slice(2).replace(/-([a-z])/gu, (match, letter) =>
            letter.toUpperCase());

        if (!Object.hasOwn(options, name)) throw new Error(`Unknown argument: ${flag}`);

        options[name] = value;
    }

    return options;
}

async function Main(argv)
{
    const options = ParseArguments(argv);

    if (options.help)
    {
        console.log("build_weapon_library [--cache <dir>] [--build <id|latest>] [--target <eve>] [--version <v1>] [--sde-version <v1>] [--auto-prepare]");
        console.log("Writes weapons_<version>.json and .json.gz to the exact-build custom cache.");

        return 0;
    }

    const cache = options.cache === undefined
        ? new CjsToolCache()
        : new CjsToolCache(options.cache);
    const repository = new CjsSdeRepository({
        autoPrepare: options.autoPrepare,
        cache,
        version: options.sdeVersion,
    });

    try
    {
        const source = await repository.OpenTarget(options.target, options.build);
        const library = await CjsToolWeapon.buildFromSource(source);
        const artifacts = await cache.WriteCustomLibrary({
            game: source.game,
            provider: source.provider,
            build: source.build,
            name: "weapons",
            version: options.version,
        }, library);

        console.log(JSON.stringify({
            target: source.target,
            game: source.game,
            provider: source.provider,
            build: source.build,
            path: artifacts.jsonPath,
            gzipPath: artifacts.gzipPath,
            jsonBytes: artifacts.jsonBytes,
            gzipBytes: artifacts.gzipBytes,
            weaponTypes: Object.keys(library.types).length,
            ammunitionTypes: Object.keys(library.ammunition).length,
            projectileGraphics: Object.keys(library.projectiles).length,
        }, null, 2));

        return 0;
    }
    finally
    {
        await repository.Close();
    }
}

try
{
    process.exitCode = await Main(process.argv.slice(2));
}
catch (error)
{
    console.error(error.message);
    process.exitCode = 1;
}

