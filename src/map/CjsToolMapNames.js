/**
 * Celestial names, which the SDE does not carry.
 *
 * `mapPlanets`, `mapMoons`, `mapAsteroidBelts` and `npcStations` carry no name
 * field at all — not a missing localisation, no field. The game composes
 * every one of them at display time from the system's name and the celestial's
 * position in the system, and so must we:
 *
 *   planet    Jita IV
 *   moon      Jita IV - Moon 4
 *   belt      Jita IV - Asteroid Belt 1
 *   station   Jita IV - Moon 4 - Caldari Navy Assembly Plant
 *   star      Jita - Star
 *   stargate  Stargate (Perimeter)
 *
 * Two consequences worth stating, because both have bitten consumers of other
 * tooling over the same data:
 *
 * A moon's number is its `orbitIndex` within its planet, NOT its `_key` order
 * and not a system-wide counter. A planet's numeral is its `celestialIndex`,
 * which counts planets in the system. Using one where the other belongs
 * produces names that are right for the first few bodies in most systems and
 * wrong everywhere else, which is the worst possible failure mode: it survives
 * a spot check.
 *
 * These names are English. The underlying system names are localised and the
 * composition rules are not, so a localised celestial name is a larger job than
 * substituting a different system name — the rules for word order
 * differ per language. Returning an English name and saying so beats returning
 * a half-localised one.
 */

const ROMAN = Object.freeze([
    [ 1000, "M" ], [ 900, "CM" ], [ 500, "D" ], [ 400, "CD" ],
    [ 100, "C" ], [ 90, "XC" ], [ 50, "L" ], [ 40, "XL" ],
    [ 10, "X" ], [ 9, "IX" ], [ 5, "V" ], [ 4, "IV" ], [ 1, "I" ]
]);

/**
 * Roman numeral for a celestial index.
 *
 * Returns null rather than an empty string for anything outside 1..3999, so a
 * caller cannot silently build "Jita " for a body whose index is missing.
 */
export function RomanNumeral(value)
{
    const number = Number(value);

    if (!Number.isInteger(number) || number < 1 || number > 3999) return null;

    let remaining = number;
    let text = "";

    for (const [ amount, numeral ] of ROMAN)
    {
        while (remaining >= amount)
        {
            text += numeral;
            remaining -= amount;
        }
    }

    return text;
}

/**
 * Reads a name off a record whichever shape it carries.
 *
 * The SDE is not consistent about this: `mapSolarSystems.name` is a
 * localisation map, `npcCorporations.name` is a plain string, and
 * `stationOperations` calls its own field `operationName`. A single reader here
 * keeps that inconsistency from being rediscovered at each call site.
 */
export function ReadName(record, field = "name", language = "en")
{
    const value = record?.[field];

    if (typeof value === "string") return value;
    if (value && typeof value === "object") return value[language] ?? value.en ?? null;

    return null;
}

/** `Jita IV`, or the system name alone if the index is unusable. */
export function PlanetName(systemName, planet)
{
    const numeral = RomanNumeral(planet?.celestialIndex);

    return numeral ? `${systemName} ${numeral}` : systemName;
}

/** `Jita IV - Moon 4`. */
export function MoonName(systemName, planet, moon)
{
    return `${PlanetName(systemName, planet)} - Moon ${moon?.orbitIndex ?? "?"}`;
}

/** `Jita IV - Asteroid Belt 1`. */
export function AsteroidBeltName(systemName, planet, belt)
{
    return `${PlanetName(systemName, planet)} - Asteroid Belt ${belt?.orbitIndex ?? "?"}`;
}

/** `Jita - Star`. */
export function StarName(systemName)
{
    return `${systemName} - Star`;
}

/**
 * `Stargate (Perimeter)` — named for where it goes, not where it is.
 *
 * Every gate in a system is otherwise the same object, so the destination is
 * the only part of the name that carries information.
 */
export function StargateName(destinationSystemName)
{
    return destinationSystemName
        ? `Stargate (${destinationSystemName})`
        : "Stargate";
}

/**
 * `Jita IV - Moon 4 - Caldari Navy Assembly Plant`.
 *
 * `useOperationName` is the source's own flag and it is genuinely used: a
 * station with it false is named for its owner alone. Honouring it is the
 * difference between the name the game shows and a plausible-looking invention.
 *
 * @param {String} orbitName - the name of the body the station orbits
 * @param {String|null} ownerName - the owning NPC corporation
 * @param {String|null} operationName - the station operation
 * @param {Boolean} useOperationName
 */
export function StationName(orbitName, ownerName, operationName, useOperationName)
{
    const suffix = [ ownerName, useOperationName ? operationName : null ]
        .filter(Boolean)
        .join(" ");

    return suffix ? `${orbitName} - ${suffix}` : orbitName;
}
