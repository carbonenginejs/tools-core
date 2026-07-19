#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    loadSchemaDoc,
    deriveExpectedFields,
    parseClassFile,
    compareClass,
    renderClassFile,
    renderEnums,
    renderReport,
    buildJsonReport
} from "../src/schema/core/classTool.js";

const HELP = `Usage:
  carbon-class --check <classFile...> [--schema <doc.json> | --family <f> --class <C>]
  carbon-class --emit <ClassName> [--family <f>] [--schema <doc.json>] [--out <file>]
  carbon-class --emit-enums [--family <f>] [--schema <enums.json>] [--out <file>]

Options:
  --check <file...>     Compare runtime class file(s) against the canonical schema doc.
  --emit <ClassName>    Generate the source-shaped class file from schema.
  --emit-enums          Generate enums from schema enums.json (filter by --family).
  --schema <doc.json>   Explicit schema doc path (overrides family/class lookup).
  --schema-root <dir>   Schema tree root (default: packaged src/schema).
  --family <f>          Schema family used to locate the doc.
  --class <C>           Class name (defaults to the name parsed from the class file).
  --out <file>          Write emitted class text to a new file, or verify an existing file.
  --include-inherited   Include fields declared outside the concrete class.
  --exclude-inherited   Omit fields declared outside the concrete class.
  --allow-extra         Treat extra-in-file fields as warnings, not drift.
  --strict              Treat io + default warnings as drift.
  --strict-io           Treat missing @io flags as drift.
  --strict-defaults     Treat wrong defaults as drift.
  --js                  Emit .js-style output (no TS annotations).
  --force               Overwrite an existing --out file when it differs.
  --json                Machine-readable output (agents).
  --ascii               ASCII status marks instead of Unicode.
  --quiet               Suppress per-file headers in multi-file runs.
  --help, -h            Show this help.
  --version             Print version.

Exit codes: 0 in-sync, 1 drift, 2 usage error, 3 schema doc missing/ambiguous, 4 class file unparseable.
`;

function readArgValue(argv, index, flag)
{
    const value = argv[index];
    if (value === undefined || value.startsWith("--"))
    {
        throw usageError(`Missing value for ${flag}`);
    }
    return value;
}

function usageError(message)
{
    const error = new Error(message);
    error.code = "usage";
    return error;
}

function parseArgs(argv)
{
    const options = {
        check: [],
        emit: null,
        emitEnums: false,
        schema: null,
        schemaRoot: null,
        family: null,
        className: null,
        out: null,
        includeInherited: null,
        allowExtra: false,
        strict: false,
        strictIo: false,
        strictDefaults: false,
        js: false,
        force: false,
        json: false,
        ascii: false,
        quiet: false,
        help: false,
        version: false
    };

    for (let i = 0; i < argv.length; i++)
    {
        const arg = argv[i];
        switch (arg)
        {
            case "--help": case "-h": options.help = true; break;
            case "--version": options.version = true; break;
            case "--check":
                // Consume one or more following non-flag paths.
                while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--"))
                {
                    options.check.push(argv[++i]);
                }
                if (!options.check.length) throw usageError("Missing value for --check");
                break;
            case "--emit": options.emit = readArgValue(argv, ++i, arg); break;
            case "--emit-enums": options.emitEnums = true; break;
            case "--schema": options.schema = readArgValue(argv, ++i, arg); break;
            case "--schema-root": options.schemaRoot = readArgValue(argv, ++i, arg); break;
            case "--family": options.family = readArgValue(argv, ++i, arg); break;
            case "--class": options.className = readArgValue(argv, ++i, arg); break;
            case "--out": options.out = readArgValue(argv, ++i, arg); break;
            case "--include-inherited": options.includeInherited = true; break;
            case "--exclude-inherited": options.includeInherited = false; break;
            case "--allow-extra": options.allowExtra = true; break;
            case "--strict": options.strict = true; break;
            case "--strict-io": options.strictIo = true; break;
            case "--strict-defaults": options.strictDefaults = true; break;
            case "--js": options.js = true; break;
            case "--force": options.force = true; break;
            case "--json": options.json = true; break;
            case "--ascii": options.ascii = true; break;
            case "--quiet": options.quiet = true; break;
            default:
                if (arg.startsWith("--")) throw usageError(`Unknown option ${arg}`);
                throw usageError(`Unexpected argument ${arg}`);
        }
    }

    return options;
}

function exitCodeForError(error)
{
    switch (error.code)
    {
        case "schema-doc-missing":
        case "schema-doc-ambiguous":
            return 3;
        case "class-file-unparseable":
            return 4;
        case "usage":
            return 2;
        default:
            return 2;
    }
}

function normalizeGeneratedText(text)
{
    return String(text).replace(/\r\n?/g, "\n");
}

function renderTextDiff(actual, expected, filePath, maxHunks = 20)
{
    const actualLines = normalizeGeneratedText(actual).split("\n");
    const expectedLines = normalizeGeneratedText(expected).split("\n");
    const max = Math.max(actualLines.length, expectedLines.length);
    const lines = [
        `--- ${filePath} (actual)`,
        `+++ ${filePath} (generated)`
    ];
    let hunks = 0;

    for (let i = 0; i < max; i++)
    {
        if (actualLines[i] === expectedLines[i]) continue;

        lines.push(`@@ line ${i + 1} @@`);
        if (actualLines[i] !== undefined) lines.push(`- ${actualLines[i]}`);
        if (expectedLines[i] !== undefined) lines.push(`+ ${expectedLines[i]}`);

        hunks++;
        if (hunks >= maxHunks)
        {
            lines.push("... diff truncated ...");
            break;
        }
    }

    return lines.join("\n");
}

function runCheck(options)
{
    let worst = 0;
    const reports = [];

    for (const filePath of options.check)
    {
        try
        {
            const absolute = path.resolve(filePath);
            const text = fs.readFileSync(absolute, "utf8");
            const parsed = parseClassFile(text, { filePath: absolute });
            const className = options.className || parsed.className;

            const { doc, schemaPath, schemaRoot, family } = loadSchemaDoc({
                schema: options.schema,
                schemaRoot: options.schemaRoot,
                family: options.family,
                className
            });

            const expected = deriveExpectedFields(doc, {
                schemaRoot,
                family,
                includeInherited: options.includeInherited ?? (parsed.base === "CjsModel")
            });

            const result = compareClass(expected, parsed, {
                allowExtra: options.allowExtra,
                strict: options.strict,
                strictIo: options.strictIo,
                strictDefaults: options.strictDefaults
            });
            result.schemaPath = schemaPath;
            result.filePath = absolute;

            if (options.json)
            {
                reports.push(buildJsonReport(result));
            }
            else
            {
                if (!options.quiet && options.check.length > 1) reports.push("");
                reports.push(renderReport(result, { ascii: options.ascii }));
            }

            if (result.summary.drift) worst = Math.max(worst, 1);
        }
        catch (error)
        {
            worst = Math.max(worst, exitCodeForError(error));
            if (options.json)
            {
                reports.push({ tool: "carbon-class", mode: "check", filePath, error: error.message, code: error.code || "error" });
            }
            else
            {
                reports.push(`carbon-class: ${filePath}: ${error.message}`);
            }
        }
    }

    if (options.json)
    {
        const payload = options.check.length === 1 ? reports[0] : reports;
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    }
    else
    {
        process.stdout.write(`${reports.join("\n")}\n`);
    }

    process.exitCode = worst;
}

function runEmit(options)
{
    const className = options.emit;
    const { doc, schemaPath, schemaRoot, family } = loadSchemaDoc({
        schema: options.schema,
        schemaRoot: options.schemaRoot,
        family: options.family,
        className
    });

    const expected = deriveExpectedFields(doc, {
        schemaRoot,
        family,
        includeInherited: options.includeInherited !== false
    });

    if (expected.fallback)
    {
        const message = `carbon-class: ${className}: ${expected.fallback.reason}; nothing to emit.`;
        if (options.json)
        {
            process.stdout.write(`${JSON.stringify({ tool: "carbon-class", mode: "emit", class: className, schemaPath, fieldCount: 0, fallback: expected.fallback }, null, 2)}\n`);
        }
        else
        {
            process.stdout.write(`${message}\n`);
        }
        process.exitCode = 1;
        return;
    }

    const text = renderClassFile(expected, { js: options.js, doc });

    if (options.out)
    {
        const absolute = path.resolve(options.out);
        if (fs.existsSync(absolute))
        {
            const existing = fs.readFileSync(absolute, "utf8");

            if (normalizeGeneratedText(existing) === normalizeGeneratedText(text))
            {
                if (options.json)
                {
                    process.stdout.write(`${JSON.stringify({ tool: "carbon-class", mode: "emit", class: className, schemaPath, out: absolute, fieldCount: expected.fields.length, verified: true }, null, 2)}\n`);
                }
                else
                {
                    process.stdout.write(`carbon-class: verified ${absolute} (${expected.fields.length} field(s))\n`);
                }
                return;
            }

            if (!options.force)
            {
                const diff = renderTextDiff(existing, text, absolute);
                if (options.json)
                {
                    process.stdout.write(`${JSON.stringify({ tool: "carbon-class", mode: "emit", class: className, schemaPath, out: absolute, fieldCount: expected.fields.length, drift: true, diff }, null, 2)}\n`);
                }
                else
                {
                    process.stdout.write(`carbon-class: existing file differs from generated output; refusing to overwrite ${absolute} (pass --force to replace).\n${diff}\n`);
                }
                process.exitCode = 1;
                return;
            }
        }

        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, text, "utf8");
        if (options.json)
        {
            process.stdout.write(`${JSON.stringify({ tool: "carbon-class", mode: "emit", class: className, schemaPath, out: absolute, fieldCount: expected.fields.length }, null, 2)}\n`);
        }
        else
        {
            process.stdout.write(`carbon-class: wrote ${absolute} (${expected.fields.length} field(s))\n`);
        }
    }
    else if (options.json)
    {
        process.stdout.write(`${JSON.stringify({ tool: "carbon-class", mode: "emit", class: className, schemaPath, fieldCount: expected.fields.length, text }, null, 2)}\n`);
    }
    else
    {
        process.stdout.write(text);
    }
}

function runEmitEnums(options)
{
    const schemaRoot = options.schemaRoot
        ? path.resolve(options.schemaRoot)
        : path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "schema");
    const enumsPath = options.schema ? path.resolve(options.schema) : path.join(schemaRoot, "enums.json");
    const raw = JSON.parse(fs.readFileSync(enumsPath, "utf8"));
    const map = raw.enums || raw;
    let list = Array.isArray(map) ? map : Object.values(map);
    if (options.family) list = list.filter(entry => entry && entry.family === options.family);
    // Class-owned enums are emitted as statics on their owning/consuming
    // classes. --emit-enums is reserved for unowned shared vocabularies.
    list = list.filter(entry =>
        entry && entry.name && !entry.ownerClass && Array.isArray(entry.values)
    );

    const text = renderEnums(list, { js: options.js });

    if (options.out)
    {
        const absolute = path.resolve(options.out);
        if (fs.existsSync(absolute))
        {
            const existing = fs.readFileSync(absolute, "utf8");
            if (normalizeGeneratedText(existing) === normalizeGeneratedText(text))
            {
                process.stdout.write(`carbon-class: verified ${absolute} (${list.length} enum(s))\n`);
                return;
            }
            if (!options.force)
            {
                process.stdout.write(`carbon-class: existing file differs from generated output; refusing to overwrite ${absolute} (pass --force to replace).\n${renderTextDiff(existing, text, absolute)}\n`);
                process.exitCode = 1;
                return;
            }
        }
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, text, "utf8");
        process.stdout.write(`carbon-class: wrote ${absolute} (${list.length} enum(s))\n`);
    }
    else
    {
        process.stdout.write(text);
    }
}

function main()
{
    let options;
    try
    {
        options = parseArgs(process.argv.slice(2));
    }
    catch (error)
    {
        process.stderr.write(`${error.message}\n\n${HELP}`);
        process.exitCode = exitCodeForError(error);
        return;
    }

    if (options.help)
    {
        process.stdout.write(HELP);
        return;
    }
    if (options.version)
    {
        try
        {
            const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
            process.stdout.write(`${pkg.version}\n`);
        }
        catch
        {
            process.stdout.write("unknown\n");
        }
        return;
    }

    if (options.check.length && options.emit)
    {
        process.stderr.write("carbon-class: choose either --check or --emit, not both.\n");
        process.exitCode = 2;
        return;
    }

    try
    {
        if (options.check.length)
        {
            runCheck(options);
        }
        else if (options.emit)
        {
            runEmit(options);
        }
        else if (options.emitEnums)
        {
            runEmitEnums(options);
        }
        else
        {
            process.stderr.write(`carbon-class: nothing to do.\n\n${HELP}`);
            process.exitCode = 2;
        }
    }
    catch (error)
    {
        process.stderr.write(`carbon-class: ${error.message}\n`);
        process.exitCode = exitCodeForError(error);
    }
}

main();
