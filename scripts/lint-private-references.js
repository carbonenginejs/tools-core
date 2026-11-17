// Checks working files, staged blobs, or a proposed commit message without printing private text.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rules = [
    [ "private document reference", /(?:^|[^\w.-])\/?docs[\\/](?:internal|research|projects|architecture|specifications|standards|decisions)[\\/]/iu ],
    [ "private documentation repository", /carbonenginejs[\\/]private-docs\b/iu ],
    [ "agent workspace", /(?:^|[^\w.-])\.(?:agents|claude|codex)[\\/]/iu ],
    [ "machine path", /\b[A-Za-z]:[\\/](?:carbon|Users|ccpwgl|skindr|[\w-]*carbonenginejs)/iu ],
    // Lowercase forward-slash resource identifiers are valid; backslashes are filesystem paths.
    [ "restricted drive path", /\b(?:[Qq]:[\\/]|[Rr]:\\|[R]:\/)/u ]
];

/** Run Git without a shell, preserving NUL-separated names and blob bytes. */
function git(args)
{
    return execFileSync("git", args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
}

/** Report only the location and rule; never echo the offending text. */
function scan(label, bytes)
{
    if (bytes.includes(0)) return 0;
    let count = 0;
    const lines = bytes.toString("utf8").split(/\r?\n/u);
    for (let i = 0; i < lines.length; i++)
    {
        for (const [kind, pattern] of rules)
        {
            if (!pattern.test(lines[i])) continue;
            console.error(`${JSON.stringify(label)}:${i + 1}: ${kind}`);
            count++;
        }
    }
    return count;
}

/** Check the selected Git view. Errors fail closed. */
function main()
{
    const args = process.argv.slice(2);
    let hits = 0;
    let count = 0;
    if (args.length === 2 && args[0] === "--commit-msg")
    {
        hits = scan("commit message", fs.readFileSync(args[1]));
        count = 1;
    }
    else
    {
        if (args.length > 1 || (args.length && args[0] !== "--staged"))
        {
            throw new Error("Usage: lint-private-references.js [--staged | --commit-msg FILE]");
        }
        const staged = args[0] === "--staged";
        const names = git(staged
            ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
            : ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
        for (const name of names)
        {
            // These files name ignored infrastructure directories, not dependencies on them.
            if (name === ".gitignore" || name === ".npmignore") continue;
            hits += scan("path", Buffer.from(name));
            let bytes;
            if (staged) bytes = git(["show", `:${name}`]);
            else
            {
                const filename = path.join(root, name);
                let stat;
                try { stat = fs.lstatSync(filename); }
                catch (error)
                {
                    if (error.code === "ENOENT") continue;
                    throw error;
                }
                // Inspect a link's target text, never follow it into another filesystem.
                if (stat.isSymbolicLink()) bytes = Buffer.from(fs.readlinkSync(filename));
                else if (stat.isFile()) bytes = fs.readFileSync(filename);
                else continue;
            }
            hits += scan(name, bytes);
            count++;
        }
    }
    console.log(`Private-reference lint: ${count} inputs, ${hits} hit(s).`);
    process.exitCode = hits ? 1 : 0;
}

try { main(); }
catch
{
    console.error("Private-reference lint could not inspect all inputs; refusing to pass.");
    process.exitCode = 1;
}
