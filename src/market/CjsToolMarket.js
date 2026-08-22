/**
 * The regional order book, and what a type has been trading at.
 *
 * A market question is a question about EVE, not about whichever site is
 * asking it. This lived in skindr because that is where somebody first needed
 * a price, and it stayed there long enough that the SKINR costing — which is
 * the same question with a shopping list in front of it — could not move here
 * without it (operator, 2026-08-22: tools-core should own a market endpoint).
 *
 * ## What this owns, and what it does not
 *
 * It owns the ESI-facing half: paging, the wire shape, resolving the ids in an
 * order to names, and honouring how long ESI says its own answer stays true.
 * It does not own presentation, sorting, chart geometry, or what a website
 * decides to do while it waits.
 *
 * ## Two things about the wire that are easy to get wrong
 *
 * **An order book is PAGED.** `/markets/{region}/orders` answers a thousand
 * rows at a time and puts the count in `x-pages`; reading page one and stopping
 * is a plausible-looking answer that silently omits the rest of the book. A
 * popular type in The Forge is several pages.
 *
 * **`issued` plus `duration` is when an order EXPIRES**, and duration is in
 * days. Neither number means anything alone, and the pair is what a reader
 * actually wants to see.
 *
 * ## Freshness is ESI's to decide
 *
 * Every market response carries `expires`. Re-asking sooner cannot produce a
 * newer answer — the same cached document comes back — so this holds each
 * answer until then and hands concurrent callers the one in flight. That is
 * also what makes it safe for a costing to price forty components: the parts
 * repeat across designs, and forty lookups become however many distinct types
 * there are.
 */

/** How long an answer with no `expires` header is held. ESI always sends one. */
const FALLBACK_TTL_MS = 5 * 60 * 1000;

/** Answers held at once, oldest evicted. A region times a type is unbounded. */
const MAX_ENTRIES = 256;

/** Rows per page, which is ESI's own limit rather than a choice. */
const PAGE_SIZE = 1000;

/** More pages than any real order book, so a broken `x-pages` cannot spin. */
const MAX_PAGES = 40;

export class CjsToolMarket
{

    #esi;

    #now;

    #entries;

    #names;

    /**
     * @param {Object} options
     * @param {Object} options.esi - anything with `Read(path)`; see CjsToolPublicEsi
     * @param {Function} [options.now] - clock, for tests
     */
    constructor({ esi, now = () => Date.now() } = {})
    {
        if (!esi || typeof esi.Read !== "function")
        {
            throw new TypeError("The market requires an ESI client with Read()");
        }

        this.#esi = esi;
        this.#now = now;
        this.#entries = new Map();
        this.#names = new Map();
    }

    /**
     * Every order for one type in one region, buy and sell.
     *
     * @param {Object} options
     * @param {Number} options.regionID
     * @param {Number} options.typeID
     * @returns {Promise<{regionID: Number, typeID: Number, orders: Array, observedAt: String, expiresAt: String}>}
     */
    async Orders({ regionID, typeID })
    {
        const region = Numeric(regionID, "region id");
        const type = Numeric(typeID, "type id");

        return this.#Held(`orders:${region}:${type}`, () => this.#ReadOrders(region, type));
    }

    /**
     * Daily history for one type in one region.
     *
     * A different question from the book: what it HAS traded at, rather than
     * what somebody is asking today. ESI recomputes it once a day, which is why
     * its `expires` is hours out rather than minutes.
     */
    async History({ regionID, typeID })
    {
        const region = Numeric(regionID, "region id");
        const type = Numeric(typeID, "type id");

        return this.#Held(`history:${region}:${type}`, () => this.#ReadHistory(region, type));
    }

    /** What is being held, for a service that wants to say. */
    Stats()
    {
        return { entries: this.#entries.size, names: this.#names.size };
    }

    async #ReadOrders(regionID, typeID)
    {
        const rows = [];
        let expiresAt = null;
        let pages = 1;

        for (let page = 1; page <= Math.min(pages, MAX_PAGES); page++)
        {
            const answer = await this.#esi.Read(
                `/markets/${regionID}/orders?order_type=all&type_id=${typeID}&page=${page}`
            );

            expiresAt ??= this.#Expiry(answer.headers);
            pages = Number(answer.headers?.get?.("x-pages")) || pages;
            rows.push(...(Array.isArray(answer.body) ? answer.body : []));

            // A short page is the last page whatever the header claimed. ESI
            // has been known to report a page count for the whole region rather
            // than for the filtered query.
            if (!Array.isArray(answer.body) || answer.body.length < PAGE_SIZE) break;
        }

        const names = await this.#Resolve(rows);

        return {
            regionID,
            typeID,
            orders: rows.map(row => this.#Order(row, names)),
            observedAt: new Date(this.#now()).toISOString(),
            expiresAt: new Date(expiresAt ?? this.#now() + FALLBACK_TTL_MS).toISOString(),
        };
    }

    async #ReadHistory(regionID, typeID)
    {
        const answer = await this.#esi.Read(`/markets/${regionID}/history?type_id=${typeID}`);
        const rows = Array.isArray(answer.body) ? answer.body : [];

        return {
            regionID,
            typeID,
            history: rows.map(row => ({
                date: row.date,
                average: row.average,
                high: row.highest,
                low: row.lowest,
                orderCount: row.order_count,
                volume: row.volume,
            })),
            observedAt: new Date(this.#now()).toISOString(),
            expiresAt: new Date(this.#Expiry(answer.headers) ?? this.#now() + FALLBACK_TTL_MS).toISOString(),
        };
    }

    /** One wire row as a record, with the pair of fields that mean an expiry. */
    #Order(row, names)
    {
        const issued = Date.parse(row.issued);

        return {
            orderID: row.order_id,
            typeID: row.type_id,
            // `side`, not `is_buy_order`. A boolean named for one of its two
            // answers reads as a flag, and a caller that forgets to negate it
            // counts every buy order as a sale.
            side: row.is_buy_order ? "buy" : "sell",
            price: row.price,
            volumeRemain: row.volume_remain,
            volumeTotal: row.volume_total,
            minVolume: row.min_volume,
            range: row.range,
            issued: row.issued,
            expiresAt: Number.isFinite(issued)
                ? new Date(issued + row.duration * 24 * 60 * 60 * 1000).toISOString()
                : null,
            locationID: row.location_id,
            locationName: names.get(row.location_id) ?? null,
            systemID: row.system_id,
            systemName: names.get(row.system_id) ?? null,
        };
    }

    /**
     * Names for the stations and systems in a book.
     *
     * Kept for the life of the process rather than with the orders: a station's
     * name is effectively permanent, and the same handful of hubs appear in
     * every book anybody asks for.
     *
     * Structures — player-owned, id above a trillion — are not public and are
     * left unnamed rather than failing the whole read for them.
     */
    async #Resolve(rows)
    {
        const wanted = new Set();

        for (const row of rows)
        {
            for (const id of [ row.location_id, row.system_id ])
            {
                if (Number.isFinite(id) && id < 1e12 && !this.#names.has(id)) wanted.add(id);
            }
        }

        if (wanted.size && typeof this.#esi.Post === "function")
        {
            try
            {
                const named = await this.#esi.Post("/universe/names", [ ...wanted ]);

                for (const entry of Array.isArray(named) ? named : [])
                {
                    this.#names.set(entry.id, entry.name);
                }
            }
            catch
            {
                // A name is a nicety; the price is the answer. One unknown
                // station must not lose a whole order book.
            }
        }

        return this.#names;
    }

    /** ESI's own `expires`, as a timestamp, or null. */
    #Expiry(headers)
    {
        const header = headers?.get?.("expires");
        const at = header ? Date.parse(header) : Number.NaN;

        // A past expiry is a clock disagreement, not an instruction to re-ask
        // on every request.
        return Number.isFinite(at) && at > this.#now() ? at : null;
    }

    /** Held until ESI says it has expired, with concurrent callers sharing one read. */
    async #Held(key, read)
    {
        const held = this.#entries.get(key);

        if (held?.pending) return held.pending;
        if (held && Date.parse(held.value.expiresAt) > this.#now()) return held.value;

        const pending = read();

        this.#entries.set(key, { pending });

        try
        {
            const value = await pending;

            this.#entries.set(key, { value });
            this.#Trim();

            return value;
        }
        catch (error)
        {
            // Not cached: the next caller should get a real attempt rather than
            // inheriting somebody else's network problem until it expires.
            this.#entries.delete(key);
            throw error;
        }
    }

    #Trim()
    {
        while (this.#entries.size > MAX_ENTRIES)
        {
            const oldest = this.#entries.keys().next();

            if (oldest.done) return;

            this.#entries.delete(oldest.value);
        }
    }

}

function Numeric(value, what)
{
    const number = Number(value);

    if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`A ${what} is required`);

    return number;
}

export default CjsToolMarket;
