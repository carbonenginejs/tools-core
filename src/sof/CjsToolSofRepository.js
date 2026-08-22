import { EveSOF } from "@carbonenginejs/runtime-sof";

const SOF_DATA_PATH = "res:/dx9/model/spaceobjectfactory/data.black";

/** Cached exact-build SOF catalogs opened from composed index sources. */
export class CjsToolSofRepository
{

    #catalogs;

    #createSof;

    #maximumCatalogs;

    /**
     * Creates a SOF repository sof repository from caller-supplied
     * configuration.
     */
    constructor({
        createSof = options => EveSOF.Create(options),
        maximumCatalogs = 4,
    } = {})
    {
        if (typeof createSof !== "function")
        {
            throw new TypeError("CjsToolSofRepository createSof must be a function");
        }

        if (!Number.isSafeInteger(maximumCatalogs) || maximumCatalogs < 1)
        {
            throw new TypeError(
                "CjsToolSofRepository maximumCatalogs must be a positive integer",
            );
        }

        this.#catalogs = new Map();
        this.#createSof = createSof;
        this.#maximumCatalogs = maximumCatalogs;
        Object.freeze(this);
    }

    /** Opens one exact composed source and decodes its SOF catalog once. */
    async OpenSource(source)
    {
        RequireSource(source);
        const key = CreateSourceKey(source);
        let loading = this.#catalogs.get(key);

        if (!loading)
        {
            loading = this.#OpenSource(source);
            this.#catalogs.set(key, loading);
            RetainNewest(this.#catalogs, this.#maximumCatalogs);
            loading.catch(() =>
            {
                if (this.#catalogs.get(key) === loading)
                {
                    this.#catalogs.delete(key);
                }
            });
        }
        else
        {
            this.#catalogs.delete(key);
            this.#catalogs.set(key, loading);
        }

        return loading;
    }

    /**
     * Coordinates SOF repository open source behavior against current immutable
     * source evidence.
     */
    async #OpenSource(source)
    {
        const resFileIndex = Object.freeze([...new Set(
            source.Match("res:/**", { root: "res" })
                .map(item => String(item?.logicalPath ?? "").trim().toLowerCase())
                .filter(Boolean),
        )].sort((left, right) => left.localeCompare(right)));
        const file = await source.Fetch(SOF_DATA_PATH);
        const sof = await this.#createSof({
            black: file.bytes,
            resFileIndex,
        });

        return new CjsToolSofCatalog({ source, sof });
    }

}

/** Read-only GPU-free SOF answers for one exact target/build. */
export class CjsToolSofCatalog
{

    #sof;

    /** Creates a SOF repository sof catalog from caller-supplied configuration. */
    constructor({ source, sof })
    {
        RequireSof(sof);

        this.target = source.target;
        this.game = source.game;
        this.provider = source.provider;
        this.buildRef = source.buildRef ?? source.build;
        this.build = source.build;
        this.client = source.client ?? null;
        this.#sof = sof;
        Object.freeze(this);
    }

    /** Returns normalized hull summaries in deterministic source order. */
    ListHulls()
    {
        return this.#sof.dataMgr.ListHullDataNames();
    }

    /** Returns normalized faction summaries in deterministic source order. */
    ListFactions()
    {
        return this.#sof.dataMgr.ListFactionDataNames();
    }

    /** Returns normalized race summaries in deterministic source order. */
    ListRaces()
    {
        return this.#sof.dataMgr.ListRaceDataNames();
    }

    /** Returns normalized material summaries in deterministic source order. */
    ListMaterials()
    {
        return this.#sof.dataMgr.ListMaterialDataNames();
    }

    /** Returns normalized layout summaries in deterministic source order. */
    ListLayouts()
    {
        return this.#sof.dataMgr.ListLayoutDataNames();
    }

    /** Returns normalized pattern summaries in deterministic source order. */
    ListPatterns()
    {
        return this.#sof.dataMgr.ListPatternDataNames();
    }

    /** Returns patterns applicable to one normalized hull selection. */
    ListHullPatterns(hull)
    {
        return this.#sof.dataMgr.ListPatternDataNamesForHull(hull);
    }

    /** Returns one hull record by canonical SOF name. */
    GetHull(name)
    {
        return this.#sof.dataMgr.GetHullDataJson(name);
    }

    /** Returns one faction record by canonical SOF name. */
    GetFaction(name)
    {
        return this.#sof.dataMgr.GetFactionDataJson(name);
    }

    /** Returns one race record by canonical SOF name. */
    GetRace(name)
    {
        return this.#sof.dataMgr.GetRaceDataJson(name);
    }

    /** Returns one material record by canonical SOF name. */
    GetMaterial(name)
    {
        return this.#sof.dataMgr.GetMaterialDataJson(name);
    }

    /** Returns one layout record by canonical SOF name. */
    GetLayout(name)
    {
        return this.#sof.dataMgr.GetLayoutDataJson(name);
    }

    /** Returns one hull-specific pattern projection by canonical names. */
    GetPatternHull(pattern, hull)
    {
        return this.#sof.dataMgr.GetPatternHullDataJson(pattern, hull);
    }

    /**
     * Parses one DNA string against the catalog without constructing runtime
     * objects.
     */
    InspectDna(dna)
    {
        return this.#sof.InspectDna(RequireDna(dna));
    }

    /** Reports the visibility groups one DNA authors, declares, and resolves. */
    GetDnaVisibilityGroups(dna)
    {
        const value = RequireDna(dna);

        if (typeof this.#sof.GetDnaVisibilityGroups !== "function")
        {
            throw new TypeError(
                "CjsToolSofRepository requires runtime-sof 0.3.2 visibility-group queries",
            );
        }

        return this.#sof.GetDnaVisibilityGroups(value);
    }

    /** Builds runtime-sof's GPU-free carbon.document without hydration. */
    async BuildDocumentAsync(dna, options = {})
    {
        const value = RequireDna(dna);
        const document = typeof this.#sof.BuildFromDNAAsync === "function"
            ? await this.#sof.BuildFromDNAAsync(value, options)
            : this.#sof.BuildFromDNA(value, options);

        if (document === null)
        {
            return null;
        }

        if (!document || typeof document !== "object" || Array.isArray(document)
            || document.schema !== "carbon.document")
        {
            throw new TypeError(
                "runtime-sof must return a carbon.document object or null",
            );
        }

        return document;
    }

    /**
     * Builds the recommended SOF boundary: one plain model-values graph that is
     * directly valid `CjsModel` input.
     *
     * The document form this sits beside is not. It addresses shared nodes with
     * `{ $ref: id }` into a flat node table, and nothing in the model or values
     * path reads `$ref` at all — the values contract spells a back-reference
     * `{ _ref }` alongside `_id` and `_type`. A consumer handed the document
     * therefore cannot rebuild from it without a hydrator, which is the round
     * trip this method exists to remove.
     *
     * No class registry is supplied or needed. runtime-sof emits JSON, so this
     * route resolves no class names and imports no graph library; a consumer
     * that wants objects builds them from the answer with
     * `RootClass.from(values)` against its own classes.
     */
    async BuildValuesAsync(dna, options = {})
    {
        const value = RequireDna(dna);
        const values = typeof this.#sof.BuildValuesFromDNAAsync === "function"
            ? await this.#sof.BuildValuesFromDNAAsync(value, options)
            : this.#sof.BuildValuesFromDNA(value, options);

        if (values === null)
        {
            return null;
        }

        if (!values || typeof values !== "object" || Array.isArray(values)
            || values.schema === "carbon.document")
        {
            throw new TypeError(
                "runtime-sof must return a plain model-values graph or null",
            );
        }

        return values;
    }

}

function RequireSource(source)
{
    if (!source || typeof source !== "object"
        || typeof source.Match !== "function"
        || typeof source.Fetch !== "function")
    {
        throw new TypeError(
            "CjsToolSofRepository requires an index source with Match and Fetch",
        );
    }

    if (!source.target || !source.build)
    {
        throw new TypeError(
            "CjsToolSofRepository requires an exact target/build identity",
        );
    }
}

function RequireSof(sof)
{
    const dataMgr = sof?.dataMgr;
    const methods = [
        "ListHullDataNames",
        "ListFactionDataNames",
        "ListRaceDataNames",
        "ListMaterialDataNames",
        "ListLayoutDataNames",
        "ListPatternDataNames",
        "ListPatternDataNamesForHull",
        "GetHullDataJson",
        "GetFactionDataJson",
        "GetRaceDataJson",
        "GetMaterialDataJson",
        "GetLayoutDataJson",
        "GetPatternHullDataJson",
    ];

    if (!dataMgr || methods.some(name => typeof dataMgr[name] !== "function")
        || typeof sof.InspectDna !== "function"
        || (typeof sof.BuildFromDNAAsync !== "function"
            && typeof sof.BuildFromDNA !== "function"))
    {
        throw new TypeError(
            "CjsToolSofRepository requires runtime-sof 0.3.1 catalog and document APIs",
        );
    }
}

function RequireDna(value)
{
    const dna = String(value ?? "").trim();

    if (!dna)
    {
        throw new TypeError("SOF DNA must be a non-empty string");
    }

    return dna;
}

function CreateSourceKey(source)
{
    return [
        source.target,
        source.build,
    ].join("\0");
}

function RetainNewest(cache, limit)
{
    while (cache.size > limit)
    {
        cache.delete(cache.keys().next().value);
    }
}
