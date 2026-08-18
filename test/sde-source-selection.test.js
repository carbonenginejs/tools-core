import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsSdeDatabase, CjsSdeRepository } from "../src/sde/index.js";
import { CjsToolCache } from "../src/cache/index.js";

/** Content differs per publisher so a test can tell which file answered. */
function TablesFor(provider)
{
    return {
        skins: {
            11542: { internalName: `${provider} skin`, types: [ 12015 ] }
        }
    };
}

function CreateCache()
{
    return new CjsToolCache(fs.mkdtempSync(path.join(os.tmpdir(), "cjs-sde-select-")));
}

/** Writes one prepared SDE where the repository looks for it. */
async function PrepareExport(cache, { provider, build, ...metadata })
{
    const databasePath = cache.GetCustomPath({
        game: "Eve",
        provider,
        build,
        name: "sde",
        version: "v1",
        extension: "sqlite"
    });
    const database = await CjsSdeDatabase.create(databasePath);

    await database.ImportTables(TablesFor(provider), { build, provider, ...metadata });
    await database.Close();

    return databasePath;
}

/** An archive that fails loudly: no test here may reach a remote channel. */
function CreateUnreachableArchive()
{
    return {
        async ResolveLatest()
        {
            throw new Error("official channel unreachable");
        },
        async PrepareDatabase()
        {
            throw new Error("official archive must not be prepared for this target");
        }
    };
}

test("a target with its own prepared SDE is answered from it, not the borrowed one", async () =>
{
    const cache = CreateCache();

    await PrepareExport(cache, { provider: "infinity", build: 3466057, target: "infinity" });

    const repository = new CjsSdeRepository({ cache, archive: CreateUnreachableArchive() });
    const resolution = await repository.ResolveTargetBuild("infinity", "latest");

    assert.equal(resolution.target, "infinity");
    assert.equal(resolution.provider, "infinity");
    assert.equal(resolution.build, "3466057");
    assert.equal(resolution.source, "prepared-export");
    assert.equal(resolution.borrowedFrom, null);

    const source = await repository.OpenTarget("infinity", "latest");
    const row = await source.Table("skins").Get("11542");

    assert.equal(row.payload.internalName, "infinity skin");

    await repository.Close();
});

test("a generated SDE is matched exactly and never trails to another build", async () =>
{
    const cache = CreateCache();

    await PrepareExport(cache, { provider: "infinity", build: 3466057, target: "infinity" });
    await PrepareExport(cache, { provider: "infinity", build: 3400000, target: "infinity" });

    const repository = new CjsSdeRepository({ cache, archive: CreateUnreachableArchive() });

    // The build that exists answers for itself.
    const exact = await repository.ResolveTargetBuild("infinity", 3400000);

    assert.equal(exact.build, "3400000");
    assert.equal(exact.source, "prepared-export");

    // A build that does not exist is not answered by a neighbouring generated
    // SDE. A generated SDE is built from one build's own inputs, so trailing
    // would pair it with resources it was never generated from.
    //
    // It is no longer answered by a borrow either: this target declares no
    // `topicSources`, so there is nobody to fall through to. Content flows from
    // Tranquility to the zh-primary targets and not back, and each carries SKINs
    // Tranquility never receives — EVE's SDE is a different answer, not a
    // stand-in for one not yet generated.
    //
    // A pinned build still resolves — resolving a reference and having an
    // an SDE are different questions — but it now resolves to the target
    // itself rather than to EVE, and carries no `borrowedFrom`. The absence is
    // reported when it is opened, which is where it can be true.
    const missing = await repository.ResolveTargetBuild("infinity", 3450000);

    assert.equal(missing.target, "infinity");
    assert.equal(missing.provider, "infinity");
    assert.equal(missing.borrowedFrom, null);
    assert.notEqual(missing.source, "prepared-export");
    await assert.rejects(() => repository.OpenTarget("infinity", 3450000));
});

/*
 * This replaces "a target with no SDE of its own still borrows, and says
 * so", which asserted the opposite. The open question that test was written
 * around — borrow, or fail and ask for the SDE to be generated — has been
 * decided against borrowing, on evidence rather than preference:
 *
 *   - Infinity has a different map and different game mechanics from both
 *     Serenity and Tranquility, so it is not a variant that EVE's data
 *     describes.
 *   - SKINs flow from Tranquility to the zh-primary targets and never back, and
 *     each of them carries SKINs Tranquility does not have. So EVE's SDE is
 *     not an approximation of theirs; it is wrong in the direction that matters
 *     most to anything reading a catalogue.
 *   - Borrowing is legible in `borrowedFrom` to a caller who thinks to look. A
 *     public page has no such field, and would present EVE's catalogue under a
 *     zh-primary name with nothing on screen saying so.
 *
 * The borrow mechanism itself is untouched and still exercised wherever a
 * target declares `topicSources`; these two simply no longer declare any.
 */
test("a target with no SDE of its own is refused, not answered from another's", async () =>
{
    const cache = CreateCache();

    await PrepareExport(cache, { provider: "ccp", build: 3466501 });

    const repository = new CjsSdeRepository({
        cache,
        archive: {
            async ResolveLatest()
            {
                return { build: "3466501", releaseDate: null, source: "exact-build" };
            },
            async PrepareDatabase()
            {
                throw new Error("already prepared");
            }
        }
    });

    // Neither is answered from the EVE SDE. They resolve a build — see the
    // defect note at the foot of this file — but opening refuses, because
    // `#Open` will not prepare a provider that has no channel of its own.
    for (const target of [ "serenity", "infinity" ])
    {
        await assert.rejects(() => repository.OpenTarget(target, "latest"));
    }

    // The EVE SDE is untouched and still answers for EVE.
    const eve = await repository.OpenTarget("eve", "latest");

    assert.equal((await eve.Table("skins").Get("11542")).payload.internalName, "ccp skin");

    await repository.Close();
});

test("the official target is unaffected and still reports no borrowing", async () =>
{
    const cache = CreateCache();

    await PrepareExport(cache, { provider: "ccp", build: 3466501 });

    const repository = new CjsSdeRepository({
        cache,
        archive: {
            async ResolveLatest()
            {
                return { build: "3466501", releaseDate: null, source: "exact-build" };
            },
            async PrepareDatabase()
            {
                throw new Error("already prepared");
            }
        }
    });
    const resolution = await repository.ResolveTargetBuild("eve", "latest");

    assert.equal(resolution.target, "eve");
    assert.equal(resolution.provider, "ccp");
    assert.equal(resolution.source, "exact-build");
    assert.equal(resolution.borrowedFrom, null);
});

test("a provider with no channel is never auto-prepared from another target's archive", async () =>
{
    const cache = CreateCache();
    const repository = new CjsSdeRepository({ cache, archive: CreateUnreachableArchive() });

    // Nothing is prepared for netease, so the request falls through to the
    // declared borrow and fails there against the unreachable remote channel.
    // What must never happen is the EVE archive being written into another
    // path, producing a file whose location claims one target and whose
    // contents are another's.
    await assert.rejects(() => repository.OpenTarget("infinity", 3466057));

    const infinityPath = cache.GetCustomPath({
        game: "Eve",
        provider: "infinity",
        build: 3466057,
        name: "sde",
        version: "v1",
        extension: "sqlite"
    });

    assert.equal(fs.existsSync(infinityPath), false);
});
