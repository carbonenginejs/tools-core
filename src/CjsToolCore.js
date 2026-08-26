import { EveSOF } from "@carbonenginejs/runtime/sof";
import { CjsToolCache } from "./cache/CjsToolCache.js";
import { PrepareSofDefaults } from "./sof/ExpandSofDefaults.js";

/** Public Node composition root for cache, identity, and graph tooling. */
export class CjsToolCore
{

    /**
     * Creates a composition facade over injected SDE and SOF services.
     */
    constructor(options = {})
    {
        this.cache = options.cache || new CjsToolCache(options.cacheDirectory);
        this.sde = options.sde || null;
        this.sof = options.sof || new EveSOF();
        this.prepareSofDefaults = options.prepareSofDefaults || PrepareSofDefaults;
    }

    /** Resolves a type/graphic/skin selection into one SOF DNA string. */
    ResolveDna(selection)
    {
        if (!this.sde || typeof this.sde.ResolveDna !== "function")
        {
            throw new Error("CjsToolCore requires an SDE adapter with ResolveDna(selection)");
        }

        const dna = this.sde.ResolveDna(selection);

        if (dna && typeof dna.then === "function")
        {
            throw new TypeError("CjsToolCore.ResolveDna received an asynchronous SDE result");
        }

        return RequireDna(dna);
    }

    /** Resolves a type/graphic/skin selection asynchronously into SOF DNA. */
    async ResolveDnaAsync(selection)
    {
        if (!this.sde || typeof this.sde.ResolveDna !== "function")
        {
            throw new Error("CjsToolCore requires an SDE adapter with ResolveDna(selection)");
        }

        return RequireDna(await this.sde.ResolveDna(selection));
    }

    /**
     * Returns the recommended SOF boundary: one plain model-values graph, the
     * same JSON-compatible object a hydrated root's GetValues returns. Nested
     * values, `_type` on polymorphic nodes, `_id`/`_ref` only for shared
     * identity — no node table, `kind`/`fields` records, or `raw` payloads.
     */
    BuildSofValues(dna, options = {})
    {
        return ValidateValues(this.sof.BuildValuesFromDNA(RequireDna(dna), options));
    }

    /** Returns the complete async plain model-values graph. */
    async BuildSofValuesAsync(dna, options = {})
    {
        return ValidateValues(await this.sof.BuildValuesFromDNAAsync(
            RequireDna(dna),
            options,
        ));
    }

    /** Returns async SOF values with registered class defaults filled in. */
    async BuildSofExpandedValuesAsync(dna, options = {})
    {
        await this.prepareSofDefaults();
        return this.BuildSofValuesAsync(dna, {
            ...options,
            populateDefaults: true,
        });
    }

    /** Resolves a prepared identity selection and builds its SOF values. */
    BuildTypeSofValues(selection, options = {})
    {
        return this.BuildSofValues(this.ResolveDna(selection), options);
    }

    /** Asynchronously resolves an identity selection and builds its values. */
    async BuildTypeSofValuesAsync(selection, options = {})
    {
        return this.BuildSofValuesAsync(await this.ResolveDnaAsync(selection), options);
    }

    /** Resolves a prepared identity selection and expands its SOF defaults. */
    async BuildTypeSofExpandedValuesAsync(selection, options = {})
    {
        return this.BuildSofExpandedValuesAsync(
            await this.ResolveDnaAsync(selection),
            options,
        );
    }

    /**
     * Returns the runtime SOF layer's device-free carbon.document JSON graph.
     *
     * Compatibility/diagnostic API: the node-table document remains available
     * for explicit graph tooling (fragment import, lossless unknown fields,
     * detached-node diagnostics). New consumers should use BuildSofValues.
     */
    BuildSofDocument(dna, options = {})
    {
        return ValidateDocument(this.sof.BuildFromDNA(RequireDna(dna), options));
    }

    /** Async compatibility/diagnostic carbon.document build. */
    async BuildSofDocumentAsync(dna, options = {})
    {
        return ValidateDocument(await this.sof.BuildFromDNAAsync(
            RequireDna(dna),
            options,
        ));
    }

    /** Resolves a prepared identity selection and builds its SOF document. */
    BuildTypeSofDocument(selection, options = {})
    {
        return this.BuildSofDocument(this.ResolveDna(selection), options);
    }

    /** Asynchronously resolves an identity selection and builds its document. */
    async BuildTypeSofDocumentAsync(selection, options = {})
    {
        return this.BuildSofDocumentAsync(await this.ResolveDnaAsync(selection), options);
    }

}

function RequireDna(value)
{
    const dna = String(value || "").trim();

    if (!dna)
    {
        throw new TypeError("SOF DNA must be a non-empty string");
    }

    return dna;
}

function ValidateDocument(value)
{
    if (value === null)
    {
        return null;
    }

    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError("The runtime SOF layer must return a carbon.document object or null");
    }

    if (value.schema !== "carbon.document")
    {
        throw new TypeError(`The runtime SOF layer returned unsupported document schema "${value.schema}"`);
    }

    return value;
}

function ValidateValues(value)
{
    if (value === null)
    {
        return null;
    }

    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError("The runtime SOF layer must return a model-values object or null");
    }

    if (value.schema === "carbon.document" || value.nodes !== undefined || value.roots !== undefined)
    {
        throw new TypeError("The runtime SOF layer returned a carbon.document where plain model values were required");
    }

    if (typeof value._type !== "string" || !value._type)
    {
        throw new TypeError("SOF model values must carry a root _type");
    }

    return value;
}
