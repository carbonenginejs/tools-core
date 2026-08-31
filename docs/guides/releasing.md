# Release this package

Status: Stable
Scope: What to check before pushing or publishing `@carbonenginejs/tools-core`
Audience: Whoever is about to push the branch or run `npm publish`
Summary: This package is public, its history accumulates while pushing is paused, and the review has to happen per commit rather than per release.

## Read the whole backlog before the first push

**This package is public — the repository and the npm artifact both.** It also
spends long periods with pushing paused while work continues, so `main` routinely
sits many commits ahead of `origin`. Those commits come from more than one
session and more than one author, and they were written at a time when nobody
expected them to go out that day.

That combination is the risk. A release here is not "publish the thing I just
finished"; it is "publish everything that accumulated since the last push, some
of which I did not write and have not read".

**Before the first push after a pause, read every commit that is going out.**

```sh
git log --oneline @{u}..              # what is about to go public
git diff @{u}.. --stat                # the shape of it
git log -p @{u}.. -- src/              # the substance
```

`git status -s` as well: an unpushed branch and a dirty tree usually mean someone
is still working, and their in-progress files are one careless `git add -A` away
from becoming part of your release.

## What to look for, in order of how badly it ends

1. **Material that is not ours to publish.** Anything acquired under an
   agreement, anything a maintainer has held back, anything you cannot account
   for. If a commit's provenance is unclear, ask before pushing rather than
   after.
2. **Credentials and operator data.** Tokens, cookies, session state, `.env`
   contents, cache paths that name a person's machine. `data.local/` is worth
   a specific look.
3. **References to private repositories.** Several organization repositories are
   private, and naming one in a comment here publishes the fact that it exists
   and what it does. Three such comments were found and reworded on 2026-08-16;
   the phrasing that replaced them describes the capability instead — "an
   externally generated or custom SDE" rather than the tool that generates one.
4. **Anything that reads as internal correspondence.** Handover notes, review
   findings, and interim decisions do not belong in this public repository. A
   file that argues it is safe because the npm artifact does not copy it has
   misunderstood the risk: the repository itself is public.

## Publishing

`files` in `package.json` decides the artifact: `bin/`, required JSON
`definitions/`, `docs/`, `scripts/`, `src/`, and the three root files. `test/` is not published, but it is
still in a public repository, so review it on the same terms.

`prepack` runs the package linter. The linter resolves npm's own dry-run file
inventory and rejects unreviewed roots, build output, archives, caches,
dependency trees, agent/tool state, internal documentation markers, and local
machine paths. The generated Carbon scanner reports under
`scripts/carbon-blue/reports/` are explicitly excluded from the allowlist.

Below 1.0.0 a caret pins the minor, so `^0.6.0` does not admit 0.7.0. Widening
the ranges of every in-organization consumer belongs in the same publish, not
the next one.

## Related documentation

- [Documentation home](../README.md)
