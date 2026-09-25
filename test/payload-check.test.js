import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { resFileAddress } from "@carbonenginejs/runtime/utils/resfile";

import { CjsToolCache, CjsToolPayloadCheck } from "../src/index.js";

const md5 = bytes => crypto.createHash("md5").update(bytes).digest("hex");

function CreateCache(context)
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-payload-check-"));
    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));
    return new CjsToolCache(directory);
}

test("validateBytes checks size and md5 and returns a Buffer", () =>
{
    const bytes = Buffer.from("hull");
    const record = { logicalPath: "res:/a.dds", checksum: md5(bytes), uncompressedSize: 4 };

    assert.ok(Buffer.isBuffer(CjsToolPayloadCheck.validateBytes(bytes, record)));
    assert.throws(() => CjsToolPayloadCheck.validateBytes(Buffer.from("hulk"), record), /Invalid checksum/u);
    assert.throws(() => CjsToolPayloadCheck.validateBytes(Buffer.from("hull!"), record), /Invalid byte length/u);
    assert.ok(CjsToolPayloadCheck.validateBytes(Buffer.from("anything"), {}), "no claim, nothing to check");
});

test("describe names originals, their gzip copies, conversions and everything else", () =>
{
    const address = resFileAddress("res:/a.dds", md5(Buffer.from("hull")));

    assert.equal(CjsToolPayloadCheck.describe(address).kind, "original");
    assert.equal(CjsToolPayloadCheck.describe(`${address}.gz`).kind, "compressed");
    const converted = CjsToolPayloadCheck.describe(`${address}.png`);
    assert.equal(converted.kind, "converted");
    assert.equal(converted.address, address);
    assert.equal(converted.suffix, "png");
    assert.equal(CjsToolPayloadCheck.describe(`${address}.webgpu.gz`).compressed, true);
    assert.equal(CjsToolPayloadCheck.describe("graphics/effect.webgpu/x.sm_hi").kind, "unaddressed");
});

test("verifyStored follows a conversion to its gzipped source and checks the source", async context =>
{
    const cache = CreateCache(context);
    const original = Buffer.from("the dds as CCP published it");
    const address = resFileAddress("res:/texture.dds", md5(original));
    const png = Buffer.from("a png made from it");

    // The cache migrates originals to their .gz copy and deletes the raw file.
    await cache.WriteRemote(`${address}.gz`, gzipSync(original));
    await cache.WriteRemote(`${address}.png`, png);

    const converted = await CjsToolPayloadCheck.verifyStored(cache, `${address}.png`, {
        logicalPath: "res:/texture.dds",
        record: { checksum: md5(png), uncompressedSize: png.byteLength },
    });
    assert.equal(converted.status, "ok", converted.reason);
    assert.equal((await CjsToolPayloadCheck.verifyStored(cache, address)).status, "ok");
    assert.equal((await CjsToolPayloadCheck.verifyStored(cache, `${address}.gz`)).status, "ok");

    assert.equal(
        (await CjsToolPayloadCheck.verifyStored(cache, `${address}.png`, { logicalPath: "res:/other.dds" })).status,
        "mismatch", "the path half of the address is checked");
    assert.equal(
        (await CjsToolPayloadCheck.verifyStored(cache, `${address}.png`, { record: { checksum: md5(original) } })).status,
        "mismatch", "a supplied record checks the converted bytes themselves");
});

test("verifyStored reports a changed original, a missing source and an unaddressed name", async context =>
{
    const cache = CreateCache(context);
    const original = Buffer.from("published");
    const address = resFileAddress("res:/a.dds", md5(original));

    assert.equal((await CjsToolPayloadCheck.verifyStored(cache, `${address}.png`)).status, "missing");

    await cache.WriteRemote(address, Buffer.from("tampered"));
    assert.equal((await CjsToolPayloadCheck.verifyStored(cache, address)).status, "mismatch");

    assert.equal((await CjsToolPayloadCheck.verifyStored(cache, "graphics/x.sm_hi")).status, "unverifiable");
});
