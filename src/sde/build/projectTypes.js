/**
 * Projects decoded `types.fsdbinary` records into the export's row shape.
 *
 * The client stores `nameID` and `descriptionID`; the official export publishes
 * `name` and `description` as objects keyed by language. This module joins the
 * two, and it takes the localisation table as an argument rather than reading
 * one, so the target profile decides which
 * language table it loaded — the same call `CjsStaticFormat` makes about a
 * SQLite driver.
 */

/** Language the export keys English under. Not `en-us`, which is the file name. */
export const CJS_DEFAULT_LANGUAGE = "en";

/**
 * Fields the client record stores and the export republishes unchanged.
 *
 * `packagedVolume` and `isRepackable` are deliberately absent: the export
 * publishes both, the record stores neither, and they appear to be derived by
 * the exporter. Emitting a guess would be worse than omitting a field, because
 * a consumer cannot tell a guess from a measurement.
 */
const COPIED_FIELDS = Object.freeze([
    "basePrice", "capacity", "factionID", "graphicID", "groupID", "iconID",
    "marketGroupID", "mass", "metaGroupID", "metaLevel", "portionSize", "published",
    "raceID", "radius", "shipTreeGroupID", "soundID", "techLevel", "volume",
    "variationParentTypeID", "isDynamicType"
]);

/**
 * Identifiers the FSD reader returns as identifier strings.
 *
 * `UINT_32_IDENTIFIER` decodes to a string because an identifier is a key, not
 * a quantity. The export publishes them as numbers, so the conversion belongs
 * here rather than in the reader, which is describing the file correctly.
 */
const IDENTIFIER_FIELDS = new Set([
    "factionID", "graphicID", "groupID", "iconID", "marketGroupID", "metaGroupID",
    "raceID", "shipTreeGroupID", "soundID", "variationParentTypeID"
]);

/**
 * Numeric fields the record stores unconditionally.
 *
 * These carry no presence bit, so zero is stored rather than absent, and the
 * export omits them when they are zero. The presence-guarded fields are the
 * opposite case and must NOT be dropped on value: `metaLevel` is published as
 * `0` whenever its bit is set, because there the bit is the fact and the value
 * is just the value.
 */
const OMIT_WHEN_ZERO = new Set([ "basePrice", "capacity", "mass", "radius", "volume" ]);

/**
 * Resolves one label into the export's per-language object.
 *
 * The label table carries trailing whitespace on a small number of entries -
 * fifteen of 52,863 English names at build 3466501 - and the official export
 * trims it. The client data is not wrong and neither is the reader; trimming
 * belongs here, at the point where the export's shape is being reproduced.
 *
 * @param {object} localization Anything exposing `Get(labelId)`.
 * @param {number|null|undefined} labelId Label identifier.
 * @param {string} language Language key.
 * @returns {object|undefined} Per-language object, or undefined when unresolved.
 */
/**
 * Normalises label text the way CCP's exporter does.
 *
 * The client stores CRLF and carries trailing whitespace on a handful of
 * entries; the export publishes LF and trims. Measured at build 3466501:
 * 16,125 of 34,299 English descriptions differ by line endings alone, and
 * fifteen names by a trailing space.
 *
 * **Exported because joins need the same key.** English names are used to join
 * records that are grouped without an identifier relationship, so a join that
 * normalised differently - or not at all - would silently miss those rows.
 * Deriving the key any other way reintroduces the bug this removes.
 *
 * @param {string|null|undefined} text Raw label text.
 * @returns {string|null} Normalised text, or null when absent or blank.
 */
export function NormalizeLabelText(text)
{
    if (text === null || text === undefined) return null;

    const normalized = String(text).replace(/\r\n/gu, "\n").trim();

    return normalized === "" ? null : normalized;
}

/**
 * Resolves and normalises one label.
 *
 * Prefers the table's own `GetNormalized` when it offers one, so a table that
 * owns the rule stays the single definition of it; the local fallback exists
 * because the table is injected and only `Get` is required of it.
 *
 * @param {object} localization Localisation table.
 * @param {number|null|undefined} labelId Label identifier.
 * @param {string} language Language key.
 * @returns {object|undefined} Per-language object, or undefined when unresolved.
 */
function ProjectLabel(localization, labelId, language)
{
    if (labelId === null || labelId === undefined) return undefined;

    // A table carrying several languages answers for all of them at once.
    // Without this the export would publish whichever single language the
    // build was run with, which is how the NetEase exports ended up with
    // Chinese and no English.
    if (typeof localization.GetLanguages === "function") return localization.GetLanguages(labelId);


    if (typeof localization.GetNormalized === "function")
    {
        const owned = localization.GetNormalized(labelId);

        return owned === null || owned === undefined ? undefined : { [language]: owned };
    }

    const normalized = NormalizeLabelText(localization.Get(labelId));

    // A label that resolves to nothing is not a label. The export omits these
    // - 377 of 52,863 types at build 3466501 - and emitting an empty string
    // would claim the type has a description that happens to be blank.
    return normalized === null ? undefined : { [language]: normalized };
}

/**
 * Projects decoded type records into export rows.
 *
 * @param {object} records Decoded records keyed by type identifier.
 * @param {object} localization Localisation table exposing `Get(labelId)`.
 * @param {object} [options] Projection options.
 * @param {string} [options.language] Language key, defaulting to English.
 * @returns {object} Export-shaped rows keyed by type identifier.
 */
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

/** Projects decoded type rows into stable public SDE type records. */
export function ProjectTypes(records, localization, options = {})
{
    if (!records || typeof records !== "object")
    {
        throw new TypeError("Type projection requires decoded type records.");
    }

    if (!localization || typeof localization.Get !== "function")
    {
        throw new TypeError("Type projection requires a localisation table exposing Get(labelId).");
    }

    const language = options.language ?? CJS_DEFAULT_LANGUAGE;
    const rows = {};

    for (const [ key, record ] of Object.entries(records))
    {
        const row = { _key: Number(key) };

        for (const field of COPIED_FIELDS)
        {
            const value = record[field];

            if (value === undefined || value === null) continue;

            if (IDENTIFIER_FIELDS.has(field))
            {
                row[field] = Number(value);
                continue;
            }

            if (OMIT_WHEN_ZERO.has(field) && value === 0) continue;

            // Emitted only when true, matching the export: at build 3466501
            // exactly 89 of 52,863 types are dynamic, and the export says
            // nothing at all about the rest.
            if (field === "isDynamicType" && value !== true) continue;

            row[field] = value;
        }

        const name = ProjectLabel(localization, record.nameID, language);
        const description = ProjectLabel(localization, record.descriptionID, language);

        if (name) row.name = name;
        if (description) row.description = description;

        // Three fields CCP does not publish. They are real client data and this
        // export is not obliged to match an omission, but they are additions, so
        // a consumer diffing against the official export will see them.
        //
        // manufacturers stays identifiers because it is genuinely many-to-one:
        // many types name corporation 1000109, and the identifier IS the join
        // key into npcCorporations. The quote pair resolves to text for the
        // opposite reason - all 434 types carry their OWN label, no identifier
        // is shared by two types, and 80 author strings appear under several
        // different identifiers. Keeping those ids would preserve nothing and
        // offer a join that groups nothing.
        if (record.manufacturers?.length)
        {
            row.manufacturers = record.manufacturers.map(Number);
        }

        const quote = ProjectLabel(localization, record.quoteID, language);
        const quoteAuthor = ProjectLabel(localization, record.quoteAuthorID, language);

        if (quote) row.quote = quote;
        if (quoteAuthor) row.quoteAuthor = quoteAuthor;

        rows[key] = SortRowKeys(row);
    }

    return rows;
}

export default ProjectTypes;
