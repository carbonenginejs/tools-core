// Custody for one refresh token. Everything here is offline and on a temp dir.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CjsToolTokenFile } from "../src/auth/CjsToolTokenFile.js";

async function MakeStore()
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-token-"));

    return { directory, store: new CjsToolTokenFile({ directory }) };
}

test("requires a directory and a usable name", () =>
{
    assert.throws(() => new CjsToolTokenFile({}), /requires a directory/u);
    assert.throws(() => new CjsToolTokenFile({ directory: "x", name: "///" }), /usable name/u);
});

test("nothing stored reads as null rather than failing", async () =>
{
    const { store } = await MakeStore();

    assert.equal(await store.Read(), null);
});

test("a stored token round-trips", async () =>
{
    const { store } = await MakeStore();

    await store.Write({ refreshToken: "r-1", characterId: 90000001 });
    const record = await store.Read();

    assert.equal(record.refreshToken, "r-1");
    assert.equal(record.characterId, 90000001);
});

test("rotation replaces the token and leaves no temporary behind", async () =>
{
    const { directory, store } = await MakeStore();

    await store.Write({ refreshToken: "r-1" });
    await store.Write({ refreshToken: "r-2" });

    assert.equal((await store.Read()).refreshToken, "r-2");

    // A leftover temp file would be a second copy of a live credential.
    const entries = await fs.readdir(directory);
    assert.deepEqual(entries, [ "esi.json" ], `unexpected files: ${entries.join(", ")}`);
});

test("a refresh that returns nothing cannot destroy a working token", async () =>
{
    const { store } = await MakeStore();

    await store.Write({ refreshToken: "still-good" });

    for (const bad of [ undefined, null, "", 0, {} ])
    {
        await assert.rejects(() => store.Write({ refreshToken: bad }), /without a refreshToken/u);
    }
    await assert.rejects(() => store.Write(null), /without a refreshToken/u);

    assert.equal((await store.Read()).refreshToken, "still-good");
});

test("a corrupt store is reported, not silently treated as logged out", async () =>
{
    const { store } = await MakeStore();

    await store.Write({ refreshToken: "r-1" });
    await fs.writeFile(store.file, "{ not json", "utf8");

    await assert.rejects(() => store.Read(), /unreadable/u);
    // Still there: it is the only copy of a long-lived credential.
    assert.ok(await fs.readFile(store.file, "utf8"));
});

test("a foreign document is refused rather than half-read", async () =>
{
    const { store } = await MakeStore();

    await fs.writeFile(store.file, JSON.stringify({ refreshToken: "r" }), "utf8");

    await assert.rejects(() => store.Read(), /unreadable/u);
});

test("clear removes it, and clearing nothing is fine", async () =>
{
    const { store } = await MakeStore();

    await store.Write({ refreshToken: "r-1" });
    await store.Clear();

    assert.equal(await store.Read(), null);
    await store.Clear();
});

test("the accessors are the injected-custody pair", async () =>
{
    const { store } = await MakeStore();
    const { getRefreshToken, setRefreshToken } = store.CreateAccessors();

    assert.equal(await getRefreshToken(), null);

    await setRefreshToken("r-1", { characterId: 7 });

    assert.equal(await getRefreshToken(), "r-1");
    assert.equal((await store.Read()).characterId, 7);
});

test("the token never appears in an error message", async () =>
{
    const { store } = await MakeStore();
    const secret = "super-secret-refresh-token";

    await store.Write({ refreshToken: secret });
    // At byte ZERO. Node quotes the first ten characters of an unparseable
    // document in its own error, so anything less than this passes by luck.
    await fs.writeFile(store.file, secret, "utf8");

    await assert.rejects(() => store.Read(), error =>
    {
        assert.ok(!error.message.includes(secret), "a token must never reach an error message");
        return true;
    });
});

test("the file is created private", { skip: process.platform === "win32" }, async () =>
{
    const { store } = await MakeStore();

    await store.Write({ refreshToken: "r-1" });

    const stats = await fs.stat(store.file);
    assert.equal(stats.mode & 0o777, 0o600, "the token must not be group or world readable");
});
