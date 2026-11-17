import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("a failed first lint does not skip privacy or later checks", () =>
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lint-runner-test-"));
    try
    {
        fs.mkdirSync(path.join(root, "scripts"));
        fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
        fs.copyFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/run-lint.js"), path.join(root, "scripts/run-lint.js"));
        fs.writeFileSync(path.join(root, "lint_package.js"), "process.exit(1);");
        fs.writeFileSync(path.join(root, "scripts/lint-private-references.js"), 'console.log("privacy executed");');
        fs.writeFileSync(path.join(root, "scripts/lint-field-initializers.js"), 'console.log("fields executed");');
        const result = spawnSync(process.execPath, ["scripts/run-lint.js"], { cwd: root, encoding: "utf8" });
        assert.equal(result.status, 1);
        assert.match(result.stdout, /privacy executed/u);
        assert.match(result.stdout, /fields executed/u);
    }
    finally
    {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
