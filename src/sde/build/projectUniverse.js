/**
  * Projects the nested solar-system content container into the export's flat
  * celestial tables.
  *
  * This one gets its own module rather than a spec. The other tables are a field
  * list applied to records that already sit one per row; this container is a tree
  * — system, then planets, then moons and asteroid belts beneath each planet —
  * and the export publishes it as six flat tables whose keys, parents and sibling
  * indices are all implied by position in that tree rather than stored.
  *
  * Six tables and roughly 477,000 rows come out of here, which is about 70% of
  * everything CCP's export publishes.
  */
import { NormalizeLabelText } from "./projectTypes.js";

/**
  * Every row carries `_key`, the same identifier its table is keyed by.
  *
  * It looks redundant and is not: the archive reader takes a record's identity
  * from this field and throws "record does not define _key" without it, and
  * `ProjectRecords` puts one on every row it builds for the same reason. Two of
  * the six tables here had it and four did not, which is exactly the kind of
  * inconsistency a field-by-field diff against the export misses when the
  * comparison skips the key.
  */

/** Statistics the client keeps and the export does not publish for a celestial. */
const DROPPED_STATISTICS = new Set([ "fragmented", "life", "radius" ]);

/** Statistics an asteroid belt does not publish, on top of those. */
const DROPPED_BELT_STATISTICS = new Set([ ...DROPPED_STATISTICS, "pressure" ]);

/**
  * Statistics the export omits when they are zero rather than publishing a zero.
  *
  * The test is on the ROUNDED value, and that distinction is the whole of it.
  * 49 planets carry a `surfaceGravity` and 335 belts a `massGas` that are not
  * zero in the file — they are around 1e-7 — and the export omits them anyway,
  * because six decimal places makes them zero. Re-derive this rule from raw
  * values and you find 384 counterexamples and conclude it is broken.
  *
  * Measured across all 68,407 planets, 344,457 moons and 40,928 belts. The other
  * statistics do the opposite: `eccentricity`, `pressure` and `rotationRate`
  * publish thousands of real zeros, so this is per-field and not a general rule.
  */
const OMIT_WHEN_ZERO = new Set([ "massGas", "orbitPeriod", "orbitRadius", "surfaceGravity" ]);

/** The export's own key order for a statistics block, which is alphabetical. */
const StatisticsOrder = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
  * Rounds a widened single to the six decimal places the export publishes.
  *
  * Identical in rule and reason to the projector's own rounding: a float32
  * widened to a double gains digits it never had, and `escapeVelocity` reads
  * 9214.15234375 here against the export's 9214.152344.
  */
function RoundSingle(value)
{
    const number = Number(value);

    return Number.isFinite(number) ? Number(number.toFixed(6)) : number;
}

/** Copies a statistics block into the export's shape, dropping and rounding. */
function ProjectStatistics(statistics, dropped = DROPPED_STATISTICS)
{
    if (!statistics || typeof statistics !== "object") return undefined;

    const result = {};

    for (const key of Object.keys(statistics).sort(StatisticsOrder))
    {
        if (dropped.has(key)) continue;

        const value = typeof statistics[key] === "number" ? RoundSingle(statistics[key]) : statistics[key];

        if (OMIT_WHEN_ZERO.has(key) && value === 0) continue;

        result[key] = value;
    }

    return result;
}

/**
  * Rounds a position's components the way the export publishes them.
  *
  * Six decimal places, the same rule as everything else here. Without it about
  * one celestial in ten differs in its last digit or two — enough to look like a
  * decoding fault rather than a formatting one.
  */
function ProjectPosition(position)
{
    if (!position || typeof position !== "object") return undefined;

    const result = {};

    for (const key of Object.keys(position)) result[key] = RoundSingle(position[key]);

    return result;
}

/** Copies an attribute bag in the export's key order, which is alphabetical. */
function ProjectAttributes(attributes, dropped = [])
{
    if (!attributes || typeof attributes !== "object") return undefined;

    const result = {};

    for (const key of Object.keys(attributes).sort(StatisticsOrder))
    {
        if (!dropped.includes(key)) result[key] = attributes[key];
    }

    return result;
}

/** Resolves a label identifier into the export's per-language object. */
function ProjectLabel(localization, labelId, language)
{
    if (labelId === null || labelId === undefined || !localization) return undefined;

    // A table carrying several languages answers for all of them at once.
    // Without this the export would publish whichever single language the
    // build was run with, which is how the NetEase exports ended up with
    // Chinese and no English.
    if (typeof localization.GetLanguages === "function") return localization.GetLanguages(labelId);


    const text = typeof localization.GetNormalized === "function"
        ? localization.GetNormalized(labelId)
        : NormalizeLabelText(localization.Get(labelId));

    return text === null || text === undefined ? undefined : { [language]: text };
}

/**
  * Assigns a value only when the export would publish one.
  *
  * The exporter's editorial rules, the same ones every other table here follows:
  * an empty list and an empty string are omitted rather than published empty,
  * because saying nothing is how it makes that statement.
  */
function Assign(row, key, value)
{
    if (value === undefined || value === null || value === "") return row;
    if (Array.isArray(value) && !value.length) return row;

    row[key] = value;

    return row;
}

/**
  * Projects one client's solar-system content into the export's celestial tables.
  *
  * @param {object} systems Decoded `solarsystemcontent` records, keyed by system.
  * @param {object} [options] Projection options.
  * @param {object} [options.localization] Localisation table exposing `Get`.
  * @param {string} [options.language] Language key.
  * @returns {object} The six tables, plus the solar-system columns this container
  *   supplies that the `systems` container does not.
  */
export function ProjectUniverse(systems, options = {})
{
    if (!systems || typeof systems !== "object")
    {
        throw new TypeError("Universe projection requires decoded solar system content.");
    }

    const language = options.language ?? "en";
    const localization = options.localization ?? null;
    const label = id => ProjectLabel(localization, id, language);

    const mapPlanets = {};
    const mapMoons = {};
    const mapAsteroidBelts = {};
    const mapStars = {};
    const mapStargates = {};
    const mapSecondarySuns = {};
    const solarSystemColumns = {};
    // A stargate stores only the identifier of the gate it reaches; the export
    // publishes the system as well. Nothing in a single system's record says which
    // system that is, so the whole set is indexed first.
    const gateSystems = new Map();

    for (const [ key, system ] of Object.entries(systems))
    {
        for (const gate of Object.keys(system.stargates ?? {})) gateSystems.set(Number(gate), Number(key));
    }

    for (const [ key, system ] of Object.entries(systems))
    {
        const solarSystemID = Number(key);

        solarSystemColumns[key] = ProjectSolarSystem(system, label);

        if (system.star)
        {
            mapStars[system.star.id] = ProjectStar(system.star, solarSystemID);
        }

        if (system.secondarySun)
        {
            mapSecondarySuns[system.secondarySun.itemID] = ProjectSecondarySun(system.secondarySun, solarSystemID);
        }

        for (const [ gateKey, gate ] of Object.entries(system.stargates ?? {}))
        {
            mapStargates[gateKey] = ProjectStargate(gateKey, gate, solarSystemID, gateSystems);
        }

        // A planet orbits its system's star, and the export says so on every row
        // even though the container leaves it implied.
        const starID = system.star ? Number(system.star.id) : undefined;

        for (const [ planetKey, planet ] of Object.entries(system.planets ?? {}))
        {
            mapPlanets[planetKey] = ProjectPlanet(planetKey, planet, solarSystemID, starID, label);

            // `orbitIndex` is NOT emitted. The export publishes it on every moon and
            // belt and nothing in this container reproduces it: neither identifier
            // order nor orbital radius matches, and the two orderings are identical to
            // each other, so the file does not hold whatever CCP sorted by. Identifier
            // order would be right for 99.9% of moons and only 83% of belts, and a
            // column that is quietly wrong on 7,400 rows is worse than one that is
            // absent. Do not re-derive this without a new input.
            for (const [ moonKey, moon ] of Object.entries(planet.moons ?? {}))
            {
                mapMoons[moonKey] = ProjectMoon(moonKey, moon, planet, solarSystemID, label);
            }

            for (const [ beltKey, belt ] of Object.entries(planet.asteroidBelts ?? {}))
            {
                mapAsteroidBelts[beltKey] = ProjectAsteroidBelt(beltKey, belt, planet, planetKey, solarSystemID, label);
            }

            // The schema allows a belt beneath a MOON as well as beneath a planet.
            // No build has ever populated one, so this walks zero rows today - but a
            // reader that only looks under planets would lose them silently if one
            // ever appeared, and the export's belt row already carries the orbitID
            // that would express it.
            for (const [ moonKey, moon ] of Object.entries(planet.moons ?? {}))
            {
                for (const [ beltKey, belt ] of Object.entries(moon.asteroidBelts ?? {}))
                {
                    mapAsteroidBelts[beltKey] = ProjectAsteroidBelt(beltKey, belt, planet, moonKey, solarSystemID, label);
                }
            }
        }
    }

    return {
        mapPlanets,
        mapMoons,
        mapAsteroidBelts,
        mapStars,
        mapStargates,
        mapSecondarySuns,
        solarSystemColumns
    };
}

/** The system columns this container supplies and the `systems` one does not. */
function ProjectSolarSystem(system, label)
{
    const row = {};

    // The six topology flags. They are stored, not computed - a jump-graph rule
    // reproduces at best 8,315 of 8,490 - and this is the file that stores them.
    for (const flag of [ "border", "corridor", "fringe", "hub", "international", "regional" ])
    {
        if (system[flag] === true) row[flag] = true;
    }

    // A star's luminosity, published only where there is one to publish. 3,006
    // systems carry a zero, and the export says nothing for those.
    const luminosity = system.luminosity === undefined ? undefined : RoundSingle(system.luminosity);

    Assign(row, "luminosity", luminosity === 0 ? undefined : luminosity);
    Assign(row, "radius", system.radius);
    Assign(row, "factionID", system.factionID);
    Assign(row, "visualEffect", system.visualEffect);
    Assign(row, "starID", system.star ? Number(system.star.id) : undefined);
    Assign(row, "disallowedAnchorCategories", system.disallowedAnchorCategories);
    Assign(row, "disallowedAnchorGroups", system.disallowedAnchorGroups);

    // planetIDs and stargateIDs are deliberately NOT emitted here. The systems
    // container supplies both and reproduces them exactly, and two sources for one
    // column is how orderings quietly diverge.
    return row;
}

/**
  * A star, whose statistics keep `life` where a planet's do not.
  *
  * **Do not unify this loop with `ProjectStatistics`.** The two drop sets are
  * near-inverses: a star drops `locked` and `radius` and keeps `life`, and every
  * other celestial does the reverse. Sharing the code would publish `locked` on
  * all 8,089 stars and drop the `life` the export carries. Verified against the
  * export: those five fields, on every star, no exceptions.
  */
function ProjectStar(star, solarSystemID)
{
    const statistics = {};

    for (const key of Object.keys(star.statistics ?? {}).sort(StatisticsOrder))
    {
        // A star publishes `life` and not `locked` or `radius` - the opposite
        // selection to every other celestial, so it is spelled out rather than
        // sharing the general rule.
        if (key === "locked" || key === "radius") continue;

        const value = star.statistics[key];

        statistics[key] = typeof value === "number" ? RoundSingle(value) : value;
    }

    return {
        _key: Number(star.id),
        radius: star.radius,
        solarSystemID,
        statistics,
        typeID: star.typeID
    };
}

/** A stargate, whose destination gains the system the far gate sits in. */
function ProjectStargate(key, gate, solarSystemID, gateSystems)
{
    const stargateID = Number(gate.destination);
    const row = {
        _key: Number(key),
        destination: { solarSystemID: gateSystems.get(stargateID), stargateID },
        position: ProjectPosition(gate.position),
        solarSystemID,
        typeID: gate.typeID
    };

    if (row.destination.solarSystemID === undefined) delete row.destination.solarSystemID;

    return row;
}

/** A secondary sun, which carries its own item identifier rather than a key. */
function ProjectSecondarySun(sun, solarSystemID)
{
    return {
        _key: Number(sun.itemID),
        effectBeaconTypeID: sun.effectBeaconTypeID,
        position: ProjectPosition(sun.position),
        solarSystemID,
        typeID: sun.typeID
    };
}

/** A planet, which owns the moons and belts flattened out from beneath it. */
function ProjectPlanet(key, planet, solarSystemID, starID, label)
{
    const row = { _key: Number(key) };

    Assign(row, "asteroidBeltIDs", Keys(planet.asteroidBelts));
    Assign(row, "attributes", ProjectAttributes(planet.planetAttributes));
    Assign(row, "celestialIndex", planet.celestialIndex);
    Assign(row, "moonIDs", Keys(planet.moons));
    Assign(row, "npcStationIDs", Keys(planet.npcStations));
    Assign(row, "orbitID", starID);
    Assign(row, "position", ProjectPosition(planet.position));
    Assign(row, "radius", planet.radius);
    Assign(row, "solarSystemID", solarSystemID);
    Assign(row, "statistics", ProjectStatistics(planet.statistics));
    Assign(row, "typeID", planet.typeID);
    Assign(row, "uniqueName", label(planet.planetNameID));

    return row;
}

/** A moon, whose attributes drop the population flag a planet's keep. */
function ProjectMoon(key, moon, planet, solarSystemID, label)
{
    const row = { _key: Number(key) };

    // A moon's attribute bag drops the population flag a planet's keeps.
    Assign(row, "attributes", ProjectAttributes(moon.planetAttributes, [ "population" ]));
    Assign(row, "celestialIndex", planet.celestialIndex);
    Assign(row, "npcStationIDs", Keys(moon.npcStations));
    Assign(row, "orbitID", moon.orbitID);
    Assign(row, "position", ProjectPosition(moon.position));
    Assign(row, "radius", moon.radius);
    Assign(row, "solarSystemID", solarSystemID);
    Assign(row, "statistics", ProjectStatistics(moon.statistics));
    Assign(row, "typeID", moon.typeID);
    Assign(row, "uniqueName", label(moon.moonNameID));

    return row;
}

/** A belt, which carries no radius of its own - its statistics hold it. */
function ProjectAsteroidBelt(key, belt, planet, planetKey, solarSystemID, label)
{
    const row = { _key: Number(key) };

    Assign(row, "celestialIndex", planet.celestialIndex);
    Assign(row, "orbitID", Number(planetKey));
    Assign(row, "position", ProjectPosition(belt.position));
    Assign(row, "radius", belt.statistics ? RoundSingle(belt.statistics.radius) : undefined);
    Assign(row, "solarSystemID", solarSystemID);
    Assign(row, "statistics", ProjectStatistics(belt.statistics, DROPPED_BELT_STATISTICS));
    Assign(row, "typeID", belt.typeID);
    Assign(row, "uniqueName", label(belt.asteroidBeltNameID));

    return row;
}

/** Returns a nested map's keys as identifiers, or nothing when it is empty. */
function Keys(value)
{
    if (!value || typeof value !== "object") return undefined;

    const keys = Object.keys(value).map(Number);

    return keys.length ? keys : undefined;
}

export default ProjectUniverse;
