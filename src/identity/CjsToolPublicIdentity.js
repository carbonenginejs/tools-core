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

/**
 * The three things a public name can belong to.
 *
 * `bucket` is what `/universe/ids` calls them and `category` is what
 * `/universe/names` calls them, and they are NOT the same word - one is
 * plural and one is not. Getting that pair wrong resolves nothing and looks
 * exactly like a name that does not exist.
 */
const KINDS = Object.freeze({
    character: { bucket: "characters", category: "character", path: "characters" },
    corporation: { bucket: "corporations", category: "corporation", path: "corporations" },
    alliance: { bucket: "alliances", category: "alliance", path: "alliances" },
});

/**
 * The longest term worth asking about.
 *
 * A character name is at most 37 characters and a corporation's 50. This is
 * clear of both, and it is what stops a caller relaying an arbitrary body
 * through us to CCP.
 */
const MAX_TERM = 100;

export class CjsToolPublicIdentity
{

    #esi;

    #ttlMs;

    #now;

    #entries;

    #canPost;

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

        // Only `Resolve` needs it, and only for a name - looking somebody up by
        // id never posts. So a client with no `Post` is not refused here; it
        // simply cannot answer a name, and says so at the point of asking.
        this.#canPost = typeof esi.Post === "function";

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

    /**
     * Who something is, from a NAME or an id.
     *
     * The other half of this class. `Character` answers when you already have
     * an id; this answers when what you have is what somebody typed, which is
     * the question every "who am I flying for" field actually asks.
     *
     * @param {Object} options
     * @param {String|Number} options.term - a name, or an id
     * @param {String} options.kind - character, corporation or alliance
     * @returns {Promise<Object|null>} null when nothing of that kind matches
     */
    async Resolve({ term, kind } = {})
    {
        const wanted = KINDS[String(kind ?? "").toLowerCase()];

        if (!wanted) throw new TypeError(`Unknown identity kind: ${String(kind).slice(0, 32)}`);

        const text = String(term ?? "").trim();

        if (!text || text.length > MAX_TERM) return null;

        // Cached under what was ASKED, folded to lower case: two readers who
        // type the same name in different capitals are asking one question,
        // and the answer they get back carries the game's own spelling anyway.
        const key = `${wanted.category}:${text.toLowerCase()}`;
        const held = this.#entries.get(key);

        if (held && (held.pending || this.#now() - held.readAt < this.#ttlMs))
        {
            return held.pending ?? held.value;
        }

        const pending = this.#ResolveTerm(text, wanted);

        this.#entries.set(key, { pending, readAt: this.#now() });

        try
        {
            const value = await pending;

            this.#entries.set(key, { value, readAt: this.#now() });
            this.#Trim();

            return value;
        }
        catch (error)
        {
            this.#entries.delete(key);
            throw error;
        }
    }

    async #ResolveTerm(text, wanted)
    {
        const id = /^\d+$/u.test(text)
            ? await this.#IdentifyId(Number(text), wanted)
            : await this.#IdentifyName(text, wanted);

        if (!id) return null;

        // A character resolves through the existing path, so one name lookup
        // and one id lookup cannot disagree about who somebody flies for.
        if (wanted.category === "character")
        {
            const character = await this.Character(id);

            return character && { kind: "character", id, ...Without(character, "characterId") };
        }

        const record = await this.#Read(`/${wanted.path}/${id}`);

        if (!record?.name) return null;

        const allianceId = wanted.category === "corporation" ? Number(record.alliance_id) || null : null;
        const alliance = allianceId ? await this.#Read(`/alliances/${allianceId}`) : null;

        return Object.freeze({
            kind: wanted.category,
            id,
            name: record.name,
            ticker: record.ticker ?? null,
            // Absent rather than null-filled, as `Character` does it: a
            // consumer needs to tell "in no alliance" from "we could not read
            // it", and an alliance has no alliance of its own to be in.
            ...(allianceId
                ? { alliance: Object.freeze({ id: allianceId, name: alliance?.name ?? null, ticker: alliance?.ticker ?? null }) }
                : {}),
            observedAt: new Date(this.#now()).toISOString(),
        });
    }

    /** An id is just a number, so the CATEGORY is what checks it is the right one. */
    async #IdentifyId(id, wanted)
    {
        if (!Number.isSafeInteger(id) || id <= 0) return null;

        const found = await this.#PostNames([ id ]);
        const match = found.find(entry => Number(entry?.id) === id);

        return match?.category === wanted.category ? id : null;
    }

    /**
     * Several spellings of one name, in ONE request.
     *
     * `/universe/ids` matches case-sensitively - "vily" finds nothing where
     * "Vily" finds the pilot - and nobody types their own name in the
     * capitalisation the client stored it in. The route takes a LIST, so the
     * casings cost one round trip between them rather than one each, and the
     * answer is whichever spelling the game recognises.
     */
    async #IdentifyName(text, wanted)
    {
        const spellings = [ ...new Set([
            text,
            text.toLowerCase(),
            text.toUpperCase(),
            // Title case with hyphens and apostrophes included: "van der berg"
            // and "o'brien" are names, and their capitals are not only after
            // spaces.
            text.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (all, before, letter) => before + letter.toUpperCase()),
        ]) ];

        if (!this.#canPost)
        {
            throw new TypeError("Resolving a name needs an ESI client with Post()");
        }

        let body = null;

        try { body = await this.#esi.Post("/universe/ids", spellings); }
        catch { return null; }

        const found = (body?.[wanted.bucket] ?? [])[0];

        return Number(found?.id) || null;
    }

    async #PostNames(ids)
    {
        try
        {
            const body = await this.#esi.Post("/universe/names", ids);

            return Array.isArray(body) ? body : [];
        }
        catch
        {
            return [];
        }
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

/** One key dropped, without mutating a frozen answer. */
function Without(record, name)
{
    const { [name]: dropped, ...rest } = record;

    return rest;
}

export default CjsToolPublicIdentity;
