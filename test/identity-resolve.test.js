import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolPublicIdentity } from "../src/identity/index.js";

/**
 * An ESI that answers from a fixture and counts what it was asked.
 *
 * The counting is the point of several of these: the reason this class exists
 * rather than a lookup per consumer is that it turns a name into one round trip
 * and remembers the answer.
 */
function Esi({ ids = {}, names = [], records = {} } = {})
{
    const asked = { get: [], post: [] };

    return {
        asked,
        async Get(path)
        {
            asked.get.push(path);

            const record = records[path];

            if (!record)
            {
                const error = new Error(`ESI ${path} failed (404)`);

                error.statusCode = 404;
                throw error;
            }

            return record;
        },
        async Post(path, body)
        {
            asked.post.push({ path, body });

            if (path === "/universe/names") return names;

            // Only the spelling the game recognises answers, which is what makes
            // the case-folding worth doing.
            const spellings = new Set(body);

            for (const [ spelling, answer ] of Object.entries(ids))
            {
                if (spellings.has(spelling)) return answer;
            }

            return {};
        },
    };
}

const VILY = {
    "/characters/720302779": { name: "Vily", corporation_id: 828800677 },
    "/corporations/828800677": { name: "Sniggerdly", ticker: "SNIGG", alliance_id: 386292982 },
    "/alliances/386292982": { name: "Pandemic Legion", ticker: "-10.0" },
};

test("a character name resolves through its corporation to its alliance", async () =>
{
    const esi = Esi({
        ids: { Vily: { characters: [ { id: 720302779, name: "Vily" } ] } },
        records: VILY,
    });
    const identity = new CjsToolPublicIdentity({ esi });
    const answer = await identity.Resolve({ term: "Vily", kind: "character" });

    assert.equal(answer.kind, "character");
    assert.equal(answer.id, 720302779);
    assert.equal(answer.name, "Vily");
    assert.equal(answer.corporation.name, "Sniggerdly");
    assert.equal(answer.alliance.name, "Pandemic Legion");
    assert.ok(answer.observedAt, "an affiliation is an observation, so it is dated");
});

test("a name is asked in several spellings, in one request", async () =>
{
    // The whole reason this is here: /universe/ids is case-sensitive, and
    // nobody types their own name the way the client stored it.
    const esi = Esi({
        ids: { Vily: { characters: [ { id: 720302779, name: "Vily" } ] } },
        records: VILY,
    });
    const identity = new CjsToolPublicIdentity({ esi });

    assert.ok(await identity.Resolve({ term: "vily", kind: "character" }));
    assert.equal(esi.asked.post.length, 1, "one round trip, not one per casing");
    assert.ok(esi.asked.post[0].body.includes("Vily"), "the casing the game knows was among them");
});

test("apostrophes and hyphens are capitalised too", async () =>
{
    const esi = Esi({
        ids: { "O'Brien-Smith": { corporations: [ { id: 98000001, name: "O'Brien-Smith" } ] } },
        records: { "/corporations/98000001": { name: "O'Brien-Smith", ticker: "OBS" } },
    });
    const identity = new CjsToolPublicIdentity({ esi });
    const answer = await identity.Resolve({ term: "o'brien-smith", kind: "corporation" });

    assert.equal(answer.name, "O'Brien-Smith");
});

test("an id is checked against its category, not just its shape", async () =>
{
    // An id is a number and every kind of thing in the game shares one space,
    // so asking for a corporation by a character's id must answer nothing.
    const esi = Esi({
        names: [ { id: 720302779, name: "Vily", category: "character" } ],
        records: VILY,
    });
    const identity = new CjsToolPublicIdentity({ esi });

    assert.equal(await identity.Resolve({ term: "720302779", kind: "corporation" }), null);

    const asCharacter = await identity.Resolve({ term: "720302779", kind: "character" });

    assert.equal(asCharacter.name, "Vily");
});

test("a corporation with no alliance says so by omission", async () =>
{
    const esi = Esi({
        ids: { Boring: { corporations: [ { id: 98000002, name: "Boring" } ] } },
        records: { "/corporations/98000002": { name: "Boring", ticker: "BORE" } },
    });
    const identity = new CjsToolPublicIdentity({ esi });
    const answer = await identity.Resolve({ term: "Boring", kind: "corporation" });

    assert.equal(answer.ticker, "BORE");
    assert.equal("alliance" in answer, false, "absent, so it cannot be read as unknown");
});

test("nothing matching is null, and so is a term nobody could have typed", async () =>
{
    const identity = new CjsToolPublicIdentity({ esi: Esi() });

    assert.equal(await identity.Resolve({ term: "Nobody", kind: "character" }), null);
    assert.equal(await identity.Resolve({ term: "", kind: "character" }), null);
    assert.equal(await identity.Resolve({ term: "x".repeat(500), kind: "character" }), null,
        "a term longer than any name is refused before it is relayed to CCP");
});

test("an unknown kind is the caller's mistake", async () =>
{
    const identity = new CjsToolPublicIdentity({ esi: Esi() });

    await assert.rejects(() => identity.Resolve({ term: "Vily", kind: "wormhole" }), TypeError);
});

test("the same question twice is one round trip", async () =>
{
    const esi = Esi({
        ids: { Vily: { characters: [ { id: 720302779, name: "Vily" } ] } },
        records: VILY,
    });
    const identity = new CjsToolPublicIdentity({ esi });

    await identity.Resolve({ term: "Vily", kind: "character" });
    await identity.Resolve({ term: "VILY", kind: "character" });

    assert.equal(esi.asked.post.length, 1, "and capitalisation is not a different question");
});

test("a client that cannot POST still resolves an id", async () =>
{
    // Only a NAME needs the POST routes. A client without them is not refused
    // outright, because half the questions do not need it.
    const esi = Esi({ records: VILY });

    delete esi.Post;

    const identity = new CjsToolPublicIdentity({ esi });

    assert.equal(await identity.Character(720302779).then(a => a.name), "Vily");
    await assert.rejects(() => identity.Resolve({ term: "Vily", kind: "character" }), TypeError);
});

test("the proxy answers the resolve route, and 404s a name nobody has", async context =>
{
    const { CjsToolHttpProxy } = await import("../src/index.js");
    const proxy = new CjsToolHttpProxy({
        indexes: { Open() {} },
        identity: {
            async Character() { return null; },
            async Resolve({ term, kind })
            {
                if (kind === "wormhole") throw new TypeError("Unknown identity kind: wormhole");

                return term === "Vily" ? { kind, id: 720302779, name: "Vily" } : null;
            },
        },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const root = `http://127.0.0.1:${server.address().port}`;
    const Ask = query => fetch(`${root}/v1/identity/resolve?${query}`);

    const found = await Ask("q=Vily&kind=character");

    assert.equal(found.status, 200);
    assert.equal((await found.json()).name, "Vily");

    const missing = await Ask("q=Nobody&kind=character");

    // Not an empty record: a consumer must be able to tell "no such pilot" from
    // "a pilot with no name".
    assert.equal(missing.status, 404);

    const wrong = await Ask("q=Vily&kind=wormhole");

    // The caller's mistake, said as one, rather than a 502 blaming CCP.
    assert.equal(wrong.status, 400);
});

test("the resolve route says so when no identity service is configured", async context =>
{
    const { CjsToolHttpProxy } = await import("../src/index.js");
    const proxy = new CjsToolHttpProxy({ indexes: { Open() {} } });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const answer = await fetch(`http://127.0.0.1:${server.address().port}/v1/identity/resolve?q=Vily&kind=character`);

    assert.equal(answer.status, 501);
});
