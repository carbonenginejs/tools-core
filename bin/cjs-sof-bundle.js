#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

import { CjsIndexCache, CjsToolIndex } from "../src/indexing/index.js";
import { CjsToolSofBundle, CjsToolSofRepository } from "../src/sof/index.js";
import { LoadToolEnv } from "../src/env.js";

const HELP = `Usage:
  cjs-sof-bundle --dna <dna> --out <directory> [options]

Options:
  --dna <dna>            SOF DNA, for example cf1_t1:caldaribase:caldari.
  --out, -o <directory>  Bundle output directory (created when absent).
  --target <target>      Index target; default: eve.
  --build <build>        Friendly or exact build; default: latest.
  --client <client>      Optional client/build selector.
  --cache <directory>    Shared tools cache root; default: the tools-core cache.
  --raw-textures         Copy DDS payloads instead of decoding them to PNG.
  --help, -h             Show this help.

Writes one self-contained SOF bundle: runtime-sof's GPU-free carbon.document,
the geometry it references, and its textures decoded to PNG. Consumers that
cannot run Carbon shaders or decode BC7/BC5 payloads (the Blender add-ons) read
the bundle directly and never repeat SOF composition.
`;

function ReadArgValue(argv, index, flag)
{
    const value = argv[index];

    if (!value || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);

    return value;
}

function ParseArgs(argv)
{
    const options = {
        build: "latest",
        cache: null,
        client: undefined,
        dna: null,
        help: false,
        out: null,
        rawTextures: false,
        target: "eve",
    };

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];

        if (argument === "--help" || argument === "-h") options.help = true;
        else if (argument === "--raw-textures") options.rawTextures = true;
        else if (argument === "--dna") options.dna = ReadArgValue(argv, ++index, argument);
        else if (argument === "--out" || argument === "-o") options.out = ReadArgValue(argv, ++index, argument);
        else if (argument === "--target") options.target = ReadArgValue(argv, ++index, argument);
        else if (argument === "--build") options.build = ReadArgValue(argv, ++index, argument);
        else if (argument === "--client") options.client = ReadArgValue(argv, ++index, argument);
        else if (argument === "--cache") options.cache = ReadArgValue(argv, ++index, argument);
        else throw new Error(`Unknown argument: ${argument}`);
    }

    return options;
}

async function Main(argv)
{
    const options = ParseArgs(argv);

    if (options.help)
    {
        process.stdout.write(HELP);

        return 0;
    }

    if (!options.dna) throw new Error("--dna is required");

    if (!options.out) throw new Error("--out is required");

    // Loaded before the index, whose cache root can come from .env.
    LoadToolEnv(options.env);

    const root = path.resolve(options.out);
    const index = new CjsToolIndex(options.cache
        ? { cache: new CjsIndexCache({ directory: path.resolve(options.cache) }) }
        : {});
    const source = await index.OpenTarget(options.target, options.build, { client: options.client });

    process.stderr.write(`Opened ${source.target} build ${source.build}\n`);

    const catalog = await new CjsToolSofRepository().OpenSource(source);
    const bundle = new CjsToolSofBundle({
        writeFile: async (relative, bytes) =>
        {
            const destination = path.join(root, relative);

            await fs.mkdir(path.dirname(destination), { recursive: true });
            await fs.writeFile(destination, bytes);
        },
    });
    const manifest = await bundle.Write({
        catalog,
        source,
        dna: options.dna,
        convertTextures: !options.rawTextures,
    });

    process.stderr.write(
        `Wrote ${Object.keys(manifest.resources).length} resources to ${root}\n`,
    );

    for (const entry of manifest.missing)
    {
        process.stderr.write(`Missing: ${entry.logicalPath} (${entry.reason})\n`);
    }

    return 0;
}

try
{
    process.exitCode = await Main(process.argv.slice(2));
}
catch (error)
{
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
}
