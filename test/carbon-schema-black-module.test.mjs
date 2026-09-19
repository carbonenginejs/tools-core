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

test("--black-module points the module at the newest dated black schema", () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-black-module-"));
    try
    {
        const report = path.join(dir, "report.json");
        fs.writeFileSync(report, JSON.stringify({
            carbonRoot: "E:/carbonengine",
            generatedAt: "2026-09-20T00:00:00.000Z",
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
                    fields: [ { name: "m_value", type: "float" } ],
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
        const out = path.join(dir, "definitions");
        fs.mkdirSync(out);
        fs.writeFileSync(path.join(out, "black-schema-v1-2026-07-11.json"), "{}");
        const module = path.join(dir, "blackDefinitions.js");
        fs.writeFileSync(module, "import definitions from \"./definitions/black-schema-v1-2026-07-11.json\" with { type: \"json\" };\n");

        execFileSync(process.execPath, [ cli, report, "--black-out", out, "--black-module", module, "--quiet" ]);

        assert.ok(fs.existsSync(path.join(out, "black-schema-v1-2026-09-20.json")));
        assert.equal(fs.readFileSync(module, "utf8"),
            "import definitions from \"./definitions/black-schema-v1-2026-09-20.json\" with { type: \"json\" };\n");
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("the bundled Black definitions import the newest dated schema", () =>
{
    const newest = fs.readdirSync(definitionsDir)
        .filter(name => /^black-schema-v\d+-\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .sort()
        .pop();
    assert.match(fs.readFileSync(moduleFile, "utf8"), new RegExp(`/${newest.replace(/\./g, "\\.")}"`));
});
