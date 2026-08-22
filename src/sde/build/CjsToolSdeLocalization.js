/**
 * Several language tables presented as one.
 *
 * ## Why this exists
 *
 * The client ships a label table per language - `localization_fsd_en-us.pickle`,
 * `_zh.pickle`, and eight others - and the export publishes one object per
 * label keyed by language: `{ "en": "Viator", "zh": "旅行者级" }`. The
 * projections take a single table and a single language, which produced an
 * export with Chinese and nothing else, and that single fact is what made every
 * NetEase type unnameable in English downstream.
 *
 * Rather than thread a list of languages through three projection modules, this
 * presents the whole set as one table. `Get` and `GetNormalized` answer in the
 * primary language so nothing that only wants a string has to change;
 * `GetLanguages` returns the full object for a projection that can use it.
 *
 * ## The primary language is English, deliberately
 *
 * English is the language every consumer can be expected to read and the one
 * the rest of the organization's tooling assumes when it has to pick. Chinese
 * is kept beside it rather than replaced: it is the name the local client
 * actually shows, and it is also the evidence that a type on this server is the
 * same type as CCP's - the two publishers' Chinese agreeing is what proves an
 * ID means the same thing on both.
 */

/** Language keys the export uses, mapped to the file name that carries them. */
export const CJS_LOCALIZATION_FILES = Object.freeze({
    de: "de",
    en: "en-us",
    es: "es",
    fr: "fr",
    it: "it",
    ja: "ja",
    ko: "ko",
    ru: "ru",
    zh: "zh"
});

/**
 * What a build carries when nothing is asked for.
 *
 * English so that every type is nameable, Chinese because it is what the client
 * displays and what corroborates the type identity. The other seven are
 * available and cost roughly 8 MB each to fetch, but nothing consumes them yet
 * and an unused translation in every row is not free either.
 */
export const CJS_DEFAULT_LANGUAGES = Object.freeze([ "en", "zh" ]);

/**
 * Builds deterministic localized values across configured language fallback
 * chains.
 */
export class CjsToolSdeLocalization
{

    #tables;

    #primary;

    /**
     * @param {Array<[string, object]>} tables language key and its table, in
     *   priority order; the first is primary.
     */
    constructor(tables)
    {
        const entries = [ ...tables ];

        if (!entries.length) throw new TypeError("At least one localisation table is required");

        this.#tables = entries;
        this.#primary = entries[0][1];
        this.languages = Object.freeze(entries.map(([ language ]) => language));
    }

    /** Labels in the primary table, for reporting. */
    get size()
    {
        return this.#primary.size;
    }

    /** The primary language's text, for a caller that wants one string. */
    Get(labelId)
    {
        return this.#primary.Get(labelId);
    }

    /** The primary language's normalized text. */
    GetNormalized(labelId)
    {
        return typeof this.#primary.GetNormalized === "function"
            ? this.#primary.GetNormalized(labelId)
            : this.#primary.Get(labelId);
    }

    /**
     * Every language that has text for this label.
     *
     * A language missing a label is omitted rather than carried as an empty
     * string: the export omits absent labels entirely, and an empty string
     * claims a translation exists and happens to be blank.
     */
    GetLanguages(labelId)
    {
        if (labelId === null || labelId === undefined) return undefined;

        const result = {};

        for (const [ language, table ] of this.#tables)
        {
            const text = typeof table.GetNormalized === "function"
                ? table.GetNormalized(labelId)
                : table.Get(labelId);

            if (text !== null && text !== undefined && text !== "") result[language] = text;
        }

        return Object.keys(result).length ? result : undefined;
    }

}
