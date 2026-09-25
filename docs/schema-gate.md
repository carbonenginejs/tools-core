# Schema drift gate

Status: Experimental
Scope: The `schema:check` script in this package
Audience: Maintainers comparing runtime source with the Carbon schema
Summary: Explains the read-only schema comparison gate, coverage floor, baseline updates, and known blind spots.

## Running the gate

`npm run schema:check` compares a runtime source checkout with the packed
Carbon schema using `carbon-class --check --strict --json`. It is run on
demand; no lint or build hook calls it. It never emits classes, refreshes
schemas, or changes source.

```sh
npm run schema:check
npm run schema:check -- --json
npm run schema:check -- --update   # banks fixes only; never to silence a finding
```

Where it reads from, with no sibling-checkout defaults:

- the schema from the packed snapshot `scripts/carbon_schema_latest.gzip`
  (produced by `npm run schema:pack`);
- the checker from the installed `@carbonenginejs/tools-core` dependency;
- the Carbon checkout from `CARBON_ROOT` or `CARBONENGINE_ROOT`;
- the source to inspect from `CARBON_SCHEMA_RUNTIME_ROOT`, defaulting to this
  package's own root.

**Not currently working (2026-09-25):** `schema:pack` writes the snapshot to
the package root while the checker looks under `scripts/`, and the file is
gitignored, so the check stops with "Schema snapshot missing". The default
source root is this package rather than a runtime checkout. Both need a
decision before the gate is relied on.

The entire absent schema directory or absent Carbon checkout produces an
explicit SKIP. An existing partial or malformed schema tree fails validation.
The gate validates indexed class documents and the enum catalog, including
documents no runtime class currently uses. Removed non-AL schema identities
also fail, even when their indexes have been edited to remain self-consistent.

## What fails

The baseline records existing comparison findings. New or changed missing
fields/methods, type/default/persistence differences, and method metadata
findings fail. Unknown checker output and process or parsing failures fail
independently of the baseline.

Coverage is tracked separately from debt. Previously observed class and member
identities, determinate defaults, and metadata presence may not disappear.
Keeping a class count while parsing no members therefore fails. The gate also
checks reported expected members against direct schema derivation before
accepting a successful CLI report, including for newly added classes.

Generated and maintained classes are checked. Dropped classes and AL schema
results are excluded from the consumer comparison; AL parity uses its own
checker. Ambiguities, schema fallbacks, class/decorator misassociation, and
uninspected schema-backed classes remain visible as coverage debt.

**Investigate findings against Carbon. Scanner output is evidence, not
authority.** A new finding can identify a scanner/checker defect or a deliberate
adaptation instead of a runtime defect. Never automatically rewrite runtime
to satisfy the scanner.

## Advisories and known blind spots

Scanner-family/runtime-domain differences and additional native methods
outside Blue reflection remain advisory. Every run prints the latter count
and its change since the baseline. This is a known blind spot: Blue alone
cannot distinguish a faithful non-Blue method from an invented method.

The class checker inspects one exported class per file. The independent AST
inventory reports additional schema-backed identities as unchecked and
rejects results that associate the wrong decorator with a class body. The
checker does not fully follow runtime inheritance and does not prove static
methods, accessors, abstract closure, signatures, or behavior.

Method implementation decorators are checked, but **stub bodies are not**.
An empty method marked `notImplemented` can satisfy the metadata comparison.
The expected-member cross-check shares the scanner's derivation code; it does
not independently prove scanner completeness against Carbon.

## Banking fixes

```sh
npm run schema:check -- --update
```

`--update` banks fixes only after a passing comparison against the existing
baseline. It removes resolved findings/gaps and adds successful coverage. It
refuses new findings, new gaps, lost coverage, skipped runs, and a missing
baseline. **Never run it to silence a fresh finding.**

Baseline keys use relative class/member identity and evidence, not line
numbers. Moving code without changing its evidence leaves the keys stable.
A legitimate source or schema removal can reduce coverage; that requires an
explicitly reviewed baseline amendment, not `--update`.

Exit 0 means PASS or explicitly reported SKIP; exit 1 means new findings or
coverage loss; exit 2 means an infrastructure error or refused update.
