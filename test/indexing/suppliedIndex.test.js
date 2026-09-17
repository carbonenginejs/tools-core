import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    CjsToolIndex,
    CjsToolIndexSuppliedStore,
    CjsToolIndexTargetProfileRegistry,
    CjsToolTargetRegistry,
    DefaultIndexProfileData,
} from "../../src/index.js";

const Targets = new CjsToolTargetRegistry([ {
    id: "test",
    game: "Eve",
    provider: "synthetic",
    client: "live",
    libraries: [],
    topics: [ "app", "res" ],
} ]);

// A publisher whose binaries are not public. The app file index exists to
// discover the resource index and where to fetch it; when both are already
// known it has nothing left to say, and on such a target it is usually
// unreachable - which is the whole reason the index is supplied.
const Profile = Object.freeze({
    target: "test",
    game: "Eve",
    provider: "synthetic",
    defaultBuildRef: "latest",
    indexSource: "supplied",
    remote: Object.freeze({
        metadataBaseUrl: "https://metadata.test",
        indexBaseUrl: "https://indexes.test",
        appBaseUrl: "https://app.test",
        resBaseUrl: "https://res.test",
    }),
    clients: Object.freeze({
        live: Object.freeze({ metadataToken: "LIVE" }),
    }),
});

/** A data root with the named builds supplied, plus a fetch that records calls. */
async function Fixture(context, builds)
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-supplied-"));

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    for (const [ build, files ] of Object.entries(builds))
    {
        const buildDirectory = path.join(directory, "games", "test", "indexes", build);

        await fs.mkdir(buildDirectory, { recursive: true });
        for (const [ name, text ] of Object.entries(files))
        {
            await fs.writeFile(path.join(buildDirectory, name), text, "utf8");
        }
    }

    const requests = [];
    const tool = new CjsToolIndex({
        profiles: new CjsToolIndexTargetProfileRegistry([ Profile ]),
        targets: Targets,
        cache: null,
        supplied: new CjsToolIndexSuppliedStore(directory),
        fetch: async url =>
        {
            requests.push(String(url));

            return { ok: true, status: 200, headers: new Map(), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
        },
    });

    return { directory, requests, tool };
}

function Row(logicalPath, storagePath)
{
    return [ logicalPath, storagePath, "", "", "", "" ].join(",");
}

test("a supplied index opens a build with no app index fetched at all", async context =>
{
    const { requests, tool } = await Fixture(context, {
        77: {
            "resfileindex.txt": `${Row("res:/ship.red", "aa/ship")}\n`,
            "resfileindex_windows.txt": `${Row("res:/shader.sm_hi", "bb/shader")}\n`,
        },
    });
    const source = await tool.OpenTarget("test", "77");

    assert.equal(source.build, "77");
    assert.equal(source.Resolve("res:/ship.red").record.storagePath, "aa/ship");
    assert.equal(
        source.Resolve("res:/shader.sm_hi").record.storagePath,
        "bb/shader",
        "the file name carries the group name, as the app index's declaration would",
    );
    assert.deepEqual(requests, [], "nothing is fetched to open a build that was supplied");
});

test("latest is the newest build supplied, not the newest published", async context =>
{
    const { tool } = await Fixture(context, {
        77: { "resfileindex.txt": `${Row("res:/old.red", "aa/old")}\n` },
        109: { "resfileindex.txt": `${Row("res:/new.red", "bb/new")}\n` },
    });

    // The metadata file is never asked: a build we cannot read is not a build
    // this service can answer with, and naming it would put a 404 in every URL.
    assert.equal((await tool.ResolveTargetBuild("test", "latest")).build, "109");
    assert.equal((await tool.OpenTarget("test", "latest")).build, "109");
});

test("a directory without a main index is not a build", async context =>
{
    const { tool } = await Fixture(context, {
        77: { "resfileindex.txt": `${Row("res:/old.red", "aa/old")}\n` },
        // A drop still arriving: the directory is there, the index is not.
        109: { "resfileindex_windows.txt": `${Row("res:/new.red", "bb/new")}\n` },
    });

    assert.equal((await tool.ResolveTargetBuild("test", "latest")).build, "77");
});

test("a build nobody supplied says where to put it, as a 404", async context =>
{
    const { directory, tool } = await Fixture(context, {
        77: { "resfileindex.txt": `${Row("res:/old.red", "aa/old")}\n` },
    });

    await assert.rejects(
        () => tool.OpenTarget("test", "109"),
        error => error.statusCode === 404
            && error.message.includes(path.join(directory, "games", "test", "indexes", "109"))
            && error.message.includes("resfileindex.txt"),
    );
});

test("a supplied target with no store configured says so", async context =>
{
    const { directory } = await Fixture(context, {});
    const tool = new CjsToolIndex({
        profiles: new CjsToolIndexTargetProfileRegistry([ Profile ]),
        targets: Targets,
        cache: null,
        fetch: async () => { throw new Error("no request should be made"); },
    });

    assert.ok(directory);
    await assert.rejects(
        () => tool.OpenTarget("test", "latest"),
        /supplies its own resource index/u,
    );
});

test("frontier is the target this exists for", () =>
{
    const profiles = new CjsToolIndexTargetProfileRegistry(DefaultIndexProfileData);

    assert.equal(profiles.Get("frontier").indexSource, "supplied");
    assert.equal(profiles.Get("eve").indexSource, "app");
    assert.equal(profiles.Get("serenity").indexSource, "app");
});
