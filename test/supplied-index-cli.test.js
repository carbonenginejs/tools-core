import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const Executable = fileURLToPath(new URL("../bin/cjs-supplied-index-import.js", import.meta.url));

/** A stand-in client install: a shared cache with one client folder in it. */
async function Install(context, { build = "3474408", startIni = true } = {})
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-supplied-cli-"));
    const client = path.join(directory, "shared", "stillness");

    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.mkdir(client, { recursive: true });
    if (startIni)
    {
        await fs.writeFile(
            path.join(client, "start.ini"),
            `[main]\r\nbuild = ${build}\r\nversion = 1\r\n`,
            "utf8",
        );
    }
    await fs.writeFile(path.join(client, "resfileindex.txt"), "res:/ship.red,aa/ship,,,,\n");
    // As a client writes it, which is not how it is read back.
    await fs.writeFile(path.join(client, "resfileindex_Windows.txt"), "res:/shader.sm_hi,bb/shader,,,,\n");
    await fs.writeFile(path.join(client, "unrelated.txt"), "not an index\n");

    return {
        shared: path.join(directory, "shared"),
        data: path.join(directory, "data.local"),
        Run: (...args) => spawnSync(process.execPath, [ Executable, ...args ], { encoding: "utf8" }),
    };
}

test("the build comes from the client's start.ini", async context =>
{
    const install = await Install(context);
    const result = install.Run("--target", "frontier", "--shared-cache", install.shared, "--data", install.data);

    assert.equal(result.status, 0, result.stderr);

    const supplied = path.join(install.data, "games", "frontier", "indexes", "3474408");

    assert.deepEqual(
        (await fs.readdir(supplied)).sort(),
        [ "resfileindex.txt", "resfileindex_windows.txt" ],
        "the indexes arrive lower cased, because the file name carries the group name",
    );
});

test("the client folder is the one the target's client installs into", async context =>
{
    const install = await Install(context);
    const result = install.Run("--target", "frontier", "--shared-cache", install.shared, "--data", install.data);

    assert.match(result.stderr, /stillness/u, "localFolder is what names it, not the target");
});

test("a second import refuses rather than overwriting", async context =>
{
    const install = await Install(context);

    assert.equal(install.Run("--target", "frontier", "--shared-cache", install.shared, "--data", install.data).status, 0);

    const second = install.Run("--target", "frontier", "--shared-cache", install.shared, "--data", install.data);

    assert.equal(second.status, 1);
    assert.match(second.stderr, /already supplied/u);
    assert.equal(
        install.Run("--target", "frontier", "--shared-cache", install.shared, "--data", install.data, "--replace").status,
        0,
    );
});

test("no start.ini asks for the build rather than guessing one", async context =>
{
    const install = await Install(context, { startIni: false });
    const result = install.Run("--target", "frontier", "--shared-cache", install.shared, "--data", install.data);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /No start\.ini/u);
    assert.match(result.stderr, /--build/u);

    const named = install.Run(
        "--target", "frontier", "--shared-cache", install.shared, "--data", install.data, "--build", "109",
    );

    assert.equal(named.status, 0, named.stderr);
    await fs.access(path.join(install.data, "games", "frontier", "indexes", "109", "resfileindex.txt"));
});

test("a target that discovers its index will not take a supplied one", async context =>
{
    const install = await Install(context);
    const result = install.Run("--target", "eve", "--shared-cache", install.shared, "--data", install.data);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /app\s+file index/u, "importing one would be inert, so it is refused");
});

test("a dry run writes nothing", async context =>
{
    const install = await Install(context);
    const result = install.Run(
        "--target", "frontier", "--shared-cache", install.shared, "--data", install.data, "--dry-run",
    );

    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(() => fs.access(path.join(install.data, "games")));
});
