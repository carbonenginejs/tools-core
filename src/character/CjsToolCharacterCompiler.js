const KEYED_CATALOGS = [
    "materials", "projections", "poses", "presets", "sculptFields",
    "blendshapeLimits", "uniqueCharacters"
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

                for (const [ typeId, type ] of Object.entries(version.types || {}))
                {
                    const colorVariant = type.colorVariant ?? null;
                    const derivedColorId = colorVariant ? `${sourceId}/${colorVariant}`.toLowerCase() : null;
                    const colorId = type.materialId || derivedColorId;
                    parts.push({
                        id: typeId,
                        name: PosixBasename(typeId),
                        sex,
                        category: TypeCategory(typeId),
                        path: partPath,
                        resourceVersion,
                        colorVariant,
                        metadataId: versionMetadataId || baseMetadataId,
                        resourcePaths,
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
            partAuthoring,
            presentation: CloneValue(data.presentation || {}),
            partMetadata: partMetadata.sort(CompareId),
            parts: parts.sort(CompareId),
            ...catalogs
        };
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

function CloneValue(value)
{
    if (Array.isArray(value)) return value.map(CloneValue);
    if (value && typeof value === "object")
    {
        return Object.fromEntries(Object.entries(value).map(([ key, item ]) => [ key, CloneValue(item) ]));
    }
    return value;
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
        const resources = ResourceOverrides(SplitResources(part.resourcePaths), source.resources || {});
        const version = source.versions[versionId] ||= { resources, types: {} };
        if (JSON.stringify(version.resources) !== JSON.stringify(resources))
        {
            throw new Error(`Character part source "${sourceId}" version "${versionId}" has conflicting resources`);
        }
        const derivedMaterialId = part.colorVariant ? `${sourceId}/${part.colorVariant}`.toLowerCase() : null;
        const materialId = part.colorIds?.[0] || null;
        version.types[part.id] = CompactRecord({
            colorVariant: part.colorVariant,
            materialId: materialId !== derivedMaterialId ? materialId : null
        });
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
    return Object.fromEntries([ "configPaths", "geometryPaths", "texturePaths" ].map(key => [
        key,
        Object.hasOwn(overrides, key) ? overrides[key] : inherited[key] || []
    ]));
}

function GetSource(sources, id)
{
    if (!sources.has(id)) sources.set(id, { versions: {} });
    return sources.get(id);
}

function SplitResources(values = [])
{
    const result = { configPaths: [], geometryPaths: [], texturePaths: [] };
    for (const value of values)
    {
        const extension = PosixExtname(value).toLowerCase();
        if (extension === ".black") result.configPaths.push(value);
        else if (extension === ".gr2") result.geometryPaths.push(value);
        else result.texturePaths.push(value);
    }
    return CompactRecord(result, false);
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

function TypeCategory(typeId)
{
    const relative = typeId.split("/").slice(1);
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
