/**
 * Projects EVE Frontier's `mapObjects.db` into the export's map tables.
 *
 * From build 3573151 Frontier ships no map in `res:/staticdata`: regions,
 * constellations, systems, jumps and `solarsystemcontent` are gone, and the
 * celestials arrive instead as SQLite at `app:/bin64/staticdata/mapObjects.db`,
 * in two tables - `celestials` (one row per sun, planet, moon, stargate and
 * Lagrange point, told apart by `groupID`) and `npcStations`.
 *
 * It is a new universe, not the old one with tables removed: celestial ids
 * were reused, but in a 2,000-row sample per kind about one in a hundred kept
 * its system and none kept its position. Nothing here is joined to an earlier
 * build.
 *
 * Rows take the shapes the earlier map tables had, so the map topic reads them
 * unchanged, and carry only what the database holds:
 *
 * - **No regions or constellations**, and systems have no galaxy position.
 *   A system's row is its id, its suns, planets and stargates.
 * - **A system's name is its id.** Frontier never published system names; the
 *   earlier builds' were numeric labels too, and this build ships none.
 * - **Suns carry a position**, because 7,037 systems have two of them and a
 *   binary pair is not at the origin. `starID` names the lower id.
 * - **Stargates have no destination.** The database does not say where a gate
 *   goes, so the field is omitted rather than guessed.
 * - **Lagrange points are a table of their own**, `mapLagrangePoints`: group
 *   4870, five per planet, which no earlier map table had.
 */

/** `groupID` values in `celestials`, and the table each becomes. */
export const MAP_OBJECT_GROUPS = Object.freeze({
    6: "mapStars",
    7: "mapPlanets",
    8: "mapMoons",
    10: "mapStargates",
    4870: "mapLagrangePoints",
});

/** The tables this projector emits, in the order they are written. */
export const MAP_OBJECT_TABLES = Object.freeze([
    "mapSolarSystems",
    "mapStars",
    "mapPlanets",
    "mapMoons",
    "mapStargates",
    "mapLagrangePoints",
    "npcStations",
]);

/** Orders a row the way the export publishes it: _key first, then alphabetical. */
function SortRowKeys(row)
{
    const ordered = { _key: row._key };

    for (const field of Object.keys(row).sort())
    {
        if (field !== "_key") ordered[field] = row[field];
    }

    return ordered;
}

/** Copies the named columns that hold a value. SQLite NULL is absence, not zero. */
function CopyPresent(row, source, fields)
{
    for (const field of fields)
    {
        const value = source[field];

        if (value !== null && value !== undefined) row[field] = value;
    }

    return row;
}

/** `{ x, y, z }` when the row has all three, which every celestial does. */
function Position(source)
{
    return source.x === null || source.x === undefined
        ? undefined
        : { x: source.x, y: source.y, z: source.z };
}

/** Appends an id to a row's id list, creating the list on first use. */
function AddId(row, field, id)
{
    (row[field] ??= []).push(id);
}

/**
 * Projects the two `mapObjects.db` tables.
 *
 * @param {{ celestials: object[], npcStations?: object[] }} rows Rows as the
 *   SQLite driver returns them, one object per row keyed by column.
 * @returns {object} `{ table: { id: row } }` for every table in `MAP_OBJECT_TABLES`.
 */
export function ProjectMapObjects(rows)
{
    if (!rows || !Array.isArray(rows.celestials))
    {
        throw new TypeError("Map object projection requires the celestials rows.");
    }

    const tables = Object.fromEntries(MAP_OBJECT_TABLES.map(table => [ table, {} ]));
    const systems = tables.mapSolarSystems;
    const System = (id) => systems[id] ??= { _key: id, name: { en: String(id) } };
    const unknownGroups = new Map();

    for (const source of rows.celestials)
    {
        const table = MAP_OBJECT_GROUPS[source.groupID];

        if (!table)
        {
            unknownGroups.set(source.groupID, (unknownGroups.get(source.groupID) ?? 0) + 1);
            continue;
        }

        const id = source.celestialID;
        const system = System(source.solarSystemID);
        const row = CopyPresent(
            { _key: id, solarSystemID: source.solarSystemID },
            source,
            [ "typeID", "radius", "orbitID", "orbitIndex", "celestialIndex" ],
        );
        const position = Position(source);

        if (position) row.position = position;

        tables[table][id] = row;

        if (table === "mapStars" && (system.starID === undefined || id < system.starID)) system.starID = id;
        if (table === "mapPlanets") AddId(system, "planetIDs", id);
        if (table === "mapStargates") AddId(system, "stargateIDs", id);
    }

    if (unknownGroups.size)
    {
        // A group this projector has not met is a new kind of celestial, which
        // is worth a schema decision rather than a silent drop.
        const listed = [ ...unknownGroups ].map(([ group, count ]) => `${group} (${count})`).join(", ");
        throw new Error(`mapObjects.db has celestial groups this projection does not map: ${listed}`);
    }

    // Child lists, which the earlier map tables carried on the parent.
    for (const moon of Object.values(tables.mapMoons))
    {
        const planet = tables.mapPlanets[moon.orbitID];

        if (planet) AddId(planet, "moonIDs", moon._key);
    }

    for (const source of rows.npcStations ?? [])
    {
        const id = source.stationID;
        const row = CopyPresent({ _key: id }, source, [
            "celestialIndex", "operationID", "orbitID", "orbitIndex", "ownerID",
            "reprocessingEfficiency", "reprocessingHangarFlag", "reprocessingStationsTake",
            "solarSystemID", "typeID",
        ]);
        const position = Position(source);

        if (position) row.position = position;

        // SQLite stores these as 0/1; the export publishes booleans.
        for (const flag of [ "isConquerable", "useOperationName" ])
        {
            if (source[flag] !== null && source[flag] !== undefined) row[flag] = Boolean(source[flag]);
        }

        tables.npcStations[id] = row;

        const planet = tables.mapPlanets[source.orbitID];

        if (planet) AddId(planet, "npcStationIDs", id);
    }

    for (const table of MAP_OBJECT_TABLES)
    {
        for (const [ id, row ] of Object.entries(tables[table])) tables[table][id] = SortRowKeys(row);
    }

    return tables;
}

export default ProjectMapObjects;
