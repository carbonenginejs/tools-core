#!/usr/bin/env node
/**
 * Fills in who the SKINR store's character ids belong to.
 *
 * The harvest records a creator and a seller as bare ids, which is right — that
 * is what the API returns, and a name is not a fact about the listing. But it
 * left every capsuleer unsearchable: somebody who knows a designer by name had
 * no way to find their work.
 *
 * This resolves them once and writes them beside the log. It needs NO LOGIN:
 * `/characters/{id}`, `/corporations/{id}` and `/alliances/{id}` are public, so
 * this runs on a server nobody has signed in on — which is the whole reason it
 * can be a maintenance job rather than part of the harvest.
 *
 * Re-runnable. `--missing` does only the ids with no name yet, which is the
 * normal case after a harvest adds new sellers; without it every id is
 * refreshed, which is what you want when the corporations have gone stale.
 *
 * Usage:
 *   node bin/cjs-skinr-names.js [--missing] [--concurrency 8]
 */
import process from "node:process";

import { LoadToolEnv } from "../src/env.js";
import { CjsToolPublicEsi, CjsToolPublicIdentity } from "../src/identity/index.js";
import { CjsToolSkinrStore } from "../src/skin/index.js";

const args = process.argv.slice(2);
const missingOnly = args.includes("--missing");
const concurrency = Number(args[args.indexOf("--concurrency") + 1]) || 8;

LoadToolEnv();

const store = CjsToolSkinrStore.open();
const identity = new CjsToolPublicIdentity({ esi: new CjsToolPublicEsi() });
const ids = store.CharacterIds({ missingOnly });

process.stdout.write(`${ids.length} character${ids.length === 1 ? "" : "s"} to resolve\n`);

let done = 0, named = 0, failed = 0;
let next = 0;

async function Worker()
{
    while (next < ids.length)
    {
        const id = ids[next++];

        try
        {
            const answer = await identity.Character(id);

            if (answer && store.PutCharacter(answer)) named++;
            else failed++;
        }
        catch (error)
        {
            // One id that will not resolve — a deleted character, a rate limit —
            // must not end a run of a thousand. It is counted and skipped, and
            // `--missing` picks it up next time.
            failed++;
        }

        done++;

        if (done % 50 === 0) process.stdout.write(`  ${done}/${ids.length} (${named} named, ${failed} failed)\n`);
    }
}

await Promise.all(Array.from({ length: Math.max(1, concurrency) }, Worker));

process.stdout.write(`done: ${named} named, ${failed} failed, of ${ids.length}\n`);
store.Close();
