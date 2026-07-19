#!/usr/bin/env node

// Two-pass Carbon schema build.
//
// Moved from format-carbon (2026-07-20): this script owns the same two-pass
// merge/compile behavior, generalized because tools-core does not itself own
// a committed live schema tree. Ordinary builds always write to a validated
// scratch child. Any output outside the scratch root requires the
// deliberately named `--allow-external-write` option; callers must also
// obtain the repository owner's separate approval before writing into a
// downstream package's committed schema directory (e.g. format-carbon's
// `src/schema`, during the migration transition).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import CjsFormatCarbon from "../src/schema/index.js";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_SCRATCH_ROOT = path.join(REPOSITORY_ROOT, ".scratch");
const DEFAULT_OUTPUT_ROOT = path.join(DEFAULT_SCRATCH_ROOT, "schema-build");
const TRINITY_ROOT = "trinity/trinity";

const HELP = `Usage:
  node scripts/build_carbon_schema.js <pass1.json> <pass2-trinity.json> [options]

Options:
  --out <dir>               Output directory. Defaults to .scratch/schema-build.
  --scratch-root <dir>      Scratch containment root. Defaults to .scratch.
  --clean                   Remove only the validated output child before writing.
  --allow-external-write    Permit an output destination outside the scratch root,
                             after separate repository-owner approval.
  --help                    Show this help.
`;

function readOptionValue(argv, index, option)
{
    const value = argv[index];
    if (!value || value.startsWith("--"))
    {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

function parseArgs(argv)
{
    const options = {
        allowExternalWrite: false,
        clean: false,
        help: false,
        inputs: [],
        out: null,
        scratchRoot: DEFAULT_SCRATCH_ROOT
    };

    for (let i = 0; i < argv.length; i++)
    {
        const arg = argv[i];
        if (arg === "--allow-external-write") options.allowExternalWrite = true;
        else if (arg === "--clean") options.clean = true;
        else if (arg === "--help") options.help = true;
        else if (arg === "--out") options.out = readOptionValue(argv, ++i, arg);
        else if (arg === "--scratch-root") options.scratchRoot = readOptionValue(argv, ++i, arg);
        else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
        else options.inputs.push(arg);
    }

    if (options.help) return options;
    if (options.inputs.length !== 2)
    {
        throw new Error("Expected <pass1.json> <pass2-trinity.json>");
    }

    if (!options.out)
    {
        options.out = path.join(options.scratchRoot, path.basename(DEFAULT_OUTPUT_ROOT));
    }
    return options;
}

function relativePathWithin(parent, candidate)
{
    const relative = path.relative(parent, candidate);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function samePath(left, right)
{
    return path.relative(left, right) === "";
}

function assertSafeScratchRoot(scratchRoot)
{
    const filesystemRoot = path.parse(scratchRoot).root;
    const currentDirectory = path.resolve(process.cwd());
    const unsafeExactRoots = [ filesystemRoot, currentDirectory, REPOSITORY_ROOT ];

    if (unsafeExactRoots.some(item => samePath(item, scratchRoot)))
    {
        throw new Error(`Refusing unsafe scratch root: ${scratchRoot}`);
    }
    if (samePath(scratchRoot, REPOSITORY_ROOT) || relativePathWithin(scratchRoot, REPOSITORY_ROOT))
    {
        throw new Error(`Scratch root must not contain the repository root: ${scratchRoot}`);
    }
}

function validateOutputRoot(outputRoot, scratchRoot, allowExternalWrite)
{
    const resolvedOutputRoot = path.resolve(outputRoot);
    const resolvedScratchRoot = path.resolve(scratchRoot);
    const isChildOfScratch = relativePathWithin(resolvedScratchRoot, resolvedOutputRoot);

    if (!isChildOfScratch)
    {
        if (!allowExternalWrite)
        {
            throw new Error(samePath(resolvedOutputRoot, resolvedScratchRoot)
                ? `Scratch output must be a child of ${resolvedScratchRoot}: ${resolvedOutputRoot}`
                : `Refusing output outside the scratch root without --allow-external-write: ${resolvedOutputRoot}`);
        }
        return { kind: "external", outputRoot: resolvedOutputRoot };
    }

    if (allowExternalWrite)
    {
        throw new Error("--allow-external-write is valid only outside the scratch root");
    }

    assertSafeScratchRoot(resolvedScratchRoot);
    return { kind: "scratch", outputRoot: resolvedOutputRoot };
}

function toPosix(value)
{
    return typeof value === "string" ? value.replace(/\\/g, "/") : value;
}

// A class is emitted into trinityCore when any of its source files sits directly
// in trinity/trinity/ (path depth 3: trinity/trinity/File.ext).
function isTrinityRootFile(file)
{
    const normalized = toPosix(file);
    return typeof normalized === "string"
        && normalized.startsWith(`${TRINITY_ROOT}/`)
        && normalized.split("/").length === 3;
}

function classImplementedAtTrinityRoot(classInfo)
{
    const blue = classInfo.blue || {};
    const files = [
        ...(classInfo.headerFiles || []),
        ...(classInfo.cppFiles || []),
        ...(blue.files || []),
        ...(blue.file ? [ blue.file ] : [])
    ];
    return files.some(isTrinityRootFile);
}

function buildCombinedReport(pass1, pass2)
{
    const trinityScan = (pass2.families || []).find(family => family.name === "trinityCore");
    if (!trinityScan)
    {
        throw new Error("Pass-2 report has no `trinityCore` family");
    }

    const trinityClasses = (trinityScan.classes || []).filter(classInfo =>
        classInfo.name
        && !classInfo.name.startsWith("_")
        && classImplementedAtTrinityRoot(classInfo));

    const trinityFamily = {
        name: "trinityCore",
        root: TRINITY_ROOT,
        files: trinityScan.files,
        classes: trinityClasses,
        stalls: trinityScan.stalls || [],
        warnings: trinityScan.warnings || []
    };

    // Pass two is the sole authority for trinityCore. This also prevents an
    // accidental pass-one trinityCore family from creating duplicate output.
    const pass1Families = (pass1.families || []).filter(family => family.name !== "trinityCore");

    // enums.json is also the class generator's enum-ownership catalog. Carbon
    // legitimately declares the same short name (Type, Usage, State, ...) in
    // many different scopes, so identity must remain qualified here. Pass one
    // wins only when pass two reports the same qualified declaration; enums
    // that exist only in pass two append in discovery order.
    const enumByIdentity = new Map();
    for (const item of pass1.enums || [])
    {
        const identity = enumIdentity(item);
        if (identity) enumByIdentity.set(identity, item);
    }
    for (const item of pass2.enums || [])
    {
        const identity = enumIdentity(item);
        if (identity && !enumByIdentity.has(identity)) enumByIdentity.set(identity, item);
    }

    return {
        ...pass1,
        summary: { ...(pass1.summary || {}), families: pass1Families.length + 1 },
        enums: [ ...enumByIdentity.values() ],
        families: [ ...pass1Families, trinityFamily ]
    };
}

function enumIdentity(item)
{
    if (!item || !item.name) return null;
    if (item.qualifiedName) return String(item.qualifiedName);
    if (item.ownerClass) return `${item.ownerClass}::${item.name}`;
    return String(item.name);
}

function cleanValidatedOutputRoot(validatedOutput)
{
    fs.rmSync(validatedOutput.outputRoot, { recursive: true, force: true });
}

function readReport(input)
{
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved))
    {
        throw new Error(`Input file not found: ${input}`);
    }
    if (!fs.statSync(resolved).isFile())
    {
        throw new Error(`Input is not a file: ${input}`);
    }
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function main()
{
    const options = parseArgs(process.argv.slice(2));
    if (options.help)
    {
        process.stdout.write(HELP);
        return;
    }

    const validatedOutput = validateOutputRoot(
        options.out,
        options.scratchRoot,
        options.allowExternalWrite
    );
    const pass1 = readReport(options.inputs[0]);
    const pass2 = readReport(options.inputs[1]);
    const combined = buildCombinedReport(pass1, pass2);

    // Compile and validate the complete bundle before a clean can remove an
    // existing output tree.
    const schema = CjsFormatCarbon.read(combined);
    const trinity = combined.families[combined.families.length - 1];
    process.stdout.write(
        `trinityCore: ${trinity.classes.length} root-level classes across ${combined.families.length} families\n`
    );

    if (options.clean) cleanValidatedOutputRoot(validatedOutput);
    const manifest = CjsFormatCarbon.write(schema, validatedOutput.outputRoot);
    process.stdout.write(
        `Wrote ${manifest.files.length} schema files to ${manifest.outputRoot} (${validatedOutput.kind})\n`
    );
}

try
{
    main();
}
catch (error)
{
    process.stderr.write(`build-schema: ${error.message}\n`);
    process.exitCode = 1;
}
