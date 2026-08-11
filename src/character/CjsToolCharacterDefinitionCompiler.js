import { CjsFileIndex } from "@carbonenginejs/tools-browser/fileindex";

const CONFIGURATION_EXTENSIONS = new Set([ ".black", ".red" ]);
const GEOMETRY_EXTENSIONS = new Set([ ".gr2" ]);
const TEXTURE_EXTENSIONS = new Set([ ".dds", ".jpeg", ".jpg", ".png", ".tga" ]);
const METADATA_FIELDS = new Set([
    "alternativeTextureSourcePath",
    "dependantModifiers",
    "dependentModifiers",
    "forcesLooseTop",
    "hidesBootShin",
    "lod1Replacement",
    "lod2Replacement",
    "numColorAreas",
    "occludesModifiers",
    "soundTag",
    "swapBottom",
    "swapSocks",
    "swapTops",
    "wap",
]);

/** Retains decoded definitions losslessly and adds typed catalogs from an exact resource index. */
export class CjsToolCharacterDefinitionCompiler
{

    /** Compiles decoded JSON without reading source bytes or inferring render policy. */
    static compile(index, {
        definitions = {},
        characterResources = {},
        characterModifierLocations = {},
        sourceBuild = null,
    } = {})
    {
        if (!(index instanceof CjsFileIndex) || index.root !== "res")
        {
            throw new TypeError(
                "CjsToolCharacterDefinitionCompiler requires a res-rooted CjsFileIndex"
            );
        }

        RequireObject(definitions, "Character definitions");
        const resources = IndexCharacterResources(characterResources);
        const modifierLocations = IndexModifierLocations(characterModifierLocations);
        const partTypes = new Map();
        const partSources = new Map();
        const partMetadata = new Map();
        const characterDefinitions = {};
        const metadataDefinitions = [];
        const matchedResourcePaths = new Set();
        const report = CreateReport(index, sourceBuild, resources.paths.size);

        report.inputDefinitions = Object.keys(definitions).length;

        for (const definitionPath of Object.keys(definitions).sort(Compare))
        {
            const entry = index.Find(definitionPath);

            if (!entry)
            {
                report.missingIndexEntries.push(definitionPath);
                continue;
            }

            try
            {
                AddDefinition(
                    characterDefinitions,
                    entry.logicalPath,
                    definitions[definitionPath]
                );
                report.retainedDefinitions++;
            }
            catch (error)
            {
                report.errors.push({
                    path: entry.logicalPath,
                    message: error.message,
                });
                continue;
            }

            if (IsMetadataDefinition(entry.logicalPath))
            {
                report.metadataDefinitions++;
                metadataDefinitions.push({
                    logicalPath: entry.logicalPath,
                    values: definitions[definitionPath],
                });
                continue;
            }

            if (!entry.logicalPath.toLowerCase().endsWith(".type"))
            {
                report.unprojectedDefinitions++;
                continue;
            }

            report.typeDefinitions++;

            try
            {
                const location = ParseDefinitionLocation(entry.logicalPath);
                const definition = ParseTypeDefinition(
                    definitions[definitionPath],
                    entry.logicalPath
                );
                const partSourceID = `${location.sex}/${definition.partPath}`;
                const resourceMatches = FindResourceMatches(
                    resources.paths,
                    entry.logicalPath,
                    location.relativePath
                );
                const recordIDs = resourceMatches.length
                    ? resourceMatches
                    : [ entry.logicalPath ];
                const projection = {
                    sourcePath: entry.logicalPath,
                    sex: location.sex,
                    partPath: definition.partPath,
                    resourceVersion: definition.resourceVersion,
                    colorVariant: definition.colorVariant,
                    bloodlineIDs: definition.bloodlineIDs,
                    partSource: partSourceID,
                };

                // Validate the entire additive projection before mutating any
                // typed catalog. A projection failure must leave only the
                // retained source definition, never a partial typed record.
                for (const recordID of recordIDs)
                {
                    ValidatePartType(partTypes, recordID, projection);
                }

                const partSource = GetPartSource(
                    partSources,
                    partSourceID,
                    location.sex,
                    definition.partPath
                );

                partSource.sourcePaths.add(location.sourcePath);
                partSource.resourceVersions.add(definition.resourceVersion);

                if (resourceMatches.length)
                {
                    report.linkedDefinitions++;
                    for (const match of resourceMatches)
                    {
                        matchedResourcePaths.add(match.toLowerCase());
                    }
                }
                else
                {
                    report.unlinkedDefinitions.push(entry.logicalPath);
                }

                for (const recordID of recordIDs)
                {
                    AddPartType(partTypes, recordID, projection);
                }

                report.projectedDefinitions++;
            }
            catch (error)
            {
                report.unprojectedDefinitions++;
                report.projectionErrors.push({
                    path: entry.logicalPath,
                    message: error.message,
                });
            }
        }

        for (const definition of metadataDefinitions)
        {
            try
            {
                ProjectMetadataDefinition(
                    partMetadata,
                    partSources,
                    definition.logicalPath,
                    definition.values
                );
                report.projectedDefinitions++;
            }
            catch (error)
            {
                report.unprojectedDefinitions++;
                report.projectionErrors.push({
                    path: definition.logicalPath,
                    message: error.message,
                });
            }
        }

        report.unresolvedCharacterResourcePaths = [ ...resources.paths.values() ]
            .flatMap(values => [ ...values ])
            .filter(value => !matchedResourcePaths.has(value.toLowerCase()))
            .sort(Compare);

        report.droppedDefinitions = report.inputDefinitions - report.retainedDefinitions;

        // Retention is the compilation boundary: typed catalogs are indexes
        // over decoded source values, never a replacement for those values.
        if (report.droppedDefinitions || report.missingIndexEntries.length || report.errors.length)
        {
            ThrowCompileError(report);
        }

        PopulateModifierReferences(
            index,
            partSources,
            partMetadata,
            modifierLocations,
            report
        );
        PopulateCandidates(index, partSources, report);
        const result = {
            characterDefinitions,
            partTypes: FinalizePartTypes(partTypes),
            partSources: FinalizePartSources(partSources),
            partMetadata: FinalizePartMetadata(partMetadata),
            report,
        };

        report.partTypes = Object.keys(result.partTypes).length;
        report.partSources = Object.keys(result.partSources).length;
        report.partMetadata = Object.keys(result.partMetadata).length;
        report.multiSourcePartTypes = Object.values(result.partTypes)
            .filter(value => value.partSources.length > 1).length;
        report.multiFolderPartSources = Object.values(result.partSources)
            .filter(value => value.sourcePaths.length > 1).length;
        return result;
    }

}

function CreateReport(index, sourceBuild, characterResourcePaths)
{
    return {
        schema: "carbonenginejs.characterDefinitionCompileReport",
        schemaVersion: 5,
        sourceBuild: sourceBuild === null || sourceBuild === undefined
            ? null
            : String(sourceBuild),
        indexedFiles: index.count,
        inputDefinitions: 0,
        retainedDefinitions: 0,
        projectedDefinitions: 0,
        unprojectedDefinitions: 0,
        droppedDefinitions: 0,
        typeDefinitions: 0,
        metadataDefinitions: 0,
        linkedDefinitions: 0,
        characterResourcePaths,
        partTypes: 0,
        partSources: 0,
        partMetadata: 0,
        multiSourcePartTypes: 0,
        multiFolderPartSources: 0,
        unlinkedDefinitions: [],
        unresolvedCharacterResourcePaths: [],
        missingIndexEntries: [],
        errors: [],
        projectionErrors: [],
        candidateResources: {
            configuration: 0,
            geometry: 0,
            texture: 0,
        },
        modifierReferences: {
            dependencies: 0,
            occlusions: 0,
            partSourceTargets: 0,
            modifierLocationTargets: 0,
            utilityShapeTargets: 0,
            explicitUtilityShapeWeights: 0,
            suffixed: 0,
            unresolved: 0,
        },
    };
}

function AddDefinition(definitions, logicalPath, values)
{
    if (Object.hasOwn(definitions, logicalPath))
    {
        throw new Error(`Duplicate decoded character definition ${JSON.stringify(logicalPath)}`);
    }

    definitions[logicalPath] = {
        sourcePath: logicalPath,
        extension: Extension(logicalPath),
        values: CloneJSON(values, `Character definition ${logicalPath}`, new WeakSet()),
    };
}

function CloneJSON(value, label, stack)
{
    if (value === null || typeof value === "string" || typeof value === "boolean")
    {
        return value;
    }
    if (typeof value === "number")
    {
        if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number`);
        return value;
    }
    if (!value || typeof value !== "object")
    {
        throw new TypeError(`${label} contains a non-JSON value`);
    }
    if (stack.has(value))
    {
        throw new TypeError(`${label} contains a circular value`);
    }

    stack.add(value);
    let result;

    if (Array.isArray(value))
    {
        result = value.map((child, index) => CloneJSON(child, `${label}[${index}]`, stack));
    }
    else
    {
        const prototype = Object.getPrototypeOf(value);

        if (prototype !== Object.prototype && prototype !== null)
        {
            throw new TypeError(`${label} contains a non-plain object`);
        }

        result = Object.fromEntries(Object.entries(value).map(([ key, child ]) => [
            key,
            CloneJSON(child, `${label}.${key}`, stack),
        ]));
    }

    stack.delete(value);
    return result;
}

function IndexCharacterResources(value)
{
    const records = [];

    if (Array.isArray(value))
    {
        for (const record of value) records.push(record);
    }
    else
    {
        RequireObject(value, "Character resources");
        for (const record of Object.values(value)) records.push(record);
    }

    const paths = new Map();

    for (let index = 0; index < records.length; index++)
    {
        const record = RequireObject(records[index], `Character resources[${index}]`);

        if (record.resPath === null || record.resPath === undefined) continue;

        const resPath = RequireString(
            record.resPath,
            `Character resources[${index}].resPath`
        ).replaceAll("\\", "/");
        const key = resPath.toLowerCase();

        if (!paths.has(key)) paths.set(key, new Set());
        paths.get(key).add(resPath);
    }

    return { paths };
}

function IndexModifierLocations(value)
{
    const entries = Array.isArray(value)
        ? value.map((record, index) => [ record?.recordID ?? index, record ])
        : Object.entries(RequireObject(value, "Character modifier locations"));
    const byModifierPath = new Map();

    for (let index = 0; index < entries.length; index++)
    {
        const [ inputID, input ] = entries[index];
        const record = RequireObject(input, `Character modifier locations[${index}]`);
        const recordID = RequireString(
            record.recordID ?? inputID,
            `Character modifier locations[${index}].recordID`
        );
        const modifierPath = NormalizePartPath(
            record.modifierKey,
            `Character modifier locations[${index}].modifierKey`
        );

        if (!byModifierPath.has(modifierPath)) byModifierPath.set(modifierPath, new Set());
        byModifierPath.get(modifierPath).add(recordID);
    }

    return byModifierPath;
}

function ParseDefinitionLocation(logicalPath)
{
    const match = logicalPath.match(
        /^res:\/graphics\/character\/(?:(female|male)\/paperdoll|modular\/(female|male))\/(.+)$/u
    );

    if (!match)
    {
        throw new Error("Character type definition is outside a supported character root");
    }

    const relativePath = match[3];
    const marker = Math.max(
        relativePath.lastIndexOf("/types/"),
        relativePath.lastIndexOf("/type/")
    );

    if (marker <= 0 || !relativePath.endsWith(".type"))
    {
        throw new Error("Character type definition must live below a types folder");
    }

    return {
        sex: match[1] ?? match[2],
        relativePath,
        sourcePath: logicalPath.slice(0, logicalPath.length - relativePath.length)
            + relativePath.slice(0, marker),
    };
}

function ParseTypeDefinition(value, logicalPath)
{
    if (!Array.isArray(value) || (value.length !== 3 && value.length !== 4))
    {
        throw new TypeError(
            `Character type definition ${logicalPath} must contain three or four values`
        );
    }

    const partPath = NormalizePartPath(value[0], `${logicalPath}[0]`);
    const resourceVersion = OptionalString(value[1], `${logicalPath}[1]`);
    const colorVariant = OptionalString(value[2], `${logicalPath}[2]`);
    const bloodlineIDs = value.length === 4
        ? NormalizeIdentifierList(value[3], `${logicalPath}[3]`)
        : [];

    return { partPath, resourceVersion, colorVariant, bloodlineIDs };
}

function IsMetadataDefinition(logicalPath)
{
    return logicalPath.toLowerCase().endsWith("/metadata.yaml");
}

function ProjectMetadataDefinition(partMetadata, partSources, logicalPath, values)
{
    const location = ParseMetadataLocation(logicalPath);
    const metadata = ParseMetadataDefinition(values, logicalPath);
    const owner = FindMetadataOwner(partSources, location);

    if (owner.source.metadata.has(location.resourceVersion))
    {
        throw new Error(
            `Character part source ${owner.recordID} has more than one metadata definition `
            + `for resource version ${JSON.stringify(location.resourceVersion)}`
        );
    }

    owner.source.sourcePaths.add(location.sourcePath);
    owner.source.resourceVersions.add(location.resourceVersion);
    owner.source.metadata.set(location.resourceVersion, logicalPath);

    if (partMetadata.has(logicalPath))
    {
        throw new Error(`Duplicate character part metadata ${JSON.stringify(logicalPath)}`);
    }

    partMetadata.set(logicalPath, {
        sourcePath: logicalPath,
        ...metadata,
    });
}

function ParseMetadataLocation(logicalPath)
{
    const match = logicalPath.match(
        /^res:\/graphics\/character\/(?:(female|male)\/paperdoll|modular\/(female|male))\/(.+)\/metadata\.yaml$/u
    );

    if (!match)
    {
        throw new Error("Character metadata definition is outside a supported character root");
    }

    const sex = match[1] ?? match[2];
    const segments = match[3].split("/");
    let resourceVersion = null;

    if (/^v\d+$/u.test(segments.at(-1)))
    {
        resourceVersion = segments.pop();
    }

    const partPath = NormalizePartPath(
        segments.join("/"),
        `${logicalPath} source path`
    );
    const rootLength = logicalPath.length - match[3].length - "/metadata.yaml".length;
    const root = logicalPath.slice(0, rootLength);

    return {
        sex,
        partPath,
        resourceVersion,
        root,
        sourcePath: `${root}${partPath}`,
    };
}

function ParseMetadataDefinition(value, logicalPath)
{
    const source = RequireObject(value, `Character metadata definition ${logicalPath}`);
    const unknown = Object.keys(source).filter(key => !METADATA_FIELDS.has(key)).sort(Compare);

    if (unknown.length)
    {
        throw new TypeError(
            `Character metadata definition ${logicalPath} contains unsupported field ${unknown[0]}`
        );
    }
    if (Object.hasOwn(source, "dependantModifiers")
        && Object.hasOwn(source, "dependentModifiers"))
    {
        throw new TypeError(
            `Character metadata definition ${logicalPath} defines both dependency spellings`
        );
    }

    const result = {};

    CopyOptionalString(source, result, "alternativeTextureSourcePath", logicalPath);
    CopyOptionalBoolean(source, result, "forcesLooseTop", logicalPath);
    CopyOptionalBoolean(source, result, "hidesBootShin", logicalPath);
    CopyOptionalString(source, result, "lod1Replacement", logicalPath);
    CopyOptionalString(source, result, "lod2Replacement", logicalPath);
    CopyOptionalInt32(source, result, "numColorAreas", logicalPath);
    CopyOptionalInt32(source, result, "soundTag", logicalPath);
    CopyOptionalBoolean(source, result, "swapTops", logicalPath);
    CopyOptionalBoolean(source, result, "swapBottom", logicalPath);
    CopyOptionalBoolean(source, result, "swapSocks", logicalPath);
    CopyOptionalBoolean(source, result, "wap", logicalPath);

    if (Object.hasOwn(source, "dependantModifiers")
        || Object.hasOwn(source, "dependentModifiers"))
    {
        const field = Object.hasOwn(source, "dependantModifiers")
            ? "dependantModifiers"
            : "dependentModifiers";

        result.dependentModifiers = NormalizeStringList(
            source[field],
            `${logicalPath}.${field}`
        );
    }

    if (Object.hasOwn(source, "occludesModifiers"))
    {
        result.occludesModifiers = NormalizeStringList(
            source.occludesModifiers,
            `${logicalPath}.occludesModifiers`
        );
    }

    result.dependencies = (result.dependentModifiers ?? []).map(authoredValue => ({
        authoredValue,
    }));
    result.occlusions = (result.occludesModifiers ?? []).map(authoredValue => ({
        authoredValue,
    }));

    return result;
}

function FindMetadataOwner(partSources, location)
{
    const matches = [];

    for (const [ recordID, source ] of partSources)
    {
        if (source.sex === location.sex && source.sourcePaths.has(location.sourcePath))
        {
            matches.push({ recordID, source });
        }
    }

    if (matches.length > 1)
    {
        throw new Error(
            `Character metadata source folder ${JSON.stringify(location.sourcePath)} `
            + `has ${matches.length} typed owners`
        );
    }
    if (matches.length === 1)
    {
        return matches[0];
    }

    const recordID = `${location.sex}/${location.partPath}`;
    const source = GetPartSource(
        partSources,
        recordID,
        location.sex,
        location.partPath
    );

    return { recordID, source };
}

function CopyOptionalString(source, target, field, logicalPath)
{
    if (!Object.hasOwn(source, field)) return;

    const value = source[field];

    if (value !== null && typeof value !== "string")
    {
        throw new TypeError(`${logicalPath}.${field} must be a string or null`);
    }

    target[field] = value;
}

function CopyOptionalBoolean(source, target, field, logicalPath)
{
    if (!Object.hasOwn(source, field)) return;

    const value = source[field];

    if (value !== null && typeof value !== "boolean")
    {
        throw new TypeError(`${logicalPath}.${field} must be a boolean or null`);
    }

    target[field] = value;
}

function CopyOptionalInt32(source, target, field, logicalPath)
{
    if (!Object.hasOwn(source, field)) return;

    const value = source[field];

    if (value !== null
        && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647))
    {
        throw new TypeError(`${logicalPath}.${field} must be an int32 or null`);
    }

    target[field] = value;
}

function NormalizeStringList(value, label)
{
    if (value === null) return [];
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array or null`);

    return value.map((item, index) =>
    {
        if (typeof item !== "string" || !item)
        {
            throw new TypeError(`${label}[${index}] must be a non-empty string`);
        }

        return item;
    });
}

function FindResourceMatches(paths, logicalPath, relativePath)
{
    const matches = new Set();

    for (const key of [ logicalPath.toLowerCase(), relativePath.toLowerCase() ])
    {
        for (const match of paths.get(key) ?? []) matches.add(match);
    }

    return [ ...matches ].sort(Compare);
}

function GetPartSource(partSources, recordID, sex, partPath)
{
    let source = partSources.get(recordID);

    if (!source)
    {
        source = {
            sex,
            partPath,
            sourcePaths: new Set(),
            resourceVersions: new Set(),
            candidates: new Map(),
            metadata: new Map(),
        };
        partSources.set(recordID, source);
    }

    return source;
}

function AddPartType(partTypes, recordID, value)
{
    let partType = partTypes.get(recordID);

    if (!partType)
    {
        partType = {
            partPath: value.partPath,
            resourceVersion: value.resourceVersion,
            colorVariant: value.colorVariant,
            bloodlineIDs: [ ...value.bloodlineIDs ],
            sourcePaths: new Set(),
            sexes: new Set(),
            partSources: new Set(),
        };
        partTypes.set(recordID, partType);
    }
    else
    {
        RequireEqual(partType.partPath, value.partPath, recordID, "partPath");
        RequireEqual(
            partType.resourceVersion,
            value.resourceVersion,
            recordID,
            "resourceVersion"
        );
        RequireEqual(partType.colorVariant, value.colorVariant, recordID, "colorVariant");

        if (!EqualLists(partType.bloodlineIDs, value.bloodlineIDs))
        {
            throw new Error(
                `Character part type ${recordID} has conflicting bloodlineIDs`
            );
        }
    }

    partType.sourcePaths.add(value.sourcePath);
    partType.sexes.add(value.sex);
    partType.partSources.add(value.partSource);
}

function ValidatePartType(partTypes, recordID, value)
{
    const partType = partTypes.get(recordID);

    if (!partType) return;

    RequireEqual(partType.partPath, value.partPath, recordID, "partPath");
    RequireEqual(
        partType.resourceVersion,
        value.resourceVersion,
        recordID,
        "resourceVersion"
    );
    RequireEqual(partType.colorVariant, value.colorVariant, recordID, "colorVariant");

    if (!EqualLists(partType.bloodlineIDs, value.bloodlineIDs))
    {
        throw new Error(
            `Character part type ${recordID} has conflicting bloodlineIDs`
        );
    }
}

function PopulateModifierReferences(
    index,
    partSources,
    partMetadata,
    modifierLocations,
    report
)
{
    const candidateFolders = IndexCandidateFolders(index);

    for (const metadata of partMetadata.values())
    {
        const owner = ParseMetadataLocation(metadata.sourcePath);

        for (const [ field, countField, dependency ] of [
            [ "dependencies", "dependencies", true ],
            [ "occlusions", "occlusions", false ],
        ])
        {
            for (const relation of metadata[field])
            {
                report.modifierReferences[countField]++;
                PopulateModifierReference(
                    relation,
                    owner,
                    candidateFolders,
                    partSources,
                    modifierLocations,
                    report,
                    dependency
                );
            }
        }
    }
}

function PopulateModifierReference(
    relation,
    owner,
    candidateFolders,
    partSources,
    modifierLocations,
    report,
    dependency
)
{
    let utilityShape = false;
    let modifierPath;
    const weightedUtility = dependency
        ? ParseWeightedUtilityDependency(relation.authoredValue)
        : null;

    if (weightedUtility)
    {
        modifierPath = weightedUtility.modifierPath;
        relation.modifierPath = modifierPath;
        relation.weight = weightedUtility.weight;
        utilityShape = true;
        report.modifierReferences.utilityShapeTargets++;
        report.modifierReferences.explicitUtilityShapeWeights++;
    }
    else if (relation.authoredValue.includes("#"))
    {
        report.modifierReferences.suffixed++;
        report.modifierReferences.unresolved++;
        return;
    }
    else
    {
        try
        {
            modifierPath = NormalizePartPath(
                relation.authoredValue,
                `Character modifier reference ${JSON.stringify(relation.authoredValue)}`
            );
        }
        catch
        {
            report.modifierReferences.unresolved++;
            return;
        }

        relation.modifierPath = modifierPath;
        if (dependency && modifierPath.startsWith("utilityshapes/"))
        {
            relation.weight = 1;
            utilityShape = true;
            report.modifierReferences.utilityShapeTargets++;
        }
    }

    const partSourceID = `${owner.sex}/${modifierPath}`;
    const sourcePath = `${owner.root}${modifierPath}`;
    let partSource = partSources.get(partSourceID);

    if (!partSource && candidateFolders.has(sourcePath))
    {
        partSource = GetPartSource(
            partSources,
            partSourceID,
            owner.sex,
            modifierPath
        );
        partSource.sourcePaths.add(sourcePath);
        partSource.resourceVersions.add(null);
    }

    if (partSource)
    {
        relation.partSource = partSourceID;
        report.modifierReferences.partSourceTargets++;
    }

    const locations = modifierLocations.get(modifierPath);

    if (locations?.size === 1)
    {
        relation.modifierLocation = [ ...locations ][0];
        report.modifierReferences.modifierLocationTargets++;
    }

    if (!relation.partSource && !relation.modifierLocation && !utilityShape)
    {
        report.modifierReferences.unresolved++;
    }
}

function ParseWeightedUtilityDependency(value)
{
    const match = String(value).match(
        /^(utilityshapes\/.+?)###([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/iu
    );

    if (!match) return null;

    const weight = Number(match[2]);
    if (!Number.isFinite(weight)) return null;

    try
    {
        return {
            modifierPath: NormalizePartPath(
                match[1],
                `Character utility modifier ${JSON.stringify(value)}`
            ),
            weight
        };
    }
    catch
    {
        return null;
    }
}

function IndexCandidateFolders(index)
{
    const result = new Set();

    for (const entry of index.entries)
    {
        if (CandidateType(entry.logicalPath) === null) continue;

        const directory = Dirname(entry.logicalPath);
        result.add(directory);

        if (/^v\d+$/u.test(Basename(directory)))
        {
            result.add(Dirname(directory));
        }
    }

    return result;
}

function PopulateCandidates(index, partSources, report)
{
    const sourcesByPath = new Map();

    for (const [ recordID, source ] of partSources)
    {
        for (const sourcePath of source.sourcePaths)
        {
            if (!sourcesByPath.has(sourcePath)) sourcesByPath.set(sourcePath, []);
            sourcesByPath.get(sourcePath).push({ recordID, source });
        }
    }

    for (const entry of index.entries)
    {
        const candidateType = CandidateType(entry.logicalPath);

        if (candidateType === null) continue;

        const directory = Dirname(entry.logicalPath);
        const directOwners = sourcesByPath.get(directory);

        if (directOwners)
        {
            for (const owner of directOwners)
            {
                AddCandidate(owner.source, null, candidateType, entry.logicalPath);
            }
            report.candidateResources[candidateType] += directOwners.length;
            continue;
        }

        const parentDirectory = Dirname(directory);
        const versionOwners = sourcesByPath.get(parentDirectory);

        if (!versionOwners) continue;

        const folderName = Basename(directory).toLowerCase();

        for (const owner of versionOwners)
        {
            let resourceVersion = [ ...owner.source.resourceVersions ]
                .find(value => value !== null && value.toLowerCase() === folderName);

            if (resourceVersion === undefined)
            {
                if (!/^v\d+$/u.test(folderName)) continue;

                resourceVersion = folderName;
                owner.source.resourceVersions.add(resourceVersion);
            }

            AddCandidate(
                owner.source,
                resourceVersion,
                candidateType,
                entry.logicalPath
            );
            report.candidateResources[candidateType]++;
        }
    }
}

function AddCandidate(source, resourceVersion, candidateType, logicalPath)
{
    if (!source.candidates.has(resourceVersion))
    {
        source.candidates.set(resourceVersion, {
            configuration: new Set(),
            geometry: new Set(),
            texture: new Set(),
        });
    }

    source.candidates.get(resourceVersion)[candidateType].add(logicalPath);
}

function FinalizePartTypes(partTypes)
{
    return Object.fromEntries([ ...partTypes.entries() ]
        .sort(([ left ], [ right ]) => Compare(left, right))
        .map(([ recordID, value ]) =>
        {
            const sourcePaths = [ ...value.sourcePaths ].sort(Compare);
            const sexes = [ ...value.sexes ].sort(Compare);
            const partSources = [ ...value.partSources ].sort(Compare);

            return [ recordID, {
                sourcePath: sourcePaths[0] ?? "",
                sourcePaths,
                sex: sexes.length === 1 ? sexes[0] : "",
                partPath: value.partPath,
                resourceVersion: value.resourceVersion,
                colorVariant: value.colorVariant,
                bloodlineIDs: [ ...value.bloodlineIDs ],
                partSource: partSources.length === 1 ? partSources[0] : null,
                partSources,
            } ];
        }));
}

function FinalizePartSources(partSources)
{
    return Object.fromEntries([ ...partSources.entries() ]
        .sort(([ left ], [ right ]) => Compare(left, right))
        .map(([ recordID, source ]) =>
        {
            const sourcePaths = [ ...source.sourcePaths ].sort(Compare);
            const baseline = CreateVersion(source, null, true);
            const versions = [ baseline ];

            for (const resourceVersion of [ ...source.resourceVersions ]
                .filter(value => value !== null)
                .sort(Compare))
            {
                versions.push(CreateVersion(source, resourceVersion, false));
            }

            return [ recordID, {
                sourcePath: sourcePaths[0] ?? "",
                sourcePaths,
                sex: source.sex,
                partPath: source.partPath,
                versions,
                metadata: source.metadata.get(null) ?? null,
            } ];
        }));
}

function CreateVersion(source, resourceVersion, baseline)
{
    const candidates = source.candidates.get(resourceVersion);
    const result = { resourceVersion };
    const metadata = source.metadata.get(resourceVersion);

    if (metadata !== undefined && resourceVersion !== null)
    {
        result.metadata = metadata;
    }

    for (const [ field, candidateType ] of [
        [ "configurationCandidates", "configuration" ],
        [ "geometryCandidates", "geometry" ],
        [ "textureCandidates", "texture" ],
    ])
    {
        const values = [ ...(candidates?.[candidateType] ?? []) ].sort(Compare);

        if (baseline || values.length) result[field] = values;
    }

    return result;
}

function FinalizePartMetadata(partMetadata)
{
    return Object.fromEntries([ ...partMetadata.entries() ]
        .sort(([ left ], [ right ]) => Compare(left, right)));
}

function CandidateType(logicalPath)
{
    const extension = Extension(logicalPath);

    if (CONFIGURATION_EXTENSIONS.has(extension)) return "configuration";
    if (GEOMETRY_EXTENSIONS.has(extension)) return "geometry";
    if (TEXTURE_EXTENSIONS.has(extension)) return "texture";
    return null;
}

function NormalizePartPath(value, label)
{
    const result = RequireString(value, label)
        .replaceAll("\\", "/")
        .replace(/^\/+|\/+$/gu, "")
        .toLowerCase();

    if (!result || result.split("/").some(segment => !segment || segment === "." || segment === ".."))
    {
        throw new TypeError(`${label} must be a safe relative character path`);
    }

    return result;
}

function NormalizeIdentifierList(value, label)
{
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);

    const result = value.map((item, index) =>
    {
        if (typeof item === "number" && !Number.isSafeInteger(item))
        {
            throw new TypeError(`${label}[${index}] must be an exact integer identity`);
        }

        const identity = String(item ?? "").trim();

        if (!/^-?\d+$/u.test(identity))
        {
            throw new TypeError(`${label}[${index}] must be an integer identity`);
        }

        return identity;
    });

    if (new Set(result).size !== result.length)
    {
        throw new Error(`${label} contains duplicate identities`);
    }

    return result;
}

function OptionalString(value, label)
{
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string") throw new TypeError(`${label} must be a string or null`);
    return value;
}

function RequireEqual(left, right, recordID, field)
{
    if (left !== right)
    {
        throw new Error(`Character part type ${recordID} has conflicting ${field}`);
    }
}

function EqualLists(left, right)
{
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function ThrowCompileError(report)
{
    const firstError = report.errors[0];
    const detail = firstError ? `; first error: ${firstError.message}` : "";
    const error = new Error(
        `Character definition compilation failed: ${report.missingIndexEntries.length} `
        + `missing index entries, ${report.errors.length} definition errors${detail}`
    );

    error.report = report;
    throw error;
}

function RequireObject(value, label)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError(`${label} must be an object`);
    }

    return value;
}

function RequireString(value, label)
{
    const result = String(value ?? "").trim();

    if (!result) throw new TypeError(`${label} must be a non-empty string`);
    return result;
}

function Dirname(value)
{
    return value.slice(0, value.lastIndexOf("/"));
}

function Basename(value)
{
    return value.slice(value.lastIndexOf("/") + 1);
}

function Extension(value)
{
    const name = Basename(value);
    const index = name.lastIndexOf(".");
    return index < 0 ? "" : name.slice(index).toLowerCase();
}

function Compare(left, right)
{
    return String(left).localeCompare(String(right), "en", { numeric: true });
}
