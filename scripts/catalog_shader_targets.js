import fs from "node:fs";
import path from "node:path";

import { parseIndexGroup } from "../src/indexing/index.js";
import { buildShaderTargetCatalog } from "../src/shader/index.js";

const HELP = `Usage:
  node scripts/catalog_shader_targets.js --index <resfileindex.txt> --shader-target <id> --build <exact-build> --out <catalog.json>

Options:
  --index <file>          Source resfileindex for the selected exact build.
  --shader-target <id>   Audited shader target, for example frontier-webgl2.
  --build <id>           Exact numeric source build.
  --out <file>           Deterministic source-inventory JSON output.
  --generated-at <time>  Optional reproducible ISO timestamp.
  --compact              Emit compact JSON.
  --help, -h             Show this help.

This command catalogs source and planned output paths. It performs no remote
reads and does not claim that a planned CEWG package has been generated or
qualified.
`;

try
{
    const options = ParseArgs(process.argv.slice(2));

    if (options.help)
    {
        process.stdout.write(HELP);
    }
    else
    {
        for (const name of [ "index", "shaderTarget", "build", "out" ])
        {
            if (!options[name]) throw new Error(`Missing --${ToKebabCase(name)}`);
        }

        const indexPath = path.resolve(options.index);
        const outputPath = path.resolve(options.out);
        const group = parseIndexGroup(fs.readFileSync(indexPath, "utf8"), {
            root: "res",
            name: path.basename(indexPath),
            sourceUrl: `file://${indexPath.replaceAll("\\", "/")}`,
        });
        const catalog = buildShaderTargetCatalog({
            shaderTarget: options.shaderTarget,
            build: options.build,
            indexEntries: group.entries,
            generatedAt: options.generatedAt ?? null,
        });

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(
            outputPath,
            `${JSON.stringify(catalog, null, options.compact ? 0 : 2)}\n`,
            "utf8",
        );
        console.log(JSON.stringify({
            out: outputPath,
            shaderTarget: catalog.shaderTarget,
            target: catalog.target,
            build: catalog.build,
            sourceCount: catalog.sourceCount,
            outputProfile: catalog.outputProfile,
            overlay: catalog.overlay,
        }, null, 2));
    }
}
catch (error)
{
    console.error(error.message);
    process.exitCode = 1;
}

function ParseArgs(argv)
{
    const options = { compact: false };

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];

        if (argument === "--help" || argument === "-h")
        {
            options.help = true;
            continue;
        }

        if (argument === "--compact")
        {
            options.compact = true;
            continue;
        }

        if (!argument.startsWith("--"))
        {
            throw new Error(`Unknown argument: ${argument}`);
        }

        const value = argv[++index];
        if (value === undefined) throw new Error(`Missing value for ${argument}`);

        const name = argument.slice(2).replace(/-([a-z])/gu, (match, character) => character.toUpperCase());
        options[name] = value;
    }

    return options;
}

function ToKebabCase(value)
{
    return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}
