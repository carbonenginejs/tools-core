/**
 * English names for targets whose data source does not carry them.
 *
 * ## The problem
 *
 * Some targets are named in one language only, so a consumer reading `name.en`
 * finds every type nameless. This supplies the missing half without inventing
 * it.
 *
 * ## How a name is arrived at
 *
 * By type ID, corroborated rather than assumed. A shared ID is only trusted
 * when the two records agree structurally - `groupID` and `mass` - and the
 * disagreements are refused rather than guessed at, because a structural
 * mismatch is the only signal available that an ID may have been reused for a
 * different object.
 *
 * Where both records carry the same language, matching text there is stronger
 * corroboration again: two sources naming one ID identically did not arrive at
 * it by inference. `evidence` reports which of these held for each answer, so a
 * consumer can tell a corroborated name from a merely plausible one.
 *
 * Some names differ between sources for the same object. The object is the same
 * and the English name is still correct, but a consumer is told, because showing
 * a renamed item under the other name without saying so misrepresents it.
 *
 * ## The gap this cannot close
 *
 * Some types appear in one source only, so no English exists to find. Those come
 * from `MANUAL_NAMES`, a hand-written file, and until someone writes one the
 * answer is an honest `null` with the name that does exist beside it.
 * `bin/cjs-localisation-gaps.js` lists what is missing.
 */

/** How an English name was arrived at. */
export const NAME_SOURCES = Object.freeze({
    /** The source itself carried `en`. */
    published: "published",
    /** Taken from a reference source for the same type ID. */
    crosswalk: "crosswalk",
    /** Written by hand, because no source has an English name for this type. */
    manual: "manual",
    /**
     * Machine-composed from a reference source's own translations. A guess, and the lowest
     * authority here: it loses to every other source, including a hand-written
     * name for the same type.
     */
    ai: "ai"
});

/** What corroborates a crosswalked name. */
export const NAME_EVIDENCE = Object.freeze({
    /** Both sources name this ID identically in the shared language. */
    chineseIdentical: "chinese-identical",
    /** Same ID and same structure, but the target renames it locally. */
    localRename: "local-rename",
    /** Shared ID, and neither source carries the shared language to compare. */
    idOnly: "id-only"
});

/**
 * Corroborates missing English type names across structurally matching target
 * records.
 */
export class CjsToolLocalisation
{

    #source;

    #reference;

    #manual;

    #guesses;

    #crosswalk;

    /**
     * @param source     the source being served
     * @param reference  an English-carrying source to cross-reference, or null
     * @param manual     hand-written names by type ID, or null
     * @param guesses    machine-composed names by type ID, or null
     */
    constructor(source, { reference = null, manual = null, guesses = null } = {})
    {
        this.#source = source;
        this.#reference = reference;
        this.#manual = manual ?? new Map();
        this.#guesses = guesses ?? new Map();
        this.#crosswalk = null;
    }

    /** Whether this source can answer in English at all, and from where. */
    Describe()
    {
        return {
            target: this.#source.target,
            build: this.#source.build,
            reference: this.#reference
                ? { target: this.#reference.target, build: this.#reference.build }
                : null,
            manualNames: this.#manual.size
        };
    }

    /**
     * The English name for a type, with its provenance.
     *
     * `published` is returned untouched when the source has it, so this costs
     * nothing on a source that carries English. Returns null only when no
     * English name exists anywhere, which is a real answer and not an error.
     */
    async English(typeID, record = null, { allowGuess = true } = {})
    {
        const id = Number(typeID);
        const local = record ?? await this.#Row(this.#source, id);
        const published = local?.name?.en;

        if (published)
        {
            return { text: published, source: NAME_SOURCES.published, evidence: null };
        }

        const manual = this.#manual.get(id);

        if (manual)
        {
            return { text: manual.en ?? manual, source: NAME_SOURCES.manual, evidence: null };
        }

        if (!this.#reference) return allowGuess ? this.#Guess(id) : null;

        const foreign = this.#reference ? await this.#Row(this.#reference, id) : null;

        if (!foreign?.name?.en) return allowGuess ? this.#Guess(id) : null;

        // The only signal that an ID may mean something else here. Refusing 23
        // names out of 51707 is the correct trade against naming one wrongly.
        if (local && foreign.groupID !== undefined && local.groupID !== undefined
            && Number(foreign.groupID) !== Number(local.groupID))
        {
            // A guess is still better than nothing here, and it cannot inherit
            // the crosswalk's mistake: it is composed from the local name
            // rather than from the ID that just proved unreliable.
            return allowGuess ? this.#Guess(id) : null;
        }

        return {
            text: foreign.name.en,
            source: NAME_SOURCES.crosswalk,
            evidence: Evidence(local?.name, foreign.name),
            referenceBuild: this.#reference.build
        };
    }

    /**
     * The machine-composed name for a type, or null.
     *
     * Last, always. A guess exists so that 8000 types read as something rather
     * than as nothing, and it must never displace a name someone verified.
     */
    #Guess(id)
    {
        const guess = this.#guesses.get(id);

        if (!guess) return null;

        return {
            text: guess.en ?? guess,
            source: NAME_SOURCES.ai,
            evidence: null,
            confidence: guess.confidence ?? null
        };
    }

    /**
     * Every published type this source has that cannot be named in English.
     *
     * The input to filling the gap by hand: `bin/cjs-localisation-gaps.js`
     * formats it, and nothing else in the service needs it.
     */
    async Gaps({ publishedOnly = true } = {})
    {
        const table = this.#source.Table("types");
        const gaps = [];
        let offset = 0;

        for (;;)
        {
            const page = await table.List({ limit: 1000, offset });

            if (!page.length) break;

            for (const record of page)
            {
                const row = record?.payload ?? record;
                const id = Number(record.id);

                if (publishedOnly && row.published !== true) continue;

                // Guesses are excluded deliberately: this list is what nobody
                // has verified, and a machine guess does not retire the need
                // for a real name.
                const english = await this.English(id, row, { allowGuess: false });

                if (english) continue;

                gaps.push({
                    typeID: id,
                    groupID: row.groupID ?? null,
                    names: row.name ?? {}
                });
            }

            offset += page.length;
        }

        return gaps;
    }

    /**
     * Reads one type record from a selected source and unwraps its payload
     * envelope.
     */
    async #Row(source, id)
    {
        const record = await source.Table("types").Get(String(id));

        return record?.payload ?? record ?? null;
    }

}

/**
 * Which corroboration applies to a crosswalked name.
 *
 * Comparing the two local names is the whole point: where they agree, no
 * inference was made at all.
 */
function Evidence(localNames, foreignNames)
{
    const left = localNames?.zh;
    const right = foreignNames?.zh;

    if (!left || !right) return NAME_EVIDENCE.idOnly;

    return left === right ? NAME_EVIDENCE.chineseIdentical : NAME_EVIDENCE.localRename;
}

/**
 * Reads a manual name file into the map this service takes.
 *
 * Keyed by type ID as a string, because JSON has no integer keys:
 *
 * ```json
 * { "85282": { "en": "Booster Mk III", "note": "one target only, named from its group" } }
 * ```
 *
 * Type IDs overlap between targets, so one file serves them all and a name
 * written once is not written twice.
 */
export function ReadGuessedNames(document)
{
    const names = new Map();

    for (const [ key, value ] of Object.entries(document?.names ?? {}))
    {
        const id = Number(key);

        if (!Number.isSafeInteger(id) || id <= 0 || !value?.en) continue;

        names.set(id, { en: value.en, confidence: value.confidence ?? null });
    }

    return names;
}

/**
 * Reads a manual name file into the map this service takes.
 */
export function ReadManualNames(document)
{
    const manual = new Map();

    for (const [ key, value ] of Object.entries(document ?? {}))
    {
        const id = Number(key);

        if (!Number.isSafeInteger(id) || id <= 0) continue;

        const text = typeof value === "string" ? value : value?.en;

        if (!text) continue;

        manual.set(id, { en: text, note: typeof value === "object" ? value.note ?? null : null });
    }

    return manual;
}
