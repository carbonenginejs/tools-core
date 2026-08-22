#!/usr/bin/env node

/**
 * Generates machine-guessed English names for the types no SDE can name.
 *
 * Writes an `englishNames` derivation artifact beside each target's prepared
 * database, which the service reads with `source: "ai"` and always ranks below
 * a hand-written name. It is derived, so it may be deleted and rebuilt, and a
 * build without one simply serves no guessed names.
 *
 * This is a cross-target pass and cannot run during import: it needs the
 * reference target's SDE as well as the one being named, and the import path
 * only ever sees the database it just wrote. Run it after preparing a
 * zh-primary target's SDE.
 *
 * ```sh
 * node bin/cjs-localisation-guess.js --target serenity --target infinity --write
 * node bin/cjs-localisation-guess.js --target infinity --sample 40
 * ```
 *
 * Without `--write` nothing is saved and a summary is printed, which is the
 * right way to review a change to the vocabulary before it lands.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { CjsToolSdeDatabase, WriteDerivation } from "../src/sde/index.js";
import { CjsToolLocalisation } from "../src/localisation/CjsToolLocalisation.js";
import {
    BuildLocalDictionary,
    BuildNameDictionary,
    GuessEnglishName,
    MergeDictionaries
} from "../src/localisation/CjsToolLocalisationGuess.js";

const HELP = `Usage:
  cjs-localisation-guess --target <target> [--target <target>] [--write]

Options:
  --target <target>     Target to guess names for; repeatable
  --reference <target>  Target supplying the dictionary (default: eve)
  --cache <path>        Cache root holding prepared databases
  --sample <count>      Print this many examples (default: 15)
  --write               Write the englishNames artifact beside each database
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

    if (!options.targets.length) throw new Error("--target is required");

    const cacheRoot = options.cache ?? path.resolve(process.cwd(), "..", ".cache", "tool-core");
    const reference = await OpenTarget(cacheRoot, options.reference);
    const dictionary = await BuildNameDictionary(reference.source);

    Say(`dictionary: ${dictionary.size} zh->en names from ${options.reference} ${reference.source.build}`);

    const samples = [];
    let composed = 0;
    let partial = 0;
    let refused = 0;

    for (const target of options.targets)
    {
        const local = await OpenTarget(cacheRoot, target);
        const localisation = new CjsToolLocalisation(local.source, { reference: reference.source });
        const gaps = await localisation.Gaps();

        // Two dictionaries: the reference target's own Chinese, and the local
        // SDE's Chinese mapped through shared type IDs. The second is what
        // catches a hull the local target renamed - it names the Vindicator
        // 惩戒级 where the reference writes 惩戒者级, so anything built on that
        // name matches only here.
        const merged = MergeDictionaries(
            await BuildLocalDictionary(local.source, reference.source),
            dictionary
        );
        const guesses = {};

        for (const gap of gaps)
        {
            const chinese = gap.names.zh;

            if (!chinese) continue;

            const guess = GuessEnglishName(chinese, merged);

            if (!guess)
            {
                refused++;
                continue;
            }

            if (guess.confidence === "composed") composed++;
            else partial++;

            guesses[gap.typeID] = {
                en: guess.text,
                zh: chinese,
                confidence: guess.confidence,
                method: guess.method
            };

            if (samples.length < options.sample) samples.push(`${guess.confidence.padEnd(9)} ${chinese}\n          -> ${guess.text}`);
        }

        Say(`${target} ${local.source.build}: ${gaps.length} gaps, ${Object.keys(guesses).length} guessed`);

        if (options.write)
        {
            // Beside that build's database, under the derivation register's own
            // name and version token - so it is invalidated the way every other
            // derived artifact is, and a build with no artifact simply serves no
            // guessed names.
            const written = await WriteDerivation(
                local.database.filePath,
                "englishNames",
                {
                    reference: { target: options.reference, build: reference.source.build },
                    generated: { composed, partial, refused },
                    names: guesses
                },
                { target }
            );

            Say(`  wrote ${written.file}`);
        }

        await local.database.Close();
    }

    const total = composed + partial + refused;

    Say("");
    Say(`composed (nothing left untranslated): ${composed} (${Percent(composed, total)})`);
    Say(`partial  (some Chinese remains):      ${partial} (${Percent(partial, total)})`);
    Say(`refused  (nothing translated):        ${refused} (${Percent(refused, total)})`);
    Say("");

    for (const sample of samples) Say(`  ${sample}`);

    if (!options.write) Say("nothing written - pass --write to save");

    await reference.database.Close();
}

function Percent(value, total)
{
    return total ? `${((value / total) * 100).toFixed(1)}%` : "0%";
}

async function OpenTarget(cacheRoot, target)
{
    const root = path.join(cacheRoot, "custom", "targets", target, "builds");
    const build = (await fs.readdir(root))
        .filter(entry => /^\d+$/u.test(entry))
        .sort((left, right) => Number(right) - Number(left))[0];

    if (!build) throw new Error(`No prepared build for ${target} under ${root}`);

    const database = await CjsToolSdeDatabase.open(path.join(root, build, "sde_v1.sqlite"), { readOnly: true });

    return { database, source: { target, build, Table: name => database.Table(name) } };
}

function Say(message)
{
    process.stderr.write(`${message}\n`);
}

function ParseArgs(argv)
{
    const options = {
        cache: undefined,
        help: false,
        reference: "eve",
        sample: 15,
        targets: [],
        write: false
    };

    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];

        if (argument === "--help" || argument === "-h")
        {
            options.help = true;
            continue;
        }

        if (argument === "--write")
        {
            options.write = true;
            continue;
        }

        if (argument === "--target")
        {
            options.targets.push(Require(argv, ++index, argument));
            continue;
        }

        if (argument === "--reference")
        {
            options.reference = Require(argv, ++index, argument);
            continue;
        }

        if (argument === "--cache")
        {
            options.cache = Require(argv, ++index, argument);
            continue;
        }

        if (argument === "--sample")
        {
            options.sample = Number(Require(argv, ++index, argument));
            continue;
        }

        throw new Error(`Unknown option ${argument}`);
    }

    return options;
}

function Require(argv, index, name)
{
    const value = argv[index];

    if (value === undefined) throw new Error(`${name} requires a value`);

    return value;
}

Main(process.argv.slice(2)).catch((error) =>
{
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
});
