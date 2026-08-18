/**
 * Expression indexes for the fields the map topic filters on.
 *
 * `CjsSdeTable.Find` filters with `json_extract(payload, ?)`, which SQLite can
 * only answer by decoding every row's JSON. That is fine for a table of a few
 * thousand rows and is not fine for the map: measured against one reference
 * build, one `solarSystemID` lookup costs
 *
 *   mapMoons (344457 rows)   640 ms
 *   mapPlanets (68407 rows)  330 ms
 *   mapStargates (13978)     214 ms
 *   npcStations (5210)       208 ms
 *
 * so composing one system's celestials — which is a single screen of a map UI —
 * costs about 1.4 seconds of pure scanning. An index on the extracted value
 * turns each of those into a b-tree seek.
 *
 * ## Why these are not derivations
 *
 * A derivation (`CjsSdeDerivations`) computes a *new answer* and is deliberately
 * written outside the database so it can never be mistaken for something the
 * source shipped. An index adds no answer at all — the same query returns
 * the same rows either way, only faster — so it carries none of that risk and
 * belongs with the data it accelerates.
 *
 * ## Why this does not bump the database version
 *
 * `DATABASE_VERSION` guards the *shape a reader must understand*, and a reader
 * that has never heard of these indexes reads the database correctly. Bumping
 * it would make every prepared database on disk unreadable and force a fresh
 * multi-hundred-megabyte archive download to gain a query plan. So the indexes
 * are created at import, and an already-prepared database gains them the first
 * time it is opened, which costs one write and never happens again.
 */

/**
 * The register: one entry per (table, JSON path) pair worth seeking on.
 *
 * `solarSystemID` is locality — "what is in this system", the whole map API.
 * `orbitID` is the containment tree — a moon's planet, a station's moon — which
 * is what lets a system be presented as a hierarchy rather than five flat lists.
 *
 * Indexing a table the source does not carry is not an error: a target without
 * an acquirable archive assembles its own tables, and an absent one simply has
 * no index. Only tables that are actually large are listed; an index on a
 * hundred rows costs more to maintain than it saves.
 */
export const QUERY_INDEXES = Object.freeze([
    Object.freeze({ table: "mapPlanets", field: "solarSystemID" }),
    Object.freeze({ table: "mapPlanets", field: "orbitID" }),
    Object.freeze({ table: "mapMoons", field: "solarSystemID" }),
    Object.freeze({ table: "mapMoons", field: "orbitID" }),
    Object.freeze({ table: "mapAsteroidBelts", field: "solarSystemID" }),
    Object.freeze({ table: "mapAsteroidBelts", field: "orbitID" }),
    Object.freeze({ table: "npcStations", field: "solarSystemID" }),
    Object.freeze({ table: "npcStations", field: "orbitID" }),
    Object.freeze({ table: "mapStargates", field: "solarSystemID" }),
    Object.freeze({ table: "mapStars", field: "solarSystemID" }),
    Object.freeze({ table: "mapSecondarySuns", field: "solarSystemID" }),
    Object.freeze({ table: "mapSolarSystems", field: "constellationID" }),
    Object.freeze({ table: "mapSolarSystems", field: "regionID" }),
    Object.freeze({ table: "mapConstellations", field: "regionID" })
]);

const NamePattern = /^[A-Za-z][A-Za-z0-9_]*$/u;

/**
 * The token in every index name, bumped when the indexed *expression* changes.
 *
 * An expression index is matched syntactically, so an index whose expression no
 * longer matches the query is not merely stale — it is invisible, and it stays
 * on disk costing writes forever while the planner scans past it. There is no
 * symptom except slowness, which is why the name carries a version and the
 * upgrade drops anything from an earlier one.
 *
 * v1 -> v2: the expression was written `json_extract(payload, '$.field')`, but
 * `NormalizeJsonPath` quotes each segment and produces `$."field"`. The two
 * texts differ, so the v1 indexes matched nothing they were built for.
 */
export const QUERY_INDEX_VERSION = 2;

/** Every index this module has ever created, for the upgrade to clean up. */
export const QUERY_INDEX_PREFIX = "sde_rows_q";

/** The index name for one register entry. */
export function QueryIndexName(entry)
{
    return `${QUERY_INDEX_PREFIX}${QUERY_INDEX_VERSION}_${entry.table}_${entry.field}`;
}

/**
 * The JSON path text, character for character as `NormalizeJsonPath` writes it.
 *
 * Duplicated rather than imported to avoid a cycle between the database and its
 * index register — and guarded by a test that asserts the two agree, because a
 * silent divergence here disables every index without failing anything.
 */
export function QueryIndexJsonPath(field)
{
    return `$."${field}"`;
}

/**
 * The `CREATE INDEX` for one register entry.
 *
 * Partial, on `table_name`, for a reason that is easy to get wrong: every
 * table's rows live in the same `sde_rows`, so an unpartitioned index on
 * `json_extract(payload, '$.solarSystemID')` would hold an entry for all 1.5
 * million rows in the database — including every row of every table that has no
 * such field, all indexed under NULL. The `WHERE` clause keeps each index to
 * exactly the table it serves.
 *
 * The predicate must be written the way `CjsSdeTable.Find` writes it, character
 * for character, or SQLite will not use the index — an expression index is
 * matched syntactically. `Find` casts to TEXT, so this does too.
 */
export function QueryIndexSql(entry)
{
    if (!NamePattern.test(entry.table) || !NamePattern.test(entry.field))
    {
        throw new TypeError(`Unsafe SDE query index entry: ${entry.table}.${entry.field}`);
    }

    return `CREATE INDEX IF NOT EXISTS ${QueryIndexName(entry)} `
        + "ON sde_rows (CAST(json_extract(payload, "
        + `'${QueryIndexJsonPath(entry.field)}') AS TEXT)) `
        + `WHERE table_name = '${entry.table}'`;
}

/**
 * Removes indexes this module created under an earlier expression.
 *
 * They cannot be left: SQLite maintains every index on every write whether or
 * not any query can use one, so a superseded expression index is pure cost with
 * no possible benefit.
 */
export function DropStaleQueryIndexes(database)
{
    const current = new Set(QUERY_INDEXES.map(QueryIndexName));
    const stale = database
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE ?"
        )
        .all(`${QUERY_INDEX_PREFIX}%`)
        .map(row => row.name)
        .filter(name => !current.has(name));

    for (const name of stale) database.prepare(`DROP INDEX IF EXISTS ${name}`).run();

    return stale;
}

/**
 * Creates every register index the database is missing.
 *
 * Skips a table the source does not carry, so this is safe to run against any
 * target's database. Returns the names created, which is what the caller
 * logs — silence about work that took seconds reads as a hang.
 *
 * @param {Object} database - an open writable better-sqlite3 handle
 * @param {Set<String>|null} [tableNames] - tables known present, or null to ask
 * @returns {Array<String>} index names created this call
 */
export function CreateQueryIndexes(database, tableNames = null)
{
    const present = tableNames ?? new Set(
        database.prepare("SELECT name FROM sde_tables").all().map(row => row.name)
    );

    const created = [];

    DropStaleQueryIndexes(database);

    for (const entry of QUERY_INDEXES)
    {
        if (!present.has(entry.table)) continue;

        const name = QueryIndexName(entry);

        if (HasIndex(database, name)) continue;

        database.prepare(QueryIndexSql(entry)).run();
        created.push(name);
    }

    return created;
}

/** Whether every index the database's own tables call for already exists. */
export function HasQueryIndexes(database)
{
    const present = new Set(
        database.prepare("SELECT name FROM sde_tables").all().map(row => row.name)
    );

    return QUERY_INDEXES
        .filter(entry => present.has(entry.table))
        .every(entry => HasIndex(database, QueryIndexName(entry)));
}

function HasIndex(database, name)
{
    return Boolean(
        database
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
            .get(name)
    );
}
