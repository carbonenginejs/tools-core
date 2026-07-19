import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const Executable = fileURLToPath(new URL("../scripts/catalog_shader_targets.js", import.meta.url));

test("shader catalog CLI writes an offline exact-build inventory", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-shader-catalog-"));
    const indexPath = path.join(directory, "resfileindex.txt");
    const outputPath = path.join(directory, "catalog.json");

    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.writeFile(indexPath, [
        "res:/graphics/effect.dx11/managed/space/characters/standardpbr.sm_hi,90/source,1a846e224f05d7ae9e8d33e9d054c1cc,526654,61005,",
        "res:/graphics/effect.dx11/managed/space/characters/standardpbr.sm_depth,91/depth,,,,",
    ].join("\n"));

    const result = spawnSync(process.execPath, [
        Executable,
        "--index", indexPath,
        "--shader-target", "frontier-webgl2",
        "--build", "3438337",
        "--out", outputPath,
        "--generated-at", "2026-07-19T00:00:00Z",
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const catalog = JSON.parse(await fs.readFile(outputPath, "utf8"));

    assert.equal(catalog.shaderTarget, "frontier-webgl2");
    assert.equal(catalog.build, "3438337");
    assert.equal(catalog.sourceCount, 1);
    assert.match(result.stdout, /"sourceCount": 1/u);
});

test("shader catalog CLI rejects friendly builds", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-shader-catalog-"));
    const indexPath = path.join(directory, "resfileindex.txt");

    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.writeFile(
        indexPath,
        "res:/graphics/effect.dx11/utility/copyblit.sm_hi,90/source,,,,\n",
    );

    const result = spawnSync(process.execPath, [
        Executable,
        "--index", indexPath,
        "--shader-target", "frontier-webgl2",
        "--build", "latest",
        "--out", path.join(directory, "catalog.json"),
    ], { encoding: "utf8" });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires an exact build/u);
});
