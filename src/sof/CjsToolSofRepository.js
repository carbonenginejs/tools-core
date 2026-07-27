import { EveSOF } from "@carbonenginejs/runtime-sof";

const SOF_DATA_PATH = "res:/dx9/model/spaceobjectfactory/data.black";

/** Cached exact-build SOF catalogs opened from composed index sources. */
export class CjsToolSofRepository
{

    #catalogs;

    #createSof;

    #maximumCatalogs;

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

    ListHulls()
    {
        return this.#sof.dataMgr.ListHullDataNames();
    }

    ListFactions()
    {
        return this.#sof.dataMgr.ListFactionDataNames();
    }

    ListRaces()
    {
        return this.#sof.dataMgr.ListRaceDataNames();
    }

    ListMaterials()
    {
        return this.#sof.dataMgr.ListMaterialDataNames();
    }

    ListLayouts()
    {
        return this.#sof.dataMgr.ListLayoutDataNames();
    }

    ListPatterns()
    {
        return this.#sof.dataMgr.ListPatternDataNames();
    }

    ListHullPatterns(hull)
    {
        return this.#sof.dataMgr.ListPatternDataNamesForHull(hull);
    }

    GetHull(name)
    {
        return this.#sof.dataMgr.GetHullDataJson(name);
    }

    GetFaction(name)
    {
        return this.#sof.dataMgr.GetFactionDataJson(name);
    }

    GetRace(name)
    {
        return this.#sof.dataMgr.GetRaceDataJson(name);
    }

    GetMaterial(name)
    {
        return this.#sof.dataMgr.GetMaterialDataJson(name);
    }

    GetLayout(name)
    {
        return this.#sof.dataMgr.GetLayoutDataJson(name);
    }

    GetPatternHull(pattern, hull)
    {
        return this.#sof.dataMgr.GetPatternHullDataJson(pattern, hull);
    }

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

    if (!source.target || !source.game || !source.provider || !source.build)
    {
        throw new TypeError(
            "CjsToolSofRepository requires an exact target/game/provider/build identity",
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
        source.game,
        source.provider,
        source.build,
        source.client ?? "",
    ].join("\0");
}

function RetainNewest(cache, limit)
{
    while (cache.size > limit)
    {
        cache.delete(cache.keys().next().value);
    }
}
