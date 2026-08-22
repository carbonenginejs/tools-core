/**
 * Projects decoded `graphicids.fsdbinary` records into the export's row shape.
 *
 * The client stores every field on every record and uses an empty string, an
 * empty list or a zero identifier to mean "absent"; the export omits them
 * instead. Emitting the empties would not be wrong so much as unanswerable — a
 * consumer cannot tell a `sofHullName` of `""` from a hull that was never set,
 * which is exactly the distinction the export preserves by leaving the key out.
 */

/** Identifiers the reader returns as identifier strings; the export publishes numbers. */
const IDENTIFIER_FIELDS = new Set([ "sofMaterialSetID" ]);

/** Fields copied straight through when present and non-empty. */
const COPIED_FIELDS = Object.freeze([
    "graphicFile", "iconFolder", "sofFactionName", "sofHullName",
    "sofLayout", "sofMaterialSetID", "sofRaceName"
]);

/**
 * Reports whether a decoded value is the container's way of saying "absent".
 *
 * @param {*} value Decoded value.
 * @returns {boolean} True when the value carries nothing.
 */
function IsAbsent(value)
{
    if (value === undefined || value === null) return true;
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "number") return value === 0;

    return false;
}

/**
 * Projects decoded graphic records into export rows.
 *
 * @param {object} records Decoded records keyed by graphic identifier.
 * @returns {object} Export-shaped rows keyed by graphic identifier.
 */
export function ProjectGraphics(records)
{
    if (!records || typeof records !== "object")
    {
        throw new TypeError("Graphic projection requires decoded graphic records.");
    }

    const rows = {};

    for (const [ key, record ] of Object.entries(records))
    {
        const row = { _key: Number(key) };

        for (const field of COPIED_FIELDS)
        {
            const value = record[field];

            if (IsAbsent(value)) continue;

            if (IDENTIFIER_FIELDS.has(field))
            {
                const identifier = Number(value);

                // A zero identifier is absence, not a reference to graphic 0.
                if (identifier !== 0) row[field] = identifier;
                continue;
            }

            row[field] = Array.isArray(value) ? [ ...value ] : value;
        }

        rows[key] = row;
    }

    return rows;
}

export default ProjectGraphics;
