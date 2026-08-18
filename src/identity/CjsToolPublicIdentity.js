/**
 * Who a public character is: their name, and the corporation and alliance they
 * were in when we asked.
 *
 * Not SKINR-specific, which is why it is not in `src/skin`. A design's creator
 * is one caller; a listing's seller, a market order's issuer and a kill's victim
 * are the same question with a different id in front of it.
 *
 * Every route it reads is public and needs no scope — `/characters/{id}`,
 * `/corporations/{id}`, `/alliances/{id}` — so this can answer for a logged-out
 * visitor exactly as the harvested SKINR store does.
 *
 * ## Affiliation is an observation, not an attribute
 *
 * A name is effectively permanent; a corporation is not. Someone who left their
 * corp yesterday has a different answer today, and a cached one is a statement
 * about the past. So every answer carries `observedAt`, and the cache has a
 * lifetime rather than being kept forever: a stale corp shown as current is the
 * kind of wrong that looks right.
 *
 * The name and the affiliation come from one request, so they age together. That
 * is a small loss — the name would keep for months — and it buys one rule
 * instead of two lifetimes to reason about.
 */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;

export class CjsToolPublicIdentity
{

    #esi;

    #ttlMs;

    #now;

    #entries;

    /**
     * @param {Object} options
     * @param {Object} options.esi - anything with `Get(path)`
     * @param {Number} [options.ttlMs] - how long an affiliation stays fresh
     * @param {Function} [options.now] - clock, for tests
     */
    constructor({ esi, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {})
    {
        if (!esi || typeof esi.Get !== "function")
        {
            throw new TypeError("Public identity requires an ESI client with Get()");
        }

        this.#esi = esi;
        this.#ttlMs = Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS;
        this.#now = now;
        this.#entries = new Map();
    }

    /**
     * One character's public identity, or null when the id is not a character.
     *
     * Concurrent callers for the same id share one in-flight resolution: a grid
     * of twenty listings by one seller is one request, not twenty.
     *
     * @param {Number|String} characterId
     * @returns {Promise<Object|null>}
     */
    async Character(characterId)
    {
        const id = Number(characterId);

        if (!Number.isFinite(id) || id <= 0) throw new TypeError("A character id is required");

        const held = this.#entries.get(id);

        if (held && (held.pending || this.#now() - held.readAt < this.#ttlMs))
        {
            return held.pending ?? held.value;
        }

        const pending = this.#Resolve(id);

        this.#entries.set(id, { pending, readAt: this.#now() });

        try
        {
            const value = await pending;

            this.#entries.set(id, { value, readAt: this.#now() });
            this.#Trim();

            return value;
        }
        catch (error)
        {
            // A failed lookup is not cached. The next caller should get a real
            // attempt rather than inheriting somebody else's network problem for
            // the rest of the TTL.
            this.#entries.delete(id);
            throw error;
        }
    }

    async #Resolve(id)
    {
        const character = await this.#esi.Get(`/characters/${id}`);

        if (!character?.name) return null;

        // The corporation is read for its name, and its alliance is read from
        // the CORPORATION rather than the character: the character route carries
        // `alliance_id` too, but the corporation's is the one that cannot
        // disagree with the corporation named beside it.
        const corporationId = Number(character.corporation_id) || null;
        const corporation = corporationId ? await this.#Read(`/corporations/${corporationId}`) : null;
        const allianceId = Number(corporation?.alliance_id ?? character.alliance_id) || null;
        const alliance = allianceId ? await this.#Read(`/alliances/${allianceId}`) : null;

        return Object.freeze({
            characterId: id,
            name: character.name,
            corporation: corporationId
                ? Object.freeze({ id: corporationId, name: corporation?.name ?? null, ticker: corporation?.ticker ?? null })
                : null,
            // Absent, not null-filled: most characters are in no alliance, and a
            // consumer needs to tell "none" from "we could not read it".
            ...(allianceId
                ? { alliance: Object.freeze({ id: allianceId, name: alliance?.name ?? null, ticker: alliance?.ticker ?? null }) }
                : {}),
            observedAt: new Date(this.#now()).toISOString(),
        });
    }

    /** A supporting read whose failure must not lose the character's name. */
    async #Read(path)
    {
        try
        {
            return await this.#esi.Get(path);
        }
        catch
        {
            return null;
        }
    }

    /** Oldest out first. A bounded cache, because ids are unbounded. */
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

export default CjsToolPublicIdentity;
