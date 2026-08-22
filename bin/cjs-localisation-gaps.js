#!/usr/bin/env node

/**
 * Lists the published types an SDE cannot name in English.
 *
 * Most types on a zh-primary target can be named from a reference target's SDE
 * by type ID - see `CjsToolLocalisation` for how that identity is corroborated -
 * but some types exist only on the zh-primary target, and for those no English
 * name exists anywhere. This produces the work list for writing them by hand,
 * and a template to write them into.
 *
 * Measured on 2026-08-16: 1995 published types on Serenity, 6299 on Infinity,
 * and 27% of Infinity's extras are also on Serenity, so one file covers both.
 *
 * ```sh
 * node bin/cjs-localisation-gaps.js --target infinity --format template > gaps.json
 * node bin/cjs-localisation-gaps.js --target serenity --format groups
 * ```
 */

import fs from "node:fs/promises";
import path from "node:path";

import { CjsToolSdeDatabase } from "../src/sde/index.js";
import { CjsToolLocalisation, ReadManualNames } from "../src/localisation/index.js";

const HELP = `Usage:
  cjs-localisation-gaps --target <target> [--reference eve] [--format <format>]

Options:
  --target <target>     Target to inspect, e.g. serenity or infinity
  --reference <target>  Target to take English names from (default: eve)
  --build <build>       Exact build (default: the newest prepared one)
  --reference-build <b> Exact reference build (default: the newest prepared one)
  --cache <path>        Cache root holding prepared databases
  --manual <path>       Existing manual name file to subtract (default: the shipped one)
  --format <format>     list (default), groups, or template
  --all                 Include unpublished types
  --help, -h            Show this help
`;

const DEFAULT_MANUAL = new URL("../src/localisation/en.json", import.meta.url);

async function Main(argv)
{
    const options = ParseArgs(argv);

    if (options.help)
    {
        process.stdout.write(HELP);

        return;
    }

    if (!options.target) throw new Error("--target is required");

    const cacheRoot = options.cache ?? path.resolve(process.cwd(), "..", ".cache", "tool-core");
    const target = await OpenTarget(cacheRoot, options.target, options.build);
    const reference = options.reference === "none"
        ? null
        : await OpenTarget(cacheRoot, options.reference, options.referenceBuild);

    const manual = ReadManualNames(await ReadJson(options.manual ?? DEFAULT_MANUAL));
    const localisation = new CjsToolLocalisation(target.source, { reference: reference?.source ?? null, manual });

    Say(`${options.target} ${target.source.build} against ${reference ? `${options.reference} ${reference.source.build}` : "no reference"}, ${manual.size} manual names`);

    const gaps = await localisation.Gaps({ publishedOnly: !options.all });

    Say(`${gaps.length} type(s) with no English name`);

    if (options.format === "groups")
    {
        const groups = await LoadGroups(target.database);
        const counts = new Map();

        for (const gap of gaps)
        {
            const group = groups.get(Number(gap.groupID));
            const label = `${gap.groupID} ${group?.name?.zh ?? group?.name?.en ?? "?"}`;

            counts.set(label, (counts.get(label) ?? 0) + 1);
        }

        for (const [ label, count ] of [ ...counts ].sort((left, right) => right[1] - left[1]))
        {
            process.stdout.write(`${String(count).padStart(6)}  ${label}\n`);
        }
    }
    else if (options.format === "template")
    {
        // A file the manual reader accepts as-is: fill in `en` and delete the
        // rest. `zh` is carried so whoever writes the English can see what they
        // are naming without opening the database.
        const document = {};

        for (const gap of gaps)
        {
            document[gap.typeID] = { en: "", note: `${options.target} only`, zh: gap.names.zh ?? null };
        }

        process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    }
    else
    {
        for (const gap of gaps)
        {
            process.stdout.write(`${gap.typeID}\t${gap.groupID}\t${gap.names.zh ?? ""}\n`);
        }
    }

    await target.database.Close();
    if (reference) await reference.database.Close();
}

/** Opens a prepared database, newest build when none is named. */
async function OpenTarget(cacheRoot, target, build)
{
    const root = path.join(cacheRoot, "custom", "targets", target, "builds");
    const chosen = build ?? (await fs.readdir(root))
        .filter(entry => /^\d+$/u.test(entry))
        .sort((left, right) => Number(right) - Number(left))[0];

    if (!chosen) throw new Error(`No prepared build for ${target} under ${root}`);

    const filePath = path.join(root, chosen, "sde_v1.sqlite");
    const database = await CjsToolSdeDatabase.open(filePath, { readOnly: true });

    return {
        database,
        source: {
            target,
            build: chosen,
            Table: name => database.Table(name)
        }
    };
}

async function LoadGroups(database)
{
    const table = database.Table("groups");
    const groups = new Map();
    let offset = 0;

    for (;;)
    {
        const page = await table.List({ limit: 1000, offset });

        if (!page.length) break;

        for (const record of page) groups.set(Number(record.id), record.payload ?? record);

        offset += page.length;
    }

    return groups;
}

async function ReadJson(location)
{
    try
    {
        return JSON.parse(await fs.readFile(location, "utf8"));
    }
    catch (error)
    {
        if (error.code === "ENOENT") return {};

        throw error;
    }
}

function Say(message)
{
    process.stderr.write(`${message}\n`);
}

function ParseArgs(argv)
{
    const options = {
        all: false,
        build: undefined,
        cache: undefined,
        format: "list",
        help: false,
        manual: undefined,
        reference: "eve",
        referenceBuild: undefined,
        target: null
    };

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];

        if (argument === "--help" || argument === "-h")
        {
            options.help = true;
            continue;
        }

        if (argument === "--all")
        {
            options.all = true;
            continue;
        }

        const name = ({
            "--build": "build",
            "--cache": "cache",
            "--format": "format",
            "--manual": "manual",
            "--reference": "reference",
            "--reference-build": "referenceBuild",
            "--target": "target"
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
