import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CjsCharacterLibraryData } from "../../runtime-character/npm/dist/index.js";
import { CjsToolCharacterCompiler } from "../src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "character-library-json.js");

function Run(args)
{
    return spawnSync(process.execPath, [ cli, ...args ], {
        cwd: root,
        encoding: "utf8"
    });
}

test("CLI exports deterministic canonical character library JSON", () =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "character-library-cli-"));
    const inputPath = path.join(directory, "catalogs.json");
    const outputPath = path.join(directory, "output", "character-library.json");
    fs.writeFileSync(inputPath, JSON.stringify({
        sourceBuild: "input-build",
        generatedAt: "2026-07-11T00:00:00.000Z",
        catalogs: {
            sources: [
                { id: "source-b", path: "b.color" },
                { id: "source-a", path: "a.color" }
            ],
            materials: [
                { id: "material-b", sourceId: "source-b" },
                {
                    id: "material-a",
                    sourceId: "source-a",
                    resourcePaths: [ "res:/texture/a.png", "res:/texture/b.png" ]
                }
            ]
        }
    }));

    const result = Run([
        inputPath,
        "--out", outputPath,
        "--source-target", "eve",
        "--source-game", "Eve",
        "--source-provider", "ccp",
        "--source-build", "3430261",
        "--include-sources"
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wrote character library JSON/);

    const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    const outputText = fs.readFileSync(outputPath, "utf8");
    assert.equal(output.schema, "carbonenginejs.characterLibrary");
    assert.equal(output.schemaVersion, 2);
    assert.equal(output.sourceTarget, "eve");
    assert.equal(output.sourceGame, "Eve");
    assert.equal(output.sourceProvider, "ccp");
    assert.equal(output.sourceBuild, "3430261");
    assert.equal(output.generatedAt, "2026-07-11T00:00:00.000Z");
    assert.deepEqual(output.sourceRefs, { "#ref1": "a.color", "#ref2": "b.color" });
    assert.deepEqual(output.sources.map(value => value.ref), [ "#ref1", "#ref2" ]);
    assert.deepEqual(Object.keys(output.materials), [ "material-a", "material-b" ]);
    assert.deepEqual(output.partSources, {});
    assert.equal(Object.hasOwn(output.materials["material-a"], "sourceId"), false);
    assert.match(outputText, /"resourcePaths": \["res:\/texture\/a\.png", "res:\/texture\/b\.png"\]/);
    assert.match(outputText, /"materials": \{\r?\n\s+"material-a": \{/);

    const expanded = CjsCharacterLibraryData.from(CjsToolCharacterCompiler.expand(output));
    assert.deepEqual(expanded.materials.map(value => value.id), [ "material-a", "material-b" ]);
});

test("CLI omits source provenance by default and reports invalid references", () =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "character-library-cli-"));
    const validPath = path.join(directory, "valid.json");
    fs.writeFileSync(validPath, JSON.stringify({
        sourceBuild: "3430261",
        sources: [ { id: "eve.prs", path: "eve.prs" } ],
        presets: [ { id: "eve", sourceId: "eve.prs" } ]
    }));

    const valid = Run([ validPath, "--compact" ]);
    assert.equal(valid.status, 0, valid.stderr);
    const output = JSON.parse(valid.stdout);
    assert.ok(output.presets.eve);
    assert.equal(Object.hasOwn(output, "sourceRefs"), false);
    assert.equal(Object.hasOwn(output, "sources"), false);
    assert.equal(Object.hasOwn(output.presets.eve, "sourceId"), false);
    assert.equal(CjsToolCharacterCompiler.expand(output).presets[0].id, "eve");

    const invalidPath = path.join(directory, "invalid.json");
    fs.writeFileSync(invalidPath, JSON.stringify({
        sourceBuild: "3430261",
        sources: [ { id: "known", path: "known.yaml" } ],
        materials: [ { id: "material", sourceId: "missing" } ]
    }));
    const invalid = Run([ invalidPath ]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /references unknown source "missing"/);

    const unsupported = Run([ validPath, "--source-target", "frontier" ]);
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /does not support target frontier/);
});

test("CLI help documents the normalized-input boundary", () =>
{
    const result = Run([ "--help" ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /character-library-json <catalogs\.json>/);
    assert.match(result.stdout, /Source-format parsing belongs to build tooling/);
    assert.match(result.stdout, /Library outputs are target-specific/);
    assert.match(result.stdout, /--source-target/);
    assert.match(result.stdout, /--include-sources/);
});
