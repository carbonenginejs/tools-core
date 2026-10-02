import assert from "node:assert/strict";
import test from "node:test";
import { CjsToolHttpProxy } from "../src/proxy/CjsToolHttpProxy.js";
import { CjsToolSofRepository } from "../src/sof/CjsToolSofRepository.js";

test("DNA route retains available layout parts while the missing hull remains a 404", async context =>
{
    const base = "res:/dx9/model/spaceobjectfactory";
    const Hull = name => ({ name, buildClass: 0, geometryResFilePath: "res:/" + name + ".gr2", opaqueAreas: [] });
    const records = new Map([
        [base + "/generic.black", { materialPrefixes: [], variants: [] }],
        [base + "/hulls/root.black", { ...Hull("root"), locatorSets: [{ name: "spots", locators: [
            { position: [1, 0, 0], rotation: [0, 0, 0, 1], scaling: [1, 1, 1], boneIndex: -1 },
        ] }] }],
        [base + "/hulls/before.black", Hull("before")],
        [base + "/hulls/after.black", Hull("after")],
        [base + "/factions/faction.black", { name: "faction" }],
        [base + "/races/race.black", { name: "race" }],
        [base + "/layouts/hangar.black", { name: "hangar", seed: 1, placements:
            ["before", "missing", "after"].map(name => ({ name, locatorSetName: "spots", descriptor: { hull: name }, isInstanced: false, isShared: false })),
        }],
    ]);
    const failures = new Map();
    const source = {
        target: "eve", game: "Eve", provider: "ccp", build: "1", buildRef: "1", client: "tranquility",
        Match()
        {
            return [...records.keys()].map(logicalPath => ({ logicalPath }));
        },
        async Fetch(logicalPath)
        {
            if (records.has(logicalPath)) return { bytes: records.get(logicalPath) };
            const error = new Error("Unavailable: " + logicalPath);
            failures.set(logicalPath, error);
            throw error;
        },
    };
    const repository = new CjsToolSofRepository();
    const proxy = new CjsToolHttpProxy({
        indexes: {
            Open() {},
            async ResolveTargetBuild() { return source; },
            async OpenTarget() { return source; },
        },
        sof: repository,
    });
    const server = proxy.CreateServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    context.after(() => new Promise(resolve => server.close(resolve)));
    const url = "http://127.0.0.1:" + server.address().port + "/eve/1/sof";
    for (const selection of ["root:faction:race:layout?hangar", "root:faction:race:layout%3Fhangar"])
    {
        const response = await fetch(url + "/dna/" + selection);
        assert.equal(response.status, 200);
        const values = await response.json();
        assert.equal(values._type, "EveShip2");
        assert.ok(JSON.stringify(values).includes("res:/before.gr2"));
        assert.ok(JSON.stringify(values).includes("res:/after.gr2"));
        assert.ok(!JSON.stringify(values).includes("res:/missing.gr2"));
    }
    assert.ok(failures.has(base + "/hulls/missing.black"));
    assert.equal((await fetch(url + "/hulls/missing")).status, 404);
    assert.equal((await fetch(url + "/dna/missing:faction:race")).status, 404);
    assert.equal((await fetch(url + "/dna/root:missing:race")).status, 404);
    assert.equal((await fetch(url + "/dna/root:faction:missing")).status, 404);
});
