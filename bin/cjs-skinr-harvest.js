#!/usr/bin/env node
/**
 * Harvests the public SKINR surface into the durable store.
 *
 * Listings first, because there is no id space to walk: `skinr_id` is a string,
 * so designs cannot be enumerated and ids only arrive from Paragon Hub pages.
 * The run is therefore: page the hub, append every listing as an observation,
 * collect the ids, and fetch each design that is not already stored.
 *
 * Designs are fetched ONCE per store. They are immutable upstream, and the
 * budget that makes bulk reading possible - 12,000 per fifteen minutes against
 * 150 for hub pages - exists because that is the intended shape. Paging is the
 * constraint here, not the definitions.
 *
 * Safe to re-run. Observations are keyed by listing and observation time, so a
 * repeated page is idempotent within a run and a new row across runs, which is
 * how a price change becomes visible at all.
 *
 * Usage:
 *   node bin/cjs-skinr-harvest.js [--pages N] [--limit N] [--designs N]
 *                                 [--before CURSOR] [--refresh] [--dry-run]
 */
import path from "node:path";
import process from "node:process";

import { CjsToolEsiClient, CjsToolEveSso, CjsToolTokenFile } from "../src/auth/index.js";
import { CjsToolPublicEsi } from "../src/identity/index.js";
import { CjsToolSkinrDesigns, CjsToolSkinrStore } from "../src/skin/index.js";
import { resolveDataRoot } from "../src/cache/resolveDataRoot.js";
import { LoadToolEnv } from "../src/env.js";

// One page every four seconds keeps a long walk inside the hub's 150-per-15
// minutes, with room for a retry. The definition budget is eighty times larger,
// so designs are paced only enough to stay polite.
const PAGE_PACE_MS = 4000;
const DESIGN_PACE_MS = 120;

const options = ReadOptions(process.argv.slice(2));

LoadToolEnv();

const dataDirectory = resolveDataRoot();
const tokens = new CjsToolTokenFile({ directory: path.join(dataDirectory, "auth") });
const clientId = String(process.env.CJS_ESI_CLIENT_ID ?? "").trim();
// Built only where there is something to build it from.
//
// `CjsToolEveSso` throws on an empty clientId, and this was constructing one
// before deciding whether a token was wanted - so the harvest died on its
// fourth line, with "EVE SSO requires a clientId", on exactly the machine the
// comment below describes as the one to run it on. A server nobody has signed
// in on could not run a harvest that does not need anybody signed in
// (2026-08-25).
const sso = clientId
    ? new CjsToolEveSso({
        clientId,
        callback: String(process.env.CJS_ESI_CALLBACK ?? "").trim(),
        scopes: String(process.env.CJS_ESI_SCOPES ?? "").split(/\s+/u).filter(Boolean),
    })
    : null;
const session = sso ? await tokens.Read() : null;

// A token is preferred and not required.
//
// The Paragon Hub routes are public - measured, not assumed:
// `/paragon-hub/skinr` and `/cosmetics/skinr/{id}` both answer 200 with no
// Authorization header. Demanding a login anyway is what made a scheduled
// harvest impossible on a server nobody has signed in on, which is exactly
// where one wants to run.
//
// Signed in, the authenticated client is used: a token raises the shared
// rate limit, and a harvest walking thirty pages is the caller most likely
// to want that headroom.
const esi = sso && session?.refreshToken
    ? new CjsToolEsiClient({ sso, tokens, compatibilityDate: options.compatibilityDate })
    : new CjsToolPublicEsi({ compatibilityDate: options.compatibilityDate });
const designs = new CjsToolSkinrDesigns({ esi });

// One timestamp for the whole run. Every listing seen in this pass was seen in
// the same pass, and stamping each page separately would make one harvest look
// like several when the history is read back.
const observedAt = new Date().toISOString();
const store = options.dryRun ? null : CjsToolSkinrStore.open();
const ids = new Set();

let pages = 0;
let listings = 0;
let appended = 0;
let cursor = options.before;

process.stdout.write(`SKINR harvest ${session?.refreshToken
    ? `as ${session.characterName ?? session.characterId}`
    : "unauthenticated"} at ${observedAt}\n`);
if (store) process.stdout.write(`store ${store.filePath}\n`);

try
{
    while (options.pages === null || pages < options.pages)
    {
        // `before`, not `after`. The hub is newest-first, so `after` asks for
        // listings newer than the newest and answers empty every time - which
        // looks exactly like a hub with one page in it. See WalkParagonHub.
        const page = await designs.ListParagonHub(
            cursor ? { before: cursor, limit: options.limit } : { limit: options.limit },
        );

        pages++;
        listings += page.listings.length;

        for (const id of CjsToolSkinrDesigns.collectSkinrIds(page.listings)) ids.add(id);
        if (store) appended += store.AppendListings(page.listings, observedAt);

        process.stdout.write(
            `page ${pages}: ${page.listings.length} listings, ${ids.size} designs seen\n`,
        );

        // An EMPTY page is not the end of the hub. One was observed answering
        // with no listings and no cursors while the next request answered
        // normally, so treating it as the end would end a harvest silently and
        // record it as complete.
        if (!page.listings.length)
        {
            process.stdout.write("empty page - stopping, but this may be transient; re-run to continue\n");
            break;
        }

        if (!page.cursor.before || page.cursor.before === cursor) break;

        cursor = page.cursor.before;
        await Wait(PAGE_PACE_MS);
    }

    const wanted = [ ...ids ].filter(id => options.refresh || !store || !store.GetDesign(id));
    const targets = options.designs === null ? wanted : wanted.slice(0, options.designs);

    process.stdout.write(`${targets.length} designs to fetch (${ids.size - wanted.length} already stored)\n`);

    let fetched = 0;
    let failed = 0;

    for (const id of targets)
    {
        try
        {
            // The RAW payload: the store keeps what ESI sent, because that is
            // the shape the pattern generator and the mask reader consume.
            const payload = await designs.FetchSkinrPayload(id);

            if (store) store.PutDesign(payload, observedAt);

            fetched++;
        }
        catch (error)
        {
            // One design that cannot be read is not a failed harvest. Report the
            // count rather than aborting - the listings are already stored, and
            // the ids stay in them, so a later run retries this design for free.
            failed++;
            process.stderr.write(`design ${id} failed: ${error?.upstreamStatus ?? ""} ${error?.message}\n`);
        }

        if (fetched % 100 === 0 && fetched) process.stdout.write(`  ${fetched}/${targets.length} designs\n`);

        await Wait(DESIGN_PACE_MS);
    }

    process.stdout.write(
        `done: ${pages} pages, ${listings} listings (${appended} observations appended), `
        + `${fetched} designs stored, ${failed} failed\n`,
    );

    if (cursor) process.stdout.write(`resume with --before ${cursor}\n`);
    if (store) process.stdout.write(`${JSON.stringify(store.Describe())}\n`);
}
finally
{
    store?.Close();
}


function ReadOptions(argv)
{
    const read = name =>
    {
        const at = argv.indexOf(`--${name}`);

        return at === -1 ? null : argv[at + 1] ?? null;
    };
    const count = value => (value === null ? null : Math.max(1, Math.trunc(Number(value))));

    return {
        pages: count(read("pages")),
        designs: count(read("designs")),
        limit: count(read("limit")) ?? 100,
        before: read("before"),
        // The client's own default is a far-future date, which ESI reads as the
        // newest view. Overridable because pinning it is how a schema change is
        // caught deliberately rather than in production.
        compatibilityDate: read("compatibility-date") ?? "2026-08-18",
        refresh: argv.includes("--refresh"),
        dryRun: argv.includes("--dry-run"),
    };
}

function Wait(ms)
{
    return new Promise(resolve => setTimeout(resolve, ms));
}
