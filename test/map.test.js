import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { CjsSdeDatabase } from "../src/sde/index.js";
import { CjsToolMap } from "../src/map/CjsToolMap.js";
import { BuildMapIndex } from "../src/map/CjsToolMapIndex.js";
import {
    BlackbodyColor,
    MEDIAN_LUMINOSITY,
    OrientationFromDirection,
    StargateDirection,
    SunIntensity
} from "../src/map/CjsToolMapGeometry.js";
import {
    AsteroidBeltName,
    MoonName,
    PlanetName,
    RomanNumeral,
    StarName,
    StargateName,
    StationName
} from "../src/map/CjsToolMapNames.js";
import {
    QUERY_INDEXES,
    QueryIndexJsonPath,
    QueryIndexName,
    QueryIndexSql
} from "../src/sde/CjsSdeQueryIndexes.js";

function CreateDatabasePath()
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-map-"));

    return path.join(directory, "sde_v1.sqlite");
}

/**
 * A two-system cluster with one of everything.
 *
 * Deliberately not Jita: fixture ids that look like real ones invite a reader
 * to check them against real data and conclude the test is wrong when it
 * is only different. The shapes are real, the values are not.
 */
const TABLES = Object.freeze({
    mapRegions: {
        10000001: { _key: 10000001, name: { en: "Testland" }, nebulaID: 900, constellationIDs: [ 20000001 ] }
    },
    mapConstellations: {
        20000001: { _key: 20000001, name: { en: "Testation" }, regionID: 10000001, solarSystemIDs: [ 30000001, 30000002 ] }
    },
    mapSolarSystems: {
        30000001: {
            _key: 30000001, name: { en: "Alpha", de: "Alpha-DE", ja: "アルファ" },
            constellationID: 20000001, regionID: 10000001,
            starID: 40000001, position: { x: 0, y: 0, z: 0 }, securityStatus: 0.9
        },
        30000002: {
            _key: 30000002, name: { en: "Beta" }, constellationID: 20000001, regionID: 10000001,
            starID: 40000010, position: { x: 100, y: 0, z: 0 }, securityStatus: 0.5
        }
    },
    mapStars: {
        40000001: {
            _key: 40000001, solarSystemID: 30000001, typeID: 3802, radius: 1,
            statistics: { spectralClass: "G5 V", temperature: 5500, luminosity: MEDIAN_LUMINOSITY }
        },
        40000010: {
            _key: 40000010, solarSystemID: 30000002, typeID: 3802, radius: 1,
            statistics: { spectralClass: "M0 V", temperature: 3000, luminosity: 0.01 }
        }
    },
    mapPlanets: {
        40000002: {
            _key: 40000002, solarSystemID: 30000001, typeID: 11, celestialIndex: 4,
            // Planets orbit the star, which is how the real data has it.
            orbitID: 40000001,
            moonIDs: [ 40000004 ], asteroidBeltIDs: [ 40000003 ],
            position: { x: 1, y: 2, z: 3 }, radius: 5,
            attributes: { shaderPreset: 4461, heightMap1: 3842, heightMap2: 3843 }
        }
    },
    mapMoons: {
        40000004: {
            _key: 40000004, solarSystemID: 30000001, typeID: 14, orbitID: 40000002,
            orbitIndex: 2, celestialIndex: 4, position: { x: 1, y: 2, z: 4 }
        }
    },
    mapAsteroidBelts: {
        40000003: {
            _key: 40000003, solarSystemID: 30000001, typeID: 15, orbitID: 40000002,
            orbitIndex: 1, celestialIndex: 4, position: { x: 1, y: 2, z: 5 }
        }
    },
    npcStations: {
        60000001: {
            _key: 60000001, solarSystemID: 30000001, typeID: 1531, orbitID: 40000004,
            celestialIndex: 4, ownerID: 1000002, operationID: 26, useOperationName: true,
            position: { x: 1, y: 2, z: 6 }
        }
    },
    mapStargates: {
        50000001: {
            _key: 50000001, solarSystemID: 30000001, typeID: 29633,
            position: { x: 9, y: 9, z: 9 },
            destination: { solarSystemID: 30000002, stargateID: 50000002 }
        },
        50000002: {
            _key: 50000002, solarSystemID: 30000002, typeID: 29633,
            position: { x: 8, y: 8, z: 8 },
            destination: { solarSystemID: 30000001, stargateID: 50000001 }
        }
    },
    stationOperations: {
        26: { _key: 26, operationName: { en: "Storage", de: "Lager" } }
    },
    npcCorporations: {
        // A localised dictionary in the real data, not a plain string - which
        // is exactly what an earlier version of this fixture asserted, and why
        // the collapse to English went unnoticed.
        1000002: { _key: 1000002, name: { en: "CBD Corporation", de: "CBD Konzern" } }
    },
    types: {
        11: { _key: 11, graphicID: 100 },
        14: { _key: 14, graphicID: 101 },
        15: { _key: 15, graphicID: 102 },
        1531: { _key: 1531, graphicID: 103 },
        3802: { _key: 3802, graphicID: 104 },
        29633: { _key: 29633, graphicID: 105 }
    },
    graphics: {
        100: { _key: 100, graphicFile: "res:/dx9/model/planet.red" },
        101: { _key: 101, graphicFile: "res:/dx9/model/moon.red" },
        102: { _key: 102, graphicFile: "res:/dx9/model/belt.red" },
        103: { _key: 103, graphicFile: "res:/dx9/model/station.red" },
        104: { _key: 104, graphicFile: "res:/dx9/model/sun.red" },
        105: { _key: 105, graphicFile: "res:/dx9/model/gate.red" },
        900: { _key: 900, graphicFile: "res:/dx9/scene/Universe/t01_cube.red" },
        // A planet's `attributes` name graphics directly, not through its type.
        3842: { _key: 3842, graphicFile: "res:/dx9/model/worldobject/planet/height1.dds" },
        3843: { _key: 3843, graphicFile: "res:/dx9/model/worldobject/planet/height2.dds" },
        4461: { _key: 4461, graphicFile: "res:/dx9/model/worldobject/planet/preset.red" }
    }
});

async function OpenFixture()
{
    const filePath = CreateDatabasePath();
    const database = await CjsSdeDatabase.create(filePath);

    await database.ImportTables(TABLES, { build: 3466501 });

    // Stands in for `CjsSdeSource`, which is what the map is written against.
    // A fake rather than the real repository because the repository's job is
    // acquiring and choosing a build, and none of that is under test here.
    return {
        filePath,
        database,
        source: {
            target: "eve",
            game: "Eve",
            provider: "ccp",
            build: "3466501",
            Table: (name) => database.Table(name),
            LoadTables: (names) => database.LoadTables(names),
            DatabaseFile: () => filePath
        }
    };
}

test("roman numerals cover the celestial range and refuse what is not one", () =>
{
    assert.equal(RomanNumeral(1), "I");
    assert.equal(RomanNumeral(4), "IV");
    assert.equal(RomanNumeral(9), "IX");
    assert.equal(RomanNumeral(14), "XIV");

    // Null, not "", so a caller cannot build "Alpha " and ship it as a name.
    assert.equal(RomanNumeral(0), null);
    assert.equal(RomanNumeral(-1), null);
    assert.equal(RomanNumeral(1.5), null);
    assert.equal(RomanNumeral(undefined), null);
});

test("celestial names follow the client's composition", () =>
{
    const planet = { celestialIndex: 4 };

    assert.equal(PlanetName("Alpha", planet), "Alpha IV");
    assert.equal(MoonName("Alpha", planet, { orbitIndex: 2 }), "Alpha IV - Moon 2");
    assert.equal(AsteroidBeltName("Alpha", planet, { orbitIndex: 1 }), "Alpha IV - Asteroid Belt 1");
    assert.equal(StarName("Alpha"), "Alpha - Star");
    assert.equal(StargateName("Beta"), "Stargate (Beta)");

    assert.equal(
        StationName("Alpha IV - Moon 2", "CBD Corporation", "Storage", true),
        "Alpha IV - Moon 2 - CBD Corporation Storage"
    );

    // The SDE's own flag, and it is load bearing: a station with it false is
    // named for its owner alone.
    assert.equal(
        StationName("Alpha IV - Moon 2", "CBD Corporation", "Storage", false),
        "Alpha IV - Moon 2 - CBD Corporation"
    );
});

test("a moon's number is its orbit index, not its planet's celestial index", () =>
{
    // The failure this guards is subtle: using celestialIndex for both reads
    // correctly for a first moon and wrongly for every other, so it survives a
    // spot check on whichever body someone happens to look at first.
    const planet = { celestialIndex: 6 };

    assert.equal(MoonName("Alpha", planet, { orbitIndex: 3, celestialIndex: 6 }), "Alpha VI - Moon 3");
});

test("a stargate faces its destination system", () =>
{
    const direction = StargateDirection({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });

    assert.deepEqual(direction, [ 1, 0, 0 ]);

    // Coincident systems have no direction, and a zero vector dressed up as one
    // would be drawn as a gate facing +X.
    assert.equal(StargateDirection({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }), null);
    assert.equal(StargateDirection(null, { x: 1, y: 1, z: 1 }), null);
});

test("orientation survives a gate pointing straight up the galactic axis", () =>
{
    // Straight up is exactly where `up` stops giving a second axis. The roll is
    // arbitrary there, but a unit quaternion still has to come out.
    const rotation = OrientationFromDirection([ 0, 1, 0 ]);

    assert.ok(rotation, "expected a rotation for an axis-aligned direction");
    assert.ok(Number.isFinite(rotation[3]));

    const length = Math.hypot(...rotation);

    assert.ok(Math.abs(length - 1) < 1e-6, `expected a unit quaternion, got length ${length}`);
});

test("blackbody colour reddens as a star cools", () =>
{
    // Asserted as a relation, not against magic triples: the point of the
    // function is that a K star looks warmer than an A star, and a fit that
    // reproduced hardcoded numbers while inverting that relation would be
    // useless and would still pass an equality test.
    const cool = BlackbodyColor(3000);
    const warm = BlackbodyColor(5500);
    const hot = BlackbodyColor(10000);

    assert.ok(cool && warm && hot);

    const BlueOverRed = (rgb) => rgb[2] / rgb[0];

    assert.ok(BlueOverRed(cool) < BlueOverRed(warm), "3000K should be redder than 5500K");
    assert.ok(BlueOverRed(warm) < BlueOverRed(hot), "5500K should be redder than 10000K");

    // Every star in the SDE lies between 2010K and 10764K, so nothing in
    // range may come back null.
    assert.ok(BlackbodyColor(2010));
    assert.ok(BlackbodyColor(10764));
    assert.equal(BlackbodyColor(0), null);
    assert.equal(BlackbodyColor("nonsense"), null);
});

test("the median star lights a scene at one", () =>
{
    assert.equal(SunIntensity(MEDIAN_LUMINOSITY), 1);
    assert.ok(SunIntensity(0.001) >= 0.25, "the curve is clamped, not unbounded");
    assert.ok(SunIntensity(1000) <= 4);
    assert.equal(SunIntensity(0), null);

    // The regression that prompted the exponent to be measured: at a square
    // root, Jita's luminosity of 1.692 landed exactly on the ceiling, making
    // one of the game's most-visited systems indistinguishable from a
    // supergiant. Anything at or above 4 here means the curve is discarding the
    // top of the range again.
    assert.ok(SunIntensity(1.692) < 3, `Jita should not sit near the clamp, got ${SunIntensity(1.692)}`);
    assert.ok(SunIntensity(1.692) > 1, "a bright star should still outshine the median");

    // Monotonic, which a clamp chosen badly would break across the common range.
    assert.ok(SunIntensity(0.05) < SunIntensity(0.098));
    assert.ok(SunIntensity(0.098) < SunIntensity(0.5));
    assert.ok(SunIntensity(0.5) < SunIntensity(5));
});

test("the map index names what the SDE leaves unnamed", () =>
{
    const index = BuildMapIndex(TABLES);

    assert.equal(index.names[40000001][2], "Alpha - Star");
    assert.equal(index.names[40000002][2], "Alpha IV");
    assert.equal(index.names[50000001][2], "Stargate (Beta)");

    // Through the moon it orbits, which is why `mapMoons` is worth loading at
    // derivation time even though nothing else needs it.
    assert.equal(index.names[60000001][2], "Alpha IV - Moon 2 - CBD Corporation Storage");

    // Moons and belts are deliberately absent - see CjsToolMapIndex.
    assert.equal(index.names[40000004], undefined);
    assert.equal(index.names[40000003], undefined);

    assert.deepEqual(index.stargates[50000001].direction, [ 1, 0, 0 ]);
    assert.deepEqual(index.stargates[50000002].direction, [ -1, 0, 0 ]);
});

test("station naming falls back to the planet when moons are not loaded", () =>
{
    const { mapMoons, ...withoutMoons } = TABLES;
    const index = BuildMapIndex(withoutMoons);

    // Coarser, but still in the right place, and `degraded` is what tells a
    // caller which of the two it is looking at.
    assert.equal(index.names[60000001][2], "Alpha IV - CBD Corporation Storage");
});

test("query index sql is partial and refuses unsafe names", () =>
{
    const entry = QUERY_INDEXES.find(item => item.table === "mapMoons" && item.field === "solarSystemID");
    const sql = QueryIndexSql(entry);

    assert.match(sql, /WHERE table_name = 'mapMoons'/u, "must be partial or it indexes every table");
    assert.match(sql, /CAST\(json_extract\(payload, '\$\."solarSystemID"'\) AS TEXT\)/u);
    assert.equal(QueryIndexName(entry), "sde_rows_q2_mapMoons_solarSystemID");

    assert.throws(() => QueryIndexSql({ table: "x'; DROP TABLE sde_rows; --", field: "a" }), TypeError);
    assert.throws(() => QueryIndexSql({ table: "mapMoons", field: "a b" }), TypeError);
});

test("the planner actually uses a locality index", async () =>
{
    // The regression this exists for produced no wrong answers and no failing
    // test: the indexes were created, the queries returned correct rows, and
    // every one of them was a full scan because `Find` bound the JSON path as a
    // parameter and SQLite matches an expression index only against a literal.
    // The only observable symptom was 640ms. Asserting the query PLAN is the
    // only way to catch it.
    const { database, filePath } = await OpenFixture();

    await database.Close();

    const handle = new Database(filePath, { readonly: true });

    try
    {
        const plan = handle
            .prepare(
                "EXPLAIN QUERY PLAN SELECT record_id FROM sde_rows "
                + "WHERE table_name = ? AND CAST(json_extract(payload, '$.\"solarSystemID\"') AS TEXT) = ?"
            )
            .all("mapMoons", "30000001")
            .map(row => row.detail)
            .join(" ");

        assert.match(plan, /sde_rows_q2_mapMoons_solarSystemID/u, `expected the locality index, got: ${plan}`);
    }
    finally
    {
        handle.close();
    }
});

test("the index expression matches the path CjsSdeTable.Find builds", async () =>
{
    // Guards the duplication called out in CjsSdeQueryIndexes: the two texts
    // are written in different files and must agree exactly. Proven by asking
    // the database rather than by comparing strings, so it stays true if either
    // side is rewritten.
    const { database, source } = await OpenFixture();
    const rows = await source.Table("mapMoons").Find("solarSystemID", "30000001");

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "40000004");
    assert.equal(QueryIndexJsonPath("solarSystemID"), "$.\"solarSystemID\"");

    await database.Close();
});

test("an import creates the locality indexes and the map derivation", async () =>
{
    const { database, filePath } = await OpenFixture();

    assert.ok(database.HasQueryIndexes(), "import should leave the database indexed");

    const derived = fs.readdirSync(path.dirname(filePath));

    assert.ok(derived.includes("mapIndex_v1.json"), `expected mapIndex_v1.json in ${derived.join(", ")}`);

    await database.Close();
});

test("a system answers with its star, its nebula and a derived key light", async () =>
{
    const { database, source } = await OpenFixture();
    const map = new CjsToolMap(source);
    const system = await map.System(30000001, { expand: "all" });

    assert.equal(system.name, "Alpha");
    assert.equal(system.region.name, "Testland");
    assert.equal(system.constellation.name, "Testation");

    // .red in the SDE, .black is what we read.
    assert.equal(system.derived.scene.nebula.graphics.scene, "res:/dx9/scene/universe/t01_cube.black");

    assert.equal(system.derived.star.spectralClass, "G5 V");

    // The same shape a star answers with through /celestials/{id}, and the same
    // `.black` rewrite - one value under one name whichever route reaches it.
    assert.equal(system.derived.star.graphics.model, "res:/dx9/model/sun.black");
    assert.deepEqual(system.derived.star.position, [ 0, 0, 0 ]);
    assert.equal(system.derived.scene.sun.intensity, 1);
    assert.ok(system.derived.scene.sun.color);

    // Null means "we do not know", and that is the whole contract: nothing in
    // the SDE names a post process for a location.
    assert.equal(system.derived.scene.postProcess, null);

    assert.equal(await map.System(39999999), null);

    await database.Close();
});

test("a system's celestials arrive named, typed and with graphics flattened", async () =>
{
    const { database, source } = await OpenFixture();
    const map = new CjsToolMap(source);
    const answer = await map.SystemCelestials(30000001, { expand: "all" });

    assert.equal(answer.celestials.planet[0].derived.name.text, "Alpha IV");
    assert.equal(answer.celestials.moon[0].derived.name.text, "Alpha IV - Moon 2");
    assert.equal(answer.celestials.asteroidBelt[0].derived.name.text, "Alpha IV - Asteroid Belt 1");
    assert.equal(answer.celestials.station[0].derived.name.text, "Alpha IV - Moon 2 - CBD Corporation Storage");
    assert.equal(answer.celestials.stargate[0].derived.name.text, "Stargate (Beta)");

    // The four graphic ids a planet carries, resolved to paths in one answer
    // rather than four more requests.
    const planet = answer.celestials.planet[0];

    // `.red` in the SDE, `.black` on the wire. Emitting the SDE's own
    // string hands the consumer an address that 404s.
    assert.equal(planet.derived.graphics.model, "res:/dx9/model/planet.black");
    assert.equal(planet.derived.graphics.shaderPreset, "res:/dx9/model/worldobject/planet/preset.black");

    // Only the container extension is rewritten - a texture is already served
    // under the name the SDE gives it.
    assert.equal(planet.derived.graphics.heightMap1, "res:/dx9/model/worldobject/planet/height1.dds");
    assert.equal(planet.derived.graphics.heightMap2, "res:/dx9/model/worldobject/planet/height2.dds");

    assert.deepEqual(answer.celestials.stargate[0].derived.orientation.direction, [ 1, 0, 0 ]);
    assert.equal(answer.celestials.stargate[0].derived.orientation.rule, "faces-destination-system");

    await database.Close();
});

test("celestials carry a float32-safe position relative to what they orbit", async () =>
{
    const { database, source } = await OpenFixture();
    const map = new CjsToolMap(source);
    const answer = await map.SystemCelestials(30000001, { expand: "all" });

    // The station orbits a moon, not a planet - so re-basing it needs the moon,
    // which is exactly the case a planets-only lookup would get wrong.
    const station = answer.celestials.station[0];

    assert.deepEqual(station.derived.orbit, { id: 40000004, kind: "moon" });
    assert.deepEqual(station.derived.localPosition, [ 0, 0, 2 ]);

    const moon = answer.celestials.moon[0];

    assert.deepEqual(moon.derived.orbit, { id: 40000002, kind: "planet" });
    assert.deepEqual(moon.derived.localPosition, [ 0, 0, 1 ]);

    // The star is the system origin. The SDE omits its position entirely, so
    // supplying it is the difference between a consumer placing the sun at the
    // centre and placing it wherever its vector happens to default to.
    const star = answer.celestials.star[0];

    assert.deepEqual(star.position, [ 0, 0, 0 ]);

    // A planet orbits the star, so its parent-relative position is its
    // system-relative one. Without the origin it had no localPosition at all.
    const planet = answer.celestials.planet[0];

    assert.deepEqual(planet.derived.orbit, { id: 40000001, kind: "star" });
    assert.deepEqual(planet.derived.localPosition, planet.position);

    // Nothing to be relative to, and that is reported rather than faked: a
    // stargate has no orbitID anywhere in the SDE.
    assert.equal(answer.celestials.stargate[0].derived.orbit, null);
    assert.equal(answer.celestials.stargate[0].derived.localPosition, null);

    assert.equal(answer.frame.units, "m");
    assert.equal(answer.frame.origin, "solarSystem");
    assert.equal(answer.frame.precision.rounded, false);

    await database.Close();
});

test("filtering to stations still re-bases them onto their moons", async () =>
{
    // The trap: a caller asking only for stations gets no moons back, so a
    // naive implementation loses every station's parent and silently drops the
    // one field that makes its position usable.
    const { database, source } = await OpenFixture();
    const map = new CjsToolMap(source);
    const answer = await map.SystemCelestials(30000001, { kinds: [ "station" ], expand: "all" });

    assert.equal(answer.celestials.moon, undefined, "moons were not asked for");
    assert.deepEqual(answer.celestials.station[0].derived.orbit, { id: 40000004, kind: "moon" });
    assert.deepEqual(answer.celestials.station[0].derived.localPosition, [ 0, 0, 2 ]);

    await database.Close();
});

test("every level carries the nebula, stamped with the region it came from", async () =>
{
    // The round trip this removes: nebula lives on the region, so drawing a
    // system used to mean fetching the system, then its region, then resolving
    // a graphic id.
    const { database, source } = await OpenFixture();
    const map = new CjsToolMap(source);
    const expected = "res:/dx9/scene/universe/t01_cube.black";

    const [ regions, constellations, systems ] = await Promise.all([
        map.Regions({ expand: "all" }),
        map.RegionConstellations(10000001, { expand: "all" }),
        map.ConstellationSystems(20000001, { expand: "all" })
    ]);

    assert.equal(regions[0].derived.nebula.graphics.scene, expected);
    assert.equal(constellations[0].derived.nebula.graphics.scene, expected);
    assert.equal(systems[0].derived.nebula.graphics.scene, expected);

    const system = await map.System(30000001, { expand: "all" });
    const celestials = await map.SystemCelestials(30000001, { expand: "all" });
    const found = await map.Search("alpha", { expand: "all" });

    assert.equal(system.derived.nebula.graphics.scene, expected);
    assert.equal(system.derived.scene.nebula.graphics.scene, expected);
    assert.equal(celestials.derived.nebula.graphics.scene, expected);
    assert.equal(found.items[0].derived.nebula.graphics.scene, expected);

    // Inherited, and says so. A system does not author a backdrop, and a
    // consumer that thinks it does will build a control that cannot work.
    assert.equal(system.derived.nebula.fromRegionID, 10000001);
    assert.equal(celestials.derived.nebula.fromRegionID, 10000001);

    // The region itself is where it comes from, so it carries no `fromRegionID`.
    assert.equal(regions[0].derived.nebula.fromRegionID, undefined);

    await database.Close();
});

test("a celestial resolves by id without guessing its kind from the range", async () =>
{
    const { database, source } = await OpenFixture();
    const map = new CjsToolMap(source);

    // All four sit in the 40000000s and interleave, which is exactly why the
    // lookup probes tables instead of reading the id.
    assert.equal((await map.Celestial(40000001)).kind, "star");
    assert.equal((await map.Celestial(40000002)).kind, "planet");
    assert.equal((await map.Celestial(40000003)).kind, "asteroidBelt");
    assert.equal((await map.Celestial(40000004, { expand: "all" })).kind, "moon");
    assert.equal((await map.Celestial(60000001)).kind, "station");
    assert.equal((await map.Celestial(50000001)).kind, "stargate");
    assert.equal(await map.Celestial(1), null);

    // Named even when reached individually, where no system listing has
    // already loaded its planet.
    assert.equal((await map.Celestial(40000004, { expand: "all" })).derived.name.text, "Alpha IV - Moon 2");

    await database.Close();
});

test("search ranks the system above the things named after it", async () =>
{
    const { database, source } = await OpenFixture();
    const map = new CjsToolMap(source);
    const found = await map.Search("alpha", { expand: "all" });

    assert.equal(found.items[0].kind, "system");
    assert.equal(found.items[0].name, "Alpha");

    // Says what it can find, so a caller is never left guessing whether an
    // absent moon means no match or no coverage.
    assert.ok(found.searchable.includes("system"));
    assert.ok(!found.searchable.includes("moon"));

    const gates = await map.Search("stargate", { kinds: [ "stargate" ] });

    assert.ok(gates.items.every(item => item.kind === "stargate"));

    await database.Close();
});

test("nothing is derived unless it is asked for", async () =>
{
    const { database, source } = await OpenFixture();
    const map = new CjsToolMap(source);

    // The default answer is the SDE and only the SDE. No `derived` key at
    // all rather than an empty one, so a consumer cannot read the absence of a
    // field as the absence of the data.
    const moon = await map.Celestial(40000004);

    assert.equal(moon.derived, undefined);
    assert.equal(moon.kind, "moon");
    assert.equal(moon.orbitID, 40000002);
    assert.deepEqual(moon.position, [ 1, 2, 4 ]);

    const system = await map.System(30000001);

    assert.equal(system.derived, undefined);
    // Published, so it stays: this `name` is the SDE's own.
    assert.equal(system.name, "Alpha");
    // As does the frame, because `position` is here and means nothing without it.
    assert.equal(system.frame.units, "m");

    const bare = await map.SystemCelestials(30000001);

    assert.equal(bare.derived, undefined);
    assert.equal(bare.celestials.moon[0].derived, undefined);

    // Groups are independent, and asking for one does not drag in another.
    const named = await map.Celestial(40000004, { expand: "name" });

    assert.equal(named.derived.name.text, "Alpha IV - Moon 2");
    assert.equal(named.derived.graphics, undefined);
    assert.equal(named.derived.localPosition, undefined);

    const placed = await map.Celestial(40000004, { expand: "transform" });

    assert.deepEqual(placed.derived.localPosition, [ 0, 0, 1 ]);
    assert.equal(placed.derived.name, undefined);

    // Comma lists and `all`.
    const two = await map.Celestial(40000004, { expand: "name,graphics" });

    assert.ok(two.derived.name && two.derived.graphics);
    assert.equal(two.derived.localPosition, undefined);

    // An unknown group is ignored rather than rejected, so a caller written
    // against a later version still gets an answer from this one.
    const unknown = await map.Celestial(40000004, { expand: "name,fictional" });

    assert.ok(unknown.derived.name);

    await database.Close();
});

test("published names localise and composed names say what they invented", async () =>
{
    // The defect this pins: every component of a celestial name is published in
    // eight languages, and the first version collapsed all of them to English
    // before a consumer ever saw them. The connectives - "Moon", the " - ", the
    // roman numeral - genuinely are not in the SDE, so the honest answer is
    // English text plus the parts, never a half-translated string.
    const { database, source } = await OpenFixture();
    const map = new CjsToolMap(source);

    // Published names follow the requested language.
    assert.equal((await map.System(30000001, { language: "de", expand: "all" })).name, "Alpha-DE");
    assert.equal((await map.System(30000001, { expand: "all" })).name, "Alpha");

    // A celestial name is ours: the text, the language of its parts, and an
    // explicit statement that the joining words are English whatever was asked.
    const celestials = await map.SystemCelestials(30000001, { language: "de", expand: "all" });
    const moon = celestials.celestials.moon[0].derived.name;

    assert.equal(moon.language, "de");
    assert.equal(moon.connectives, "en");
    assert.equal(moon.text, "Alpha-DE IV - Moon 2");

    // The parts carry the whole published dictionary rather than one language,
    // so a consumer holding the client's label strings can compose any of them.
    assert.equal(moon.parts.system.ja, "アルファ");
    assert.equal(moon.parts.planetNumeral, "IV");
    assert.equal(moon.parts.orbitIndex, 2);

    // A station's corporation and operation are localised in the SDE too.
    const station = celestials.celestials.station[0].derived.name;

    assert.equal(station.parts.corporation, "CBD Konzern");
    assert.equal(station.parts.operation, "Lager");

    // An unknown code falls back rather than failing: a bad ?lang= should still
    // return the map.
    assert.equal((await map.System(30000001, { language: "xx", expand: "all" })).name, "Alpha");

    await database.Close();
});
