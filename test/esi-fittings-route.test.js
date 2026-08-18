import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsToolEsiClient, CjsToolEveSso, CjsToolTokenFile } from "../src/auth/index.js";
import { CjsToolHttpProxy } from "../src/proxy/index.js";
import { FITTINGS_SCOPE } from "../src/proxy/CjsToolHttpProxy.js";

/**
 * `GET /v1/auth/esi/fittings`.
 *
 * Every state the route has to tell apart, because the whole value of the route
 * over calling ESI directly is that it distinguishes them: signed out, a
 * session with no character, a grant that does not cover fittings, an upstream
 * failure, and success. A route that answered 502 to all of them would send the
 * operator looking for an outage when they need to sign in again.
 *
 * No token ever appears in a response, and that is asserted rather than assumed.
 */

async function MakeAuth({ esiResponse, esiStatus = 200 } = {})
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-fittings-"));
    const tokens = new CjsToolTokenFile({ directory });
    const sso = new CjsToolEveSso({
        clientId: "test-client",
        callback: "http://localhost:5510/v1/auth/esi/callback",
        fetch: async () => ({
            ok: true,
            status: 200,
            json: async () => ({ refresh_token: "r-1", access_token: "a" }),
        }),
    });

    // The ESI transport is stubbed at the client's own seam, so nothing here
    // touches the network and the upstream status is whatever a case needs.
    const esi = new CjsToolEsiClient({
        sso,
        tokens,
        fetch: async () => ({
            ok: esiStatus >= 200 && esiStatus < 300,
            status: esiStatus,
            headers: new Map(),
            json: async () => esiResponse ?? [],
            text: async () => JSON.stringify(esiResponse ?? []),
            body: null,
        }),
    });

    return { sso, tokens, esi };
}

async function Serve(context, auth)
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

const SAVED = [
    {
        fitting_id: 1234,
        name: "Example fit",
        description: "",
        ship_type_id: 587,
        items: [
            { type_id: 2456, flag: "HiSlot0", quantity: 1 },
            { type_id: 12058, flag: "Cargo", quantity: 42 },
        ],
    },
];

test("an unconfigured service says so rather than pretending to be signed out", async context =>
{
    const root = await Serve(context, undefined);
    const response = await fetch(`${root}/v1/auth/esi/fittings`);

    assert.equal(response.status, 501);
    assert.match((await response.json()).error, /CJS_ESI_CLIENT_ID/u);
});

test("signed out is 401, and names the command that fixes it", async context =>
{
    const auth = await MakeAuth();
    const root = await Serve(context, auth);
    const response = await fetch(`${root}/v1/auth/esi/fittings`);

    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /Not signed in/u);
});

test("a session with no character is 409, not a failure", async context =>
{
    const auth = await MakeAuth();

    await auth.tokens.Write({ refreshToken: "r-secret" });

    const root = await Serve(context, auth);
    const response = await fetch(`${root}/v1/auth/esi/fittings`);

    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /no character/u);
});

test("a grant without the scope is refused before ESI is called", async context =>
{
    const auth = await MakeAuth({
        // Would succeed if it were reached. It must not be.
        esiResponse: SAVED,
    });

    await auth.tokens.Write({
        refreshToken: "r-secret",
        characterId: 96000001,
        characterName: "Example Pilot",
        scopes: [ "esi-skills.read_skills.v1" ],
    });

    const root = await Serve(context, auth);
    const response = await fetch(`${root}/v1/auth/esi/fittings`);
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.scope, FITTINGS_SCOPE);
    assert.match(body.error, /CJS_ESI_SCOPES/u);
});

test("a 403 from ESI is reported as a missing scope, not as an outage", async context =>
{
    // The token records no scopes - written before scope capture existed - so
    // the pre-check cannot fire and ESI is the one that refuses.
    const auth = await MakeAuth({ esiStatus: 403 });

    await auth.tokens.Write({ refreshToken: "r-secret", characterId: 96000001 });

    const root = await Serve(context, auth);
    const response = await fetch(`${root}/v1/auth/esi/fittings`);
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.scope, FITTINGS_SCOPE);
    assert.match(body.error, /Sign in again/u);
});

test("an upstream failure is a 502 and says what ESI answered", async context =>
{
    const auth = await MakeAuth({ esiStatus: 500 });

    await auth.tokens.Write({ refreshToken: "r-secret", characterId: 96000001 });

    const root = await Serve(context, auth);
    const response = await fetch(`${root}/v1/auth/esi/fittings`);

    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /500/u);
});

test("success returns normalized fittings and no token", async context =>
{
    const auth = await MakeAuth({ esiResponse: SAVED });

    await auth.tokens.Write({
        refreshToken: "r-secret",
        accessToken: "a-secret",
        characterId: 96000001,
        characterName: "Example Pilot",
        scopes: [ FITTINGS_SCOPE ],
    });

    const root = await Serve(context, auth);
    const response = await fetch(`${root}/v1/auth/esi/fittings`);
    const text = await response.text();
    const body = JSON.parse(text);

    assert.equal(response.status, 200);
    assert.equal(body.characterId, 96000001);
    assert.equal(body.characterName, "Example Pilot");
    assert.deepEqual(body.fittings, [
        {
            fittingID: 1234,
            name: "Example fit",
            description: "",
            shipTypeID: 587,
            items: [
                { typeID: 2456, flag: "HiSlot0", quantity: 1 },
                { typeID: 12058, flag: "Cargo", quantity: 42 },
            ],
        },
    ]);

    // The point of the route existing at all.
    assert.ok(!text.includes("r-secret"), "response must not carry the refresh token");
    assert.ok(!text.includes("a-secret"), "response must not carry the access token");
});

test("the character comes from the token, never from the caller", async context =>
{
    const auth = await MakeAuth({ esiResponse: SAVED });
    const requested = [];

    // Records the path the client was asked for, so a supplied id cannot
    // silently become the one that is read.
    auth.esi = { Get: async (path) => { requested.push(path); return SAVED; } };

    await auth.tokens.Write({
        refreshToken: "r-secret",
        characterId: 96000001,
        scopes: [ FITTINGS_SCOPE ],
    });

    const root = await Serve(context, auth);
    const response = await fetch(`${root}/v1/auth/esi/fittings?characterID=99999999`);

    assert.equal(response.status, 200);
    assert.deepEqual(requested, [ "/characters/96000001/fittings" ]);
    assert.equal((await response.json()).characterId, 96000001);
});
