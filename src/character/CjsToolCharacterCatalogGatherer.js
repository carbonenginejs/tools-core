import { CjsFileIndex } from "@carbonenginejs/tools-browser/fileindex";
import { CjsToolCache } from "../cache/CjsToolCache.js";
import { CjsToolCharacterDefinitionCompiler } from "./CjsToolCharacterDefinitionCompiler.js";

const PROFILE_DOCUMENTS = new Set([
    "characterDefinitions",
    "characterPartTypes",
    "characterPartMetadata",
    "characterMaterialProfiles",
    "characterProjectionProfiles",
    "characterRecipeProfiles",
]);
const PROFILE_INPUT_KEYS = new Set([
    "documentName",
    "logicalPath",
    "recordID",
]);
const PART_SOURCE_CANDIDATE_FIELDS = [
    "configurationCandidates",
    "geometryCandidates",
    "textureCandidates",
];

/** Gathers decoded or declared character JSON and materializes effective part-source versions. */
export class CjsToolCharacterCatalogGatherer
{

    #cache;

    /** Creates a gatherer backed by an optional shared cache. */
    constructor({ cache = new CjsToolCache() } = {})
    {
        if (!(cache instanceof CjsToolCache))
        {
            throw new TypeError(
                "CjsToolCharacterCatalogGatherer cache must be a CjsToolCache"
            );
        }

        this.#cache = cache;
    }

    /** Reads lossless definitions, declared profiles, and sparse sources into seven document maps. */
    async Gather(index, {
        sourceBuild = null,
        definitions = null,
        characterResources = {},
        characterModifierLocations = {},
        profiles = [],
        partSources = {},
    } = {})
    {
        if (!(index instanceof CjsFileIndex) || index.root !== "res")
        {
            throw new TypeError(
                "CjsToolCharacterCatalogGatherer requires a res-rooted CjsFileIndex"
            );
        }

        if (!Array.isArray(profiles))
        {
            throw new TypeError("Character catalog profiles must be an array");
        }

        RequireObject(partSources, "Character catalog partSources");
        const documents = CreateCatalogDocuments();
        const report = CreateReport(index, sourceBuild);
        const sourceInputs = {};

        if (definitions !== null && definitions !== undefined)
        {
            const compiled = CjsToolCharacterDefinitionCompiler.compile(index, {
                definitions,
                characterResources,
                characterModifierLocations,
                sourceBuild,
            });

            report.definitionCompilation = compiled.report;

            for (const recordID of Object.keys(compiled.characterDefinitions).sort(Compare))
            {
                AddRecord(
                    documents.characterDefinitions,
                    recordID,
                    compiled.characterDefinitions[recordID],
                    "definition"
                );
            }

            for (const recordID of Object.keys(compiled.partTypes).sort(Compare))
            {
                AddRecord(
                    documents.characterPartTypes,
                    recordID,
                    compiled.partTypes[recordID],
                    "part type"
                );
            }

            for (const recordID of Object.keys(compiled.partMetadata).sort(Compare))
            {
                AddRecord(
                    documents.characterPartMetadata,
                    recordID,
                    compiled.partMetadata[recordID],
                    "part metadata"
                );
            }

            for (const recordID of Object.keys(compiled.partSources).sort(Compare))
            {
                sourceInputs[recordID] = compiled.partSources[recordID];
            }
        }

        for (let profileIndex = 0; profileIndex < profiles.length; profileIndex++)
        {
            const descriptor = profiles[profileIndex];

            try
            {
                await this.#AddProfile(
                    index,
                    documents,
                    descriptor,
                    profileIndex,
                    report
                );
            }
            catch (error)
            {
                report.errors.push({
                    input: profileIndex,
                    path: descriptor?.logicalPath ?? null,
                    message: error.message,
                });
            }
        }

        for (const recordID of Object.keys(partSources).sort(Compare))
        {
            if (Object.hasOwn(sourceInputs, recordID))
            {
                report.errors.push({
                    input: `partSources.${recordID}`,
                    path: null,
                    message: `Duplicate compiled character part source ${JSON.stringify(recordID)}`,
                });
                continue;
            }

            sourceInputs[recordID] = partSources[recordID];
        }

        for (const recordID of Object.keys(sourceInputs).sort(Compare))
        {
            try
            {
                const source = MaterializePartSource(
                    RequireObject(
                        sourceInputs[recordID],
                        `Character part source ${recordID}`
                    ),
                    recordID
                );

                ValidatePartSourceCandidates(source, index, recordID, report);
                AddRecord(
                    documents.characterPartSources,
                    recordID,
                    source,
                    "part source"
                );
                report.candidateResources.partSources++;
            }
            catch (error)
            {
                report.errors.push({
                    input: `partSources.${recordID}`,
                    path: null,
                    message: error.message,
                });
            }
        }

        if (report.missingIndexEntries.length
            || report.missingCacheFiles.length
            || report.errors.length)
        {
            const firstError = report.errors[0];
            const detail = firstError ? `; first error: ${firstError.message}` : "";
            const error = new Error(
                `Character catalog gathering failed: ${report.missingIndexEntries.length} `
                + `missing index entries, ${report.missingCacheFiles.length} cache misses, `
                + `${report.errors.length} input errors${detail}`
            );

            error.report = report;
            throw error;
        }

        report.catalogs = CountCatalogs(documents);
        return { documents, report };
    }

    /** Gathers through a temporary character catalog gatherer. */
    static gather(index, options = {}, dependencies = {})
    {
        return new this(dependencies).Gather(index, options);
    }

    /** Reads and routes one declared model-shaped JSON record. */
    async #AddProfile(index, documents, value, inputIndex, report)
    {
        const descriptor = RequireObject(
            value,
            `Character catalog profiles[${inputIndex}]`
        );

        RejectUnknownKeys(
            descriptor,
            PROFILE_INPUT_KEYS,
            `Character catalog profiles[${inputIndex}]`
        );
        const documentName = RequireString(
            descriptor.documentName,
            `Character catalog profiles[${inputIndex}].documentName`
        );

        if (!PROFILE_DOCUMENTS.has(documentName))
        {
            throw new Error(`Unsupported character profile document ${documentName}`);
        }

        const logicalPath = RequireString(
            descriptor.logicalPath,
            `Character catalog profiles[${inputIndex}].logicalPath`
        );
        const entry = index.Find(logicalPath);

        if (!entry)
        {
            report.missingIndexEntries.push(logicalPath);
            return;
        }

        const cached = await this.#cache.ReadRemote(entry.location, {
            ...(entry.checksum ? { md5: entry.checksum } : {}),
            ...(entry.uncompressedSize !== null
                ? { size: entry.uncompressedSize }
                : {}),
        });

        if (!cached)
        {
            report.missingCacheFiles.push(entry.logicalPath);
            return;
        }

        const recordID = descriptor.recordID === undefined
            ? entry.logicalPath
            : RequireString(
                descriptor.recordID,
                `Character catalog profiles[${inputIndex}].recordID`
            );

        AddRecord(
            documents[documentName],
            recordID,
            ReadJson(cached.bytes, entry.logicalPath),
            documentName
        );
        report.selectedProfiles[documentName] =
            (report.selectedProfiles[documentName] || 0) + 1;
    }

}

function CreateCatalogDocuments()
{
    return {
        characterDefinitions: {},
        characterPartTypes: {},
        characterPartSources: {},
        characterPartMetadata: {},
        characterMaterialProfiles: {},
        characterProjectionProfiles: {},
        characterRecipeProfiles: {},
    };
}

function CreateReport(index, sourceBuild)
{
    return {
        schema: "carbonenginejs.characterLibraryBuildReport",
        schemaVersion: 2,
        sourceBuild: sourceBuild === null || sourceBuild === undefined
            ? null
            : String(sourceBuild),
        indexedFiles: index.count,
        selectedProfiles: {},
        definitionCompilation: null,
        missingIndexEntries: [],
        missingCacheFiles: [],
        errors: [],
        catalogs: {},
        candidateResources: {
            partSources: 0,
            configuration: 0,
            geometry: 0,
            texture: 0,
        },
    };
}

function ReadJson(bytes, logicalPath)
{
    try
    {
        return JSON.parse(Buffer.from(bytes).toString("utf8"));
    }
    catch (error)
    {
        throw new Error(`Cannot read character JSON ${logicalPath}: ${error.message}`);
    }
}

function ValidatePartSourceCandidates(source, index, recordID, report)
{
    if (!Array.isArray(source.versions))
    {
        throw new TypeError(`Character part source ${recordID}.versions must be an array`);
    }

    for (let versionIndex = 0; versionIndex < source.versions.length; versionIndex++)
    {
        const version = RequireObject(
            source.versions[versionIndex],
            `Character part source ${recordID}.versions[${versionIndex}]`
        );

        ValidateCandidateList(
            version.configurationCandidates,
            index,
            `Character part source ${recordID}.versions[${versionIndex}].configurationCandidates`,
            report,
            "configuration"
        );
        ValidateCandidateList(
            version.geometryCandidates,
            index,
            `Character part source ${recordID}.versions[${versionIndex}].geometryCandidates`,
            report,
            "geometry"
        );
        ValidateCandidateList(
            version.textureCandidates,
            index,
            `Character part source ${recordID}.versions[${versionIndex}].textureCandidates`,
            report,
            "texture"
        );
    }
}

function MaterializePartSource(source, recordID)
{
    if (!Array.isArray(source.versions))
    {
        throw new TypeError(`Character part source ${recordID}.versions must be an array`);
    }

    const seen = new Set();
    const versions = source.versions.map((value, versionIndex) =>
    {
        const label = `Character part source ${recordID}.versions[${versionIndex}]`;
        const version = RequireObject(value, label);
        const resourceVersion = NormalizeResourceVersion(
            version.resourceVersion,
            `${label}.resourceVersion`
        );

        if (seen.has(resourceVersion))
        {
            throw new Error(
                `Character part source ${recordID} contains duplicate resource version `
                + JSON.stringify(resourceVersion)
            );
        }

        seen.add(resourceVersion);
        return { version, resourceVersion, versionIndex };
    });
    const baseline = versions.find(item => item.resourceVersion === null)?.version ?? null;

    return {
        ...source,
        versions: versions.map(({ version, resourceVersion, versionIndex }) => ({
            ...version,
            resourceVersion,
            metadata: Object.hasOwn(version, "metadata")
                ? version.metadata
                : version !== baseline && baseline && Object.hasOwn(baseline, "metadata")
                    ? baseline.metadata
                    : source.metadata ?? null,
            ...Object.fromEntries(PART_SOURCE_CANDIDATE_FIELDS.map(field => [
                field,
                MaterializeCandidateList(
                    version,
                    baseline,
                    field,
                    `Character part source ${recordID}.versions[${versionIndex}].${field}`
                )
            ])),
        })),
    };
}

function MaterializeCandidateList(version, baseline, field, label)
{
    const value = Object.hasOwn(version, field)
        ? version[field]
        : version !== baseline && baseline && Object.hasOwn(baseline, field)
            ? baseline[field]
            : [];

    if (!Array.isArray(value))
    {
        throw new TypeError(`${label} must be an array`);
    }

    return [ ...value ];
}

function NormalizeResourceVersion(value, label)
{
    if (value === null || value === undefined)
    {
        return null;
    }

    if (typeof value !== "string" || !value)
    {
        throw new TypeError(`${label} must be null or a non-empty string`);
    }

    return value;
}

function ValidateCandidateList(value, index, label, report, countName)
{
    if (!Array.isArray(value))
    {
        throw new TypeError(`${label} must be an array`);
    }

    for (let candidateIndex = 0; candidateIndex < value.length; candidateIndex++)
    {
        const candidate = RequireString(value[candidateIndex], `${label}[${candidateIndex}]`);

        if (!index.Find(candidate))
        {
            report.missingIndexEntries.push(candidate);
        }

        report.candidateResources[countName]++;
    }
}

function AddRecord(document, recordID, value, label)
{
    const id = RequireString(recordID, `Character ${label} recordID`);

    if (Object.hasOwn(document, id))
    {
        throw new Error(`Duplicate character ${label} ${JSON.stringify(id)}`);
    }

    document[id] = value;
}

function CountCatalogs(documents)
{
    return Object.fromEntries(Object.entries(documents).map(([ name, records ]) =>
        [ name, Object.keys(records).length ]));
}

function RejectUnknownKeys(value, allowed, label)
{
    const unknown = Object.keys(value).filter(key => !allowed.has(key)).sort(Compare);

    if (unknown.length)
    {
        throw new TypeError(`${label} contains unsupported field ${unknown[0]}`);
    }
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

    if (!result)
    {
        throw new TypeError(`${label} must be a non-empty string`);
    }

    return result;
}

function Compare(left, right)
{
    return String(left).localeCompare(String(right), "en", { numeric: true });
}
