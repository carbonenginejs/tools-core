import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const scannerPath = path.resolve(here, "../scripts/carbon-blue/convert.cjs");

// Requiring the scanner must not trigger a scan: main() is guarded behind
// require.main === module, so importing it for inspection is side-effect free.
const scanner = require(scannerPath);

test("scanner default paths resolve to the recovered scripts/carbon-blue tree", () =>
{
    assert.ok(path.isAbsolute(scanner.DEFAULT_CONFIG), "DEFAULT_CONFIG must be absolute");
    assert.ok(path.isAbsolute(scanner.DEFAULT_CLASS_REPORT), "DEFAULT_CLASS_REPORT must be absolute");

    assert.ok(
        scanner.DEFAULT_CONFIG.endsWith(path.join("scripts", "carbon-blue", "config", "default.json")),
        "DEFAULT_CONFIG must point at scripts/carbon-blue/config/default.json"
    );
    assert.ok(
        scanner.DEFAULT_CLASS_REPORT.endsWith(path.join("scripts", "carbon-blue", "reports", "classes-latest.json")),
        "DEFAULT_CLASS_REPORT must point at scripts/carbon-blue/reports/classes-latest.json"
    );

    // Anchored to the script directory, so the default config resolves the same
    // way regardless of the current working directory the scanner runs from.
    assert.ok(fs.existsSync(scanner.DEFAULT_CONFIG), "reconstructed default config must exist on disk");
});

test("scanner source retains no paths from the deleted build-tools tree", () =>
{
    const source = fs.readFileSync(scannerPath, "utf8");
    assert.ok(!source.includes("build-tools/carbon-blue"), "stale build-tools/carbon-blue paths must be gone");
});

test("recovered default config carries the reconstructed families and portable output layout", () =>
{
    const config = JSON.parse(fs.readFileSync(scanner.DEFAULT_CONFIG, "utf8"));

    assert.ok(Array.isArray(config.families) && config.families.length > 0, "families must be a non-empty array");
    assert.equal(config.carbonRoot, undefined, "default config must not contain a machine-local CarbonEngine path");

    // Report/output targets stay inside the scanner's own tree so a bare scan is
    // non-destructive and never writes format-carbon/src/schema.
    for (const key of ["reportPath", "markdownReportPath", "outputRoot", "schemaOutputRoot", "classOutputRoot", "classReportPath"])
    {
        assert.equal(typeof config[key], "string", `${key} must be a string`);
        assert.ok(config[key].startsWith("scripts/carbon-blue/"), `${key} must resolve under scripts/carbon-blue/`);
    }
});

test("named nested structs do not leak their members into the containing class", () =>
{
    const parsed = scanner.__test.parseHeaderFile(`
        class AudGameObjResource
        {
        public:
            struct Orientation
            {
                Vector3 front;
                Vector3 top;
            };

            Vector3 m_position;
        };
    `, "audio/src/AudGameObjResource.h");
    const classInfo = parsed.classes.find(item => item.name === "AudGameObjResource");

    assert.ok(classInfo);
    assert.deepEqual(classInfo.fields.map(field => field.name), ["m_position"]);
});
