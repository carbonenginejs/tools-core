/**
 * The map answers that cannot be looked up, precomputed at import.
 *
 * This is a derivation in the sense `CjsToolSdeDerivations` means it — a pure
 * function of the rows an import just wrote, stored beside the database so it
 * can never be mistaken for something the source shipped. It holds exactly the
 * two things the SDE does not contain and a query cannot recover:
 *
 * **Stargate orientation.** Which way a gate faces depends on the position of
 * a system it is not in, so it is a cross-row join that no index can answer.
 *
 * **Celestial names.** `mapPlanets`, `npcStations`, `mapStars` and
 * `mapStargates` carry no name field at all — the game composes one at
 * display time. That makes name *search* impossible against the raw tables:
 * there is no string to match, so `LIKE` cannot find "Jita IV" however the
 * database is indexed. The names have to exist before they can be searched, and
 * this is where they come to exist.
 *
 * ## What is deliberately not here
 *
 * Moons and asteroid belts, which are 385385 of the cluster's 481000 celestials
 * between them. Their names are composed from their planet's, and they are only
 * ever asked for as part of a system, where the planets are loaded anyway — so
 * naming them on demand costs nothing and precomputing them would quadruple
 * this file to serve a search nobody performs. If moon search is ever wanted,
 * that is a considered change to this comment and a version bump, not an
 * oversight to quietly fix.
 *
 * Also not here: anything already stored. A planet's position, type and
 * statistics are published fields sitting in an indexed table, and copying them
 * into a derived artifact would create a second copy to keep honest.
 */

import {
    OrientationFromDirection,
    StargateDirection
} from "./CjsToolMapGeometry.js";

import {
    PlanetName,
    ReadName,
    StarName,
    StargateName,
    StationName
} from "./CjsToolMapNames.js";

/** The tables this derivation reads. Absent ones make it skip, not fail. */
export const MAP_INDEX_TABLES = Object.freeze([
    "mapSolarSystems",
    "mapStars",
    "mapStargates",
    "mapPlanets",
    "npcStations",
    "stationOperations",
    "npcCorporations"
]);

/**
 * The kinds this index names, in the order a search should prefer them.
 *
 * A search for "Jita" should surface the system before its star and its gates,
 * because the system is what a person means by the word. Encoded as data so the
 * ranking is one list rather than a comparator scattered across call sites.
 */
export const NAMED_KINDS = Object.freeze([ "star", "planet", "station", "stargate" ]);

/**
 * Builds the map index from already-decoded tables.
 *
 * @param {Object} tables - `{ tableName: { recordId: record } }`
 * @returns {Object} the artifact
 */
export function BuildMapIndex(tables)
{
    const systems = tables.mapSolarSystems ?? {};
    const systemNames = new Map();
    const systemPositions = new Map();

    for (const [ id, system ] of Object.entries(systems))
    {
        systemNames.set(Number(id), ReadName(system) ?? String(id));
        systemPositions.set(Number(id), system?.position ?? null);
    }

    const stargates = BuildStargates(tables, systemNames, systemPositions);
    const names = BuildNames(tables, systemNames, stargates);

    return {
        // Bumped when a *rule* changes rather than when the code moves. The
        // enclosing derivation's `version` invalidates the file; this records
        // which rule produced the values inside it, so an answer can say how it
        // was reached without the reader having to know the file's history.
        rules: { stargateOrientation: 1, celestialNames: 1 },
        counts: {
            stargates: Object.keys(stargates).length,
            names: Object.keys(names).length
        },
        stargates,
        names
    };
}

/**
 * One entry per gate: where it points, and where it goes.
 *
 * A gate whose destination system is missing from the SDE still gets an
 * entry, with a null direction. Dropping it would make the gate vanish from its
 * system rather than appear unrotated, and a gate that is drawn facing the
 * wrong way is a smaller lie than a gate that is not drawn.
 */
function BuildStargates(tables, systemNames, systemPositions)
{
    const gates = tables.mapStargates ?? {};
    const result = {};

    for (const [ id, gate ] of Object.entries(gates))
    {
        const destinationSystemID = gate?.destination?.solarSystemID ?? null;
        const from = systemPositions.get(Number(gate?.solarSystemID));
        const to = destinationSystemID === null
            ? null
            : systemPositions.get(Number(destinationSystemID));

        const direction = StargateDirection(from, to);

        result[id] = {
            solarSystemID: gate?.solarSystemID ?? null,
            destinationSystemID,
            destinationStargateID: gate?.destination?.stargateID ?? null,
            direction,
            rotation: OrientationFromDirection(direction)
        };
    }

    return result;
}

/**
 * `{ celestialID: [ kind, solarSystemID, name ] }`.
 *
 * A tuple rather than an object per entry, because there are ninety-odd
 * thousand of them and the key names would be most of the file.
 */
function BuildNames(tables, systemNames, stargates)
{
    const result = {};
    const SystemName = (id) => systemNames.get(Number(id)) ?? String(id);

    for (const [ id, star ] of Object.entries(tables.mapStars ?? {}))
    {
        result[id] = [ "star", star?.solarSystemID ?? null, StarName(SystemName(star?.solarSystemID)) ];
    }

    const planets = tables.mapPlanets ?? {};

    for (const [ id, planet ] of Object.entries(planets))
    {
        result[id] = [
            "planet",
            planet?.solarSystemID ?? null,
            PlanetName(SystemName(planet?.solarSystemID), planet)
        ];
    }

    for (const [ id, gate ] of Object.entries(stargates))
    {
        result[id] = [
            "stargate",
            gate.solarSystemID,
            StargateName(gate.destinationSystemID === null
                ? null
                : SystemName(gate.destinationSystemID))
        ];
    }

    // Stations last, because a station's name is built from the name of the
    // body it orbits — which may be a planet named just above, or a moon, which
    // is not in this index at all. The moon case is resolved through the moon's
    // own planet rather than skipped: "Jita IV - Moon 4 - Caldari Navy Assembly
    // Plant" is the name people search for, and dropping the stations orbiting
    // moons would lose most of them.
    const operations = tables.stationOperations ?? {};
    const corporations = tables.npcCorporations ?? {};
    const moons = tables.mapMoons ?? {};

    for (const [ id, station ] of Object.entries(tables.npcStations ?? {}))
    {
        const systemName = SystemName(station?.solarSystemID);
        const orbit = ResolveStationOrbitName(station, systemName, planets, moons);

        result[id] = [
            "station",
            station?.solarSystemID ?? null,
            StationName(
                orbit,
                ReadName(corporations[station?.ownerID], "name"),
                ReadName(operations[station?.operationID], "operationName"),
                station?.useOperationName !== false
            )
        ];
    }

    return result;
}

/**
 * The name of whatever a station orbits.
 *
 * `mapMoons` is optional here on purpose: it is the largest table in the SDE
 * and this derivation does not otherwise need it. When it is supplied the moon
 * name is exact; when it is not, the station falls back to its `celestialIndex`
 * as a planet numeral, which is the same planet the moon belongs to and so
 * still places the station correctly, just less precisely.
 */
function ResolveStationOrbitName(station, systemName, planets, moons)
{
    const orbit = station?.orbitID == null ? null : String(station.orbitID);

    if (orbit && planets[orbit])
    {
        return PlanetName(systemName, planets[orbit]);
    }

    if (orbit && moons[orbit])
    {
        const moon = moons[orbit];
        const planet = planets[String(moon?.orbitID)] ?? { celestialIndex: moon?.celestialIndex };

        return `${PlanetName(systemName, planet)} - Moon ${moon?.orbitIndex ?? "?"}`;
    }

    return PlanetName(systemName, { celestialIndex: station?.celestialIndex });
}
