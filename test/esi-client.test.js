// Offline: the fetch is stubbed. What matters here is header discipline,
// refresh behaviour and that a rotated token is persisted.
import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolEsiClient } from "../src/auth/CjsToolEsiClient.js";

function MakeTokens(initial = null)
{
    let record = initial;

    return {
        writes: [],
        async Read() { return record; },
        async Write(next) { record = next; this.writes.push(next); },
    };
}

const Sso = refresh => ({ Refresh: refresh });
const Ok = body => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } });

test("refuses to call out when nobody has signed in", async () =>
{
    const client = new CjsToolEsiClient({
        sso: Sso(async () => { throw new Error("must not refresh"); }),
        tokens: MakeTokens(null),
        fetch: async () => { throw new Error("must not fetch"); },
    });

    await assert.rejects(() => client.Get("/x"), error =>
    {
        assert.match(error.message, /npm run login/u);
        assert.equal(error.statusCode, 401);
        return true;
    });
});

test("every request carries the compatibility date and a bearer", async () =>
{
    let seen = null;
    const client = new CjsToolEsiClient({
        sso: Sso(async () => ({ access_token: "a1", refresh_token: "r2", expires_in: 1199 })),
        tokens: MakeTokens({ refreshToken: "r1" }),
        fetch: async (url, options) => { seen = { url, options }; return Ok({ id: "x" }); },
    });

    assert.deepEqual(await client.Get("/cosmetics/skinr/abc"), { id: "x" });
    assert.equal(seen.url, "https://esi.evetech.net/cosmetics/skinr/abc");
    // ESI rejects the call outright without this, so it is not optional.
    assert.equal(seen.options.headers["x-compatibility-date"], "2026-08-01");
    assert.equal(seen.options.headers.authorization, "Bearer a1");
});

test("the default compatibility date is one that has already passed", async () =>
{
    let seen = null;
    const client = new CjsToolEsiClient({
        sso: Sso(async () => ({ access_token: "a1", refresh_token: "r2", expires_in: 1199 })),
        tokens: MakeTokens({ refreshToken: "r1" }),
        fetch: async (url, options) => { seen = { url, options }; return Ok({}); },
    });

    await client.Get("/x");

    // A compatibility date is a PIN, and ESI reads it literally: a far-future
    // placeholder does not mean "newest schema", it is a 400 on every route for
    // every id. That shipped once and cost a whole feature - character names
    // resolved for nobody - because nothing local could tell the difference
    // between "upstream is unhappy" and "we asked an impossible question".
    const pinned = Date.parse(`${seen.options.headers["x-compatibility-date"]}T00:00:00Z`);

    assert.ok(Number.isFinite(pinned), "the compatibility date must be a real date");
    assert.ok(pinned < Date.now(), "the compatibility date must be in the past");
});

test("a rotated refresh token is persisted, not dropped", async () =>
{
    const tokens = MakeTokens({ refreshToken: "r1" });
    const client = new CjsToolEsiClient({
        sso: Sso(async () => ({ access_token: "a1", refresh_token: "r2-rotated", expires_in: 1199 })),
        tokens,
        fetch: async () => Ok({}),
    });

    await client.Get("/x");

    // EVE rotates on every refresh; keeping r1 would strand the session.
    assert.equal(tokens.writes.at(-1).refreshToken, "r2-rotated");
    assert.equal(tokens.writes.at(-1).accessToken, "a1");
    assert.ok(tokens.writes.at(-1).expiresAt > Date.now());
});

test("a cached access token is reused until it nears expiry", async () =>
{
    let refreshes = 0;
    const client = new CjsToolEsiClient({
        sso: Sso(async () => { refreshes++; return { access_token: "a", refresh_token: "r", expires_in: 1199 }; }),
        tokens: MakeTokens({ refreshToken: "r", accessToken: "still-good", expiresAt: Date.now() + 600_000 }),
        fetch: async () => Ok({}),
    });

    await client.Get("/x");
    await client.Get("/y");

    assert.equal(refreshes, 0, "a valid access token must not trigger a refresh");
});

test("a 401 refreshes once and retries, and a second 401 gives up", async () =>
{
    let refreshes = 0;
    let calls = 0;
    const client = new CjsToolEsiClient({
        sso: Sso(async () => { refreshes++; return { access_token: `a${refreshes}`, refresh_token: "r", expires_in: 1199 }; }),
        tokens: MakeTokens({ refreshToken: "r" }),
        fetch: async () => { calls++; return { ok: false, status: 401 }; },
    });

    await assert.rejects(() => client.Get("/x"), /failed \(401\)/u);
    assert.equal(calls, 2, "one retry, not a loop");
});

test("concurrent callers share one refresh rather than each spending the token", async () =>
{
    let refreshes = 0;
    const client = new CjsToolEsiClient({
        sso: Sso(async () =>
        {
            refreshes++;
            await new Promise(resolve => setTimeout(resolve, 10));
            return { access_token: "a", refresh_token: "r", expires_in: 1199 };
        }),
        tokens: MakeTokens({ refreshToken: "r" }),
        fetch: async () => Ok({}),
    });

    await Promise.all([ client.Get("/a"), client.Get("/b"), client.Get("/c") ]);

    // Parallel refreshes would invalidate each other, since EVE rotates on use.
    assert.equal(refreshes, 1);
});

test("a 404 stays a 404 rather than becoming a gateway error", async () =>
{
    const client = new CjsToolEsiClient({
        sso: Sso(async () => ({ access_token: "a", refresh_token: "r", expires_in: 1199 })),
        tokens: MakeTokens({ refreshToken: "r" }),
        fetch: async () => ({ ok: false, status: 404 }),
    });

    await assert.rejects(() => client.Get("/missing"), error =>
    {
        assert.equal(error.statusCode, 404);
        return true;
    });
});

test("a refresh preserves the stored identity", async () =>
{
    // Write() REPLACES the record, so a refresh that restates only the token
    // fields silently drops the character. The failure that causes is not an
    // error: the session stays signed in and the character-scoped routes start
    // refusing about an hour after a login that worked.
    const tokens = MakeTokens({
        refreshToken: "r-1",
        characterId: 96057971,
        characterName: "Pilot",
    });

    const client = new CjsToolEsiClient({
        sso: Sso(async () => ({
            access_token: "a-2",
            refresh_token: "r-2",
            expires_in: 1200,
        })),
        tokens,
        fetch: async () => Ok({ ok: true }),
    });

    await client.Get("/cosmetics/skinr/abc");

    const stored = tokens.writes.at(-1);

    assert.equal(stored.refreshToken, "r-2", "the rotated token must replace the old one");
    assert.equal(stored.characterId, 96057971, "identity must survive a refresh");
    assert.equal(stored.characterName, "Pilot");
});
