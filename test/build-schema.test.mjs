import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPOSITORY_ROOT = path.resolve(".");
const BUILD_SCRIPT = path.join(REPOSITORY_ROOT, "scripts", "build_carbon_schema.js");

function makeClass(name, sourceFiles, fieldName)
{
    return {
        name,
        headerFiles: sourceFiles.filter(file => file.endsWith(".h")),
        cppFiles: sourceFiles.filter(file => file.endsWith(".cpp")),
        bases: [],
        fields: [ { name: fieldName, type: "int" } ],
        methods: [],
        blue: {
            isExposed: false,
            files: [],
            defines: [],
            exposures: [],
            attributes: [],
            properties: [],
            methods: [],
            interfaces: []
        },
        reviewNotes: []
    };
}

function makeEnum(name, source, ownerClass = null)
{
    return {
        name,
        qualifiedName: ownerClass ? `${ownerClass}::${name}` : name,
        ...(ownerClass ? { ownerClass } : {}),
        family: source,
        values: [ { name: `${source.toUpperCase()}_VALUE`, value: 1 } ]
    };
}

function writeJson(file, value)
{
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createFixture(root)
{
    const pass1Path = path.join(root, "reports", "pass1.json");
    const pass2Path = path.join(root, "reports", "pass2.json");
    writeJson(pass1Path, {
        carbonRoot: "E:/carbonengine",
        generatedAt: "2026-07-19T00:00:00.000Z",
        summary: { families: 2 },
        enums: [
            makeEnum("CollisionEnum", "pass1"),
            makeEnum("Type", "pass1-owner-a", "OwnerA"),
            makeEnum("Type", "pass1-owner-b", "OwnerB"),
            makeEnum("Pass1Only", "pass1")
        ],
        families: [
            {
                name: "include",
                root: "trinity/trinity/Include",
                files: [],
                classes: [
                    makeClass(
                        "SharedRoot",
                        [ "trinity/trinity/Include/SharedRoot.h" ],
                        "m_pass1Field"
                    )
                ],
                stalls: [],
                warnings: []
            },
            {
                name: "trinityCore",
                root: "stale/pass-one/root",
                files: [],
                classes: [
                    makeClass("StaleTrinity", [ "stale/pass-one/StaleTrinity.h" ], "m_staleField")
                ],
                stalls: [],
                warnings: []
            }
        ]
    });
    writeJson(pass2Path, {
        carbonRoot: "E:/carbonengine",
        generatedAt: "2026-07-19T00:00:01.000Z",
        summary: { families: 1 },
        enums: [
            makeEnum("CollisionEnum", "pass2"),
            makeEnum("Type", "pass2-owner-a", "OwnerA"),
            makeEnum("Type", "pass2-owner-c", "OwnerC"),
            makeEnum("Pass2Only", "pass2")
        ],
        families: [
            {
                name: "trinityCore",
                root: "trinity/trinity",
                files: [],
                classes: [
                    makeClass(
                        "SharedRoot",
                        [
                            "trinity/trinity/Include/SharedRoot.h",
                            "trinity/trinity/SharedRoot.cpp"
                        ],
                        "m_pass2Field"
                    ),
                    makeClass("RootOnly", [ "trinity/trinity/RootOnly.h" ], "m_rootField"),
                    makeClass(
                        "NestedOnly",
                        [ "trinity/trinity/Eve/NestedOnly.h" ],
                        "m_nestedField"
                    ),
                    makeClass("_PrivateRoot", [ "trinity/trinity/PrivateRoot.h" ], "m_privateField")
                ],
                stalls: [],
                warnings: []
            }
        ]
    });
    return { pass1Path, pass2Path };
}

function runBuild(pass1Path, pass2Path, scratchRoot, outputRoot, extra = [])
{
    return spawnSync(process.execPath, [
        BUILD_SCRIPT,
        pass1Path,
        pass2Path,
        "--scratch-root",
        scratchRoot,
        "--out",
        outputRoot,
        ...extra
    ], {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8"
    });
}

function assertBuildPassed(result)
{
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function readTree(root)
{
    const files = [];
    function visit(directory)
    {
        for (const item of fs.readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name)))
        {
            const fullPath = path.join(directory, item.name);
            if (item.isDirectory()) visit(fullPath);
            else files.push([
                path.relative(root, fullPath).replace(/\\/g, "/"),
                fs.readFileSync(fullPath, "utf8")
            ]);
        }
    }
    visit(root);
    return files;
}

test("two-pass build gives pass two trinityCore authority and unions enums", () =>
{
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-build-"));
    try
    {
        const { pass1Path, pass2Path } = createFixture(scratchRoot);
        const outputRoot = path.join(scratchRoot, "schema");
        const result = runBuild(pass1Path, pass2Path, scratchRoot, outputRoot, [ "--clean" ]);
        assertBuildPassed(result);

        const includeShared = JSON.parse(
            fs.readFileSync(path.join(outputRoot, "include", "SharedRoot.json"), "utf8")
        );
        const trinityShared = JSON.parse(
            fs.readFileSync(path.join(outputRoot, "trinityCore", "SharedRoot.json"), "utf8")
        );
        assert.ok(includeShared.fields.some(field => field.cppName === "m_pass1Field"));
        assert.ok(trinityShared.fields.some(field => field.cppName === "m_pass2Field"));
        assert.equal(fs.existsSync(path.join(outputRoot, "trinityCore", "RootOnly.json")), true);
        assert.equal(fs.existsSync(path.join(outputRoot, "trinityCore", "NestedOnly.json")), false);
        assert.equal(fs.existsSync(path.join(outputRoot, "trinityCore", "_PrivateRoot.json")), false);
        assert.equal(fs.existsSync(path.join(outputRoot, "trinityCore", "StaleTrinity.json")), false);

        const enums = JSON.parse(fs.readFileSync(path.join(outputRoot, "enums.json"), "utf8")).enums;
        assert.deepEqual(enums.map(item => item.name), [
            "CollisionEnum",
            "Type",
            "Type",
            "Pass1Only",
            "Type",
            "Pass2Only"
        ]);
        assert.equal(enums[0].family, "pass1");
        assert.deepEqual(
            enums.filter(item => item.name === "Type").map(item => item.qualifiedName),
            [ "OwnerA::Type", "OwnerB::Type", "OwnerC::Type" ]
        );
        assert.equal(
            enums.find(item => item.qualifiedName === "OwnerA::Type").family,
            "pass1-owner-a",
            "pass one must retain authority for the same qualified enum"
        );
    }
    finally
    {
        fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
});

test("two-pass output is deterministic", () =>
{
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-deterministic-"));
    try
    {
        const { pass1Path, pass2Path } = createFixture(scratchRoot);
        const firstRoot = path.join(scratchRoot, "first");
        const secondRoot = path.join(scratchRoot, "second");
        assertBuildPassed(runBuild(pass1Path, pass2Path, scratchRoot, firstRoot, [ "--clean" ]));
        assertBuildPassed(runBuild(pass1Path, pass2Path, scratchRoot, secondRoot, [ "--clean" ]));
        assert.deepEqual(readTree(firstRoot), readTree(secondRoot));
    }
    finally
    {
        fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
});

test("clean removes only the validated scratch output child", () =>
{
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-clean-"));
    try
    {
        const { pass1Path, pass2Path } = createFixture(scratchRoot);
        const outputRoot = path.join(scratchRoot, "schema");
        const siblingSentinel = path.join(scratchRoot, "keep.txt");
        const staleOutput = path.join(outputRoot, "stale.json");
        fs.mkdirSync(outputRoot, { recursive: true });
        fs.writeFileSync(siblingSentinel, "keep", "utf8");
        fs.writeFileSync(staleOutput, "stale", "utf8");

        assertBuildPassed(runBuild(pass1Path, pass2Path, scratchRoot, outputRoot, [ "--clean" ]));
        assert.equal(fs.readFileSync(siblingSentinel, "utf8"), "keep");
        assert.equal(fs.existsSync(staleOutput), false);
    }
    finally
    {
        fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
});

test("clean refuses the declared scratch root itself", () =>
{
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-root-refusal-"));
    try
    {
        const { pass1Path, pass2Path } = createFixture(scratchRoot);
        const sentinel = path.join(scratchRoot, "keep.txt");
        fs.writeFileSync(sentinel, "keep", "utf8");
        const result = runBuild(pass1Path, pass2Path, scratchRoot, scratchRoot, [ "--clean" ]);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Scratch output must be a child/);
        assert.equal(fs.readFileSync(sentinel, "utf8"), "keep");
    }
    finally
    {
        fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
});

test("external destination is refused without explicit authorization", () =>
{
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tools-core-schema-live-refusal-"));
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tools-core-schema-external-"));
    try
    {
        const { pass1Path, pass2Path } = createFixture(scratchRoot);
        const sentinel = path.join(externalRoot, "keep.txt");
        fs.writeFileSync(sentinel, "keep", "utf8");
        const result = runBuild(pass1Path, pass2Path, scratchRoot, externalRoot, [ "--clean" ]);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Refusing output outside the scratch root without --allow-external-write/);
        assert.equal(fs.readFileSync(sentinel, "utf8"), "keep");
    }
    finally
    {
        fs.rmSync(scratchRoot, { recursive: true, force: true });
        fs.rmSync(externalRoot, { recursive: true, force: true });
    }
});
