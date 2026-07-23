import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { CjsToolAudioPrefetch } from "../src/audio/index.js";
import { CjsToolPrefetch } from "../src/prefetch/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prefetchCli = path.join(root, "bin", "cjs-tools-prefetch.js");
const serviceCli = path.join(root, "bin", "cjs-tools-service.js");

class FixtureProfile
{

    constructor(name, values, contexts = [])
    {
        this.name = name;
        this.values = values;
        this.contexts = contexts;
    }

    async Resolve(context)
    {
        this.contexts.push(context);

        return this.values;
    }

}

function CreateIndexes(
    {
        fetchResults = new Map(),
        resolveCalls = [],
        openCalls = [],
        fetchCalls = [],
        activity = null,
    } = {},
)
{
    return {
        async ResolveTargetBuild(target, build, options)
        {
            resolveCalls.push({ target, build, options });

            return {
                target,
                game: "Eve",
                provider: "ccp",
                buildRef: build,
                build: "123",
                client: options.client ?? "tranquility",
            };
        },
        async OpenTarget(target, build, options)
        {
            openCalls.push({ target, build, options });

            return {
                async Fetch(logicalPath, fetchOptions)
                {
                    fetchCalls.push({ logicalPath, options: fetchOptions });

                    if (activity)
                    {
                        activity.active++;
                        activity.maximum = Math.max(
                            activity.maximum,
                            activity.active,
                        );
                        await new Promise(resolve => setImmediate(resolve));
                        activity.active--;
                    }

                    return fetchResults.get(logicalPath) ?? {
                        byteLength: 1,
                        cacheHit: false,
                    };
                },
            };
        },
    };
}

test("prefetch resolves one exact build and acquires deduplicated paths", async () =>
{
    const resolveCalls = [];
    const openCalls = [];
    const fetchCalls = [];
    const contexts = [];
    const progress = [];
    const activity = { active: 0, maximum: 0 };
    const indexes = CreateIndexes({
        resolveCalls,
        openCalls,
        fetchCalls,
        activity,
        fetchResults: new Map([
            [ "app:/shared.bin", { byteLength: 4, cacheHit: true } ],
            [ "res:/alpha.bin", { byteLength: 6, cacheHit: false } ],
            [ "res:/beta.bin", { byteLength: 8, cacheHit: false } ],
        ]),
    });
    const prefetch = new CjsToolPrefetch({
        indexes,
        profiles: [
            new FixtureProfile("beta", [
                "res:/beta.bin",
                "APP:/SHARED.BIN",
            ], contexts),
            new FixtureProfile("alpha", [
                "res:/alpha.bin",
                "app:/shared.bin",
            ], contexts),
        ],
    });
    const report = await prefetch.Prefetch({
        target: "eve",
        build: "latest",
        profiles: "beta,alpha",
        concurrency: 3,
        onProgress(value)
        {
            progress.push(value);
        },
    });

    assert.deepEqual(resolveCalls, [ {
        target: "eve",
        build: "latest",
        options: { client: "tranquility" },
    } ]);
    assert.deepEqual(openCalls, [ {
        target: "eve",
        build: "123",
        options: { client: "tranquility" },
    } ]);
    assert.equal(contexts.length, 2);
    assert.ok(contexts.every(context => context.build === "123"));
    assert.ok(contexts.every(context => Object.isFrozen(context)));
    assert.deepEqual(
        fetchCalls.map(call => call.logicalPath).sort(),
        [ "app:/shared.bin", "res:/alpha.bin", "res:/beta.bin" ],
    );
    assert.ok(fetchCalls.every(call =>
        call.options.refresh === false
        && Object.keys(call.options).length === 1));
    assert.equal(activity.maximum, 3);
    assert.equal(progress.length, 3);
    assert.ok(progress.every(value => Object.isFrozen(value)));
    assert.deepEqual(report.profiles, [ "alpha", "beta" ]);
    assert.deepEqual(report.resources, {
        total: 3,
        cacheHits: 1,
        acquired: 2,
        byteLength: 18,
    });
    assert.ok(Object.isFrozen(report));
});

test("prefetch plans deterministic requirements with profile provenance", async () =>
{
    const prefetch = new CjsToolPrefetch({
        indexes: CreateIndexes(),
        profiles: [
            new FixtureProfile("one", [
                { logicalPath: "res:/same.bin", indexName: "Secondary" },
            ]),
            new FixtureProfile("two", [
                { logicalPath: "RES:/SAME.BIN", indexName: "secondary" },
                "app:/other.bin",
            ]),
        ],
    });
    const plan = await prefetch.Plan();

    assert.equal(plan.schema, "carbon.tools-prefetch.plan");
    assert.equal(plan.build, "123");
    assert.deepEqual(plan.profiles, [ "one", "two" ]);
    assert.deepEqual(plan.requirements, [
        {
            logicalPath: "app:/other.bin",
            indexName: null,
            profiles: [ "two" ],
        },
        {
            logicalPath: "res:/same.bin",
            indexName: "secondary",
            profiles: [ "one", "two" ],
        },
    ]);
    assert.ok(Object.isFrozen(plan.requirements[0]));
});

test("prefetch rejects unknown profiles before resolving a build", async () =>
{
    const resolveCalls = [];
    const prefetch = new CjsToolPrefetch({
        indexes: CreateIndexes({ resolveCalls }),
        profiles: [ new FixtureProfile("audio", []) ],
    });

    await assert.rejects(
        prefetch.Plan({ profiles: "missing" }),
        /Prefetch profile not found: missing/u,
    );
    assert.equal(resolveCalls.length, 0);
});

test("prefetch rejects wildcard and non-index resource requirements", async () =>
{
    const wildcard = new CjsToolPrefetch({
        indexes: CreateIndexes(),
        profiles: [ new FixtureProfile("bad", [ "res:/audio/*.wem" ]) ],
    });
    const generated = new CjsToolPrefetch({
        indexes: CreateIndexes(),
        profiles: [ new FixtureProfile("bad", [ "generated:/audio/1.ogg" ]) ],
    });

    await assert.rejects(
        wildcard.Plan(),
        /must use exact logical paths/u,
    );
    await assert.rejects(
        generated.Plan(),
        /must use app:\/ or res:\//u,
    );
});

test("audio prefetch includes indexed media and banks but not generated outputs", async () =>
{
    const calls = [];
    const profile = new CjsToolAudioPrefetch({
        audio: {
            async OpenTarget(target, build)
            {
                calls.push({ target, build });

                return {
                    ListSourcePaths()
                    {
                        return [
                            "generated:/audio/7.ogg",
                            "res:/audio/7.wem",
                            "app:/audio/base.bnk",
                        ];
                    },
                };
            },
        },
    });
    const paths = await profile.Resolve({ target: "eve", build: "123" });

    assert.deepEqual(calls, [ { target: "eve", build: "123" } ]);
    assert.deepEqual(paths, [
        "res:/audio/7.wem",
        "app:/audio/base.bnk",
    ]);
});

test("prefetch commands document profiles and fail before service bootstrap", () =>
{
    const help = spawnSync(process.execPath, [ prefetchCli, "--help" ], {
        cwd: root,
        encoding: "utf8",
    });

    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /cjs-tools-prefetch \[audio\]/u);
    assert.match(help.stdout, /explicit app:\/ or res:\/ paths/u);
    assert.match(help.stdout, /--request-timeout-ms/u);
    assert.match(help.stdout, /--max-payload-bytes/u);

    const service = spawnSync(process.execPath, [
        serviceCli,
        "--prefetch",
        "missing",
        "--port",
        "0",
    ], {
        cwd: root,
        encoding: "utf8",
    });

    assert.equal(service.status, 1);
    assert.equal(service.stdout, "");
    assert.match(service.stderr, /Prefetch profile not found: missing/u);
});
