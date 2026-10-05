import assert from "node:assert/strict";
import test from "node:test";

import { ProjectMapObjects, MAP_OBJECT_TABLES } from "../src/sde/build/projectMapObjects.js";

/** One mapObjects.db `celestials` row; columns default to SQLite NULL. */
function celestial(fields)
{
    return {
        celestialID: null, celestialNameID: null, solarSystemID: null, typeID: null, groupID: null,
        radius: null, x: 1, y: 2, z: 3, orbitID: null, orbitIndex: null, celestialIndex: null,
        celestialName: null, ...fields,
    };
}

const SYSTEM = 30000004;
const rows = {
    celestials: [
        // A binary pair: the system's starID is the lower id.
        celestial({ celestialID: 40000021, solarSystemID: SYSTEM, groupID: 6, typeID: 45031, radius: 2, orbitID: null }),
        celestial({ celestialID: 40000020, solarSystemID: SYSTEM, groupID: 6, typeID: 45031, radius: 1 }),
        celestial({ celestialID: 42000001, solarSystemID: SYSTEM, groupID: 7, typeID: 11, radius: 5, orbitID: 40000020, celestialIndex: 1, celestialName: "P1" }),
        celestial({ celestialID: 48000001, solarSystemID: SYSTEM, groupID: 8, typeID: 14, radius: 3, orbitID: 42000001, orbitIndex: 1, celestialIndex: 1 }),
        celestial({ celestialID: 60000001, solarSystemID: SYSTEM, groupID: 10, typeID: 79787 }),
        celestial({ celestialID: 412000001, solarSystemID: SYSTEM, groupID: 4870, typeID: 88163, orbitID: 42000001, celestialIndex: 1, celestialName: "P1L1" }),
    ],
    npcStations: [ {
        stationID: 64000001, orbitID: 42000001, solarSystemID: SYSTEM, ownerID: 1000001, typeID: 3, x: 4, y: 5, z: 6,
        operationID: 22, reprocessingEfficiency: 0.5, reprocessingStationsTake: 0.05, reprocessingHangarFlag: 4,
        isConquerable: 0, useOperationName: 1, orbitIndex: null, celestialIndex: 1,
    } ],
};

test("every celestial group lands in its table, with the system built from its members", () =>
{
    const tables = ProjectMapObjects(rows);

    assert.deepEqual(Object.keys(tables), [ ...MAP_OBJECT_TABLES ]);
    assert.deepEqual(Object.keys(tables.mapStars).sort(), [ "40000020", "40000021" ]);
    assert.ok(tables.mapPlanets[42000001]);
    assert.ok(tables.mapMoons[48000001]);
    assert.ok(tables.mapStargates[60000001]);
    assert.ok(tables.mapLagrangePoints[412000001]);

    const system = tables.mapSolarSystems[SYSTEM];
    assert.deepEqual(system.name, { en: String(SYSTEM) }, "a Frontier system is named by its id");
    assert.equal(system.starID, 40000020, "a binary system's starID is the lower id");
    assert.deepEqual(system.planetIDs, [ 42000001 ]);
    assert.deepEqual(system.stargateIDs, [ 60000001 ]);
    assert.equal(system.position, undefined, "mapObjects.db has no galaxy position for a system");
    assert.equal(system.regionID, undefined);
});

test("children are listed on their parents the way the earlier map tables listed them", () =>
{
    const tables = ProjectMapObjects(rows);

    assert.deepEqual(tables.mapPlanets[42000001].moonIDs, [ 48000001 ]);
    assert.deepEqual(tables.mapPlanets[42000001].npcStationIDs, [ 64000001 ]);
});

test("SQLite NULL is absence, and nothing the database does not hold is invented", () =>
{
    const tables = ProjectMapObjects(rows);
    const gate = tables.mapStargates[60000001];

    assert.equal(gate.destination, undefined, "the database does not say where a gate goes");
    assert.equal(gate.radius, undefined);
    assert.equal(gate.orbitID, undefined);
    assert.deepEqual(gate.position, { x: 1, y: 2, z: 3 });
    assert.equal(tables.mapPlanets[42000001].celestialName, undefined, "local labels are composed by the map topic");
});

test("stations publish booleans where SQLite stores 0 and 1", () =>
{
    const station = ProjectMapObjects(rows).npcStations[64000001];

    assert.equal(station.isConquerable, false);
    assert.equal(station.useOperationName, true);
    assert.deepEqual(station.position, { x: 4, y: 5, z: 6 });
    assert.equal(station.orbitIndex, undefined);
});

test("an unknown celestial group stops the projection instead of vanishing", () =>
{
    assert.throws(
        () => ProjectMapObjects({ celestials: [ celestial({ celestialID: 1, solarSystemID: SYSTEM, groupID: 99 }) ] }),
        /celestial groups this projection does not map: 99 \(1\)/u,
    );
});
