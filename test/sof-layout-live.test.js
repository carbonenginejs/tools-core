import assert from "node:assert/strict";
import test from "node:test";
import { EveSOF } from "@carbonenginejs/runtime/sof";
import { CjsToolHttpProxy } from "../src/proxy/CjsToolHttpProxy.js";
import { CjsToolSofRepository } from "../src/sof/CjsToolSofRepository.js";

// Opt in with an exact-build tools resource base, for example
// CJS_SOF_LAYOUT_RESOURCE_BASE=http://localhost:5510/eve/3561556.
// Acquire through tools HTTP only; no decoded game data is checked in.
const resourceBase = process.env.CJS_SOF_LAYOUT_RESOURCE_BASE;
test("real deathless hangar retains every available placement and returns HTTP 200", { skip: !resourceBase }, async context =>
{
    const dna = "mdeha01:deathless:deathless:layout?deathless_hangar";
    const base = "res:/dx9/model/spaceobjectfactory";
    const pathsResponse = await fetch(resourceBase + "/resfiles");
    assert.equal(pathsResponse.status, 200);
    const paths = await pathsResponse.json();
    const records = new Map();
    const failures = new Map();
    const Read = async logicalPath =>
    {
        if (records.has(logicalPath)) return records.get(logicalPath);
        const response = await fetch(resourceBase + "/resources/" + logicalPath.slice(5) + "?format=json");
        if (!response.ok)
        {
            const error = new Error(logicalPath + ": HTTP " + response.status);
            failures.set(logicalPath, error);
            throw error;
        }
        const value = (await response.json()).object;
        records.set(logicalPath, value);
        return value;
    };
    const sof = (await new EveSOF().Register({ lazyData: { source: Read }, resFileIndex: paths }));
    const options = { seedOverwrite: 658 };
    const values = await sof.BuildValuesFromDNAAsync(dna, options);
    assert.equal(values._type, "EveStation2");
    const missing = base + "/hulls/mmipr_xl_01a.black";
    assert.ok(failures.has(missing));
    assert.ok((await sof.GetSofLibraryBuilder()).GetLoadErrors().some(item => item.path === missing && item.error === failures.get(missing)));
    const layout = records.get(base + "/layouts/deathless_hangar.black");
    const CheckDescriptors = value =>
    {
        if (!value || typeof value !== "object") return;
        if (value.descriptor?.hull)
        {
            for (const hull of value.descriptor.hull.split(";"))
            {
                const path = base + "/hulls/" + hull + ".black";
                if (paths.includes(path)) assert.ok(records.has(path), "Available hull not fetched: " + hull);
                else assert.ok(failures.has(path), "Missing hull not reported: " + hull);
            }
        }
        for (const child of Object.values(value)) CheckDescriptors(child);
    };
    CheckDescriptors(layout);
    const plan = (await sof.PlanLayoutFromDNA(dna, options));
    const container = values.effectChildren.find(child => child.name === "layouts");
    assert.ok(container);
    const geometry = new Set();
    let instances = 0;
    const Inspect = value =>
    {
        if (!value || typeof value !== "object") return;
        if (value.geometryResPath) geometry.add(value.geometryResPath);
        if (value._type === "Tr2InstancedMesh") instances += value.instanceGeometryResource.rows.length;
        for (const child of Object.values(value)) Inspect(child);
    };
    Inspect(container);
    assert.equal(instances, plan.placements.filter(item => item.isInstanced).length);
    for (const placement of plan.placements)
    {
        const hull = records.get(base + "/hulls/" + placement.descriptor.hull + ".black");
        if (hull.geometryResFilePath) assert.ok(geometry.has(hull.geometryResFilePath), "Placement absent: " + placement.name);
    }
    // Negative control: restoring fail-fast catalog loading rejects this same asset.
    const negative = (await new EveSOF().Register({ lazyData: { source: Read }, resFileIndex: paths }));
    (await negative.GetSofLibraryBuilder())._ResolveNamedOperation = async operation => operation;
    await assert.rejects(negative.BuildValuesFromDNAAsync(dna, options), /mmipr_xl_01a.black/);

    const source = {
        target: "eve", game: "Eve", provider: "ccp", build: "3561556", buildRef: "3561556", client: "tranquility",
        Match() { return paths.map(logicalPath => ({ logicalPath })); },
        async Fetch(logicalPath) { return { bytes: await Read(logicalPath) }; },
    };
    const proxy = new CjsToolHttpProxy({
        indexes: {
            Open() {},
            async ResolveTargetBuild() { return source; },
            async OpenTarget() { return source; },
        },
        sof: new CjsToolSofRepository(),
    });
    const server = proxy.CreateServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    context.after(() => new Promise(resolve => server.close(resolve)));
    const root = "http://127.0.0.1:" + server.address().port + "/eve/3561556/sof";
    const response = await fetch(root + "/dna/" + dna);
    assert.equal(response.status, 200);
    assert.equal((await response.json())._type, "EveStation2");
    assert.equal((await fetch(root + "/hulls/mmipr_xl_01a")).status, 404);
    context.diagnostic("Loaded " + records.size + " catalogs; retained " + plan.placements.length + " placements (" + instances + " instanced); missing paths: " + [...failures.keys()].join(", "));
});
