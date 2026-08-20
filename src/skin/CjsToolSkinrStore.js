/**
 * Where harvested SKINR designs and the listings that advertised them are kept.
 *
 * ## Its own database, beside the SDE rather than inside it
 *
 * An acquired SDE stays byte-identical to what was published, so a reading of
 * ours never lands in it - the same rule the type-extras sidecar follows. This
 * is a reading of a live API, and a table inside the SDE would be
 * indistinguishable from something the source shipped, in the place a consumer
 * is least likely to look.
 *
 * ## Durable data, not cache
 *
 * Designs alone would be cache-shaped: immutable, and re-fetchable at any time,
 * so losing them costs a download. **Listings are not.** A listing is an
 * observation of a moment - it expires, sells out, or is removed - and one seen
 * today may be unfetchable tomorrow. Deleting them loses history that cannot be
 * re-acquired, which is exactly the distinction the data root exists for, and
 * they share a file with the designs.
 *
 * So listings are stored as **a log of what was seen**, keyed by listing and
 * observation time, and the current state of the hub is a projection of that log
 * rather than a table this overwrites. Modelling them as current state would
 * make every harvest destroy the previous one.
 *
 * ## Eve only
 *
 * SKINR is not accessible on serenity or infinity, so there is nothing to
 * harvest there and no fallback to invent. A consumer asking about one of
 * those targets must be told the data does not exist *for that world* rather
 * than handed an empty list, which states something false: that the world has no
 * SKINR designs. Absent and empty are different answers here exactly as they are
 * for type extras.
 *
 * ## Not build-scoped
 *
 * A design is not a client-build artifact. It exists independently of whichever
 * build is current, so the per-build cache layout would be wrong for it: the
 * same design would be stored again under every build, and pruning a build would
 * take observations with it.
 */
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { resolveDataRoot } from "../cache/resolveDataRoot.js";
import { CjsToolSkinrDesigns } from "./CjsToolSkinrDesigns.js";

const DATABASE_SCHEMA = "carbon.skinr.sqlite";
const DATABASE_VERSION = 1;

/** The only target with a SKINR surface. See the header. */
export const SKINR_TARGET = "eve";


export class CjsToolSkinrStore
{

    #database;

    constructor(database, filePath)
    {
        this.#database = database;
        this.filePath = path.resolve(filePath);

        // A random order has to be STABLE for the duration of one reading, and
        // SQLite's own random() is not: a consumer reads the hub in pages, and
        // an order that re-rolls per statement shows some listings twice and
        // hides others entirely. Seeding it makes "random" mean *a* shuffle,
        // named by the caller, that can be asked for again page after page.
        //
        // Registered here rather than expressed in SQL because listing ids are
        // text, so there is no arithmetic to hash them with. Deterministic in
        // the SQL sense - same arguments, same answer - which is what lets
        // SQLite use it in an ORDER BY at all.
        database.function("cjs_skinr_shuffle", { deterministic: true }, (listingId, seed) =>
            ShuffleKey(listingId, seed));
    }

    /**
     * The store's path for a data root, created or not.
     *
     * Named rather than derived per caller: a store that two components address
     * differently is two stores, and the second one is always the empty one.
     */
    static file(dataRoot)
    {
        return path.join(resolveDataRoot(dataRoot), "skinr", SKINR_TARGET, `skinr_v${DATABASE_VERSION}.sqlite`);
    }

    /**
     * Opens the store, creating it when absent.
     *
     * Absent is the ordinary first state and not an error: nothing has been
     * harvested yet.
     *
     * @param {Object} [options]
     * @param {String} [options.dataRoot] - durable root, for tests and operators
     * @param {String} [options.file] - an exact path, which wins
     * @param {String} [options.target] - refused unless it is eve
     */
    static open(options = {})
    {
        const target = String(options.target ?? SKINR_TARGET).toLowerCase();

        if (target !== SKINR_TARGET)
        {
            // Not an empty store. A caller on another target asking for SKINR
            // is asking for something that does not exist in its world, and
            // answering with an empty store would say the world simply has none.
            throw new TypeError(`SKINR data does not exist for target ${target}`);
        }

        const file = options.file ?? this.file(options.dataRoot);

        fs.mkdirSync(path.dirname(file), { recursive: true });

        const database = new Database(file);

        database.pragma("journal_mode = WAL");
        database.pragma("foreign_keys = ON");

        const store = new this(database, file);

        try
        {
            store.#Migrate();
        }
        catch (error)
        {
            // Refusing the file must not also hold it open. A rejected store
            // that keeps its handle locks the database against the operator who
            // is about to go and look at what it actually is.
            store.Close();
            throw error;
        }

        return store;
    }

    /**
     * Records one design, keeping when it was first and last seen.
     *
     * **The stored payload is the raw ESI design, not the normalized reading.**
     * Every consumer that does something with a design wants the raw shape:
     * `CjsToolSkinrPattern.generate` reads `ship_type_id`,
     * `layout.pattern_blend_mode` and each slot's `configuration.nanocoating.id`,
     * and ccpwgl's custom-mask reader wants `projection.slot1` and
     * `transform.position.x`. Normalizing is exactly the act of replacing those
     * with tagged unions and arrays, so a store that kept only the normalized
     * form would have to un-normalize to feed the tool we already have - and the
     * columns below are the reading, derived on write for querying.
     *
     * Definitions are immutable upstream, so a second write is not an update in
     * any meaningful sense - but the payload is replaced rather than ignored,
     * because "immutable" is a promise about the service and not a guarantee
     * about our copy, and the newer read is the better evidence. `first_seen`
     * survives, because that one is ours to remember.
     *
     * @param {Object} payload - the design exactly as ESI sent it
     * @param {String} observedAt - ISO 8601, from the caller's clock
     */
    PutDesign(payload, observedAt)
    {
        const design = CjsToolSkinrDesigns.readSkinr(payload);
        const id = RequireId(design?.id, "design id");
        const seen = RequireTimestamp(observedAt);

        this.#database.prepare(
            "INSERT INTO skinr_designs "
            + "(skinr_id, ship_type_id, tier_level, name, line, creator_id, payload, first_seen, last_seen) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            + "ON CONFLICT (skinr_id) DO UPDATE SET "
            + "ship_type_id = excluded.ship_type_id, tier_level = excluded.tier_level, "
            + "name = excluded.name, line = excluded.line, creator_id = excluded.creator_id, "
            + "payload = excluded.payload, last_seen = excluded.last_seen"
        ).run(
            id,
            NumberOrNull(design.shipTypeId),
            NumberOrNull(design.tierLevel),
            design.name ?? null,
            design.line ?? null,
            NumberOrNull(design.creatorId),
            JSON.stringify(payload),
            seen,
            seen,
        );
    }

    /** One stored design, normalized, or null when it has never been harvested. */
    GetDesign(skinrId)
    {
        const row = this.#Design(skinrId);

        return row
            ? {
                ...CjsToolSkinrDesigns.readSkinr(JSON.parse(row.payload)),
                firstSeen: row.first_seen,
                lastSeen: row.last_seen,
            }
            : null;
    }

    /**
     * One stored design as ESI sent it, or null.
     *
     * This is what the pattern generator and the custom-mask reader take. A
     * caller rendering a design wants this one, not `GetDesign`.
     */
    GetDesignPayload(skinrId)
    {
        const row = this.#Design(skinrId);

        return row ? JSON.parse(row.payload) : null;
    }

    /** Every design harvested for one hull, newest observation first. */
    ListDesignsForShip(shipTypeId)
    {
        return this.#database
            .prepare("SELECT payload FROM skinr_designs WHERE ship_type_id = ? ORDER BY last_seen DESC, skinr_id")
            .all(NumberOrNull(shipTypeId))
            .map(row => CjsToolSkinrDesigns.readSkinr(JSON.parse(row.payload)));
    }

    #Design(skinrId)
    {
        return this.#database
            .prepare("SELECT payload, first_seen, last_seen FROM skinr_designs WHERE skinr_id = ?")
            .get(RequireId(skinrId, "design id"));
    }

    /**
     * Appends one page of listing observations.
     *
     * Nothing is deleted and nothing is overwritten: a listing observed twice
     * is two rows, and that is the point - the pair of rows is how a price
     * change or a sell-out is visible at all. Re-recording the same listing at
     * the same instant is idempotent, so a retried page does not double-count.
     *
     * @param {Array<Object>} listings - normalized listings
     * @param {String} observedAt - ISO 8601, one value for the whole page
     * @returns {Number} rows appended
     */
    AppendListings(listings, observedAt)
    {
        const seen = RequireTimestamp(observedAt);
        const statement = this.#database.prepare(
            "INSERT OR IGNORE INTO skinr_listing_observations "
            + "(listing_id, observed_at, skinr_id, seller_id, quantity, state, "
            + "price_kind, price_value, created, payload) "
            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        const append = this.#database.transaction(records =>
        {
            let written = 0;

            for (const listing of records)
            {
                const id = String(listing?.id ?? "").trim();

                if (!id) continue;

                written += statement.run(
                    id,
                    seen,
                    listing.skinrId ? String(listing.skinrId) : null,
                    NumberOrNull(listing.sellerId),
                    NumberOrNull(listing.quantity),
                    listing.state ?? null,
                    listing.price?.kind ?? null,
                    // Text, not a float: ISK is a decimal quantity and binary
                    // floating point is the wrong shape for money. Whatever
                    // reads it back decides how to parse it.
                    listing.price?.value === undefined || listing.price?.value === null
                        ? null
                        : String(listing.price.value),
                    listing.created ?? null,
                    JSON.stringify(listing)
                ).changes;
            }

            return written;
        });

        return append(Array.isArray(listings) ? listings : []);
    }

    /**
     * The hub as last observed: one row per listing, its newest observation.
     *
     * A projection, computed on read. The alternative - a table this keeps
     * up to date - would need the harvest to know which listings *stopped*
     * appearing, and a page that was never fetched is indistinguishable from a
     * listing that was removed.
     */
    ListLatestListings({ skinrId = null, limit = 100 } = {})
    {
        const rows = this.#database.prepare(
            "SELECT payload, observed_at FROM skinr_listing_observations AS outer "
            + "WHERE observed_at = ("
            + "  SELECT MAX(observed_at) FROM skinr_listing_observations AS inner "
            + "  WHERE inner.listing_id = outer.listing_id"
            + ") "
            + "AND (? IS NULL OR skinr_id = ?) "
            + "ORDER BY observed_at DESC, listing_id LIMIT ?"
        ).all(skinrId, skinrId, NormalizeLimit(limit));

        return rows.map(row => ({ ...JSON.parse(row.payload), observedAt: row.observed_at }));
    }

    /**
     * The hub as a browsable list: each listing joined to what it advertises.
     *
     * One query rather than a listing list plus a design lookup per row, because
     * the two are read together every time — a card shows a price *and* what the
     * price is for. The design half may be missing: a listing can name a design
     * this store has not fetched yet, and that is reported as absent fields
     * rather than dropping the listing, which would make the hub look smaller
     * than it is.
     *
     * Sorting by price is **within a currency only**. ISK and PLEX are not
     * comparable without a conversion rate, and inventing one here would bury
     * an exchange rate inside a sort order. A caller wanting one list sorted by
     * value asks for a currency, or converts.
     *
     * @param {Object} [options]
     * @param {Number} [options.limit=60]
     * @param {Number} [options.offset=0]
     * @param {Number} [options.shipTypeId] - one hull
     * @param {Number} [options.tier] - exact tier level
     * @param {String} [options.currency] - "isk" or "plex"
     * @param {String} [options.state] - listing state, e.g. "listed"
     * @param {Number} [options.creatorId]
     * @param {String} [options.search] - matches design name or line
     * @param {String} [options.sort] - recent | price | tier | name
     * @returns {{ total: Number, cards: Array<Object> }}
     */
    ListCards(options = {})
    {
        const where = [ "o.observed_at = (SELECT MAX(observed_at) FROM skinr_listing_observations i WHERE i.listing_id = o.listing_id)" ];
        const parameters = {};

        if (NumberOrNull(options.shipTypeId) !== null)
        {
            where.push("d.ship_type_id = :shipTypeId");
            parameters.shipTypeId = NumberOrNull(options.shipTypeId);
        }

        if (NumberOrNull(options.tier) !== null)
        {
            where.push("d.tier_level = :tier");
            parameters.tier = NumberOrNull(options.tier);
        }

        if (options.currency)
        {
            where.push("o.price_kind = :currency");
            parameters.currency = String(options.currency).toLowerCase();
        }

        if (options.state)
        {
            where.push("o.state = :state");
            parameters.state = String(options.state);
        }

        if (NumberOrNull(options.creatorId) !== null)
        {
            where.push("d.creator_id = :creatorId");
            parameters.creatorId = NumberOrNull(options.creatorId);
        }

        if (options.search && String(options.search).trim())
        {
            // Name, line, or the people. A reader typing "police" means the
            // design and cannot know which field carries the word they
            // remember; a reader typing a capsuleer's name means the person, and
            // wants everything they made or are selling. One box for both,
            // because the reader does not know which kind of thing they have
            // typed until they see what comes back.
            //
            // Both sides of a listing: `creator` is who made it and `seller` is
            // who is offering it, and they differ on about one listing in seven.
            where.push(
                "(d.name LIKE :search OR d.line LIKE :search"
                + " OR EXISTS (SELECT 1 FROM skinr_characters c"
                + "   WHERE c.character_id IN (d.creator_id, o.seller_id)"
                + "     AND c.name LIKE :search))"
            );
            parameters.search = `%${String(options.search).trim()}%`;
        }

        const clause = where.join(" AND ");
        const order = SortOrder(options.sort, options.direction);
        const total = this.#database.prepare(
            "SELECT COUNT(*) AS n FROM skinr_listing_observations o "
            + "LEFT JOIN skinr_designs d ON d.skinr_id = o.skinr_id "
            + `WHERE ${clause}`
        ).get(parameters).n;

        const cards = this.#database.prepare(
            "SELECT o.listing_id, o.skinr_id, o.seller_id, o.quantity, o.state, "
            + "o.price_kind, o.price_value, o.created, o.observed_at, o.payload AS listing, "
            + "d.name, d.line, d.ship_type_id, d.tier_level, d.creator_id, "
            // The people, named. A consumer grouping by capsuleer had only ids
            // and resolved them one at a time by selecting a row, so a group
            // heading read FINDING CAPSULEER until somebody happened to click
            // that seller — and every row nobody clicked stayed that way.
            + "cc.name AS creator_name, cs.name AS seller_name "
            + "FROM skinr_listing_observations o "
            + "LEFT JOIN skinr_designs d ON d.skinr_id = o.skinr_id "
            + "LEFT JOIN skinr_characters cc ON cc.character_id = d.creator_id "
            + "LEFT JOIN skinr_characters cs ON cs.character_id = o.seller_id "
            + `WHERE ${clause} ORDER BY ${order} LIMIT :limit OFFSET :offset`
        ).all({
            ...parameters,
            // Only when the order asks for it: better-sqlite3 refuses a named
            // value the statement does not mention, and the count above shares
            // this parameter set.
            ...(order.includes(":seed") ? { seed: NormalizeSeed(options.seed) } : {}),
            limit: NormalizeLimit(options.limit ?? 60),
            offset: Math.max(0, Math.trunc(Number(options.offset)) || 0)
        });

        return {
            total,
            cards: cards.map(row => ({
                listingId: row.listing_id,
                skinrId: row.skinr_id,
                sellerId: row.seller_id,
                quantity: row.quantity,
                state: row.state,
                // The pair, as stored: a bare number with the currency dropped is
                // how a 420 PLEX design ends up looking like a bargain in ISK.
                price: row.price_kind ? { kind: row.price_kind, value: row.price_value } : null,
                created: row.created,
                expires: JSON.parse(row.listing)?.expires ?? null,
                observedAt: row.observed_at,
                // Named where the backfill has reached them. Absent rather than
                // null so a consumer can tell "not resolved yet" from "has no
                // name", and so a row keeps whatever it can show meanwhile.
                ...(row.seller_name ? { sellerName: row.seller_name } : {}),
                // Absent, not null-filled: this listing names a design we have
                // not fetched, which is different from a design without a name.
                ...(row.name === null && row.ship_type_id === null ? {} : {
                    name: row.name,
                    line: row.line,
                    shipTypeId: row.ship_type_id,
                    tierLevel: row.tier_level,
                    creatorId: row.creator_id,
                    ...(row.creator_name ? { creatorName: row.creator_name } : {}),
                }),
            })),
        };
    }

    /** The values a filter panel can offer, measured rather than assumed. */
    Facets()
    {
        return {
            tiers: this.#database.prepare(
                "SELECT tier_level AS tier, COUNT(*) AS n FROM skinr_designs "
                + "WHERE tier_level IS NOT NULL GROUP BY tier_level ORDER BY tier_level"
            ).all(),
            hulls: this.#database.prepare(
                "SELECT ship_type_id AS shipTypeId, COUNT(*) AS n FROM skinr_designs "
                + "WHERE ship_type_id IS NOT NULL GROUP BY ship_type_id ORDER BY n DESC"
            ).all(),
            currencies: this.#database.prepare(
                "SELECT price_kind AS currency, COUNT(*) AS n FROM skinr_listing_observations "
                + "WHERE price_kind IS NOT NULL GROUP BY price_kind ORDER BY n DESC"
            ).all(),
            states: this.#database.prepare(
                "SELECT state, COUNT(*) AS n FROM skinr_listing_observations "
                + "WHERE state IS NOT NULL GROUP BY state ORDER BY n DESC"
            ).all(),
        };
    }

    /** Every observation of one listing, oldest first: its history. */
    ListingHistory(listingId)
    {
        return this.#database.prepare(
            "SELECT payload, observed_at FROM skinr_listing_observations "
            + "WHERE listing_id = ? ORDER BY observed_at"
        ).all(RequireId(listingId, "listing id"))
            .map(row => ({ ...JSON.parse(row.payload), observedAt: row.observed_at }));
    }

    /**
     * Every character id the store mentions, on either side of a listing.
     *
     * Both sides, because they are different people about one listing in seven:
     * a design's creator made it, a listing's seller is offering it.
     *
     * @param {Object} [options]
     * @param {Boolean} [options.missingOnly] - only ids with no name yet
     * @returns {Array<Number>}
     */
    CharacterIds({ missingOnly = false } = {})
    {
        const known = missingOnly
            ? " AND id NOT IN (SELECT character_id FROM skinr_characters WHERE name IS NOT NULL)"
            : "";

        return this.#database.prepare(
            "SELECT DISTINCT id FROM ("
            + "  SELECT creator_id AS id FROM skinr_designs"
            + "  UNION SELECT seller_id AS id FROM skinr_listing_observations"
            + `) WHERE id IS NOT NULL AND id > 0${known} ORDER BY id`
        ).all().map(row => row.id);
    }

    /**
     * Records who an id belongs to.
     *
     * `observed_at` is not decoration: a name is effectively permanent but a
     * corporation is a statement about a moment, and someone who left theirs
     * yesterday has a different answer today. Storing when it was true is what
     * lets a later reader tell a fresh answer from a stale one.
     *
     * @param {Object} identity - as `CjsToolPublicIdentity` returns
     */
    PutCharacter(identity)
    {
        const id = NumberOrNull(identity?.characterId);

        if (id === null || !identity?.name) return false;

        this.#database.prepare(
            "INSERT INTO skinr_characters (character_id, name, corporation, alliance, observed_at) "
            + "VALUES (:id, :name, :corporation, :alliance, :observedAt) "
            + "ON CONFLICT(character_id) DO UPDATE SET "
            + "  name = excluded.name, corporation = excluded.corporation, "
            + "  alliance = excluded.alliance, observed_at = excluded.observed_at"
        ).run({
            id,
            name: String(identity.name),
            corporation: identity.corporation?.name ?? null,
            alliance: identity.alliance?.name ?? null,
            observedAt: identity.observedAt ?? new Date().toISOString(),
        });

        return true;
    }

    /**
     * The names for a set of ids, for a caller drawing rows.
     *
     * @param {Array<Number>} ids
     * @returns {Map<Number, Object>}
     */
    Characters(ids = [])
    {
        const wanted = ids.map(NumberOrNull).filter(id => id !== null);

        if (!wanted.length) return new Map();

        const rows = this.#database.prepare(
            `SELECT character_id, name, corporation, alliance, observed_at FROM skinr_characters `
            + `WHERE character_id IN (${wanted.map(() => "?").join(",")})`
        ).all(...wanted);

        return new Map(rows.map(row => [ row.character_id, {
            characterId: row.character_id,
            name: row.name,
            corporation: row.corporation,
            alliance: row.alliance,
            observedAt: row.observed_at,
        } ]));
    }

    /** What is in the store, for a caller reporting harvest progress. */
    Describe()
    {
        const counts = this.#database.prepare(
            "SELECT (SELECT COUNT(*) FROM skinr_designs) AS designs, "
            + "(SELECT COUNT(*) FROM skinr_listing_observations) AS observations, "
            + "(SELECT COUNT(DISTINCT listing_id) FROM skinr_listing_observations) AS listings, "
            + "(SELECT MAX(observed_at) FROM skinr_listing_observations) AS lastObservedAt"
        ).get();

        return {
            schema: DATABASE_SCHEMA,
            version: DATABASE_VERSION,
            target: SKINR_TARGET,
            file: this.filePath,
            ...counts,
        };
    }

    Close()
    {
        this.#database.close();
    }

    #Migrate()
    {
        this.#database.exec(
            "CREATE TABLE IF NOT EXISTS skinr_meta ("
            + "  key TEXT PRIMARY KEY, value TEXT NOT NULL);"
            + "CREATE TABLE IF NOT EXISTS skinr_designs ("
            + "  skinr_id TEXT PRIMARY KEY,"
            + "  ship_type_id INTEGER,"
            + "  tier_level INTEGER,"
            + "  name TEXT,"
            + "  line TEXT,"
            + "  creator_id INTEGER,"
            + "  payload TEXT NOT NULL,"
            + "  first_seen TEXT NOT NULL,"
            + "  last_seen TEXT NOT NULL);"
            + "CREATE INDEX IF NOT EXISTS skinr_designs_ship "
            + "  ON skinr_designs (ship_type_id);"
            + "CREATE INDEX IF NOT EXISTS skinr_designs_creator "
            + "  ON skinr_designs (creator_id);"
            // The primary key is the pair, which is what makes this a log: the
            // same listing seen at two moments is two rows, and the same page
            // recorded twice is one.
            + "CREATE TABLE IF NOT EXISTS skinr_listing_observations ("
            + "  listing_id TEXT NOT NULL,"
            + "  observed_at TEXT NOT NULL,"
            + "  skinr_id TEXT,"
            + "  seller_id INTEGER,"
            + "  quantity INTEGER,"
            + "  state TEXT,"
            + "  price_kind TEXT,"
            + "  price_value TEXT,"
            + "  created TEXT,"
            + "  payload TEXT NOT NULL,"
            + "  PRIMARY KEY (listing_id, observed_at));"
            + "CREATE INDEX IF NOT EXISTS skinr_listing_design "
            + "  ON skinr_listing_observations (skinr_id, observed_at);"
            // Who the ids belong to.
            //
            // The harvest records a creator and a seller as bare ids, which is
            // correct — that is what the API returns, and a name is not a fact
            // about the listing. But it made every capsuleer unsearchable: a
            // reader who knows a designer by name had no way to find their work,
            // and the ones that appeared to work were only names cached by
            // having clicked them.
            //
            // Kept beside the log rather than inside it for the same reason the
            // store sits beside the SDE: a name is an observation of ours, not
            // something the source shipped, and `observed_at` says when it was
            // true. A corporation especially — people leave.
            + "CREATE TABLE IF NOT EXISTS skinr_characters ("
            + "  character_id INTEGER PRIMARY KEY,"
            + "  name TEXT,"
            + "  corporation TEXT,"
            + "  alliance TEXT,"
            + "  observed_at TEXT NOT NULL);"
            + "CREATE INDEX IF NOT EXISTS skinr_characters_name "
            + "  ON skinr_characters (name);"
        );

        const meta = this.#database.prepare("SELECT value FROM skinr_meta WHERE key = 'schema'").get();

        if (meta && meta.value !== DATABASE_SCHEMA)
        {
            throw new TypeError(`Not a SKINR store: ${this.filePath} carries schema ${meta.value}`);
        }

        this.#database.prepare(
            "INSERT INTO skinr_meta (key, value) VALUES ('schema', ?), ('version', ?), ('target', ?) "
            + "ON CONFLICT (key) DO UPDATE SET value = excluded.value"
        ).run(DATABASE_SCHEMA, String(DATABASE_VERSION), SKINR_TARGET);
    }

}

function RequireId(value, what)
{
    const id = String(value ?? "").trim();

    if (!id) throw new TypeError(`A ${what} is required`);

    return id;
}

/**
 * The observation time is the caller's, not this module's.
 *
 * A store that stamps its own clock cannot record a harvest that was read from
 * a file, replayed, or backfilled, and it makes every test depend on wall time.
 */
function RequireTimestamp(value)
{
    const text = String(value ?? "").trim();

    if (!text) throw new TypeError("An observation timestamp is required");

    return text;
}

function NumberOrNull(value)
{
    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

/**
 * The ORDER BY for one sort name.
 *
 * A fixed map rather than interpolated caller text: this is the one place in
 * the query where a string reaches SQL unparameterised, so it may only ever be
 * one of these.
 *
 * `price` sorts numerically inside whichever currency the caller filtered to.
 * The value is stored as text because ISK is a decimal quantity, so the cast is
 * here rather than in the column.
 */
/**
 * The ORDER BY for one sort, in one direction.
 *
 * Every key can be read either way. It used to be one key only - `price` had a
 * `price-desc` twin and nothing else had anything - which made a direction
 * control on a consumer either a lie on four options out of five, or a
 * client-side reverse of the page it happens to be holding. The second is
 * worse: reversing a thousand rows out of three thousand answers a question
 * about the window rather than about the hub.
 *
 * Each key has a natural direction - newest listings, highest tiers, cheapest
 * prices, names from A - and that is what asking for the key alone gives. A
 * stated direction is the COLUMN's, not a reversal of the key's: "tier
 * descending" is 18 down to 1 whichever way tier happens to read by default.
 * Relative-to-natural was tried first and is a worse answer, because a reader
 * pressing DESC on TIER is asking for high numbers first, not for "the other
 * one from whatever you were doing".
 *
 * The tiebreaker turns with the key. A stable order that always broke ties the
 * same way would leave equal-priced listings in one order in both directions,
 * so a reversed page would not quite be the reverse of the page.
 *
 * @param {String} sort
 * @param {String} [direction] - "asc" or "desc"; the key's own order otherwise
 */
function SortOrder(sort, direction)
{
    const key = String(sort ?? "").toLowerCase();
    const asked = String(direction ?? "").toLowerCase();

    // Seeded, so one shuffle survives being read in pages. See the constructor
    // for why SQLite's random() cannot do this. Direction means nothing to a
    // shuffle - its reverse is just another shuffle - so it is ignored rather
    // than honoured into a second arrangement nobody asked for.
    if (key === "random") return "cjs_skinr_shuffle(o.listing_id, :seed), o.listing_id";

    const columns = {
        // Legacy: the descending twin, from when this was the only key that had
        // one. Still accepted, because links to it exist.
        "price-desc": { column: "CAST(o.price_value AS REAL)", natural: "DESC" },
        price: { column: "CAST(o.price_value AS REAL)", natural: "ASC" },
        tier: { column: "d.tier_level", natural: "DESC" },
        name: { column: "d.name COLLATE NOCASE", natural: "ASC" },
        recent: { column: "o.created", natural: "DESC" }
    };

    const chosen = columns[key] ?? columns.recent;
    const order = asked === "asc" ? "ASC" : asked === "desc" ? "DESC" : chosen.natural;

    return `${chosen.column} ${order}, o.listing_id ${order}`;
}

/**
 * A listing's place in one shuffle: FNV-1a over the seed and the id.
 *
 * The seed is half the key rather than a starting point, so two seeds give two
 * unrelated orders instead of the same order rotated.
 */
function ShuffleKey(listingId, seed)
{
    let hash = 0x811c9dc5;

    for (const text of [ String(seed ?? 0), ":", String(listingId ?? "") ])
    {
        for (let i = 0; i < text.length; i++)
        {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
    }

    return hash;
}

/** A caller's seed as an integer, or one that changes if they named none. */
function NormalizeSeed(value)
{
    const seed = Math.trunc(Number(value));

    // No seed is a reading of one page, so an arbitrary shuffle is the right
    // answer - and a fixed fallback would make "random" mean one permanent
    // order that every reader saw. A paging caller must send its own.
    return Number.isFinite(seed) ? seed : Math.trunc(Math.random() * 0x7fffffff);
}

function NormalizeLimit(value)
{
    const limit = Math.trunc(Number(value));

    return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 100;
}

export default CjsToolSkinrStore;
