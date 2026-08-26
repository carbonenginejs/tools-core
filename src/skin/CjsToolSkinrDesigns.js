/**
 * The public half of EVE's Cosmetics and Paragon Hub surface: SKINR designs and
 * the listings that advertise them.
 *
 * Public here means **no scope** — the routes want a valid token and nothing
 * else, so this service's own operator token answers them and no visitor ever
 * needs to authenticate to read the result. That is the whole reason to harvest:
 * once stored, serving the data requires no token at all. Anything scope-gated
 * (what a *character* owns) is deliberately not in this file.
 *
 * Beside the SDE catalogue in this folder, deliberately. That owns component categories, patterns and faction
 * slots: what a SKINR can be built FROM. This owns what somebody actually built
 * and what it is being sold for, which comes from ESI rather than the SDE.
 *
 * ## Identifiers are strings, and nothing can be enumerated
 *
 * `skinr_id` is a string, not a sequential integer, so there is no range to walk
 * and no way to discover designs by counting. IDs arrive from listings and from
 * character licences. The harvest is therefore listings-first: page the hub,
 * collect ids, fetch each design once. The definition route's very large token
 * budget exists because that is the intended shape.
 */


/** Every `oneOf` is normalized to a `kind` tag rather than a bag of optionals. */
export const SKINR_SLOT_KINDS = Object.freeze({
    NANOCOATING: "nanocoating",
    PATTERN: "pattern",
});

export const SKINR_PRICE_KINDS = Object.freeze({
    ISK: "isk",
    PLEX: "plex",
});


/**
 * Harvests public SKINR design and listing observations from scope-free ESI
 * routes.
 */
export class CjsToolSkinrDesigns
{

    /**
     * @param {Object} options
     * @param {Object} options.esi - CjsToolEsiClient, or anything with `Get(path)`
     */
    constructor({ esi } = {})
    {
        if (!esi || typeof esi.Get !== "function")
        {
            throw new TypeError("Cosmetics requires an ESI client with Get()");
        }

        this.esi = esi;
    }

    /**
     * Reads one SKINR design.
     *
     * The response is the same for every caller — the token gates the route but
     * does not identify the reader — so a cached copy is safe to serve to
     * anyone. It is also effectively immutable: twelve months of client cache.
     *
     * @param {String} skinrId
     * @returns {Promise<Object>} the normalized design
     */
    async GetSkinr(skinrId)
    {
        return CjsToolSkinrDesigns.readSkinr(await this.FetchSkinrPayload(skinrId));
    }

    /**
     * The design exactly as ESI sent it.
     *
     * The payload is what the pattern generator consumes - it reads
     * `ship_type_id`, `layout.pattern_blend_mode` and each slot's
     * `configuration.nanocoating.id`, and the custom-mask reader wants
     * `projection.slot1` and `transform.position.x` - none of which survive
     * normalization, because normalizing is precisely the act of replacing them
     * with tagged unions and arrays.
     *
     * So the normalized form is a *reading*, and this is the evidence. Anything
     * that stores a design stores this, and normalizes on the way out.
     *
     * @param {String} skinrId
     * @returns {Promise<Object>} the raw ESI design
     */
    async FetchSkinrPayload(skinrId)
    {
        const id = String(skinrId ?? "").trim();

        if (!id) throw new TypeError("A skinr id is required");

        return this.esi.Get(`/cosmetics/skinr/${encodeURIComponent(id)}`);
    }

    /**
     * Reads one page of public Paragon Hub listings.
     *
     * `after` and `before` are mutually exclusive, and the cursor strings are
     * opaque — pass back exactly what was returned. `"0"` starts at an end.
     *
     * @param {Object} [options]
     * @param {String} [options.after]
     * @param {String} [options.before]
     * @param {Number} [options.limit] - 10..100, ESI defaults to 10
     * @returns {Promise<{ listings: Array<Object>, cursor: { after: ?String, before: ?String } }>}
     */
    async ListParagonHub({ after, before, limit } = {})
    {
        if (after !== undefined && before !== undefined)
        {
            throw new TypeError("Paragon Hub paging takes after or before, not both");
        }

        const query = new URLSearchParams();

        if (after !== undefined) query.set("after", String(after));
        if (before !== undefined) query.set("before", String(before));
        if (limit !== undefined) query.set("limit", String(CjsToolSkinrDesigns.normalizeLimit(limit)));

        const search = query.toString();

        return CjsToolSkinrDesigns.readListingPage(await this.esi.Get(`/paragon-hub/skinr${search ? `?${search}` : ""}`));
    }

    /**
     * Walks every public listing, newest first.
     *
     * **Paging forward uses `before`, not `after`.** Measured against the live
     * service on 2026-08-18: the hub is ordered newest first, so the returned
     * `after` cursor marks the newest edge of the page just read and asking for
     * anything after it returns an empty page — forever, on every page, which
     * reads exactly like reaching the end of a very short hub. `before` marks
     * the older edge and is the one that advances.
     *
     * `after` still has a use, and it is the incremental one: store the newest
     * page's `after` cursor and a later run asks only for listings that appeared
     * since. That is a different job from walking the whole hub.
     *
     * Yields pages rather than listings so a caller can persist a page and its
     * cursor together: resuming from the last stored cursor is the only way to
     * continue a harvest that stopped, and a flattened stream loses it.
     *
     * Stops when the service reports no further cursor, or when a page repeats
     * one already seen — a cursor that does not advance would otherwise loop
     * forever against a service that is misbehaving.
     *
     * @param {Object} [options]
     * @param {Number} [options.limit=100] - page size; the maximum by default
     * @param {String} [options.before] - resume point, from a stored page cursor
     * @param {Number} [options.maxPages=1000]
     * @returns {AsyncGenerator<{ listings: Array<Object>, cursor: Object }>}
     */
    async *WalkParagonHub({ limit = 100, before = null, maxPages = 1000 } = {})
    {
        const seen = new Set();
        let cursor = before;

        for (let page = 0; page < maxPages; page++)
        {
            if (cursor !== null && seen.has(cursor)) return;
            seen.add(cursor);

            const result = await this.ListParagonHub(
                cursor === null ? { limit } : { before: cursor, limit },
            );

            yield result;

            const next = result.cursor.before;

            // An absent cursor is the documented end of the set. An empty page
            // with a cursor is not an end, so it is not treated as one.
            if (next === null || next === undefined) return;

            cursor = next;
        }
    }

    /**
     * Collects the design ids advertised by a page of listings.
     *
     * Deduplicated, because one design is commonly listed by several sellers and
     * fetching it twice spends budget for nothing.
     *
     * @param {Array<Object>} listings
     * @param {Set<String>} [into]
     * @returns {Set<String>}
     */
    static collectSkinrIds(listings, into = new Set())
    {
        for (const listing of listings || [])
        {
            if (listing && listing.skinrId) into.add(listing.skinrId);
        }

        return into;
    }

    /**
     * Normalizes a SKINR design.
     *
     * Field names become camelCase, and both `oneOf` shapes become tagged
     * unions. Unknown blend modes and slot kinds are preserved rather than
     * rejected: ESI may add enum values inside an existing compatibility date,
     * and a reader that throws on an unseen value fails the whole harvest for
     * one unrecognized design.
     *
     * @param {Object} payload
     * @returns {Object}
     */
    static readSkinr(payload)
    {
        const source = payload || {};
        const layout = source.layout || {};

        return {
            id: source.id ?? null,
            name: source.name ?? null,
            line: source.line ?? null,
            creatorId: numberOrNull(source.creator_id),
            shipTypeId: numberOrNull(source.ship_type_id),
            tierLevel: numberOrNull(source.tier?.level),
            patternBlendMode: layout.pattern_blend_mode ?? null,
            slots: (layout.slots || []).map(slot => CjsToolSkinrDesigns.readSlot(slot)),
        };
    }

    /**
     * Normalizes one layout slot into a tagged union.
     * @param {Object} slot
     * @returns {Object}
     */
    static readSlot(slot)
    {
        const source = slot || {};
        const configuration = source.configuration || {};
        const base = { slotId: numberOrNull(source.id) };

        if (configuration.nanocoating)
        {
            return { ...base, kind: SKINR_SLOT_KINDS.NANOCOATING, componentId: numberOrNull(configuration.nanocoating.id) };
        }

        if (configuration.pattern)
        {
            const pattern = configuration.pattern;
            const settings = pattern.configuration || {};

            return {
                ...base,
                kind: SKINR_SLOT_KINDS.PATTERN,
                componentId: numberOrNull(pattern.id),
                mirrored: Boolean(settings.mirrored),
                // Four independent flags, one per cosmetic slot the pattern can
                // be projected onto. Kept as an array in slot order because
                // every consumer wants "which slots", not four named booleans.
                projection: [ 1, 2, 3, 4 ].map(index => Boolean(settings.projection?.[`slot${index}`])),
                transform: {
                    position: readVector(settings.transform?.position, [ "x", "y", "z" ]),
                    rotation: readVector(settings.transform?.rotation, [ "x", "y", "z", "w" ]),
                    scaling: readVector(settings.transform?.scaling, [ "x", "y", "z" ]),
                },
            };
        }

        // Neither arm matched. Reported rather than dropped: a slot that exists
        // and cannot be read is a fact worth surfacing, and silently returning
        // an empty slot list makes a design look plain instead of unread.
        return { ...base, kind: null, unread: configuration };
    }

    /**
     * Normalizes a page of listings and its cursor.
     * @param {Object} payload
     * @returns {{ listings: Array<Object>, cursor: { after: ?String, before: ?String } }}
     */
    static readListingPage(payload)
    {
        const source = payload || {};

        return {
            listings: (source.listings || []).map(listing => CjsToolSkinrDesigns.readListing(listing)),
            cursor: {
                after: source.cursor?.after ?? null,
                before: source.cursor?.before ?? null,
            },
        };
    }

    /**
     * Normalizes one listing.
     *
     * Timestamps stay as the strings ESI sent. Parsing them here would throw
     * away the exact value in favour of a Date whose serialization differs, and
     * a stored observation should be what was observed.
     *
     * @param {Object} listing
     * @returns {Object}
     */
    static readListing(listing)
    {
        const source = listing || {};

        return {
            id: source.id ?? null,
            skinrId: source.skinr_id ?? null,
            sellerId: numberOrNull(source.seller_id),
            quantity: numberOrNull(source.quantity),
            state: source.state ?? null,
            created: source.created ?? null,
            expires: source.expires ?? null,
            lastModified: source.last_modified ?? null,
            price: CjsToolSkinrDesigns.readPrice(source.price),
        };
    }

    /**
     * Normalizes a price into a tagged union.
     *
     * ISK arrives as a double and is kept verbatim. Anything doing arithmetic on
     * it for accounting wants a decimal representation, and that conversion
     * belongs at the point of use rather than here, where it would quietly
     * change what was observed.
     *
     * @param {Object} price
     * @returns {?Object}
     */
    static readPrice(price)
    {
        if (!price) return null;
        if (price.isk !== undefined) return { kind: SKINR_PRICE_KINDS.ISK, value: price.isk };
        if (price.plex !== undefined) return { kind: SKINR_PRICE_KINDS.PLEX, value: numberOrNull(price.plex) };

        return { kind: null, unread: price };
    }

    /**
     * Clamps a page size into the range the service accepts.
     * @param {Number} limit
     * @returns {Number}
     */
    static normalizeLimit(limit)
    {
        const value = Number(limit);

        if (!Number.isFinite(value)) return 10;

        return Math.min(100, Math.max(10, Math.trunc(value)));
    }

}


function numberOrNull(value)
{
    if (value === null || value === undefined) return null;

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

function readVector(source, keys)
{
    if (!source) return null;

    return keys.map(key => numberOrNull(source[key]));
}
