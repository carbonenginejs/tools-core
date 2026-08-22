/**
 * Projects decoded `graphicmaterialsets.fsdbinary` records into export rows.
 *
 * This is the table a skin's materials actually live in. `skinMaterialID`
 * resolves to a `skinMaterials` row, whose `materialSetID` is a key **into this
 * table** — all 863 resolve at build 3466501 — and the row supplies the mesh
 * materials, the pattern names and the resource-path insert that compose a SOF
 * DNA string. The separately named `materialSets` export table is not a second
 * source for any of that: no such dataset ships in any client index, and CCP's
 * own export publishes it with zero rows.
 */

/** Colour channels, in the order the container stores them. */
const CHANNELS = Object.freeze([ "r", "g", "b", "a" ]);

/** Colour fields the export rounds. */
const COLOR_FIELDS = Object.freeze([ "colorHull", "colorPrimary", "colorSecondary", "colorWindow" ]);

/**
 * Decimal places the exporter rounds colour components to.
 *
 * Measured, not guessed: at 6 places all 14,736 published components match
 * exactly and none are off, while 5 and 7 each miss more than half. The
 * container stores float32, so `0.0941176488995552` is published as
 * `0.094118`.
 */
const COLOR_PRECISION = 6;

/** Text fields copied through when present. */
const TEXT_FIELDS = Object.freeze([
    "description", "custommaterial1", "custommaterial2",
    "material1", "material2", "material3", "material4",
    "resPathInsert", "sofFactionName", "sofPatternName", "sofRaceHint"
]);

/**
 * Rounds one colour to the precision the export publishes.
 *
 * @param {object} color Decoded colour.
 * @returns {object|undefined} Rounded colour, or undefined when absent.
 */
function ProjectColor(color)
{
    if (!color || typeof color !== "object") return undefined;

    const projected = {};

    for (const channel of CHANNELS)
    {
        const value = Number(color[channel]);

        if (!Number.isFinite(value)) return undefined;

        projected[channel] = Number(value.toFixed(COLOR_PRECISION));
    }

    return projected;
}

/**
 * Projects decoded material-set records into export rows.
 *
 * @param {object} records Decoded records keyed by material-set identifier.
 * @returns {object} Export-shaped rows keyed by material-set identifier.
 */
export function ProjectGraphicMaterialSets(records)
{
    if (!records || typeof records !== "object")
    {
        throw new TypeError("Material-set projection requires decoded material-set records.");
    }

    const rows = {};

    for (const [ key, record ] of Object.entries(records))
    {
        const row = { _key: Number(key) };

        // Presence is authoritative here, and emptiness is not a proxy for it.
        // This record carries a presence word, so the reader already omits what
        // the container calls absent - and the export agrees exactly: across all
        // 939 rows there is no field the export publishes that the reader lacks,
        // or vice versa. Sixteen rows publish a *present but empty* sofRaceHint
        // or resPathInsert, which filtering on emptiness would silently drop.
        //
        // graphicIDs is the opposite case and its projection filters, because
        // that record has no presence word and an empty string is the only way
        // it can say "absent".
        for (const field of TEXT_FIELDS)
        {
            const value = record[field];

            if (typeof value !== "string") continue;

            row[field] = value;
        }

        for (const field of COLOR_FIELDS)
        {
            const color = ProjectColor(record[field]);

            if (color !== undefined) row[field] = color;
        }

        rows[key] = row;
    }

    return rows;
}

export default ProjectGraphicMaterialSets;
