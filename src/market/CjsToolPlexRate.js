/**
 * The PLEX reference price, for putting an ISK figure beside a PLEX one.
 *
 * ## There is no Jita buy order for PLEX in ESI
 *
 * Measured 2026-08-18 against the live service: `/markets/{region}/orders?
 * type_id=44992` answers with **zero orders** in The Forge, Domain, Sinq Laison
 * and Heimatar — every major hub — while the same route returns 164 orders for
 * Tritanium in The Forge, so the route and the filter both work. And
 * `/markets/10000002/history?type_id=44992` holds seven rows ending
 * **2025-07-07**, over a year stale.
 *
 * PLEX is not traded on the regional market ESI publishes. So "highest Jita buy"
 * cannot be computed from ESI, no matter how the request is shaped, and any code
 * claiming to do it is reading something else and calling it that.
 *
 * ## What is available, and what it is
 *
 * `/markets/prices` publishes an `average_price` for type 44992 — the API's
 * own figure, updated on its own schedule, with `adjusted_price` at zero. That is the
 * only ESI source, so it is the one used, and it is reported as an **estimate**
 * with its source and the moment it was read. A consumer showing a converted
 * price is showing an estimate and should say so; that is why `source` and
 * `observedAt` are part of the answer rather than an implementation detail.
 *
 * A true order-book price needs a third-party aggregator, which is a dependency
 * decision rather than a coding one and is deliberately not made here.
 *
 * ## Hourly, and never blocking
 *
 * One `/markets/prices` read covers every type, so refreshing it hourly costs a
 * single request. A refresh that fails keeps the last good value and lets it age
 * rather than answering with nothing: a price from fifty minutes ago is useful
 * and an absent price is not, and `observedAt` is what makes that visible.
 */
const PLEX_TYPE_ID = 44992;
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
        try
        {
            const prices = await this.#esi.Get("/markets/prices");
            const row = (Array.isArray(prices) ? prices : []).find(entry => Number(entry?.type_id) === PLEX_TYPE_ID);
            const isk = Number(row?.average_price);

            if (!Number.isFinite(isk) || isk <= 0)
            {
                // The type is missing from the answer, or its price is zero. Not
                // an outage - a reading that says nothing - so the previous one
                // stands and ages rather than being replaced by a wrong number.
                return this.Peek();
            }

            const value = Object.freeze({
                typeId: PLEX_TYPE_ID,
                isk,
                // Named for what it is. `jitaBuy` would be a lie: there is no
                // public order book for PLEX to take a buy price from.
                estimate: true,
                source: "esi:/markets/prices#average_price",
                observedAt: new Date(this.#now()).toISOString(),
                ttlSeconds: Math.round(this.#ttlMs / 1000),
            });

            this.#rate = { value, readAt: this.#now() };

            return value;
        }
        catch
        {
            // A failed refresh keeps the last good reading. Fifty minutes old and
            // labelled is worth more than absent, and `observedAt` says which.
            return this.Peek();
        }
    }

}

export default CjsToolPlexRate;
