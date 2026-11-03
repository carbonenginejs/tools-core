// A class field is never undefined: every field declared in src states its default by meaning (null for an object
// or a function, "" for a string, a number for a number, false for a flag), and a constructor still assigns the real
// value. A field with no initializer fails. Zero hits allowed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The fields with no initializer in one module's source.
 *
 * @param {string} code The module source.
 * @param {string} file Its path, for messages.
 * @returns {string[]} One message per field.
 */
export function findBareFields(code, file)
{
    const ast = parse(code, { sourceType: "module", plugins: [ [ "decorators", { version: "2023-11" } ] ] });
    const hits = [];
    const visit = node =>
    {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { for (const item of node) visit(item); return; }
        if ((node.type === "ClassProperty" || node.type === "ClassPrivateProperty") && node.value === null && !node.declare)
        {
            const name = node.key.type === "PrivateName" ? `#${node.key.id.name}` : node.key.name ?? node.key.value;
            hits.push(`${file}:${node.loc.start.line} ${name} has no initializer; give it a default by meaning.`);
        }
        for (const key of Object.keys(node)) if (key !== "loc" && !key.endsWith("Comments")) visit(node[key]);
    };
    visit(ast.program);
    return hits;
}

function sourceFiles(directory)
{
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }))
    {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...sourceFiles(target));
        else if (/\.m?js$/.test(entry.name)) files.push(target);
    }
    return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
    const hits = [];
    for (const file of sourceFiles(path.join(root, "src")))
        hits.push(...findBareFields(fs.readFileSync(file, "utf8"), path.relative(root, file).replaceAll("\\", "/")));
    for (const hit of hits) console.error(hit);
    if (hits.length) process.exitCode = 1;
    else console.log("Field initializers: every class field in src has a default.");
}
