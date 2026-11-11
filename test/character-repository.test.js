import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsCharacterLibrary } from "@carbonenginejs/runtime/character";
import { CjsToolCache } from "../src/cache/index.js";
import { CjsToolCharacterRepository } from "../src/character/index.js";

const ROOT = "res:/graphics/character/female/paperdoll/hair/bob/";
const TYPE = ROOT + "types/bob.type", COLOR = ROOT + "dark.color";
const PATTERN = "patternColors: [!!python/tuple [0.2,0.2,0.2,1.0], !!python/tuple [0.6,0.6,0.6,1.0], !!python/tuple [0.5,0.5,0.5,1.0], !!python/tuple [0.5,0.5,0.5,1.0], !!python/tuple [0.5,0.5,0.5,1.0], !!python/tuple [0,0,8,8], 0.0]";
const FILES = {
    [TYPE]: "!!python/tuple [hair/bob, '', dark]\n",
    [COLOR]: `colors: [!!python/tuple [0.1,0.2,0.3,1], !!python/tuple [0,0,0,1], !!python/tuple [0,0,0,1]]\npattern: ''\n${PATTERN}\n`
};

/** An exact-build source over FILES, as CjsToolIndex.OpenTarget answers one; it counts what is opened and fetched. */
function Build()
{
    const counts = { opened: 0, fetched: [] };
    const source = {
        target: "eve",
        Match: () => Object.keys(FILES).map((logicalPath, index) => ({ logicalPath, location: "x/" + index, checksum: "c", uncompressedSize: 1 })),
        async Fetch(resourcePath)
        {
            counts.fetched.push(resourcePath);
            if (!Object.hasOwn(FILES, resourcePath)) throw new Error("unexpected " + resourcePath);
            return { bytes: new TextEncoder().encode(FILES[resourcePath]) };
        }
    };
    const indexes = {
        async ResolveTargetBuild() { throw new Error("exact builds must not resolve remotely"); },
        async OpenTarget() { counts.opened++; return source; }
    };
    return { counts, indexes };
}

async function Cache(context)
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-character-"));
    context.after(() => fs.rm(directory, { force: true, recursive: true }));
    return { directory, cache: new CjsToolCache(directory), file: version => path.join(directory, "custom", "targets", "eve", "builds", "3450001", `character_${version}.json`) };
}

test("a missing library is built from the build's files by the runtime builder and cached as version 1", async context =>
{
    const { cache, file } = await Cache(context);
    const { counts, indexes } = Build();
    const library = await new CjsToolCharacterRepository({ cache, indexes }).OpenTarget("eve", "3450001");

    assert.ok(library instanceof CjsCharacterLibrary);
    assert.deepEqual([ library.GetKindRecord("types", TYPE).partPath, library.GetKindRecord("types", TYPE).colorVariant ], [ "hair/bob", "dark" ]);
    assert.deepEqual(counts.fetched.sort(), [ COLOR, TYPE ].sort());
    const values = JSON.parse(await fs.readFile(file("v1"), "utf8"));
    assert.equal(values.schemaVersion, 1);
    assert.deepEqual(values.sourceNames.types, [ TYPE ]);
});

test("a cached library is read without opening the build; refresh rebuilds it", async context =>
{
    const { cache } = await Cache(context);
    const first = Build();
    await new CjsToolCharacterRepository({ cache, indexes: first.indexes }).OpenTarget("eve", "3450001");

    const second = Build();
    const repository = new CjsToolCharacterRepository({ cache, indexes: second.indexes });
    const cached = await repository.OpenTarget("eve", "3450001");
    assert.equal(second.counts.opened, 0);
    assert.equal(cached.GetKindRecord("colorVariations", COLOR)._pdpID, COLOR);

    await repository.OpenTarget("eve", "3450001", { refresh: true });
    assert.equal(second.counts.opened, 1);
});

test("an earlier format in the cache is not read; without auto-prepare the library is missing", async context =>
{
    const { cache, file } = await Cache(context);
    await fs.mkdir(path.dirname(file("v10")), { recursive: true });
    await fs.writeFile(file("v10"), JSON.stringify({ schema: "carbonenginejs.characterLibrary", schemaVersion: 11, documents: {} }));
    const repository = new CjsToolCharacterRepository({ cache, indexes: Build().indexes, autoPrepare: false });
    await assert.rejects(repository.OpenTarget("eve", "3450001"), error => error.statusCode === 404);
});
