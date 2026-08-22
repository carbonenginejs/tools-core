/**
 * Composes SDE icon records into loadable resource addresses.
 *
 * The raw `sde/icons` table remains source evidence and keeps `iconFile`
 * exactly as published. This composed topic owns the one normalization every
 * consumer otherwise repeats: resource paths are case-normalized and a path
 * with no extension denotes a PNG.
 */
export class CjsToolIcons
{

    #source;

    #records;

    /** Creates an icon catalog over one exact-build SDE source. */
    constructor(source)
    {
        if (!source || typeof source.LoadTables !== "function")
        {
            throw new TypeError("CjsToolIcons source must provide LoadTables(names)");
        }

        this.#source = source;
        this.#records = null;
    }

    /** Returns the exact source identity behind this icon catalog. */
    Identity()
    {
        return Object.freeze({
            target: this.#source.target,
            game: this.#source.game,
            provider: this.#source.provider,
            build: this.#source.build,
        });
    }

    /** Returns every icon record keyed by icon identifier. */
    async List()
    {
        return await this.#Load();
    }

    /** Returns one icon record, or null when the identifier is unknown. */
    async Get(iconID)
    {
        const key = String(NormalizeIconID(iconID));

        return (await this.#Load())[key] ?? null;
    }

    /** Loads and composes the immutable catalog once for this exact source. */
    async #Load()
    {
        if (!this.#records)
        {
            this.#records = this.#Build().catch(error =>
            {
                this.#records = null;
                throw error;
            });
        }

        return await this.#records;
    }

    /** Projects raw SDE icon rows into public resource records. */
    async #Build()
    {
        const table = (await this.#source.LoadTables([ "icons" ])).icons ?? {};
        const records = {};

        for (const [ key, source ] of Object.entries(table))
        {
            const iconID = NormalizeIconID(source?._key ?? key);
            const record = {
                iconID,
                resPath: NormalizeIconResourcePath(source?.iconFile),
            };

            if (source?.description !== undefined && source.description !== null)
            {
                record.description = source.description;
            }

            records[iconID] = Object.freeze(record);
        }

        return Object.freeze(records);
    }

}

/**
 * Normalizes one SDE icon file into the resource address consumers can fetch.
 *
 * @param {string} value Source `iconFile` value.
 * @returns {string} Lower-case `res:/` path with an explicit extension.
 */
export function NormalizeIconResourcePath(value)
{
    let resourcePath = String(value ?? "")
        .trim()
        .replaceAll("\\", "/")
        .toLocaleLowerCase("en-US")
        .replace(/^res:\/+/, "res:/");

    if (!resourcePath.startsWith("res:/"))
    {
        throw new TypeError(`Icon resource path must use res:/: ${value}`);
    }

    const segments = resourcePath.slice("res:/".length).split("/");

    if (segments.some(segment => !segment || segment === "." || segment === ".."))
    {
        throw new TypeError(`Icon resource path is malformed: ${value}`);
    }

    if (!/\.[a-z0-9]+$/u.test(segments.at(-1))) resourcePath += ".png";

    return resourcePath;
}

/** Normalizes one non-negative icon identifier. */
function NormalizeIconID(value)
{
    const iconID = Number(value);

    if (!Number.isSafeInteger(iconID) || iconID < 0)
    {
        throw new TypeError(`Icon identifier must be a non-negative safe integer: ${value}`);
    }

    return iconID;
}
