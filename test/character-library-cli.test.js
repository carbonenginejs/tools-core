import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import { CjsCharacterLibrary } from "@carbonenginejs/runtime-character";
import { CreateCharacterDocuments } from "./character-library-fixture.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(root, "bin", "cjs-character-json.js");

test("character JSON CLI writes one deterministic schema-v6 artifact pair", context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-character-cli-"));
    const inputPath = path.join(directory, "documents.json");
    const outputPath = path.join(directory, "character-library.json");

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));
    fs.writeFileSync(inputPath, JSON.stringify({
        sourceTarget: "eve",
        sourceBuild: "3450001",
        documents: CreateCharacterDocuments(),
    }));

    const result = spawnSync(process.execPath, [
        cli,
        inputPath,
        "--out",
        outputPath,
        "--generated-at",
        "2026-08-02T00:00:00.000Z",
    ], {
        cwd: root,
        encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wrote character library JSON/u);
    assert.match(result.stdout, /Wrote character library gzip/u);

    const jsonBytes = fs.readFileSync(outputPath);
    const gzipBytes = fs.readFileSync(`${outputPath}.gz`);
    const values = JSON.parse(jsonBytes.toString("utf8"));
    const library = CjsCharacterLibrary.from(values);

    assert.deepEqual(gunzipSync(gzipBytes), jsonBytes);
    assert.equal(values.schemaVersion, 6);
    assert.equal(values.sourceBuild, "3450001");
    assert.equal(library.ListDocuments().length, 18);
});

test("character JSON CLI requires an exact source build", context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-character-cli-"));
    const inputPath = path.join(directory, "documents.json");

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));
    fs.writeFileSync(inputPath, JSON.stringify({
        documents: CreateCharacterDocuments(),
    }));

    const result = spawnSync(process.execPath, [ cli, inputPath ], {
        cwd: root,
        encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exact source build/u);
});
