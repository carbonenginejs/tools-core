import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    CjsIndexEntry,
    CjsIndexOverlayStore,
    CjsToolWebglBuilder,
    CjsToolWebgpuBuilder,
} from "../src/index.js";

const WebglPath = "res:/graphics/effect.dx11/managed/space/test.sm_hi";
const WebgpuPath = "res:/graphics/effect.dx11/managed/space/gpu.sm_hi";

test("WebGL builder verifies sources and emits deterministic qualified reports", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-webgl-builder-"));
    const source = createSource({
        target: "frontier",
        game: "Frontier",
        client: "stillness",
        logicalPath: WebglPath,
        bytes: "compiled-webgl-source",
    });
    const builder = new CjsToolWebglBuilder({ source, format: QualifiedFormat });
    const progress = [];

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    const first = await builder.Build({
        shaderTarget: "frontier-webgl2",
        build: "77",
        source,
        sourcePaths: [ WebglPath ],
        outputDirectory: directory,
        onProgress: (event) => progress.push(event),
    });
    const second = await builder.Build({
        shaderTarget: "frontier-webgl2",
        build: "77",
        source,
        sourcePaths: [ WebglPath ],
        outputDirectory: directory,
    });

    assert.equal(first.status, "qualified");
    assert.equal(first.report.counts.generated, 1);
    assert.equal(first.report.counts.qualified, 1);
    assert.equal(first.report.qualificationLevel, "structural");
    assert.equal(first.report.entries[0].outputPath,
        "res:/graphics/effect.webgl2/managed/space/test.sm_hi");
    assert.equal(first.report.entries[0].sourceMd5, source.resolution.record.checksum);
    assert.deepEqual(first.report, second.report);
    assert.equal(first.directory, second.directory);
    assert.equal((await fs.readdir(directory)).length, 1);
    assert.deepEqual(progress.map((event) => event.event), [
        "build-start",
        "source-opened",
        "catalog-ready",
        "staging-start",
        "entry-start",
        "entry-complete",
        "report-ready",
        "publication-complete",
        "build-complete",
    ]);
    assert.equal(progress.find((event) => event.event === "entry-complete").status, "qualified");
});

test("WebGPU builder remains independently importable and uses CEWGPU targets", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-webgpu-builder-"));
    const source = createSource({
        target: "eve",
        game: "Eve",
        client: "tranquility",
        logicalPath: WebgpuPath,
        bytes: "compiled-webgpu-source",
    });
    const builder = new CjsToolWebgpuBuilder({ format: QualifiedFormat });

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    const result = await builder.Build({
        shaderTarget: "eve-webgpu",
        build: "77",
        source,
        sourcePaths: [ WebgpuPath ],
        outputDirectory: directory,
    });

    assert.equal(result.report.format, "CEWGPU");
    assert.equal(result.report.outputProfile, "effect.webgpu");
    assert.equal(result.report.selectionPolicy.sourceFamily, "dx11-sm5.0");
    assert.equal(result.report.qualificationLevel, "structural");
});

test("tools-core coordinates but does not implement native HLSLcc qualification", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-native-qualifier-"));
    const source = createSource({
        target: "eve",
        game: "Eve",
        client: "tranquility",
        logicalPath: WebgpuPath,
        bytes: "compiled-source",
    });
    const missing = new CjsToolWebgpuBuilder({ format: QualifiedFormat });
    const qualified = new CjsToolWebgpuBuilder({ format: NativeQualifiedFormat });

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    await assert.rejects(
        async () => missing.Build({
            shaderTarget: "eve-webgpu",
            build: "77",
            source,
            sourcePaths: [ WebgpuPath ],
            qualificationLevel: "native-hlslcc",
            outputDirectory: directory,
        }),
        (error) =>
        {
            assert.match(
                error.report.entries[0].error.message,
                /does not expose a format-owned native HLSLcc qualifier/u,
            );
            return true;
        },
    );

    const result = await qualified.Build({
        shaderTarget: "eve-webgpu",
        build: "77",
        source,
        sourcePaths: [ WebgpuPath ],
        qualificationLevel: "native-hlslcc",
        outputDirectory: directory,
    });

    assert.equal(result.status, "qualified");
    assert.equal(result.report.entries[0].qualification.level, "native-hlslcc");
    assert.equal(result.report.entries[0].qualification.nativeComparison.ok, true);
});

test("failed shader runs roll back staging and do not publish output", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-shader-rollback-"));
    const source = createSource({
        target: "frontier",
        game: "Frontier",
        client: "stillness",
        logicalPath: WebglPath,
        bytes: "compiled-source",
    });
    const builder = new CjsToolWebglBuilder({ format: FailingFormat });
    const progress = [];

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    await assert.rejects(
        () => builder.Build({
            shaderTarget: "frontier-webgl2",
            build: "77",
            source,
            sourcePaths: [ WebglPath ],
            outputDirectory: directory,
            onProgress: (event) => progress.push(event),
        }),
        /did not qualify/u,
    );
    assert.deepEqual(await fs.readdir(directory), []);
    assert.equal(progress.at(-1).event, "build-error");
    assert.match(progress.at(-1).error.message, /did not qualify/u);
});

test("force transactionally replaces a conflicting immutable output", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-shader-force-"));
    const source = createSource({
        target: "frontier",
        game: "Frontier",
        client: "stillness",
        logicalPath: WebglPath,
        bytes: "compiled-force-source",
    });
    const builder = new CjsToolWebglBuilder({ format: QualifiedFormat });
    const options = {
        shaderTarget: "frontier-webgl2",
        build: "77",
        source,
        sourcePaths: [ WebglPath ],
        outputDirectory: directory,
    };

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    const first = await builder.Build(options);

    await fs.writeFile(
        path.join(first.directory, "build-report.json"),
        '{ "reportSha256": "conflict" }\n',
        "utf8",
    );
    await assert.rejects(() => builder.Build(options), /already exists/u);

    const replaced = await builder.Build({ ...options, force: true });
    const report = JSON.parse(await fs.readFile(
        path.join(replaced.directory, "build-report.json"),
        "utf8",
    ));

    assert.equal(report.reportSha256, replaced.report.reportSha256);
});

test("qualified builds install and safely reuse immutable persistent overlays", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tools-core-shader-overlay-"));
    const outputDirectory = path.join(directory, "output");
    const overlays = new CjsIndexOverlayStore(path.join(directory, "data.local"));
    const source = createSource({
        target: "frontier",
        game: "Frontier",
        client: "stillness",
        logicalPath: WebglPath,
        bytes: "compiled-overlay-source",
    });
    const builder = new CjsToolWebglBuilder({ format: QualifiedFormat, overlays });

    context.after(async () => fs.rm(directory, { recursive: true, force: true }));

    const first = await builder.Build({
        shaderTarget: "frontier-webgl2",
        build: "77",
        source,
        sourcePaths: [ WebglPath ],
        outputDirectory,
    });
    const second = await builder.Build({
        shaderTarget: "frontier-webgl2",
        build: "77",
        source,
        sourcePaths: [ WebglPath ],
        outputDirectory,
    });
    const installed = await overlays.OpenTarget("frontier", "77", {
        game: "Frontier",
        provider: "ccp",
        client: "stillness",
    });

    assert.equal(installed.length, 1);
    assert.equal(installed[0].Resolve(first.report.entries[0].outputPath).logicalPath,
        first.report.entries[0].outputPath);
    assert.equal(second.overlay.reused, true);
});

function createSource({ target, game, client, logicalPath, bytes })
{
    const payload = Buffer.from(bytes);
    const record = new CjsIndexEntry({
        logicalPath,
        location: "aa/source",
        checksum: createHash("md5").update(payload).digest("hex"),
        uncompressedSize: payload.byteLength,
        compressedSize: payload.byteLength,
    });
    const resolution = Object.freeze({
        target,
        game,
        provider: "ccp",
        client,
        build: "77",
        logicalPath,
        indexName: "main",
        record,
    });

    return Object.freeze({
        target,
        game,
        provider: "ccp",
        client,
        build: "77",
        resolution,
        Match()
        {
            return [ resolution ];
        },
        Resolve(requested)
        {
            assert.equal(requested, logicalPath);
            return resolution;
        },
        async Fetch(requested)
        {
            assert.equal(requested, logicalPath);
            return { bytes: payload };
        },
    });
}

class QualifiedFormat
{

    static packageVersion = "test";

    static buildEffect(bytes, options)
    {
        const output = Buffer.from(`package:${Buffer.from(bytes).toString("hex")}`);

        return {
            bytes: output,
            info: {
                format: options.outputPath.includes("effect.webgpu") ? "CEWGPU" : "CEWG",
                sourcePath: options.source,
                outputPath: options.outputPath,
                sourceIdentity: options.sourceIdentity,
                translator: "synthetic",
            },
            metadata: { selectedOptions: [] },
            qualification: { ok: true, level: "structural" },
        };
    }

    static inspect(bytes)
    {
        return { byteLength: bytes.byteLength, valid: true };
    }

}

class NativeQualifiedFormat extends QualifiedFormat
{

    static qualifyEffect()
    {
        return {
            ok: true,
            level: "native-hlslcc",
            nativeComparison: {
                ok: true,
                owner: "format-webgpu",
            },
        };
    }

}

class FailingFormat extends QualifiedFormat
{

    static buildEffect()
    {
        throw new Error("synthetic conversion failure");
    }

}
