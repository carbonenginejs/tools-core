import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const sourceRoots = [ "src", "bin", "scripts", "test" ];
const controlNames = new Set([ "catch", "for", "if", "switch", "while", "with" ]);
const errors = [];

// Moved from format-carbon 2026-07-20, retaining its own established (and
// separately lint-checked) naming conventions for now. A dedicated style
// conformance pass is a deliberate follow-up, not part of the behavior-
// preserving move.
const styleExemptPaths = new Set([
    path.join(root, "bin", "cjs-carbon-class.js"),
    path.join(root, "bin", "cjs-carbon-schema.js"),
    path.join(root, "scripts", "build_carbon_schema.js")
]);
const styleExemptRoot = path.join(root, "src", "schema");

for (const sourceRoot of sourceRoots)
{
    const files = await GetJavaScriptFiles(path.join(root, sourceRoot));

    for (const file of files)
    {
        if (styleExemptPaths.has(file) || file.startsWith(`${styleExemptRoot}${path.sep}`))
        {
            continue;
        }

        await LintJavaScript(file, errors);
    }
}

await LintJavaScript(fileURLToPath(import.meta.url), errors);
await LintManifest(errors);
await LintDocument("README.md", errors);

if (errors.length)
{
    console.error(errors.join("\n"));
    console.error(`\n${errors.length} tools-core lint error(s)`);
    process.exitCode = 1;
}
else
{
    console.log("tools-core package lint passed");
}

/**
 * Collects JavaScript files in deterministic order.
 */
async function GetJavaScriptFiles(directory)
{
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name)))
    {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory())
        {
            files.push(...await GetJavaScriptFiles(entryPath));
        }
        else if (entry.isFile() && entry.name.endsWith(".js"))
        {
            files.push(entryPath);
        }
    }

    return files;
}

/**
 * Checks syntax and the package's dependency-free house-style rules.
 */
async function LintJavaScript(file, lintErrors)
{
    const relativeFile = path.relative(root, file).replaceAll(path.sep, "/");
    const source = await fs.readFile(file, "utf8");
    const syntax = spawnSync(process.execPath, [ "--check", file ], {
        encoding: "utf8",
    });

    if (syntax.status !== 0)
    {
        lintErrors.push(`${relativeFile}: ${syntax.stderr.trim()}`);
    }

    if (/[ \t]+$/mu.test(source))
    {
        lintErrors.push(`${relativeFile}: contains trailing whitespace`);
    }

    const integration = relativeFile.match(
        /^src\/integrations\/([a-z][a-z0-9-]*)\/index\.js$/u,
    );
    const boundaryPrefix = integration
        ? integration[1].split("-")
            .map(part => part[0].toUpperCase() + part.slice(1))
            .join("")
        : "Cjs";

    for (const match of source.matchAll(/export\s+class\s+([A-Za-z0-9_$]+)/gu))
    {
        if (!match[1].startsWith(boundaryPrefix))
        {
            lintErrors.push(`${relativeFile}: exported boundary class must use the ${boundaryPrefix} prefix: ${match[1]}`);
        }
    }

    const lines = source.split(/\r?\n/u);

    for (let index = 0; index < lines.length; index++)
    {
        const line = lines[index];

        if (/\b(?:class|function)\b[^{}]*\{\s*$/u.test(line) || /\)\s*\{\s*$/u.test(line))
        {
            lintErrors.push(`${relativeFile}:${index + 1}: opening brace must use Allman layout`);
        }

        const method = line.match(/^    (?:(static)\s+)?(?:async\s+)?(?:get\s+|set\s+)?(#?[A-Za-z_$][A-Za-z0-9_$]*)\s*\(/u);

        if (method && !controlNames.has(method[2]))
        {
            const isStatic = method[1] === "static";
            const name = method[2].replace(/^#/u, "");

            if (isStatic && !/^[a-z]/u.test(name))
            {
                lintErrors.push(`${relativeFile}:${index + 1}: static helper must use lower camel case: ${name}`);
            }
            else if (!isStatic && ![ "constructor", "toJSON", "toString", "valueOf" ].includes(name) && !/^[A-Z]/u.test(name))
            {
                lintErrors.push(`${relativeFile}:${index + 1}: instance method must use PascalCase: ${name}`);
            }
        }
    }
}

/**
 * Checks the public package identity and required scripts.
 */
async function LintManifest(lintErrors)
{
    const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));

    if (manifest.name !== "@carbonenginejs/tools-core")
    {
        lintErrors.push("package.json: expected @carbonenginejs/tools-core");
    }

    for (const script of [ "lint", "check", "test" ])
    {
        if (!manifest.scripts?.[script])
        {
            lintErrors.push(`package.json: missing ${script} script`);
        }
    }
}

/**
 * Rejects public documentation links that escape the package.
 */
async function LintDocument(name, lintErrors)
{
    const file = path.join(root, name);
    const source = await fs.readFile(file, "utf8");

    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu))
    {
        const target = match[1].trim().split(/\s+/u, 1)[0];

        if (/^(?:file:|[a-z]:[\\/]|[\\/]{1,2})/iu.test(target))
        {
            lintErrors.push(`${name}: external filesystem link is not allowed: ${target}`);
        }
    }
}
