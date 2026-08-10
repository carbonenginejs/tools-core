// The SSO legs on the proxy. Offline: the SSO client's network call is stubbed.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CjsToolHttpProxy } from "../src/proxy/CjsToolHttpProxy.js";
import { CjsToolEveSso } from "../src/auth/CjsToolEveSso.js";
import { CjsToolTokenFile } from "../src/auth/CjsToolTokenFile.js";

async function Serve(context, { auth = undefined } = {})
{
    const proxy = new CjsToolHttpProxy({ sde: { OpenTarget() {} }, auth });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    return `http://127.0.0.1:${server.address().port}`;
}

async function MakeAuth({ tokenResponse } = {})
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-auth-"));
    const tokens = new CjsToolTokenFile({ directory });
    const sso = new CjsToolEveSso({
        clientId: "test-client",
        callback: "http://localhost:5510/v1/auth/esi/callback",
        fetch: async () => ({
            ok: true,
            status: 200,
            json: async () => tokenResponse ?? { refresh_token: "r-1", access_token: "a" },
        }),
    });

    return { sso, tokens };
}

test("auth routes report unconfigured rather than pretending", async context =>
{
    const root = await Serve(context);
    const response = await fetch(`${root}/v1/auth/esi/status`);

    assert.equal(response.status, 501);
    assert.match((await response.json()).error, /CJS_ESI_CLIENT_ID/u);
});

test("status reports whether a token is stored, and never the token", async context =>
{
    const auth = await MakeAuth();
    const root = await Serve(context, { auth });

    let body = await (await fetch(`${root}/v1/auth/esi/status`)).json();
    assert.equal(body.authenticated, false);

    await auth.tokens.Write({ refreshToken: "r-secret", characterId: 42, characterName: "Pilot" });

    const response = await fetch(`${root}/v1/auth/esi/status`);
    const text = await response.text();

    body = JSON.parse(text);
    assert.equal(body.authenticated, true);
    assert.equal(body.characterId, 42);
    assert.equal(body.characterName, "Pilot");
    assert.ok(!text.includes("r-secret"), "a status response must never carry the token");
});

test("login redirects the browser to EVE and holds one pending login", async context =>
{
    const auth = await MakeAuth();
    const root = await Serve(context, { auth });

    const response = await fetch(`${root}/v1/auth/esi/login`, { redirect: "manual" });

    assert.equal(response.status, 302);

    const location = new URL(response.headers.get("location"));
    assert.equal(location.origin + location.pathname, "https://login.eveonline.com/v2/oauth/authorize");
    assert.equal(location.searchParams.get("client_id"), "test-client");
    assert.equal(auth.sso.pendingCount, 1);
});

test("the callback stores the refresh token and says nothing about it", async context =>
{
    const auth = await MakeAuth();
    const root = await Serve(context, { auth });

    const { state } = auth.sso.BeginLogin();
    const response = await fetch(`${root}/v1/auth/esi/callback?code=abc&state=${state}`);
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.ok(!text.includes("r-1"), "the callback page must not contain the token");
    assert.equal((await auth.tokens.Read()).refreshToken, "r-1");
});

test("a forged callback cannot mint a session", async context =>
{
    const auth = await MakeAuth();
    const root = await Serve(context, { auth });

    // No login was begun, so no state exists to claim.
    const response = await fetch(`${root}/v1/auth/esi/callback?code=abc&state=forged`);

    assert.equal(response.status, 400);
    assert.equal(await auth.tokens.Read(), null, "nothing may be stored for an unknown state");
});

test("a replayed callback is refused after the first use", async context =>
{
    const auth = await MakeAuth();
    const root = await Serve(context, { auth });

    const { state } = auth.sso.BeginLogin();
    const query = `code=abc&state=${state}`;

    assert.equal((await fetch(`${root}/v1/auth/esi/callback?${query}`)).status, 200);
    assert.equal((await fetch(`${root}/v1/auth/esi/callback?${query}`)).status, 400);
});

test("a provider error is reported without echoing its text", async context =>
{
    const auth = await MakeAuth();
    const root = await Serve(context, { auth });

    const injected = encodeURIComponent("<script>alert(1)</script>");
    const response = await fetch(
        `${root}/v1/auth/esi/callback?error=access_denied&error_description=${injected}`,
    );
    const text = await response.text();

    assert.equal(response.status, 400);
    assert.match(text, /access_denied/u);
    // The query is attacker-influenced and this renders in a browser.
    assert.ok(!text.includes("<script>"), "provider text must not be echoed");
});

test("an unknown auth leg is a 404", async context =>
{
    const root = await Serve(context, { auth: await MakeAuth() });

    assert.equal((await fetch(`${root}/v1/auth/esi/nope`)).status, 404);
});
