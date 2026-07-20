import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { CjsToolCache, CjsToolLibraryArtifact } from "../src/index.js";

test("writes deterministic JSON and gzip library siblings", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-library-artifact-"));
    const firstPath = path.join(directory, "first.json");
    const secondPath = path.join(directory, "second.json");
    const value = { schema: "test.library", schemaVersion: 1, typeID: 587 };

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));

    const first = await CjsToolLibraryArtifact.write(firstPath, value);
    const second = await CjsToolLibraryArtifact.write(secondPath, value);
    const json = fs.readFileSync(first.jsonPath);
    const gzip = fs.readFileSync(first.gzipPath);

    assert.deepEqual(gunzipSync(gzip), json);
    assert.deepEqual(gzip, fs.readFileSync(second.gzipPath));
    assert.equal(first.jsonBytes, json.byteLength);
    assert.equal(first.gzipBytes, gzip.byteLength);
    assert.match(json.toString("utf8"), /"typeID": 587/u);
});

test("shared cache places both library artifacts under one exact build", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-library-cache-"));
    const cache = new CjsToolCache(directory);

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));

    const result = await cache.WriteCustomLibrary({
        provider: "ccp",
        build: "3436472",
        name: "skin",
        version: "v1",
    }, { schema: "carbonenginejs.skinLibrary", schemaVersion: 1 });

    assert.equal(result.gzipPath, `${result.jsonPath}.gz`);
    assert.equal(fs.existsSync(result.jsonPath), true);
    assert.equal(fs.existsSync(result.gzipPath), true);
});
