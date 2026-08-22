import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsToolCache } from "../src/index.js";

test("uses the shared index, ResFiles, and deterministic custom paths", async () =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-tools-core-"));
    const cache = new CjsToolCache(directory);
    const bytes = new TextEncoder().encode("character");
    const md5 = crypto.createHash("md5").update(bytes).digest("hex");
    const storagePath = `8f/8f44ee1a9a017bf2_${md5}`;

    assert.equal(
        cache.GetRemoteFilePath(storagePath),
        path.join(directory, "ResFiles", storagePath)
    );
    assert.equal(
        cache.GetIndexPath("eve", 3435006, "resfileindex.txt"),
        path.join(
            directory,
            "targets",
            "eve",
            "builds",
            "3435006",
            "indexes",
            "resfileindex.txt",
        )
    );
    assert.equal(
        cache.GetIndexPath("frontier", 3438337, "resfileindex.txt"),
        path.join(
            directory,
            "targets",
            "frontier",
            "builds",
            "3438337",
            "indexes",
            "resfileindex.txt",
        )
    );
    assert.equal(
        cache.GetCustomPath({ target: "eve", build: 3435006, name: "character", version: "v7" }),
        path.join(
            directory,
            "custom",
            "targets",
            "eve",
            "builds",
            "3435006",
            "character_v7.json",
        )
    );
    assert.equal(
        cache.GetCustomPath({
            target: "eve",
            build: 3435006,
            name: "sde",
            version: "v1",
            extension: "sqlite",
        }),
        path.join(
            directory,
            "custom",
            "targets",
            "eve",
            "builds",
            "3435006",
            "sde_v1.sqlite",
        )
    );

    const first = await cache.WriteRemote(storagePath, bytes, { md5, size: bytes.byteLength });
    const second = await cache.WriteRemote(storagePath, bytes, { md5, size: bytes.byteLength });
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.deepEqual(
        Buffer.from((await cache.ReadRemote(storagePath, { md5, size: bytes.byteLength })).bytes),
        Buffer.from(bytes)
    );
});

test("rejects friendly builds and paths outside the cache", () =>
{
    const cache = new CjsToolCache("cache");
    assert.throws(() => cache.GetCustomPath({ target: "eve", build: "latest", name: "character" }), /exact build/);
    assert.throws(() => cache.GetRemoteFilePath("../outside"), /storage path/);
    assert.throws(() => cache.GetRemoteFilePath("8f/../outside"), /storage path/);
    assert.throws(
        () => cache.GetCustomPath({
            target: "eve",
            build: 1,
            name: "sde",
            extension: "../sqlite",
        }),
        /custom extension/,
    );
});
