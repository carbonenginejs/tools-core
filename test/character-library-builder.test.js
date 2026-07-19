import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("character builder reads and validates profiles from the shared ResFiles cache", context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-character-tool-"));
    const cacheDirectory = path.join(directory, "cache");
    const inputPath = path.join(directory, "resfileindex.txt");
    const outputPath = path.join(directory, "character-library.json");
    const logicalPath = "res:/graphics/character/global/paperdolllibrary/"
        + "backgrounds/air_station.yaml";
    const storagePath = "aa/air_station.yaml";
    const bytes = Buffer.from(JSON.stringify({
        scale: 1,
        path: "res:/ui/texture/classes/air_station.png",
        offset: [ 0, 0 ],
        aspect_ratio: 0.61275,
    }));
    const checksum = crypto.createHash("md5").update(bytes).digest("hex");
    const cachePath = path.join(cacheDirectory, "ResFiles", "aa", "air_station.yaml");

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, bytes);
    fs.writeFileSync(
        inputPath,
        `${logicalPath},${storagePath},${checksum},${bytes.byteLength},${bytes.byteLength}\n`,
    );

    const args = [
        "scripts/build_character_library.js",
        "--index", inputPath,
        "--cache", cacheDirectory,
        "--out", outputPath,
        "--target", "eve",
        "--build", "3435006",
        "--generated-at", "2026-07-19T00:00:00.000Z",
    ];
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    const library = JSON.parse(fs.readFileSync(outputPath, "utf8"));

    assert.equal(library.sourceTarget, "eve");
    assert.equal(library.sourceBuild, "3435006");
    assert.equal(library.presentation.backgrounds.air_station.scale, 1);

    fs.writeFileSync(cachePath, "{}");

    const invalid = spawnSync(process.execPath, args, { encoding: "utf8" });

    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /size mismatch/);
});
