/**
 * Builds the type fields the client stores and CCP's published export omits.
 *
 * `types.fsdbinary` carries three of them: the NPC corporations that manufacture
 * a type, and the show-info flavour quote with its attribution. An **acquired**
 * export cannot gain these by re-preparing, because CCP never published them -
 * they are only ever read out of the client, which is what this package does.
 *
 * This is deliberately a pure function of decoded records. It fetches nothing,
 * resolves no provider or build, and writes no file, so it keeps the promise the
 * readers make: caller-supplied bytes only. Whoever has the bytes calls it and
 * decides where the result goes.
 *
 * The two shapes differ on purpose:
 *
 * - `manufacturers` stays a list of **identifiers**, because it is genuinely
 *   many-to-one. Many types name corporation 1000109, and that identifier is the
 *   join key into `npcCorporations`; resolving it to "Duvolle Laboratories" here
 *   would throw the join away.
 * - `quote` and `quoteAuthor` resolve to **text**, because their identifiers
 *   join nothing. All 434 types that carry a quote carry their own label, no
 *   identifier is shared by two types, and 80 author strings appear under
 *   several different identifiers - so keeping the ids would preserve no
 *   structure while offering a join that groups wrongly.
 */

/**
 * @param {object} types Decoded `types.fsdbinary` records, keyed by type.
 * @param {object} localization Anything exposing `Get(labelId)`; a
 *   `CjsFsdLocalization` is the usual one.
 * @param {object} [options] Build options.
 * @param {string} [options.language] Language key for resolved text, `en` by
 *   default. It names the key in the published object, not the table that was
 *   loaded - the caller chose that when it read the bytes.
 * @returns {object} `{ types }`, holding only the types that carry something.
 */
export function BuildTypeExtras(types, localization, options = {})
{
    if (!types || typeof types !== "object")
    {
        throw new TypeError("Type extras require decoded type records.");
    }

    if (!localization || typeof localization.Get !== "function")
    {
        throw new TypeError("Type extras require a localisation table exposing Get(labelId).");
    }

    const language = options.language ?? "en";
    const Label = (id) =>
    {
        const text = id ? localization.Get(id) : null;

        return text === null || text === undefined ? undefined : { [language]: text };
    };

    const records = {};

    for (const [ key, record ] of Object.entries(types))
    {
        const entry = {};

        if (record.manufacturers?.length) entry.manufacturers = record.manufacturers.map(Number);

        const quote = Label(record.quoteID);
        const quoteAuthor = Label(record.quoteAuthorID);

        if (quote) entry.quote = quote;
        if (quoteAuthor) entry.quoteAuthor = quoteAuthor;

        // Only types that have something. A row per type with nothing in it
        // would be a hundred times the weight for no information.
        if (Object.keys(entry).length) records[key] = entry;
    }

    return { types: records };
}

export default BuildTypeExtras;
