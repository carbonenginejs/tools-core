// Always run privacy checks, even when another lint fails.
import { spawnSync } from "node:child_process";

const steps = ["lint_package.js", "scripts/lint-private-references.js", "scripts/lint-field-initializers.js"];
let failed = false;
for (const step of steps)
{
    const result = spawnSync(process.execPath, [step], { stdio: "inherit" });
    if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
