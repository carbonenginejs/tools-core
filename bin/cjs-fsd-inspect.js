#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { CjsToolFsdInspectReader } from "../src/fsd/index.js";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h"))
{
    console.log("Usage: cjs-fsd-inspect <file.fsdbinary> [logical-path]");
    process.exit(args.length === 0 ? 1 : 0);
}

const [ file, logicalPath ] = args;
const bytes = await readFile(file);
const reader = new CjsToolFsdInspectReader({
    path: logicalPath ?? `local:/${basename(file).toLowerCase()}`,
});
const result = reader.Read(bytes);

console.log(JSON.stringify(result, null, 2));
