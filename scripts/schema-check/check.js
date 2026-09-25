#!/usr/bin/env node
// tools-core owns the checker; this consumer owns its coverage and debt floor.
/**
 * Schema drift gate: `npm run schema:check [-- --json] [-- --update]`.
 *
 * Compares a runtime checkout with the packed Carbon schema through
 * `carbon-class --check --strict --json`. It runs on demand only (no lint or
 * build hook calls it) and never emits classes, refreshes schemas or changes
 * source. Inputs, with no sibling-checkout defaults:
 * - schema: `carbon_schema_latest.gzip` in the package root (gitignored build
 *   output of `schema:generate` / `schema:pack`), refused past seven days;
 * - checker: this package's `bin/cjs-carbon-class.js`;
 * - Carbon checkout: `CARBON_ROOT` or `CARBONENGINE_ROOT`;
 * - runtime checkout: `CARBON_SCHEMA_RUNTIME_ROOT`, required; unset skips.
 *
 * An absent schema directory, absent Carbon checkout or unnamed runtime is an
 * explicit SKIP. A partial or malformed schema tree fails: every indexed
 * document and the enum catalog are validated, including ones no runtime class
 * uses, before the checker is resolved.
 *
 * What fails: new or changed comparison findings against `baseline.json`
 * (missing fields/methods, type/default/persistence differences, method
 * metadata), unknown checker output, process or parse failures, and lost
 * coverage. Coverage is tracked apart from debt: previously observed class and
 * member identities, determinate defaults and metadata presence may not
 * disappear, so a run that keeps its class count but parses no members fails.
 * Classes under `dropped/` and AL (`trinityal`) results are excluded; AL parity
 * has its own checker.
 *
 * Advisory only: scanner-family differences and additional native methods
 * outside Blue reflection (count and delta printed every run). Blue alone
 * cannot tell a faithful non-Blue method from an invented one. Blind spots: one
 * exported class per file is compared; inheritance, statics, accessors,
 * signatures and behaviour are not proven; `notImplemented` stub bodies satisfy
 * the metadata comparison. Findings are evidence to check against Carbon, not
 * authority; never rewrite runtime just to satisfy the scanner.
 *
 * `--update` banks fixes only after a PASS against the existing baseline: it
 * drops resolved findings and gaps and adds new coverage. It refuses new
 * findings, new gaps, lost coverage, a skipped run and a missing baseline; it
 * is never a way to accept a fresh finding. Baseline keys are relative
 * class/member identity plus evidence, not line numbers, so moving code keeps
 * them stable. A legitimate removal that lowers coverage needs a reviewed
 * baseline edit, not `--update`.
 *
 * Exit 0: PASS or reported SKIP. Exit 1: new findings or lost coverage.
 * Exit 2: infrastructure error or refused update.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectReport } from "./audit.js";
import { evaluate, updateBaseline } from "./policy.js";

try
{
    const args = process.argv.slice(2);
    if (args.some(arg => !["--json", "--update"].includes(arg))) throw new Error("Usage: node scripts/schema-check/check.js [--json] [--update]");
    const update = args.includes("--update");
    if (update) console.error("WARNING: --update banks fixes only. Never use it to silence a fresh finding; investigate against Carbon first.");
    const report = await collectReport();
    // The debt floor lives BESIDE the checker, not at a consumer-shaped path.
    // It pointed at scripts/schema-baseline.json until 2026-09-09, which is
    // where it sat in runtime before the move.
    const baselineFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "baseline.json");
    const baseline = report.status === "SKIP" ? null : JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    const result = report.status === "SKIP" ? { status: "SKIP", reason: report.reason } : evaluate(report, baseline);
    if (update)
    {
        const next = updateBaseline(report, baseline);
        fs.writeFileSync(baselineFile, JSON.stringify(next, null, 2) + "\n");
    }
    if (args.includes("--json")) console.log(JSON.stringify({ ...result, updated: update }));
    else if (result.status === "SKIP") console.log(`lint:schema SKIPPED - ${result.reason}`);
    else
    {
        const counts = result.counts;
        console.log(`lint:schema ${result.status}: ${counts.checked} classes checked; ${counts.findings} comparison findings; ${counts.gaps} coverage-gap records.`);
        console.log(`Additional native methods outside Blue: ${counts.additionalCarbonMethods} (${counts.additionalCarbonMethodsDelta >= 0 ? "+" : ""}${counts.additionalCarbonMethodsDelta} since baseline), advisory. Known blind spot: Blue cannot distinguish native ports from invented methods.`);
        console.log(`${counts.advisories} advisory records; ${counts.resolved} baseline findings no longer reported. Scanner output is evidence, not authority.`);
        if (result.status === "FAIL")
        {
            for (const name of ["failures", "newFindings", "newGaps", "lostCoverage", "lostMemberCoverage", "lostSchemaCoverage"])
            {
                const entries = result[name];
                if (!entries.length) continue;
                console.error(`${name}: ${entries.length}`);
                for (const entry of entries.slice(0, 20)) console.error(JSON.stringify(entry));
            }
            console.error("Investigate against Carbon. --json shows every finding; --update cannot accept new debt or lost coverage.");
        }
        else if (update) console.log("Schema baseline updated to bank fixes and additional coverage.");
    }
    process.exitCode = result.status === "FAIL" ? 1 : 0;
}
catch (error)
{
    console.error(`lint:schema infrastructure/update failure: ${error.message}`);
    process.exitCode = 2;
}
