import { EveSOF } from "@carbonenginejs/runtime/sof";
import { PrepareSofDefaults } from "./ExpandSofDefaults.js";

const SOF_BASE_PATH = "res:/dx9/model/spaceobjectfactory";
const SOF_DATA_PATH = "res:/dx9/model/spaceobjectfactory/data.black";
const SOF_LOAD_MODES = new Set([ "lazy", "full" ]);
const CATALOGS = Object.freeze({
    hull: Object.freeze({ directory: "hulls", fetch: "FetchHull", get: "GetHullDataJson", list: "ListHullDataNames" }),
    faction: Object.freeze({ directory: "factions", fetch: "FetchFaction", get: "GetFactionDataJson", list: "ListFactionDataNames" }),
    race: Object.freeze({ directory: "races", fetch: "FetchRace", get: "GetRaceDataJson", list: "ListRaceDataNames" }),
    material: Object.freeze({ directory: "materials", fetch: "FetchMaterial", get: "GetMaterialDataJson", list: "ListMaterialDataNames" }),
    layout: Object.freeze({ directory: "layouts", fetch: "FetchLayout", get: "GetLayoutDataJson", list: "ListLayoutDataNames" }),
    pattern: Object.freeze({ directory: "patterns", fetch: "FetchPattern", get: null, list: "ListPatternDataNames" }),
});

/** Cached exact-build SOF catalogs opened from composed index sources. */
export class CjsToolSofRepository
{

    #catalogs;

    #createSof;

    #loadMode;

    #maximumCatalogs;

    #prepareDefaults;

    /**
     * Creates a SOF repository from caller-supplied configuration.
     */
    constructor({
        createSof = CreateRuntimeSof,
        loadMode = "lazy",
        maximumCatalogs = 4,
        prepareDefaults = PrepareSofDefaults,
    } = {})
    {
        if (typeof createSof !== "function")
        {
            throw new TypeError("CjsToolSofRepository createSof must be a function");
        }

        if (!SOF_LOAD_MODES.has(loadMode))
        {
            throw new TypeError(
                "CjsToolSofRepository loadMode must be \"lazy\" or \"full\"",
            );
        }

        if (typeof prepareDefaults !== "function")
        {
            throw new TypeError("CjsToolSofRepository prepareDefaults must be a function");
        }

        if (!Number.isSafeInteger(maximumCatalogs) || maximumCatalogs < 1)
        {
            throw new TypeError(
                "CjsToolSofRepository maximumCatalogs must be a positive integer",
            );
        }

        this.#catalogs = new Map();
        this.#createSof = createSof;
        this.#loadMode = loadMode;
        this.#maximumCatalogs = maximumCatalogs;
        this.#prepareDefaults = prepareDefaults;
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
                .map(item => String(item.logicalPath).trim().toLowerCase())
                .filter(Boolean),
        )].sort((left, right) => left.localeCompare(right)));
        const catalogNames = CreateCatalogNames(resFileIndex);
        let library = null;
        let sof;

        if (this.#loadMode === "full")
        {
            const file = await source.Fetch(SOF_DATA_PATH);
            sof = await this.#createSof({
                black: file.bytes,
                resFileIndex,
            });
        }
        else
        {
            sof = await this.#createSof({
                lazyData: {
                    source: async (logicalPath, context = {}) =>
                    {
                        const file = await source.Fetch(
                            logicalPath,
                            context.signal === null ? {} : { signal: context.signal },
                        );
                        return file.bytes;
                    },
                },
                resFileIndex,
            });
            await sof.InitializeAsync();
            library = sof.GetSofLibraryBuilder();
        }

        return new CjsToolSofCatalog({
            catalogNames,
            library,
            loadMode: this.#loadMode,
            source,
            sof,
            prepareDefaults: this.#prepareDefaults,
        });
    }

}

/** Read-only GPU-free SOF answers for one exact target/build. */
export class CjsToolSofCatalog
{

    #sof;

    #catalogNames;

    #library;

    #prepareDefaults;

    /** Creates one SOF catalog from caller-supplied configuration. */
    constructor({
        catalogNames = CreateCatalogNames([]),
        library = null,
        loadMode = "full",
        prepareDefaults = PrepareSofDefaults,
        source,
        sof,
    })
    {
        RequireSof(sof);

        if (!SOF_LOAD_MODES.has(loadMode))
        {
            throw new TypeError("CjsToolSofCatalog loadMode must be \"lazy\" or \"full\"");
        }

        if (typeof prepareDefaults !== "function")
        {
            throw new TypeError("CjsToolSofCatalog prepareDefaults must be a function");
        }

        this.target = source.target;
        this.game = source.game;
        this.provider = source.provider;
        this.buildRef = source.buildRef ?? source.build;
        this.build = source.build;
        this.client = source.client ?? null;
        this.loadMode = loadMode;
        this.#catalogNames = catalogNames;
        this.#library = library;
        this.#sof = sof;
        this.#prepareDefaults = prepareDefaults;
        Object.freeze(this);
    }

    /** Returns normalized hull summaries in deterministic source order. */
    ListHulls()
    {
        return this.#List("hull");
    }

    /** Returns normalized faction summaries in deterministic source order. */
    ListFactions()
    {
        return this.#List("faction");
    }

    /** Returns normalized race summaries in deterministic source order. */
    ListRaces()
    {
        return this.#List("race");
    }

    /** Returns normalized material summaries in deterministic source order. */
    ListMaterials()
    {
        return this.#List("material");
    }

    /** Returns normalized layout summaries in deterministic source order. */
    ListLayouts()
    {
        return this.#List("layout");
    }

    /** Returns normalized pattern summaries in deterministic source order. */
    ListPatterns()
    {
        return this.#List("pattern");
    }

    /** Returns patterns applicable to one normalized hull selection. */
    ListHullPatterns(hull)
    {
        return this.#sof.dataMgr.ListPatternDataNamesForHull(hull);
    }

    /** Loads one hull and every indexed pattern before listing applications. */
    async ListHullPatternsAsync(hull)
    {
        if (this.#library)
        {
            if (!await this.#EnsureNamed("hull", hull)) return null;
            await Promise.all(this.ListPatterns().map(name =>
                this.#library.FetchPattern(name)));
        }

        return this.ListHullPatterns(hull);
    }

    /** Returns one hull record by canonical SOF name. */
    GetHull(name)
    {
        return this.#sof.dataMgr.GetHullDataJson(name);
    }

    /** Loads and returns one hull record by canonical SOF name. */
    async GetHullAsync(name)
    {
        return this.#GetNamedAsync("hull", name);
    }

    /** Returns one faction record by canonical SOF name. */
    GetFaction(name)
    {
        return this.#sof.dataMgr.GetFactionDataJson(name);
    }

    /** Loads and returns one faction record by canonical SOF name. */
    async GetFactionAsync(name)
    {
        return this.#GetNamedAsync("faction", name);
    }

    /** Returns one race record by canonical SOF name. */
    GetRace(name)
    {
        return this.#sof.dataMgr.GetRaceDataJson(name);
    }

    /** Loads and returns one race record by canonical SOF name. */
    async GetRaceAsync(name)
    {
        return this.#GetNamedAsync("race", name);
    }

    /** Returns one material record by canonical SOF name. */
    GetMaterial(name)
    {
        return this.#sof.dataMgr.GetMaterialDataJson(name);
    }

    /** Loads and returns one material record by canonical SOF name. */
    async GetMaterialAsync(name)
    {
        return this.#GetNamedAsync("material", name);
    }

    /** Returns one layout record by canonical SOF name. */
    GetLayout(name)
    {
        return this.#sof.dataMgr.GetLayoutDataJson(name);
    }

    /** Loads and returns one layout record by canonical SOF name. */
    async GetLayoutAsync(name)
    {
        return this.#GetNamedAsync("layout", name);
    }

    /** Returns one hull-specific pattern projection by canonical names. */
    GetPatternHull(pattern, hull)
    {
        return this.#sof.dataMgr.GetPatternHullDataJson(pattern, hull);
    }

    /** Loads the selected pattern and hull before returning their application. */
    async GetPatternHullAsync(pattern, hull)
    {
        if (this.#library)
        {
            const [ hasPattern, hasHull ] = await Promise.all([
                this.#EnsureNamed("pattern", pattern),
                this.#EnsureNamed("hull", hull),
            ]);
            if (!hasPattern || !hasHull) return null;
        }

        return this.GetPatternHull(pattern, hull);
    }

    /**
     * Parses one DNA string against the catalog without constructing runtime
     * objects.
     */
    InspectDna(dna)
    {
        return this.#sof.InspectDna(RequireDna(dna));
    }

    /** Loads one DNA's indexed named-catalog closure before inspecting it. */
    async InspectDnaAsync(dna)
    {
        const value = RequireDna(dna);

        if (this.#library)
        {
            const requirements = this.#library.constructor.ParseDnaRequirements(value);

            if (!this.#HasDnaRequirements(requirements))
            {
                return this.#sof.InspectDna(value);
            }

            await this.#library.EnsureFromDNA(value);
        }

        return this.#sof.InspectDna(value);
    }

    /** Reports the visibility groups one DNA authors, declares, and resolves. */
    GetDnaVisibilityGroups(dna)
    {
        const value = RequireDna(dna);
        return this.#sof.GetDnaVisibilityGroups(value);
    }

    /** Loads one DNA's catalog closure before reporting visibility groups. */
    async GetDnaVisibilityGroupsAsync(dna)
    {
        const inspection = await this.InspectDnaAsync(dna);
        return inspection.buildable && inspection.valid
            ? this.GetDnaVisibilityGroups(dna)
            : null;
    }

    /** Builds the runtime SOF layer's GPU-free carbon.document without hydration. */
    async BuildDocumentAsync(dna, options = {})
    {
        const value = RequireDna(dna);
        const document = await this.#sof.BuildFromDNAAsync(value, options);

        if (document === null)
        {
            return null;
        }

        if (!document || typeof document !== "object" || Array.isArray(document)
            || document.schema !== "carbon.document")
        {
            throw new TypeError(
                "The runtime SOF layer must return a carbon.document object or null",
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
     * No class registry is supplied or needed. The runtime SOF layer emits JSON, so this
     * route resolves no class names and imports no graph library; a consumer
     * that wants objects builds them from the answer with
     * `RootClass.from(values)` against its own classes.
     */
    async BuildValuesAsync(dna, options = {})
    {
        const value = RequireDna(dna);
        const values = await this.#sof.BuildValuesFromDNAAsync(value, options);

        if (values === null)
        {
            return null;
        }

        if (!values || typeof values !== "object" || Array.isArray(values)
            || values.schema === "carbon.document")
        {
            throw new TypeError(
                "The runtime SOF layer must return a plain model-values graph or null",
            );
        }

        return values;
    }

    /**
     * Builds sparse SOF values and overlays the registered Trinity/audio class
     * defaults without constructing or initializing the authored graph.
     */
    async BuildExpandedValuesAsync(dna, options = {})
    {
        await this.#prepareDefaults();
        return this.BuildValuesAsync(dna, {
            ...options,
            populateDefaults: true,
        });
    }

    /** Returns sorted names from the immutable source index plus loaded values. */
    #List(kind)
    {
        const config = CATALOGS[kind];

        if (!this.#library) return this.#sof.dataMgr[config.list]();

        return Object.freeze([...new Set([
            ...this.#catalogNames[kind].names,
            ...this.#sof.dataMgr[config.list](),
        ])].sort((left, right) => left.localeCompare(right)));
    }

    /** Loads one indexed named record when it is not already present. */
    async #EnsureNamed(kind, name)
    {
        const config = CATALOGS[kind];
        const value = NormalizeCatalogName(name);

        if (config.get && this.#sof.dataMgr[config.get](value) !== null) return true;
        if (!this.#catalogNames[kind].set.has(value)) return false;

        await this.#library[config.fetch](value);
        return true;
    }

    /** Loads and projects one named catalog record. */
    async #GetNamedAsync(kind, name)
    {
        if (this.#library && !await this.#EnsureNamed(kind, name)) return null;
        return this.#sof.dataMgr[CATALOGS[kind].get](name);
    }

    /** Tests top-level DNA requests against the exact build's file catalog. */
    #HasDnaRequirements(requirements)
    {
        return requirements.hulls.every(name => this.#HasNamed("hull", name))
            && this.#HasNamed("faction", requirements.faction)
            && this.#HasNamed("race", requirements.race)
            && requirements.materials.every(name => this.#HasNamed("material", name))
            && requirements.patterns.every(name => this.#HasNamed("pattern", name))
            && requirements.layouts.every(name => this.#HasNamed("layout", name));
    }

    /** Tests one canonical name in the source index or loaded manager. */
    #HasNamed(kind, name)
    {
        const value = NormalizeCatalogName(name);
        return this.#catalogNames[kind].set.has(value)
            || this.#sof.dataMgr[CATALOGS[kind].list]().includes(value);
    }

}

function CreateRuntimeSof(options)
{
    return Object.hasOwn(options, "lazyData")
        ? new EveSOF().Register(options)
        : EveSOF.Create(options);
}

function CreateCatalogNames(resFileIndex)
{
    return Object.freeze(Object.fromEntries(Object.entries(CATALOGS).map(([kind, config]) =>
    {
        const prefix = `${SOF_BASE_PATH}/${config.directory}/`;
        const names = [...new Set(resFileIndex.flatMap(value =>
        {
            const path = String(value ?? "").trim().toLowerCase();

            if (!path.startsWith(prefix) || !path.endsWith(".black")) return [];

            const name = path.slice(prefix.length, -".black".length);
            return name && !name.includes("/") ? [name] : [];
        }))].sort((left, right) => left.localeCompare(right));

        return [kind, Object.freeze({
            names: Object.freeze(names),
            set: new Set(names),
        })];
    })));
}

function NormalizeCatalogName(value)
{
    return String(value ?? "").trim().toLowerCase();
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
    if (!(sof instanceof EveSOF))
    {
        throw new TypeError("CjsToolSofRepository requires an EveSOF");
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
