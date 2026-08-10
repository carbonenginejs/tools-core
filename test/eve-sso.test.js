// EVE SSO PKCE, offline. Nothing here touches the network: the value of this
// module is in the parts that must be right BEFORE a token exists.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { CjsToolEveSso } from "../src/auth/CjsToolEveSso.js";

const base64url = buffer => buffer.toString("base64")
    .replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");

function MakeSso(overrides = {})
{
    return new CjsToolEveSso({
        clientId: "test-client",
        callback: "http://localhost:5502/v1/auth/esi/callback",
        scopes: [ "esi-skins.read_skins.v1" ],
        ...overrides,
    });
}

test("requires the identity it cannot invent", () =>
{
    assert.throws(() => new CjsToolEveSso({ callback: "http://x" }), /clientId/u);
    assert.throws(() => new CjsToolEveSso({ clientId: "x" }), /callback/u);
});

test("the authorize url carries a real S256 challenge, not the verifier", () =>
{
    const sso = MakeSso();
    const { url, state } = sso.BeginLogin();
    const parsed = new URL(url);

    assert.equal(parsed.origin + parsed.pathname, "https://login.eveonline.com/v2/oauth/authorize");
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.equal(parsed.searchParams.get("client_id"), "test-client");
    assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
    assert.equal(parsed.searchParams.get("scope"), "esi-skins.read_skins.v1");
    assert.equal(parsed.searchParams.get("state"), state);

    // A public client has no secret, so the challenge is the whole proof: it
    // must be the HASH of the verifier. Sending the verifier itself would make
    // an intercepted redirect spendable.
    const challenge = parsed.searchParams.get("code_challenge");
    const verifier = sso.ClaimLogin(state);

    assert.notEqual(challenge, verifier, "the challenge must not be the verifier");
    assert.equal(challenge, base64url(createHash("sha256").update(verifier).digest()));

    // base64url only - a "+", "/" or "=" would be mangled in a query string.
    assert.match(challenge, /^[A-Za-z0-9_-]+$/u);
    assert.match(verifier, /^[A-Za-z0-9_-]+$/u);
});

test("no client secret is ever sent", () =>
{
    const url = new URL(MakeSso().BeginLogin().url);

    for (const key of [ "client_secret", "code_verifier" ])
    {
        assert.equal(url.searchParams.get(key), null, `${key} must not be in the authorize url`);
    }
});

test("every login is unique", () =>
{
    const sso = MakeSso();
    const states = new Set();
    const verifiers = new Set();

    for (let i = 0; i < 50; i++)
    {
        const { state } = sso.BeginLogin();
        states.add(state);
        verifiers.add(sso.ClaimLogin(state));
    }

    assert.equal(states.size, 50, "states must not repeat");
    assert.equal(verifiers.size, 50, "verifiers must not repeat");
});

test("a state is single use, and an unknown one is refused", () =>
{
    const sso = MakeSso();
    const { state } = sso.BeginLogin();

    assert.ok(sso.ClaimLogin(state));
    // Replaying a state is what a CSRF attempt looks like here; a second claim
    // would let a second code be spent against the first login.
    assert.throws(() => sso.ClaimLogin(state), /Unknown or expired/u);
    assert.throws(() => sso.ClaimLogin("not-a-state"), /Unknown or expired/u);
    assert.throws(() => sso.ClaimLogin(undefined), /Unknown or expired/u);
});

test("pending logins expire and are swept", () =>
{
    const sso = MakeSso({ pendingTtlMs: 1000 });
    const { state } = sso.BeginLogin(0);

    assert.equal(sso.pendingCount, 1);
    assert.throws(() => sso.ClaimLogin(state, 1001), /Unknown or expired/u);
    assert.equal(sso.pendingCount, 0, "an expired login must not linger");

    // Still claimable inside the window.
    const second = sso.BeginLogin(0);
    assert.ok(sso.ClaimLogin(second.state, 999));
});

test("completing a login without a code fails before anything is claimed", async () =>
{
    const sso = MakeSso();
    const { state } = sso.BeginLogin();

    await assert.rejects(() => sso.CompleteLogin({ state }), /requires a code/u);
    // The state survives, so a genuine callback can still complete.
    assert.equal(sso.pendingCount, 1);
});

test("refresh refuses an empty token instead of calling out with one", async () =>
{
    await assert.rejects(() => MakeSso().Refresh(""), /requires a refresh token/u);
    await assert.rejects(() => MakeSso().Refresh(null), /requires a refresh token/u);
});
