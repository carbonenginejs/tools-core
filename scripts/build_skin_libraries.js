// Builds exact-source offline SKIN and SKINR JSON libraries from one prepared
// static-data database. The generated files use the shared custom cache layout.
//
// Usage:
//   npm run build:skins -- [--cache <dir>] [--build <id|latest>]
//     [--target <eve>] [--version <v1>] [--sde-version <v1>]
//     [--auto-prepare]
import { CjsToolCache } from "../src/cache/index.js";
import { CjsSdeRepository } from "../src/sde/index.js";
import { CjsToolSkin } from "../src/skin/index.js";

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

        if (!flag.startsWith("--"))
        {
            throw new Error(`Unknown argument: ${flag}`);
        }

        const value = argv[++index];

        if (value === undefined)
        {
            throw new Error(`Missing value for ${flag}`);
        }

        const name = flag.slice(2).replace(/-([a-z])/gu, (match, letter) =>
            letter.toUpperCase());

        if (!Object.hasOwn(options, name))
        {
            throw new Error(`Unknown argument: ${flag}`);
        }

        options[name] = value;
    }

    return options;
}

async function Main(argv)
{
    const options = ParseArguments(argv);

    if (options.help)
    {
        console.log("build_skin_libraries [--cache <dir>] [--build <id|latest>] [--target <eve>] [--version <v1>] [--sde-version <v1>] [--auto-prepare]");
        console.log("Writes skin_<version>.json and skinr_<version>.json to the shared exact-build custom cache.");

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
        const libraries = await CjsToolSkin.buildAllFromSource(source);
        const identity = {
            game: source.game,
            provider: source.provider,
            build: source.build,
            version: options.version,
        };
        const skinArtifacts = await cache.WriteCustomLibrary({
            ...identity,
            name: "skin",
        }, libraries.skin);
        const skinrArtifacts = await cache.WriteCustomLibrary({
            ...identity,
            name: "skinr",
        }, libraries.skinr);

        console.log(JSON.stringify({
            target: source.target,
            game: source.game,
            provider: source.provider,
            build: source.build,
            skin: {
                path: skinArtifacts.jsonPath,
                gzipPath: skinArtifacts.gzipPath,
                jsonBytes: skinArtifacts.jsonBytes,
                gzipBytes: skinArtifacts.gzipBytes,
                skins: Object.keys(libraries.skin.skins).length,
                materials: Object.keys(libraries.skin.skinMaterials).length,
                licenses: Object.keys(libraries.skin.skinLicenses).length,
            },
            skinr: {
                path: skinrArtifacts.jsonPath,
                gzipPath: skinrArtifacts.gzipPath,
                jsonBytes: skinrArtifacts.jsonBytes,
                gzipBytes: skinrArtifacts.gzipBytes,
                components: Object.keys(libraries.skinr.components).length,
                componentLicenses: Object.keys(libraries.skinr.componentLicenses).length,
                shipTypes: Object.keys(libraries.skinr.typesToSlotConfigurations).length,
            },
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
