import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CjsToolBuildCache } from "../src/internal/CjsToolBuildCache.js";
import { CjsToolHttpProxy } from "../src/proxy/CjsToolHttpProxy.js";
import { CjsToolCache } from "../src/cache/CjsToolCache.js";
import { CjsToolSdeRepository } from "../src/sde/CjsToolSdeRepository.js";
import { CjsToolSdeDatabase } from "../src/sde/CjsToolSdeDatabase.js";

test("idle expiry closes SDE handles and the next HTTP request reopens them", async context =>
{
    let now = 0;
    const memory = new CjsToolBuildCache({ idleMs: 100, now: () => now });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-build-cache-"));
    const cache = new CjsToolCache(directory);
    const file = cache.GetCustomPath({ target: "eve", game: "Eve", provider: "ccp",
        build: "100", name: "sde", version: "v1", extension: "sqlite" });
    const database = await CjsToolSdeDatabase.create(file);
    await database.ImportTables({ skins: { 1: { internalName: "Fixture" } } }, { build: 100 });
    await database.Close();
    const repository = new CjsToolSdeRepository({ cache, memory, autoPrepare: false });
    const proxy = new CjsToolHttpProxy({ sde: repository, memory });
    const server = proxy.CreateServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    context.after(async () =>
    {
        await new Promise(resolve => server.close(resolve));
        await memory.Close();
        await repository.Close();
        await fs.rm(directory, { recursive: true, force: true });
    });
    const url = `http://127.0.0.1:${server.address().port}/eve/100/sde`;
    const first = await fetch(url);
    assert.equal(first.status, 200);
    const before = await first.json();
    const source = await memory.Run(() => repository.OpenTarget("eve", "100"));
    assert.equal(memory.GetStats().owners["sde.sources"], 1);
    now = 99;
    await memory.Sweep();
    assert.equal(memory.GetStats().owners["sde.sources"], 1, "negative control before TTL");
    await source.Describe();
    now = 100;
    await memory.Sweep();
    assert.equal(memory.GetStats().entries, 0);
    await assert.rejects(() => source.Describe(), "expired SQLite handle is closed");
    const second = await fetch(url);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), before);
    assert.equal(memory.GetStats().owners["sde.sources"], 1);
    const reopened = await memory.Run(() => repository.OpenTarget("eve", "100"));
    assert.notEqual(reopened, source);
});

test("queued expiry admits requests while active handlers still own their handles", async () =>
{
    let now = 0;
    let release;
    let entered;
    let closed = 0;
    const ready = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const memory = new CjsToolBuildCache({ idleMs: 1, now: () => now });
    const owners = memory.CreateMap("sources", key => ["eve", key], { close: () => { closed++; } });
    const active = memory.Run(async () =>
    {
        owners.set("1", {});
        entered();
        await gate;
        assert.equal(closed, 0, "in-flight owner must remain usable");
    });
    await ready;
    now = 2;
    const sweeping = memory.Sweep();
    let nextEntered = false;
    const next = memory.Run(() =>
    {
        nextEntered = true;
        assert.equal(closed, 0);
    });
    await Promise.resolve();
    assert.equal(nextEntered, true, "a slow request must not hold unrelated requests behind expiry");
    assert.equal(closed, 0);
    release();
    await Promise.all([active, sweeping, next]);
    assert.equal(owners.size, 0);
    await memory.Close();
});

test("actual handle retirement blocks new requests until asynchronous close finishes", async () =>
{
    let release;
    let closing;
    let now = 0;
    const began = new Promise(resolve => { closing = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const memory = new CjsToolBuildCache({ idleMs: 1, now: () => now });
    const owners = memory.CreateMap("sources", key => ["eve", key], {
        close: async () => { closing(); await gate; },
    });
    owners.set("1", {});
    now = 2;
    const sweeping = memory.Sweep();
    await began;
    let entered = false;
    const next = memory.Run(() => { entered = true; });
    await Promise.resolve();
    assert.equal(entered, false, "closed handles cannot be adopted during retirement");
    release();
    await Promise.all([sweeping, next]);
    assert.equal(entered, true);
    await memory.Close();
});

test("current resource/SDE pair counts once; pinned owners get their short idle window", async () =>
{
    let now = 0;
    const memory = new CjsToolBuildCache({ idleMs: 10, currentIdleMs: 100,
        maximumBuilds: 2, now: () => now });
    const owners = memory.CreateMap("sources", key => ["eve", key]);
    memory.MarkCurrent("eve", "resources", "3");
    memory.MarkCurrent("eve", "sde", "2");
    owners.set("3", {});
    owners.set("2", {});
    owners.set("1", {});
    await memory.Sweep();
    assert.equal(owners.size, 3, "switching builds alone must not evict pinned owners");
    assert.equal(memory.GetStats().residentUnits, 2);
    now = 10;
    await memory.Sweep();
    assert.deepEqual([...owners.keys()], ["3", "2"]);
    now = 100;
    await memory.Sweep();
    assert.equal(owners.size, 0);
    await memory.Close();
});

test("total backstop retires a complete current pair after idle expiry", async () =>
{
    let now = 0;
    const memory = new CjsToolBuildCache({ maximumBuilds: 1, now: () => now });
    const owners = memory.CreateMap("sources", key => key.split(":"));
    memory.MarkCurrent("eve", "resources", "2");
    memory.MarkCurrent("eve", "sde", "1");
    owners.set("eve:1", {});
    owners.set("eve:2", {});
    now++;
    memory.MarkCurrent("frontier", "resources", "9");
    owners.set("frontier:9", {});
    await memory.Sweep();
    assert.deepEqual([...owners.keys()], ["frontier:9"]);
    await memory.Close();
});

test("fallback identity retires aliases and dependent composers before closing", async () =>
{
    let now = 0;
    const memory = new CjsToolBuildCache({ idleMs: 1, now: () => now });
    const dependent = memory.CreateMap("localisation", key => [key, "8"], { dependent: true });
    let closed = 0;
    const sources = memory.CreateMap("sde", key => ["eve", key], { close: () =>
    {
        assert.equal(dependent.size, 0, "cross-target references removed before close");
        closed++;
    } });
    const source = {};
    sources.set("9", source);
    memory.SetIdentity(sources, "9", "eve", "7");
    sources.set("7", source);
    dependent.set("infinity", source);
    now = 1;
    await memory.Sweep();
    assert.equal(closed, 1, "aliases close a handle only once");
    assert.equal(memory.GetStats().entries, 0);
    await memory.Close();
});

test("configurable current history counts every resource/SDE pair", async () =>
{
    const memory = new CjsToolBuildCache({ currentBuildsPerTarget: 2, maximumBuilds: 2 });
    const owners = memory.CreateMap("sources", key => ["eve", key]);
    for (const [facet, build] of [["resources", "1"], ["sde", "2"], ["resources", "3"], ["sde", "4"]])
    {
        memory.MarkCurrent("eve", facet, build);
        owners.set(build, {});
    }
    assert.equal(memory.GetStats().residentUnits, 2);
    await memory.Sweep();
    assert.equal(owners.size, 4);
    await memory.Close();
});

test("latest HTTP build lookup preserves a split current pair for pinned requests", async context =>
{
    let now = 0;
    const memory = new CjsToolBuildCache({ idleMs: 1, currentIdleMs: 100,
        maximumBuilds: 1, now: () => now });
    const owners = memory.CreateMap("fixture", key => ["eve", key]);
    const proxy = new CjsToolHttpProxy({ memory, indexes: {
        Open() {},
        async ResolveTargetBuild()
        {
            return { target: "eve", build: "20" };
        }
    }, sde: {
        OpenTarget() {},
        async ResolveTargetBuild()
        {
            return { target: "eve", build: "19" };
        }
    } });
    const server = proxy.CreateServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    context.after(async () =>
    {
        await new Promise(resolve => server.close(resolve));
        await memory.Close();
    });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/eve/latest/build`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.builds.resources, "20");
    assert.equal(result.builds.sde, "19");
    owners.set("20", {});
    owners.set("19", {});
    now = 2;
    await memory.Sweep();
    assert.equal(owners.size, 2);
    assert.equal(memory.GetStats().residentUnits, 1);
});

test("distinct fallback SDE handles cannot hide behind one actual build", async () =>
{
    const memory = new CjsToolBuildCache({ maximumBuilds: 2 });
    let closed = 0;
    const owners = memory.CreateMap("sde", key => ["eve", key], { close: () => { closed++; } });
    for (const key of ["7", "8", "9"])
    {
        owners.set(key, {});
        memory.SetIdentity(owners, key, "eve", "6", "sde");
    }
    assert.equal(memory.GetStats().residentUnits, 3);
    await memory.Sweep();
    assert.equal(closed, 3);
    assert.equal(owners.size, 0);
    await memory.Close();
});

test("SDE fallback changes only its facet, leaving the current resource build intact", async () =>
{
    let now = 0;
    const memory = new CjsToolBuildCache({ idleMs: 1, currentIdleMs: 100, now: () => now });
    const resources = memory.CreateMap("resources", key => ["eve", key]);
    const sources = memory.CreateMap("sde", key => ["eve", key]);
    memory.MarkCurrent("eve", "resources", "9");
    memory.MarkCurrent("eve", "sde", "9");
    resources.set("9", {});
    sources.set("9", {});
    memory.SetIdentity(sources, "9", "eve", "7", "sde");
    now = 2;
    await memory.Sweep();
    assert.equal(resources.size, 1);
    assert.equal(sources.size, 1);
    assert.equal(memory.GetStats().residentUnits, 1);
    await memory.Close();
});

test("overlapping facet history still counts each current resource build", async () =>
{
    const memory = new CjsToolBuildCache({ currentBuildsPerTarget: 2 });
    const owners = memory.CreateMap("resources", key => ["eve", key]);
    memory.MarkCurrent("eve", "resources", "1");
    memory.MarkCurrent("eve", "sde", "1");
    memory.MarkCurrent("eve", "resources", "2");
    owners.set("1", {});
    owners.set("2", {});
    assert.equal(memory.GetStats().residentUnits, 2);
    await memory.Close();
});

test("repeated latest lookup preserves an already-open fallback SDE identity", async () =>
{
    let now = 0;
    const memory = new CjsToolBuildCache({ idleMs: 1, currentIdleMs: 100, now: () => now });
    const owners = memory.CreateMap("sde", key => ["eve", key]);
    owners.set("9", {});
    for (let i = 0; i < 2; i++)
    {
        memory.MarkCurrent("eve", "sde", "9");
        memory.SetIdentity(owners, "9", "eve", "7", "sde");
    }
    now = 2;
    await memory.Sweep();
    assert.equal(owners.size, 1);
    await memory.Close();
});
