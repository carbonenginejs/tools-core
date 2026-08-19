/**
 * The PLEX reference price, for putting an ISK figure beside a PLEX one.
 *
 * ## PLEX trades globally, not regionally
 *
 * `/markets/10000002/orders?type_id=44992` answers with **zero orders** — The
 * Forge, Domain, Sinq Laison, Heimatar, every hub — while the same request for
 * Tritanium in The Forge returns dozens. That is true, repeatedly measured, and
 * it is not the whole story: an earlier reading of this file concluded from it
 * that ESI has no PLEX order book at all, and that was wrong.
 *
 * PLEX moved to a GLOBAL market with its own region, **19000001**, where the
 * book is deep and current — 847 buy orders on 2026-08-19. The third-party
 * browsers show it under "region 0", meaning every region at once, which is why
 * they have a price when a regional query insists there is none.
 *
 * The lesson is worth keeping with the code: a negative control proved the
 * REQUEST was well-formed, and was then taken as proof the ANSWER was complete.
 * It only ever showed we were asking the wrong region.
 *
 * ## What it reads, and what that means
 *
 * The highest BUY order on the global market: what somebody holding a PLEX can
 * actually get for it, which is the honest conversion for a listing priced in
 * PLEX. It is a real posted order, so it is NOT reported as an estimate.
 *
 * `/markets/prices#average_price` remains as a fallback for when the book
 * cannot be read, and is labelled `estimate: true` because it is the API's own
 * figure on its own schedule rather than a price anybody is offering. Either
 * way the answer carries `source` and `observedAt`, so a consumer can say which
 * it is showing and how old it is.
 *
 * ## Hourly, and never blocking
 *
 * One read per hour. A refresh that fails keeps the last good value and lets it
 * age rather than answering with nothing: a price from fifty minutes ago is
 * useful and an absent price is not, and `observedAt` is what makes that
 * visible.
 */
const PLEX_TYPE_ID = 44992;

/**
 * The global PLEX market.
 *
 * PLEX is not traded regionally any more, which is why every hub returns zero
 * orders for it while returning hundreds for ordinary types. This is the region
 * the global book lives in, and is what the third-party browsers are showing
 * when they display "region 0" - all regions at once.
 */
const PLEX_REGION_ID = 19000001;
const DEFAULT_TTL_MS = 60 * 60 * 1000;

export class CjsToolPlexRate
{

    #esi;

    #ttlMs;

    #now;

    #rate;

    #refreshing;

    /**
     * @param {Object} options
     * @param {Object} options.esi - anything with `Get(path)`
     * @param {Number} [options.ttlMs] - how long a reading stays fresh
     * @param {Function} [options.now] - clock, for tests
     */
    constructor({ esi, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {})
    {
        if (!esi || typeof esi.Get !== "function")
        {
            throw new TypeError("The PLEX rate requires an ESI client with Get()");
        }

        this.#esi = esi;
        this.#ttlMs = Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS;
        this.#now = now;
        this.#rate = null;
        this.#refreshing = null;
    }

    /**
     * The current reading, refreshing it when stale.
     *
     * Concurrent callers share one in-flight refresh. Two pages opening at once
     * is the ordinary case and it should cost one request, not two.
     *
     * @returns {Promise<Object|null>} the rate, or null when never read
     */
    async Read()
    {
        if (this.#rate && this.#now() - this.#rate.readAt < this.#ttlMs) return this.#rate.value;

        this.#refreshing ??= this.#Refresh().finally(() => { this.#refreshing = null; });

        return this.#refreshing;
    }

    /** The last reading without refreshing, however old. Null when never read. */
    Peek()
    {
        return this.#rate?.value ?? null;
    }

    async #Refresh()
    {
        // The real order book first, the published average only as a fallback.
        const reading = await this.#HighestBuy() ?? await this.#AveragePrice();

        if (!reading) return this.Peek();

        const value = Object.freeze({
            typeId: PLEX_TYPE_ID,
            ...reading,
            observedAt: new Date(this.#now()).toISOString(),
            ttlSeconds: Math.round(this.#ttlMs / 1000),
        });

        this.#rate = { value, readAt: this.#now() };

        return value;
    }

    /**
     * The best price a PLEX would actually sell for, from the global market.
     *
     * PLEX is not traded regionally — asking The Forge for it returns zero
     * orders, on both the current type and the old one, while the same request
     * for Tritanium in the same region answers with dozens. That is what a
     * previous reading of this concluded from, and it concluded the wrong
     * thing: PLEX moved to a GLOBAL market with its own region, 19000001, where
     * the book is deep and current. Region 0 is what the third-party browsers
     * show, which is every region at once, and it is why they have a price when
     * a regional query says there is none.
     *
     * Highest BUY, not lowest sell: it is what somebody holding PLEX can get for
     * it now, which is the honest conversion for a listing priced in PLEX.
     * Measured 2026-08-19: 847 buy orders, best 4,608,000 — against 166 sell
     * orders at 4,838,000 and a published average of 4,508,205, so the choice
     * moves the figure by about 2%.
     *
     * @returns {Promise<Object|null>}
     */
    async #HighestBuy()
    {
        try
        {
            const orders = await this.#esi.Get(`/markets/${PLEX_REGION_ID}/orders?type_id=${PLEX_TYPE_ID}&order_type=buy`);
            const prices = (Array.isArray(orders) ? orders : [])
                .map(order => Number(order?.price))
                .filter(price => Number.isFinite(price) && price > 0);

            if (!prices.length) return null;

            return {
                isk: Math.max(...prices),
                // Not an estimate: this is an order somebody has posted, at a
                // price they will pay.
                estimate: false,
                orders: prices.length,
                source: `esi:/markets/${PLEX_REGION_ID}/orders#highest-buy`,
            };
        }
        catch
        {
            return null;
        }
    }

    /**
     * The published average, kept as a fallback rather than the answer.
     *
     * An estimate, and labelled one: it is the API's own figure on its own
     * schedule, not a price anybody is offering. Used only when the order book
     * cannot be read, so a rate exists at all rather than the hub losing both
     * its ISK and PLEX figures.
     *
     * @returns {Promise<Object|null>}
     */
    async #AveragePrice()
    {
        try
        {
            const prices = await this.#esi.Get("/markets/prices");
            const row = (Array.isArray(prices) ? prices : []).find(entry => Number(entry?.type_id) === PLEX_TYPE_ID);
            const isk = Number(row?.average_price);

            if (!Number.isFinite(isk) || isk <= 0) return null;

            return { isk, estimate: true, source: "esi:/markets/prices#average_price" };
        }
        catch
        {
            return null;
        }
    }

}

export default CjsToolPlexRate;
