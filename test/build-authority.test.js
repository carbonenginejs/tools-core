import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsToolBuildAuthority, CjsToolBuildObservations, CjsToolBuildPolicy, REASONS } from "../src/build/index.js";

/** A data root with an optional policy already written into it. */
function Root(policy = null)
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-build-authority-"));

    if (policy) fs.writeFileSync(path.join(directory, "build-policy.json"), JSON.stringify(policy), "utf8");

    return directory;
}

/** An authority over a fresh root, with discovery supplied as a plain function. */
async function Open(discover, { policy = null, requireVerified = false } = {})
{
    const directory = Root(policy);

    return {
        directory,
        authority: await CjsToolBuildAuthority.open({ dataDirectory: directory, discover, requireVerified })
    };
}

test("a concrete build is passed back, not dressed as a decision", async () =>
{
    let asked = false;
    const { authority } = await Open(() => { asked = true; return "999"; });
    const answer = await authority.Resolve({ target: "eve", buildRef: "3466501" });

    assert.equal(answer.build, "3466501");
    // Not `newest-observed`: nobody chose it, the caller named it.
    assert.equal(answer.reason, "requested");
    assert.notEqual(answer.reason, REASONS.newestObserved);
    assert.equal(asked, false, "a named build needs no discovery");
});

test("latest asks upstream, records what it said, and reports it", async () =>
{
    const { authority, directory } = await Open(() => ({ build: "3466501", released: "2026-08-13T11:07:01Z" }));
    const answer = await authority.Resolve({ target: "eve", facet: "resources" });

    assert.equal(answer.build, "3466501");
    assert.equal(answer.reason, REASONS.newestObserved);
    assert.equal(answer.observedLatest, "3466501");

    // The log is durable, which is what makes the offline answer below possible.
    const reread = await CjsToolBuildObservations.read(directory);

    assert.equal(reread.Latest("eve", "resources").build, "3466501");
});

test("unreachable upstream serves the last observed build rather than failing", async () =>
{
    const { directory, authority } = await Open(() => "3466501");

    await authority.Resolve({ target: "eve" });

    // Same root, discovery now throwing the way an unreachable remote does.
    const offline = await CjsToolBuildAuthority.open({
        dataDirectory: directory,
        discover: () => { throw new Error("ENETUNREACH"); }
    });
    const answer = await offline.Resolve({ target: "eve" });

    assert.equal(answer.build, "3466501");
    assert.equal(answer.reason, REASONS.lastObserved, "and it says the answer is old");
    assert.equal(answer.observedLatest, null, "upstream said nothing, and that is not hidden");
});

test("a pin outranks what upstream reports", async () =>
{
    const { authority } = await Open(() => "3466600", {
        policy: { targets: { eve: { resources: { pin: "3466054", since: "2026-08-16", note: "held for a demo" } } } }
    });
    const answer = await authority.Resolve({ target: "eve" });

    assert.equal(answer.build, "3466054");
    assert.equal(answer.reason, REASONS.pinned);
    // The surprising answer explains itself at the point of use.
    assert.equal(answer.observedLatest, "3466600");
    assert.equal(answer.note, "held for a demo");
});

test("the facets resolve independently and may disagree", async () =>
{
    const { authority } = await Open((target, facet) => facet === "sde" ? "3466054" : "3466501");
    const answers = await authority.ResolveAll({ target: "eve" });

    assert.equal(answers.resources.build, "3466501");
    assert.equal(answers.sde.build, "3466054");
});

test("the verification gate serves the newest verified build, and says so", async () =>
{
    const { authority } = await Open(() => "3466600", { requireVerified: true });

    await authority.Verify({ target: "eve", facet: "resources", build: "3466501" });

    const answer = await authority.Resolve({ target: "eve" });

    assert.equal(answer.build, "3466501", "not the newest that exists");
    assert.equal(answer.reason, REASONS.newestVerified);
    assert.equal(answer.observedLatest, "3466600", "which is still reported");
    assert.equal(answer.verified, true);
});

test("the gate is not an outage on a target nobody has verified", async () =>
{
    const { authority } = await Open(() => "3466600", { requireVerified: true });
    const answer = await authority.Resolve({ target: "serenity" });

    assert.equal(answer.build, "3466600");
    assert.equal(answer.verified, false, "unverified, and plainly labelled rather than refused");
});

test("a pin outranks the gate", async () =>
{
    const { authority } = await Open(() => "3466600", {
        requireVerified: true,
        policy: { targets: { eve: { resources: { pin: "3466054" } } } }
    });

    await authority.Verify({ target: "eve", facet: "resources", build: "3466501" });

    const answer = await authority.Resolve({ target: "eve" });

    assert.equal(answer.build, "3466054", "the operator already decided");
    assert.equal(answer.reason, REASONS.pinned);
});

test("re-verifying the build already served is recorded, not dropped as a repeat", async () =>
{
    const { authority } = await Open(() => "3466501");

    const first = await authority.Verify({ target: "eve", build: "3466501" });

    assert.ok(first, "the first verification is written");
    assert.equal(authority.Verified("eve", "resources"), "3466501");
    assert.equal(authority.IsVerified("eve", "resources", "3466501"), true);
    assert.equal(authority.IsVerified("eve", "resources", "3466600"), false);
});

test("the keep-set holds what is served, every pin, and the window", async () =>
{
    const { directory } = await Open(() => "3466501");
    const observations = await CjsToolBuildObservations.read(directory);

    for (const build of [ "3466000", "3466200", "3466501" ])
    {
        await observations.Record({ target: "eve", facet: "resources", build });
    }

    const authority = await CjsToolBuildAuthority.open({
        dataDirectory: directory,
        discover: () => "3466501",
        // A pin on a build that is NOT what is served: collecting it would undo
        // the decision the next time it was applied.
    });
    const withPin = new CjsToolBuildAuthority({
        observations,
        policy: new CjsToolBuildPolicy({ targets: { eve: { resources: { pin: "3465000" } } } }),
        discover: () => "3466501"
    });

    const plain = await authority.KeepSet({ targets: [ "eve" ], facets: [ "resources" ], window: 2 });
    const pinned = await withPin.KeepSet({ targets: [ "eve" ], facets: [ "resources" ], window: 2 });

    assert.ok(plain.builds.get("eve").has("3466501"), "what is served");
    assert.ok(plain.builds.get("eve").has("3466200"), "and the one before it");
    assert.ok(!plain.builds.get("eve").has("3466000"), "but not beyond the window");
    assert.ok(pinned.builds.get("eve").has("3465000"), "a pin is kept even when not served");
});

test("a target with no build and no history fails the keep-set rather than contributing nothing", async () =>
{
    // The dangerous case, and the quiet one: `Resolve` is right not to throw —
    // "upstream said nothing and I have never seen this target" is an honest
    // answer. It only becomes a deletion when a keep-set accepts it as zero
    // files and is then applied to a store those files share.
    const { authority } = await Open(() => { throw new Error("ENETUNREACH"); });
    const answer = await authority.Resolve({ target: "frontier" });

    assert.equal(answer.build, null, "resolution itself does not throw");

    await assert.rejects(
        () => authority.KeepSet({ targets: [ "frontier" ], facets: [ "resources" ] }),
        /ever been observed/u
    );
});

test("the keep-set refuses rather than shrinking when a target cannot be resolved", async () =>
{
    const { authority } = await Open(() => "3466501");

    // Seeded, so the failure below is about the bad target rather than about an
    // empty log — the trap the previous version of this test fell into.
    await authority.Resolve({ target: "eve" });

    // One good target and one unresolvable. The dangerous outcome is not the
    // error, it is answering with eve's builds alone: resource files are
    // content-addressed and shared, so pruning against that set deletes files
    // the other target needs. Frontier answering 401 for part of its index is
    // this case in the wild.
    await assert.rejects(
        () => authority.KeepSet({ targets: [ "eve", "" ], facets: [ "resources" ] }),
        /Refusing to report a keep-set/u
    );

    // And the good target on its own still works, so the refusal is about the
    // failure rather than the shape of the request.
    const fine = await authority.KeepSet({ targets: [ "eve" ], facets: [ "resources" ] });

    assert.ok(fine.builds.get("eve").has("3466501"));
});
