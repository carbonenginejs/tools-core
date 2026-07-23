const KEYED_CATALOGS = [
    "materials", "projections", "poses", "presets", "sculptFields",
    "blendshapeLimits", "uniqueCharacters", "visemeSets"
];

/** Stateless transforms between expanded and compact character-library data. */
export class CjsToolCharacterCompiler
{

    static compile(data, options = {})
    {
        const materials = KeyCatalog(data.materials || []);
        const projections = KeyCatalog(data.projections || []);
        const projectionByFolder = IndexProjectionsByFolder(Object.keys(projections));
        const sources = BuildPartSources(
            data.parts || [],
            data.partMetadata || [],
            projectionByFolder,
            options.partSourceResources || {},
            data.partAuthoring || {}
        );
        const result = {
            schema: "carbonenginejs.characterLibrary",
            schemaVersion: 2,
            sourceTarget: data.sourceTarget ?? null,
            sourceGame: data.sourceGame ?? null,
            sourceProvider: data.sourceProvider ?? null,
            sourceBuild: data.sourceBuild ?? null,
            generatedAt: data.generatedAt ?? null,
            partSources: sources,
            recipeLinks: BuildRecipeLinks(data.presets || [], sources, materials),
            materials,
            modifierNames: CloneValue(data.modifierNames || {}),
            faceSetup: CloneValue(data.faceSetup || {}),
            presentation: CloneValue(data.presentation || {})
        };

        for (const catalog of KEYED_CATALOGS.slice(1)) result[catalog] = KeyCatalog(data[catalog] || []);
        if (data.sourceRefs) result.sourceRefs = { ...data.sourceRefs };
        if (data.sources) result.sources = data.sources.map(value => CompactRecord(value));
        if (result.sourceTarget === null) delete result.sourceTarget;
        if (result.sourceGame === null) delete result.sourceGame;
        if (result.sourceProvider === null) delete result.sourceProvider;
        if (result.sourceBuild === null) delete result.sourceBuild;
        if (result.generatedAt === null) delete result.generatedAt;
        return result;
    }

    static expand(data)
    {
        if (Number(data?.schemaVersion) !== 2 || !data?.partSources) return data;
        const catalogs = Object.fromEntries(KEYED_CATALOGS.map(name => [ name, ExpandCatalog(data[name] || {}) ]));
        const partMetadata = [];
        const parts = [];
        const partAuthoring = {};

        for (const [ sourceId, source ] of Object.entries(data.partSources))
        {
            const [ sex, ...pathParts ] = sourceId.split("/");
            const partPath = source.path || pathParts.join("/");
            const baseMetadataId = source.metadata ? sourceId : null;
            if (source.metadata) partMetadata.push({ id: sourceId, ...source.metadata });
            if (source.authoring) partAuthoring[sourceId] = CloneValue(source.authoring);

            for (const [ versionId, version ] of Object.entries(source.versions || {}))
            {
                const resourceVersion = versionId === "default" ? null : versionId;
                const versionMetadataId = version.metadata ? `${sourceId}/${versionId}` : null;
                if (version.metadata) partMetadata.push({ id: versionMetadataId, ...version.metadata });
                const resources = ResolveResources(source.resources || {}, version.resources || {});
                const resourcePaths = [
                    ...(resources.configPaths || []),
                    ...(resources.geometryPaths || []),
                    ...(resources.texturePaths || [])
                ];

                for (const [ partID, type ] of Object.entries(version.types || {}))
                {
                    const colorVariant = type.colorVariant ?? null;
                    const derivedColorId = colorVariant ? `${sourceId}/${colorVariant}`.toLowerCase() : null;
                    const colorId = type.materialId || derivedColorId;
                    parts.push({
                        id: partID,
                        typeID: type.typeID ?? null,
                        name: type.name || PosixBasename(partID),
                        sex,
                        category: TypeCategory(partID),
                        path: partPath,
                        resourceVersion,
                        colorVariant,
                        metadataId: versionMetadataId || baseMetadataId,
                        resourcePaths,
                        lodBundles: CloneValue(resources.lodBundles),
                        colorIds: colorId && catalogs.materials.some(value => value.id === colorId) ? [ colorId ] : [],
                        projectionId: source.projectionId ?? null
                    });
                }
            }
        }

        return {
            schema: data.schema,
            schemaVersion: 1,
            sourceTarget: data.sourceTarget ?? null,
            sourceGame: data.sourceGame ?? null,
            sourceProvider: data.sourceProvider ?? null,
            sourceBuild: data.sourceBuild ?? null,
            generatedAt: data.generatedAt ?? null,
            ...(data.sourceRefs ? { sourceRefs: { ...data.sourceRefs } } : {}),
            ...(data.sources ? { sources: data.sources.map(value => ({ ...value })) } : {}),
            modifierNames: CloneValue(data.modifierNames || {}),
            faceSetup: CloneValue(data.faceSetup || {}),
            recipeLinks: CloneValue(data.recipeLinks || {}),
            partAuthoring,
            presentation: CloneValue(data.presentation || {}),
            partMetadata: partMetadata.sort(CompareId),
            parts: parts.sort(CompareId),
            ...catalogs
        };
    }

    /** Applies prepared external identities to expanded part records. */
    static applyPartIdentities(data, identities)
    {
        return ApplyPartIdentities(this.expand(data), identities);
    }

    /** Builds the compact records used by runtime CjsCharacterLodBundle values. */
    static createLodBundles(configPaths = [], geometryPaths = [])
    {
        return BuildLodBundles(configPaths, geometryPaths);
    }

    /** Resolves a requested LOD while retaining one complete resource bundle. */
    static resolveLodBundle(values, requestedLod)
    {
        return ResolveLodBundle(values, requestedLod);
    }

    static resolvePartMaterialLink(part, materialIds, options = {})
    {
        const sex = String(part.sex || "").toLowerCase();
        const partPath = String(part.path || "").toLowerCase();
        const variant = String(part.colorVariant || "default").toLowerCase();
        const [ root, region ] = partPath.split("/");
        const candidates = [
            { id: `${sex}/${partPath}/${variant}`, mode: "logical" },
            options.sourceFolder ? { id: `${sex}/${String(options.sourceFolder).toLowerCase()}/${variant}`, mode: "sourceFolder" } : null,
            root ? { id: `${sex}/${root}/colors/${variant}`, mode: "sharedPalette" } : null,
            !part.colorVariant && region ? { id: `${sex}/${root}/${region}/colors/basecolor`, mode: "sharedBase" } : null,
            !part.colorVariant && root ? { id: `${sex}/${root}/colors/basecolor`, mode: "sharedBase" } : null
        ].filter(Boolean);

        for (const candidate of candidates)
        {
            if (materialIds.has(candidate.id)) return {
                ...candidate,
                implicit: !part.colorVariant
            };
        }
        return null;
    }

    static omitSourceProvenance(data)
    {
        delete data.sourceRefs;
        delete data.sources;

        for (const catalog of [
            "parts",
            "materials",
            "projections",
            "poses",
            "presets",
            "sculptFields",
            "blendshapeLimits",
        ])
        {
            for (const record of data[catalog])
            {
                delete record.sourceId;
                delete record.sourceIds;
            }
        }

        return data;
    }

}

const MORPH_CATEGORIES = new Set([ "bodyshapes", "facemodifiers", "utilityshapes" ]);

function BuildRecipeLinks(presets, sources, materials)
{
    const sourceByID = new Map(Object.entries(sources)
        .map(([ sourceID, source ]) => [ sourceID.toLowerCase(), [ sourceID, source ] ]));
    const materialIDs = new Set(Object.keys(materials));
    const result = {};

    for (const preset of [ ...presets ].sort(CompareId))
    {
        const presetID = String(preset.id || "");
        const sex = String(preset.sex || "").toLowerCase();
        result[presetID] = {
            presetID,
            sex,
            entries: (preset.entries || []).map((entry, entryIndex) =>
                BuildRecipeLink(entry, entryIndex, sex, sourceByID, materialIDs))
        };
    }

    return result;
}

function BuildRecipeLink(entry, entryIndex, sex, sourceByID, materialIDs)
{
    const category = String(entry.category || "").toLowerCase();
    const partPath = String(entry.path || "").replace(/^\/+|\/+$/gu, "");

    if (MORPH_CATEGORIES.has(category))
    {
        return {
            entryIndex,
            kind: "morph",
            status: "resolved",
            morphName: PosixBasename(partPath)
        };
    }

    if (sex !== "female" && sex !== "male")
    {
        return UnresolvedRecipeLink(entryIndex, "invalid-recipe-sex");
    }

    const material = CjsToolCharacterCompiler.resolvePartMaterialLink({
        sex,
        path: partPath,
        colorVariant: entry.colorVariation
    }, materialIDs);
    const sourceMatch = sourceByID.get(`${sex}/${partPath}`.toLowerCase());
    if (!sourceMatch)
    {
        if (material)
        {
            return ResolvedRecipeLink(entryIndex, "material", null, {
                materialID: material.id
            });
        }
        return UnresolvedRecipeLink(entryIndex, "source-not-found");
    }

    const [ sourceID, source ] = sourceMatch;
    const candidates = CollectRecipePartCandidates(source);
    if (candidates.length === 1)
    {
        return ResolvedRecipeLink(entryIndex, "part", sourceID, {
            partID: candidates[0].partID
        });
    }

    if (candidates.length > 1)
    {
        const requestedColor = NormalizeOptionalToken(entry.colorVariation);
        const colorMatches = requestedColor
            ? candidates.filter(candidate => NormalizeOptionalToken(candidate.colorVariant) === requestedColor)
            : [];

        if (colorMatches.length === 1)
        {
            return ResolvedRecipeLink(entryIndex, "part", sourceID, {
                partID: colorMatches[0].partID
            });
        }

        const candidatePartIDs = (colorMatches.length ? colorMatches : candidates)
            .map(candidate => candidate.partID);
        return {
            entryIndex,
            kind: "part",
            status: "ambiguous",
            sourceID,
            candidatePartIDs,
            issueCode: colorMatches.length > 1
                ? "duplicate-color-variation"
                : "missing-type-discriminator"
        };
    }

    const metadataID = ResolveRecipeMetadataID(sourceID, source);
    if (metadataID)
    {
        return ResolvedRecipeLink(entryIndex, "rule", sourceID, { metadataID });
    }

    if (material)
    {
        return ResolvedRecipeLink(entryIndex, "material", sourceID, {
            materialID: material.id
        });
    }

    return {
        ...UnresolvedRecipeLink(entryIndex, "no-selectable-content"),
        sourceID
    };
}

function CollectRecipePartCandidates(source)
{
    const values = [];
    for (const version of Object.values(source.versions || {}))
    {
        for (const [ partID, type ] of Object.entries(version.types || {}))
        {
            values.push({ partID, colorVariant: type.colorVariant ?? null });
        }
    }
    return values.sort((left, right) => Compare(left.partID, right.partID));
}

function ResolveRecipeMetadataID(sourceID, source)
{
    if (source.metadata)
    {
        return sourceID;
    }

    const versions = Object.entries(source.versions || {})
        .filter(([, version ]) => version.metadata);
    return versions.length === 1 ? `${sourceID}/${versions[0][0]}` : null;
}

function ResolvedRecipeLink(entryIndex, kind, sourceID, values)
{
    return { entryIndex, kind, status: "resolved", sourceID, ...values };
}

function UnresolvedRecipeLink(entryIndex, issueCode)
{
    return {
        entryIndex,
        kind: "unresolved",
        status: "unresolved",
        issueCode
    };
}

function NormalizeOptionalToken(value)
{
    const token = String(value ?? "").trim().toLowerCase();
    return token && token !== "none" ? token : null;
}

function CloneValue(value)
{
    if (Array.isArray(value)) return value.map(CloneValue);
    if (value && typeof value === "object")
    {
        return Object.fromEntries(Object.entries(value).map(([ key, item ]) => [ key, CloneValue(item) ]));
    }
    return value;
}

function ApplyPartIdentities(data, identities)
{
    if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.parts))
    {
        throw new TypeError("Character part identities require an expanded character library");
    }

    if (!identities || typeof identities !== "object" || Array.isArray(identities))
    {
        throw new TypeError("Character part identities must be an object");
    }

    if (identities.schema !== "carbonenginejs.characterPartIdentities"
        || Number(identities.schemaVersion) !== 1)
    {
        throw new TypeError("Unsupported character part-identities schema");
    }

    ValidateIdentitySource(data, identities, "sourceTarget", "sourceTarget");
    ValidateIdentitySource(data, identities, "sourceBuild", "sourceBuild");

    const values = identities.parts;

    if (!values || typeof values !== "object" || Array.isArray(values))
    {
        throw new TypeError("Character part identities.parts must be an object");
    }

    const partsByID = new Map(data.parts.map(part => [ String(part.id), part ]));
    const normalized = new Map();

    for (const [ id, value ] of Object.entries(values))
    {
        if (!partsByID.has(id))
        {
            throw new Error(`Character part identity references unknown part "${id}"`);
        }

        if (!value || typeof value !== "object" || Array.isArray(value))
        {
            throw new TypeError(`Character part identity "${id}" must be an object`);
        }

        const typeID = NormalizeExternalTypeID(value.typeID, id);
        const name = NormalizeIdentityName(value.name, id);

        if (typeID === null && name === null)
        {
            throw new Error(`Character part identity "${id}" has no typeID or name`);
        }

        normalized.set(id, { typeID, name });
    }

    return {
        ...data,
        parts: data.parts.map(part =>
        {
            const identity = normalized.get(String(part.id));

            return identity ? {
                ...part,
                ...(identity.typeID === null ? {} : { typeID: identity.typeID }),
                ...(identity.name === null ? {} : { name: identity.name }),
            } : { ...part };
        })
    };
}

function ValidateIdentitySource(data, identities, dataField, identityField)
{
    if (identities[identityField] === undefined || identities[identityField] === null
        || data[dataField] === undefined || data[dataField] === null)
    {
        return;
    }

    if (String(identities[identityField]).toLowerCase()
        !== String(data[dataField]).toLowerCase())
    {
        throw new Error(
            `Character part identities ${identityField} mismatch: `
            + `${identities[identityField]} != ${data[dataField]}`
        );
    }
}

function NormalizeExternalTypeID(value, partID)
{
    if (value === undefined || value === null || value === "")
    {
        return null;
    }

    if (typeof value === "number" && !Number.isSafeInteger(value))
    {
        throw new TypeError(`Character part identity "${partID}" typeID is not an exact integer`);
    }

    const typeID = String(value).trim();

    if (!/^[1-9]\d*$/u.test(typeID))
    {
        throw new TypeError(
            `Character part identity "${partID}" typeID must be a positive integer`
        );
    }

    return typeID;
}

function NormalizeIdentityName(value, partID)
{
    if (value === undefined || value === null)
    {
        return null;
    }

    const name = String(value).trim();

    if (!name)
    {
        throw new TypeError(`Character part identity "${partID}" name must be non-empty`);
    }

    return name;
}

function BuildPartSources(parts, metadata, projectionByFolder, partSourceResources, partAuthoring)
{
    const sources = new Map();
    for (const part of parts)
    {
        const sourceId = `${part.sex}/${String(part.path).toLowerCase()}`;
        const source = GetSource(sources, sourceId);
        if (partSourceResources[sourceId]) source.resources ||= SplitResources(partSourceResources[sourceId]);
        const derivedPath = sourceId.slice(sourceId.indexOf("/") + 1);
        if (part.path !== derivedPath) source.path = part.path;
        source.classification ||= ClassifyPart(part.path);
        if (projectionByFolder.has(sourceId)) source.projectionId = projectionByFolder.get(sourceId);

        const versionId = part.resourceVersion || "default";
        const resources = ResourceOverrides(SplitResources(part.resourcePaths, part.lodBundles), source.resources || {});
        const version = source.versions[versionId] ||= { resources, types: {} };
        if (JSON.stringify(version.resources) !== JSON.stringify(resources))
        {
            throw new Error(`Character part source "${sourceId}" version "${versionId}" has conflicting resources`);
        }
        const derivedMaterialId = part.colorVariant ? `${sourceId}/${part.colorVariant}`.toLowerCase() : null;
        const materialId = part.colorIds?.[0] || null;
        version.types[part.id] = CompactRecord({
            typeID: part.typeID,
            name: part.name && part.name !== PosixBasename(part.id) ? part.name : null,
            colorVariant: part.colorVariant,
            materialId: materialId !== derivedMaterialId ? materialId : null
        });
    }

    for (const [ sourceId, resourcePaths ] of Object.entries(partSourceResources))
    {
        GetSource(sources, sourceId).resources ||= SplitResources(resourcePaths);
    }

    for (const record of metadata)
    {
        const body = CompactMetadata(record);
        delete body.id;
        if (sources.has(record.id)) GetSource(sources, record.id).metadata = body;
        else
        {
            const parentId = PosixDirname(record.id);
            const versionId = PosixBasename(record.id);
            const parent = sources.get(parentId);
            if (parent?.versions?.[versionId]) parent.versions[versionId].metadata = body;
            else
            {
                const source = GetSource(sources, record.id);
                source.classification ||= ClassifyPart(record.id.split("/").slice(1).join("/"));
                source.metadata = body;
            }
        }
    }

    for (const [ sourceId, authoring ] of Object.entries(partAuthoring))
    {
        GetSource(sources, sourceId).authoring = CloneValue(authoring);
    }

    return Object.fromEntries(Array.from(sources).sort(([ a ], [ b ]) => Compare(a, b))
        .map(([ id, source ]) => [ id, CompactRecord(source, false) ]));
}

function ResourceOverrides(resources, inherited)
{
    return CompactRecord(Object.fromEntries(Object.entries(resources).filter(([ key, values ]) =>
        JSON.stringify(values) !== JSON.stringify(inherited[key] || []))), false);
}

function ResolveResources(inherited, overrides)
{
    const result = Object.fromEntries([ "configPaths", "geometryPaths", "texturePaths" ].map(key => [
        key,
        Object.hasOwn(overrides, key) ? overrides[key] : inherited[key] || []
    ]));
    const modelsOverridden = Object.hasOwn(overrides, "configPaths")
        || Object.hasOwn(overrides, "geometryPaths");

    result.lodBundles = Object.hasOwn(overrides, "lodBundles")
        ? CloneValue(overrides.lodBundles)
        : !modelsOverridden && Object.hasOwn(inherited, "lodBundles")
            ? CloneValue(inherited.lodBundles)
            : BuildLodBundles(result.configPaths, result.geometryPaths);

    return result;
}

function GetSource(sources, id)
{
    if (!sources.has(id)) sources.set(id, { versions: {} });
    return sources.get(id);
}

function SplitResources(values = [], lodBundles = null)
{
    const result = { configPaths: [], geometryPaths: [], texturePaths: [] };
    for (const value of values)
    {
        const extension = PosixExtname(value).toLowerCase();
        if (extension === ".black") result.configPaths.push(value);
        else if (extension === ".gr2") result.geometryPaths.push(value);
        else result.texturePaths.push(value);
    }
    result.lodBundles = Array.isArray(lodBundles) && lodBundles.length
        ? NormalizeLodBundles(lodBundles)
        : BuildLodBundles(result.configPaths, result.geometryPaths);
    return CompactRecord(result, false);
}

function BuildLodBundles(configPaths, geometryPaths)
{
    const geometries = NormalizeResourcePaths(geometryPaths).map(ParseModelPath);
    const bundles = [];

    for (const configurationPath of NormalizeResourcePaths(configPaths))
    {
        const configuration = ParseModelPath(configurationPath);
        const candidates = geometries
            .filter(value => value.modelFamily === configuration.modelFamily
                && value.lod === configuration.lod)
            .sort((a, b) => CompareGeometryCandidates(configuration, a, b));
        const geometry = candidates[0];

        if (!geometry) continue;

        bundles.push({
            requestedLod: null,
            resolvedLod: configuration.lod,
            configurationPath: configuration.path,
            geometryPath: geometry.path,
            modelFamily: configuration.modelFamily,
            fallbackReason: ""
        });
    }

    return bundles.sort(CompareLodBundles);
}

function NormalizeLodBundles(values)
{
    return values.map(value => ({
        requestedLod: value.requestedLod ?? null,
        resolvedLod: value.resolvedLod ?? null,
        configurationPath: String(value.configurationPath || ""),
        geometryPath: String(value.geometryPath || ""),
        modelFamily: String(value.modelFamily || ""),
        fallbackReason: String(value.fallbackReason || "")
    })).filter(value => value.configurationPath && value.geometryPath)
        .sort(CompareLodBundles);
}

function NormalizeResourcePaths(values)
{
    if (!Array.isArray(values))
    {
        throw new TypeError("Character LOD resource paths must be arrays");
    }

    return [ ...new Set(values.map(value => String(value || "")).filter(Boolean)) ]
        .sort(Compare);
}

function ParseModelPath(value)
{
    const path = String(value || "");
    const separator = path.lastIndexOf("/");
    const dot = path.lastIndexOf(".");
    const stem = path.slice(separator + 1, dot > separator ? dot : undefined).toLowerCase();
    const match = stem.match(/_lod(\d+)/u);
    const family = stem
        .replace(/_lod\d+.*$/u, "")
        .replace(/_(?:nosim|wopockets)$/u, "")
        .replace(/[^a-z0-9]/gu, "");

    return {
        path,
        directory: path.slice(0, Math.max(separator, 0)).toLowerCase(),
        stem,
        modelFamily: family,
        lod: match ? Number(match[1]) : null
    };
}

function CompareGeometryCandidates(configuration, a, b)
{
    const directoryA = a.directory === configuration.directory ? 0 : 1;
    const directoryB = b.directory === configuration.directory ? 0 : 1;

    if (directoryA !== directoryB) return directoryA - directoryB;

    const stemA = a.stem === configuration.stem ? 0 : 1;
    const stemB = b.stem === configuration.stem ? 0 : 1;

    return stemA - stemB || Compare(a.path, b.path);
}

function CompareLodBundles(a, b)
{
    const lodA = a.resolvedLod === null ? -1 : a.resolvedLod;
    const lodB = b.resolvedLod === null ? -1 : b.resolvedLod;

    return lodA - lodB
        || Compare(a.modelFamily, b.modelFamily)
        || Compare(a.configurationPath, b.configurationPath)
        || Compare(a.geometryPath, b.geometryPath);
}

function ResolveLodBundle(values, requestedLod)
{
    const lod = NormalizeRequestedLod(requestedLod);
    const bundles = NormalizeLodBundles(values || []);

    if (!bundles.length) return null;

    const exact = lod === null
        ? null
        : bundles.find(value => value.resolvedLod === lod);
    const base = bundles.find(value => value.resolvedLod === null);
    const selected = exact || base || SelectNearestLodBundle(bundles, lod);

    return {
        ...selected,
        requestedLod: lod,
        fallbackReason: exact || (lod === null && selected === base)
            ? ""
            : selected === base ? "base" : "nearest"
    };
}

function SelectNearestLodBundle(bundles, requestedLod)
{
    if (requestedLod === null) return bundles[0];

    return bundles.slice().sort((a, b) =>
    {
        const distanceA = Math.abs(a.resolvedLod - requestedLod);
        const distanceB = Math.abs(b.resolvedLod - requestedLod);

        // Match the native medium fallback: low detail precedes high detail
        // when both are equally distant from the requested LOD.
        return distanceA - distanceB
            || b.resolvedLod - a.resolvedLod
            || CompareLodBundles(a, b);
    })[0];
}

function NormalizeRequestedLod(value)
{
    if (value === null || value === undefined) return null;

    const lod = Number(value);

    if (!Number.isInteger(lod) || lod < 0)
    {
        throw new TypeError(`Character LOD must be a non-negative integer or null, received ${value}`);
    }

    return lod;
}

function KeyCatalog(records)
{
    return Object.fromEntries(records.map(record =>
    {
        const body = CompactRecord(record);
        delete body.id;
        return [ record.id, body ];
    }).sort(([ a ], [ b ]) => Compare(a, b)));
}

function ExpandCatalog(records)
{
    return Object.entries(records).map(([ id, record ]) => ({ id, ...record })).sort(CompareId);
}

function CompactRecord(record, omitNull = true)
{
    return Object.fromEntries(Object.entries(record).filter(([_key, value]) =>
    {
        if (value === undefined) return false;
        if (omitNull && value === null) return false;
        if (Array.isArray(value) && !value.length) return false;
        if (IsPlainObject(value) && !Object.keys(value).length) return false;
        return true;
    }));
}

function CompactMetadata(record)
{
    return Object.fromEntries(Object.entries(CompactRecord(record)).filter(([_key, value]) =>
        value !== false && value !== ""));
}

function ClassifyPart(partPath)
{
    const [ root, regionName = "" ] = String(partPath).toLowerCase().split("/");
    const result = {};
    if (root === "accessories")
    {
        result.type = "accessory";
        if (regionName === "glasses") result.kind = "eyewear";
        else if (regionName === "masks") result.kind = "mask";
        else
        {
            result.kind = "piercing";
            result.region = ({ earslow: "ear", earshigh: "ear", brow: "eyebrow", lips: "lip" })[regionName] || regionName;
            if (regionName === "earslow") result.placement = "low";
            if (regionName === "earshigh") result.placement = "high";
        }
    }
    else if (root === "tattoo" || root === "scars" || root === "hair" || root === "beard" || root === "makeup" || root === "skintype" || root === "archetypes")
    {
        result.type = "bodyPart";
        result.kind = ({ scars: "scar", skintype: "skin", archetypes: "archetype", beard: "facialHair" })[root] || root;
        SetRegion(result, regionName || (root === "hair" || root === "beard" ? "head" : ""));
    }
    else
    {
        result.type = "clothing";
        result.layer = ({ outer: "outer", topouter: "mid", topmiddle: "top", bottomouter: "bottom", feet: "feet", bottomunderwear: "underwear", topunderwear: "underwear" })[root] || root;
    }
    return CompactRecord(result);
}

function SetRegion(result, value)
{
    if (!value) return;
    if (value === "armleft" || value === "armright")
    {
        result.region = "arm";
        result.side = value === "armleft" ? "left" : "right";
    }
    else result.region = value;
}

function IndexProjectionsByFolder(projectionIds)
{
    const grouped = new Map();
    for (const id of projectionIds)
    {
        const folder = PosixDirname(id).toLowerCase();
        if (!grouped.has(folder)) grouped.set(folder, []);
        grouped.get(folder).push(id);
    }
    return new Map(Array.from(grouped).filter(([_folder, ids]) => ids.length === 1).map(([ folder, ids ]) => [ folder, ids[0] ]));
}

function TypeCategory(partID)
{
    const relative = partID.split("/").slice(1);
    return relative.slice(0, -2).join("/");
}

function CompareId(a, b)
{
    return Compare(String(a.id), String(b.id));
}

function Compare(a, b)
{
    return a < b ? -1 : a > b ? 1 : 0;
}

function PosixBasename(value)
{
    const input = String(value || "");
    return input.slice(input.lastIndexOf("/") + 1);
}

function PosixDirname(value)
{
    const input = String(value || "");
    const index = input.lastIndexOf("/");
    return index < 0 ? "." : index === 0 ? "/" : input.slice(0, index);
}

function PosixExtname(value)
{
    const name = PosixBasename(value);
    const index = name.lastIndexOf(".");
    return index <= 0 ? "" : name.slice(index);
}

function IsPlainObject(value)
{
    return value && typeof value === "object" && !Array.isArray(value);
}
