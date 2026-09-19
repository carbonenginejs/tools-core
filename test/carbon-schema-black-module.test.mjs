import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/cjs-carbon-schema.js", import.meta.url));
const definitionsDir = fileURLToPath(new URL("../definitions/", import.meta.url));
const moduleFile = fileURLToPath(new URL("../src/schema/core/blackDefinitions.js", import.meta.url));

// One persisted `value` member of the given C++ type, scanned on `generatedAt`.
function writeReport(file, cppType, generatedAt = "2026-09-20T00:00:00.000Z")
{
    fs.writeFileSync(file, JSON.stringify({
        carbonRoot: "E:/carbonengine",
        generatedAt,
        enums: [],
        families: [ {
            name: "sample",
            root: "trinity",
            classes: [ {
                name: "Sample",
                family: "sample",
                headerFiles: [ "trinity/Sample.h" ],
                cppFiles: [],
                bases: [],
                fields: [ { name: "m_value", type: cppType } ],
                methods: [],
                blue: {
                    isExposed: true,
                    files: [ "trinity/Sample_Blue.cpp" ],
                    defines: [ { macro: "BLUE_DEFINE", name: "Sample" } ],
                    exposures: [ { macro: "EXPOSURE_BEGIN", name: "Sample" } ],
                    attributes: [ { macro: "MAP_ATTRIBUTE", name: "value", nameSource: "literal", member: "m_value", flags: [ "READWRITE", "PERSIST" ], source: "trinity/Sample_Blue.cpp", line: 1 } ],
                    properties: [],
                    methods: [],
                    interfaces: []
                },
                reviewNotes: []
            } ]
        } ]
    }));
}

function withTempDir(prefix, run)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try { run(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("--black-module points the module at the newest dated black schema", () => withTempDir("cjs-black-module-", dir =>
{
    const report = path.join(dir, "report.json");
    writeReport(report, "float");
    const out = path.join(dir, "definitions");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "black-schema-v1-2026-07-11.json"), "{}");
    const module = path.join(dir, "blackDefinitions.js");
    fs.writeFileSync(module, "import definitions from \"./definitions/black-schema-v1-2026-07-11.json\" with { type: \"json\" };\n");

    execFileSync(process.execPath, [ cli, report, "--black-out", out, "--black-module", module, "--quiet" ]);

    assert.ok(fs.existsSync(path.join(out, "black-schema-v1-2026-09-20.json")));
    assert.equal(fs.readFileSync(module, "utf8"),
        "import definitions from \"./definitions/black-schema-v1-2026-09-20.json\" with { type: \"json\" };\n");
}));

test("a dated Black snapshot is never rewritten with different content", () => withTempDir("cjs-black-snapshot-", dir =>
{
    const report = path.join(dir, "report.json");
    const out = path.join(dir, "definitions");
    const snapshot = path.join(out, "black-schema-v1-2026-09-19.json");
    const write = () => execFileSync(process.execPath, [ cli, report, "--black-out", out, "--quiet" ], { stdio: "pipe" });

    writeReport(report, "float", "2026-09-19T01:00:00.000Z");
    write();
    // Regenerating identical content on the same date is harmless.
    write();

    writeReport(report, "int32_t", "2026-09-19T13:07:39.523Z");
    assert.throws(write, /will not overwrite black-schema-v1-2026-09-19\.json/);
    assert.equal(JSON.parse(fs.readFileSync(snapshot, "utf8")).classes.Sample.value, "float");
}));

test("the bundled Black definitions import the newest dated schema", () =>
{
    const newest = fs.readdirSync(definitionsDir)
        .filter(name => /^black-schema-v\d+-\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .sort()
        .pop();
    assert.match(fs.readFileSync(moduleFile, "utf8"), new RegExp(`/${newest.replace(/\./g, "\\.")}"`));
});
