import { CjsToolCharacterCompiler } from "./CjsToolCharacterCompiler.js";

/** Read-only query API over one prepared character library. */
export class CjsToolCharacterLibrary
{

    #document;

    #partsByID;

    #partsByTypeID;

    #partsByName;

    #partsByCategory;

    #sourceIdentity;

    constructor(data)
    {
        ValidateDocument(data);

        this.#document = CloneValue(data);
        this.data = NormalizeRuntimeLibrary(CjsToolCharacterCompiler.expand(data));
        this.#partsByID = BuildUniqueIndex(this.data.parts, "id");
        this.#partsByTypeID = GroupOptional(this.data.parts, "typeID");
        this.#partsByName = GroupOptional(this.data.parts, "name", NormalizeName);
        this.#partsByCategory = GroupOptional(this.data.parts, "category", value => value.toLowerCase());
        this.#sourceIdentity = Object.freeze({
            sourceTarget: String(this.data.sourceTarget || ""),
            sourceGame: String(this.data.sourceGame || ""),
            sourceProvider: String(this.data.sourceProvider || ""),
            sourceBuild: String(this.data.sourceBuild || "")
        });
        Object.freeze(this);
    }

    /** Returns the normalized runtime-shaped library. */
    GetValues()
    {
        return CloneValue(this.data);
    }

    /** Returns the prepared document without expanding its storage schema. */
    GetDocument()
    {
        return CloneValue(this.#document);
    }

    /** Returns the small immutable source identity used by API metadata. */
    GetSourceIdentity()
    {
        return { ...this.#sourceIdentity };
    }

    /** Returns a part by its Carbon-owned internal identity. */
    GetPart(id)
    {
        return this.#partsByID.get(String(id)) || null;
    }

    /** Resolves a part by internal ID, exact type identity, or unambiguous name. */
    ResolvePart(selection)
    {
        if (selection && typeof selection === "object")
        {
            if (selection.id) return this.GetPart(selection.id);
            if (selection.typeID !== undefined && selection.typeID !== null)
            {
                return this.GetPartByTypeID(selection.typeID);
            }
            if (selection.name) return this.GetPartByName(selection.name);
            return null;
        }

        const value = String(selection ?? "");
        const byID = this.GetPart(value);

        if (byID) return byID;
        if (/^\d+$/u.test(value)) return this.GetPartByTypeID(value);
        return this.GetPartByName(value);
    }

    /** Returns the unique part carrying an exact type identity. */
    GetPartByTypeID(typeID)
    {
        return ResolveUnique(this.#partsByTypeID.get(String(typeID)) || [], `typeID ${typeID}`);
    }

    /** Returns every part carrying an exact type identity. */
    GetPartsByTypeID(typeID)
    {
        return (this.#partsByTypeID.get(String(typeID)) || []).slice();
    }

    /** Returns the unique part with a case-insensitive name. */
    GetPartByName(name)
    {
        const identity = ResolveOptionalNameCandidates(this.LookupName(name), name);

        return identity ? this.GetPart(identity.partID) : null;
    }

    /** Returns every part with a case-insensitive name. */
    GetPartsByName(name)
    {
        return this.LookupName(name).map(value => this.GetPart(value.partID));
    }

    /** Returns every exact case-insensitive character name identity. */
    LookupName(name)
    {
        return BuildNameCandidates(this.#partsByName.get(NormalizeName(name)) || []);
    }

    /** Returns every punctuation- and spacing-normalized character identity. */
    SearchName(name)
    {
        const normalized = NormalizeSearchName(name);
        const matches = new Map();

        for (const [ candidate, parts ] of this.#partsByName)
        {
            if (NormalizeSearchName(candidate) !== normalized)
            {
                continue;
            }

            for (const part of parts)
            {
                matches.set(part.id, part);
            }
        }

        return BuildNameCandidates([ ...matches.values() ]);
    }

    /** Resolves one exact name to a unique character identity. */
    ResolveName(name)
    {
        return ResolveNameCandidates(this.LookupName(name), name);
    }

    /** Resolves one normalized name to a unique character identity. */
    ResolveSearchName(name)
    {
        return ResolveNameCandidates(this.SearchName(name), name);
    }

    /** Returns parts in one exact category or, optionally, its descendants. */
    GetPartsByCategory(category, { recursive = false } = {})
    {
        const key = String(category || "").toLowerCase();

        if (!recursive)
        {
            return (this.#partsByCategory.get(key) || []).slice();
        }

        return this.data.parts.filter(part =>
        {
            const value = String(part.category || "").toLowerCase();
            return value === key || value.startsWith(`${key}/`);
        });
    }

    /** Returns the available atomic LOD bundles for one selected part. */
    GetPartLodBundles(selection)
    {
        return (this.ResolvePart(selection)?.lodBundles || []).map(CloneValue);
    }

    /** Resolves one selected part to an atomic configuration and geometry bundle. */
    ResolvePartLodBundle(selection, requestedLod)
    {
        const part = this.ResolvePart(selection);

        return part
            ? CjsToolCharacterCompiler.resolveLodBundle(part.lodBundles, requestedLod)
            : null;
    }

}

function ValidateDocument(data)
{
    if (!data || typeof data !== "object" || Array.isArray(data))
    {
        throw new TypeError("CjsToolCharacterLibrary data must be an object");
    }

    if (data.schema !== "carbonenginejs.characterLibrary")
    {
        throw new TypeError("Unsupported character-library schema");
    }

    const version = Number(data.schemaVersion);

    if (!Number.isSafeInteger(version) || (version !== 1 && version !== 2))
    {
        throw new TypeError(`Unsupported character-library schema version "${data.schemaVersion}"`);
    }

    if (version === 1 && !Array.isArray(data.parts))
    {
        throw new TypeError("Character-library schema v1 requires a parts array");
    }

    if (version === 2
        && (!data.partSources || typeof data.partSources !== "object" || Array.isArray(data.partSources)))
    {
        throw new TypeError("Character-library schema v2 requires a partSources object");
    }
}

function NormalizeRuntimeLibrary(data)
{
    const result = CloneValue(data);

    if (!Array.isArray(result.parts))
    {
        throw new TypeError("Expanded character library requires a parts array");
    }

    result.schemaVersion = 1;
    result.parts = result.parts.map((part, index) => NormalizePart(part, index));
    return result;
}

function NormalizePart(part, index)
{
    if (!part || typeof part !== "object" || Array.isArray(part))
    {
        throw new TypeError(`Character library part ${index} must be an object`);
    }

    const id = String(part.id || "");
    const typeID = part.typeID === undefined || part.typeID === null || part.typeID === ""
        ? null
        : String(part.typeID);
    const lodBundles = part.lodBundles === undefined || part.lodBundles === null
        ? []
        : part.lodBundles;

    if (!Array.isArray(lodBundles))
    {
        throw new TypeError(`Character library part "${id}" lodBundles must be an array`);
    }

    return {
        ...part,
        typeID,
        lodBundles: lodBundles.map((bundle, bundleIndex) =>
            NormalizeLodBundle(bundle, id, bundleIndex))
    };
}

function NormalizeLodBundle(bundle, partID, index)
{
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle))
    {
        throw new TypeError(`Character library part "${partID}" LOD bundle ${index} must be an object`);
    }

    return {
        ...bundle,
        requestedLod: NormalizeNullableLod(bundle.requestedLod, partID, index, "requestedLod"),
        resolvedLod: NormalizeNullableLod(bundle.resolvedLod, partID, index, "resolvedLod")
    };
}

function NormalizeNullableLod(value, partID, index, field)
{
    if (value === undefined || value === null)
    {
        return null;
    }

    const lod = Number(value);

    if (!Number.isInteger(lod) || lod < 0)
    {
        throw new TypeError(
            `Character library part "${partID}" LOD bundle ${index} ${field} must be a non-negative integer or null`
        );
    }

    return lod;
}

function BuildUniqueIndex(parts, key)
{
    const result = new Map();

    for (const part of parts || [])
    {
        const value = String(part?.[key] || "");

        if (!value)
        {
            throw new Error(`CjsToolCharacterLibrary part is missing ${key}`);
        }

        if (result.has(value))
        {
            throw new Error(`CjsToolCharacterLibrary duplicate ${key} "${value}"`);
        }

        result.set(value, part);
    }

    return result;
}

function GroupOptional(parts, key, normalize = String)
{
    const result = new Map();

    for (const part of parts || [])
    {
        if (part?.[key] === undefined || part[key] === null || part[key] === "") continue;

        const value = normalize(String(part[key]));
        if (!result.has(value)) result.set(value, []);
        result.get(value).push(part);
    }

    return result;
}

function ResolveUnique(parts, label)
{
    if (!parts.length) return null;

    if (parts.length !== 1)
    {
        const error = new Error(`Character ${label} is ambiguous across ${parts.length} parts`);
        error.statusCode = 409;
        throw error;
    }

    return parts[0];
}

function BuildNameCandidates(parts)
{
    return Object.freeze(parts.map(part => Object.freeze({
        kind: "character",
        typeID: part.typeID ?? null,
        partID: part.id
    })).sort((left, right) => Compare(left.partID, right.partID)));
}

function ResolveOptionalNameCandidates(candidates, name)
{
    if (!candidates.length)
    {
        return null;
    }

    return ResolveNameCandidates(candidates, name);
}

function ResolveNameCandidates(candidates, name)
{
    if (!candidates.length)
    {
        const error = new Error(`Character name "${name}" not found`);

        error.statusCode = 404;
        throw error;
    }

    if (candidates.length > 1)
    {
        const error = new Error(
            `Character name "${name}" is ambiguous (${candidates.length} identities)`
        );

        error.statusCode = 409;
        throw error;
    }

    return candidates[0];
}

function NormalizeName(value)
{
    const name = String(value ?? "").trim();

    if (!name)
    {
        throw new TypeError("Character name must be non-empty");
    }

    return name.toLocaleLowerCase("en-US");
}

function NormalizeSearchName(value)
{
    return NormalizeName(value)
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .replace(/\s+/gu, " ");
}

function Compare(left, right)
{
    return String(left).localeCompare(String(right), "en", { numeric: true });
}

function CloneValue(value)
{
    if (Array.isArray(value)) return value.map(CloneValue);

    if (value && typeof value === "object")
    {
        return Object.fromEntries(Object.entries(value)
            .map(([ key, item ]) => [ key, CloneValue(item) ]));
    }

    return value;
}
