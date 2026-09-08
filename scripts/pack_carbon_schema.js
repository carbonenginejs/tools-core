#!/usr/bin/env node
// Packs the generated Carbon schema tree into one gzip, and copies it to a
// consumer that needs it.
//
// WHY THIS EXISTS. A consumer's schema gate must read a file in its own
// directory - reaching into this package's `.scratch` works only on a machine
// with the whole organization checked out side by side, and skips in silence
// everywhere else. So this package, which OWNS schema generation, hands the
// consumer a file instead.
//
// WHY GZIP. The tree is 1,911 documents and 14.5 MB raw. As loose files a
// refresh churns 1,911 paths in git and keeps every version forever; as one
// blob it is about a tenth of the size and one changed file per refresh.
//
//   npm run schema:pack                       write it here
//   npm run schema:pack -- --out <directory>  and copy it there
//
// `schema:generate` runs this last, so a regenerated tree always produces a
// fresh archive beside it.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The archive name every consumer looks for. */
export const ARCHIVE_NAME = "carbon_schema_latest.gzip";

/** The tree `schema:build` writes, inside this package. */
const DEFAULT_TREE = path.join(packageRoot, ".scratch", "schema-build");

/** Every `.json` under a directory, relative and slash-separated. */
function jsonFiles(root, base = root)
{
    const out = [];

    for (const entry of fs.readdirSync(root, { withFileTypes: true }))
    {
        const full = path.join(root, entry.name);

        if (entry.isDirectory()) out.push(...jsonFiles(full, base));
        else if (entry.name.endsWith(".json")) out.push(path.relative(base, full).replaceAll("\\", "/"));
    }

    return out;
}


const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const treeIndex = args.indexOf("--tree");
const treeRoot = treeIndex === -1 ? DEFAULT_TREE : path.resolve(args[treeIndex + 1]);

if (!fs.existsSync(treeRoot))
{
    console.error(`No schema tree at ${treeRoot}. Run npm run schema:generate first.`);
    process.exit(2);
}

const files = jsonFiles(treeRoot);
const documents = {};
for (const file of files) documents[file] = JSON.parse(fs.readFileSync(path.join(treeRoot, file), "utf8"));

const archive = path.join(packageRoot, ARCHIVE_NAME);
fs.writeFileSync(archive, zlib.gzipSync(
    Buffer.from(JSON.stringify({ packedAt: new Date().toISOString(), documentCount: files.length, documents })),
    { level: 9 }));

const megabytes = (fs.statSync(archive).size / 1048576).toFixed(1);
console.log(`Packed ${files.length} schema documents into ${ARCHIVE_NAME} (${megabytes} MB).`);

if (outIndex !== -1)
{
    const target = path.resolve(args[outIndex + 1]);
    if (!fs.existsSync(target))
    {
        console.error(`Target directory does not exist: ${target}`);
        process.exit(2);
    }

    fs.copyFileSync(archive, path.join(target, ARCHIVE_NAME));
    console.log(`Copied to ${path.join(target, ARCHIVE_NAME)}`);
}
