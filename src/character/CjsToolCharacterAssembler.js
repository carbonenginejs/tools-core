import { CjsToolCharacterNormalizer } from "./CjsToolCharacterNormalizer.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";

const TargetRegistry = new CjsToolTargetRegistry();

/** Deterministic character catalog and source-reference assembly. */
export class CjsToolCharacterAssembler
{

    static dataCatalogs = Object.freeze({
        partMetadata: "partMetadata",
        parts: "parts",
        materials: "materials",
        projections: "projections",
        poses: "poses",
        presets: "presets",
        sculptFields: "sculptFields",
        blendshapeLimits: "blendshapeLimits",
        uniqueCharacters: "uniqueCharacters",
        visemeSets: "visemeSets",
    });

    static assemble(catalogs = {}, options = {}, { targets = TargetRegistry } = {})
    {
        utils.requireObject(catalogs, "Character library catalogs");
        utils.requireObject(options, "Character library assembly options");

        const sourceCatalog = this.buildSourceCatalog(catalogs.sources ?? [], catalogs.sourceRefs ?? {});
        const target = ResolveLibraryTarget(options, targets);
        const result = {
            schema: "carbonenginejs.characterLibrary",
            schemaVersion: 1,
            sourceTarget: target?.id ?? null,
            sourceGame: target?.game ?? null,
            sourceProvider: target?.provider ?? null,
            sourceBuild: utils.optionalString(options.sourceBuild),
            generatedAt: utils.optionalString(options.generatedAt),
            sourceRefs: sourceCatalog.sourceRefs,
            sources: sourceCatalog.sources,
            presentation: this.normalizePresentationTree(catalogs.presentation ?? {}),
            modifierNames: this.normalizeModifierNamesTree(catalogs.modifierNames ?? {}),
            faceSetup: this.normalizeFaceSetupTree(catalogs.faceSetup ?? {}),
            partAuthoring: this.normalizePartAuthoringTree(catalogs.partAuthoring ?? {})
        };

        for (const catalog of Object.values(this.dataCatalogs))
        {
            const records = catalogs[catalog] ?? [];
            if (!Array.isArray(records)) throw new TypeError(`Character library ${catalog} must be an array`);
            result[catalog] = SortAndValidateCatalog(catalog, catalog === this.dataCatalogs.uniqueCharacters
                ? records.map(value => this.normalizeUniqueCharacter(value))
                : records);
        }

        const dataCatalogs = Object.values(this.dataCatalogs);
        ValidateLegacySourceReferences(result, sourceCatalog.aliases, dataCatalogs);
        RemoveLegacySourceReferences(result, dataCatalogs);
        return result;
    }

    static normalizeUniqueCharacter(value)
    {
        const source = utils.requireObject(value, "Character library unique character");
        const resources = utils.requireObject(source.resources ?? {}, "Character library unique character resources");
        return {
            id: String(source.id || ""),
            sex: source.sex === undefined || source.sex === null || source.sex === "" ? null : String(source.sex),
            resources: {
                configPaths: NormalizeStringList(resources.configPaths),
                texturePaths: NormalizeStringList(resources.texturePaths)
            },
            blendshapeWeights: CjsToolCharacterNormalizer.normalizeUniqueBlendshapeWeightsProfile(source.blendshapeWeights ?? {}),
            animationOffsets: CjsToolCharacterNormalizer.normalizeUniqueAnimationOffsetsProfile(source.animationOffsets ?? {})
        };
    }

    static normalizeModifierNamesTree(value)
    {
        const source = utils.requireObject(value, "Character library modifier names tree");
        return Object.fromEntries([ "female", "male" ].map(sex =>
        {
            const record = utils.requireObject(source[sex] ?? {}, `Character library modifierNames.${sex}`);
            return [ sex, Object.fromEntries([ "body", "face", "utility" ]
                .map(group => [ group, CjsToolCharacterNormalizer.normalizeModifierNamesProfile(record[group] ?? []) ])) ];
        }));
    }

    static normalizeFaceSetupTree(value)
    {
        const source = utils.requireObject(value, "Character library face setup tree");
        const bindPoses = utils.requireObject(source.bindPoses ?? {}, "Character library faceSetup.bindPoses");
        const controls = utils.requireObject(source.controls ?? {}, "Character library faceSetup.controls");
        return {
            bindPoses: Object.fromEntries(Object.entries(bindPoses).sort(CompareEntries)
                .map(([ sex, pose ]) => [ sex, CloneObject(pose, `Character library faceSetup.bindPoses.${sex}`) ])),
            animation: CjsToolCharacterNormalizer.normalizeFaceAnimationProfile(source.animation ?? {}),
            controls: Object.fromEntries([ "female", "male" ]
                .map(sex => [ sex, CjsToolCharacterNormalizer.normalizeFaceControlsProfile(controls[sex] ?? {}) ])),
            tweakSettings: CjsToolCharacterNormalizer.normalizeFaceTweakSettingsProfile(source.tweakSettings ?? {
                gammaCurves: {}, wrinkleMultiplier: 1, correctionMultiplier: 1
            })
        };
    }

    static normalizePartAuthoringTree(value)
    {
        const source = utils.requireObject(value, "Character library part authoring tree");
        return Object.fromEntries(Object.entries(source).sort(CompareEntries).map(([ id, authoring ]) =>
        {
            const record = utils.requireObject(authoring, `Character library partAuthoring.${id}`);
            return [ id, {
                materialInfo: record.materialInfo === undefined || record.materialInfo === null
                    ? null
                    : CjsToolCharacterNormalizer.normalizeMaterialInfoProfile(record.materialInfo)
            } ];
        }));
    }

    static normalizePresentationTree(value)
    {
        const source = utils.requireObject(value, "Character library presentation tree");
        const groups = [ "backgrounds", "cameras", "characters", "lights", "positions", "posts" ];
        const unknown = Object.keys(source).filter(group => !groups.includes(group));
        if (unknown.length)
        {
            throw new Error(`Character library presentation tree contains unsupported group "${unknown.sort()[0]}"`);
        }

        return Object.fromEntries(groups.map(group =>
        {
            const profiles = utils.requireObject(source[group] ?? {}, `Character library presentation.${group}`);
            return [ group, Object.fromEntries(Object.entries(profiles)
                .sort(([ a ], [ b ]) => CompareIds(a, b))
                .map(([ id, profile ]) => [ id, CjsToolCharacterNormalizer.normalizePresentationProfile(profile, { group, id }) ])) ];
        }));
    }

    static buildSourceCatalog(records, declaredRefs = {})
    {
        if (!Array.isArray(records)) throw new TypeError("Character library sources must be an array");
        const refs = NormalizeSourceRefs(declaredRefs);
        const byPath = new Map();
        const aliases = new Map();

        for (const [ ref, sourcePath ] of Object.entries(refs))
        {
            RegisterSource(byPath, aliases, { ref }, String(sourcePath || "").trim());
        }
        for (let index = 0; index < records.length; index++)
        {
            const source = utils.requireObject(records[index], `Character library sources[${index}]`);
            const sourcePath = String(source.path || refs[source.ref] || "").trim();
            if (!sourcePath) throw new Error(`Character library sources[${index}] is missing path`);
            RegisterSource(byPath, aliases, source, sourcePath);
        }

        const paths = Array.from(byPath.keys()).sort(CompareIds);
        const sourceRefs = {};
        const sources = [];
        paths.forEach((sourcePath, index) =>
        {
            const ref = `#ref${index + 1}`;
            const source = byPath.get(sourcePath);
            sourceRefs[ref] = sourcePath;
            sources.push({ ref, ...source.metadata });
            aliases.set(ref, sourcePath);
        });

        return { sourceRefs, sources, aliases };
    }

}

function ResolveLibraryTarget(options, targets)
{
    const identity = [ options.sourceTarget, options.sourceGame, options.sourceProvider ];

    if (identity.every((value) => value === undefined || value === null || value === ""))
    {
        return null;
    }

    if (!(targets instanceof CjsToolTargetRegistry))
    {
        throw new TypeError("Character library targets must be a CjsToolTargetRegistry");
    }

    const target = targets.Resolve({
        target: options.sourceTarget,
        game: options.sourceGame,
        provider: options.sourceProvider,
    });

    return targets.RequireLibrary(target, "character");
}

function RegisterSource(byPath, aliases, source, sourcePath)
{
    if (!sourcePath) throw new Error("Character library sourceRefs contains an empty path");
    const metadata = {
        profile: utils.optionalString(source.profile),
        build: utils.optionalString(source.build),
        checksum: utils.optionalString(source.checksum),
        byteLength: NormalizeByteLength(source.byteLength)
    };
    const existing = byPath.get(sourcePath);
    if (existing) MergeSourceMetadata(existing.metadata, metadata, sourcePath);
    else byPath.set(sourcePath, { metadata });

    for (const alias of [ source.id, source.ref, sourcePath ])
    {
        const value = String(alias || "").trim();
        if (!value) continue;
        const previous = aliases.get(value);
        if (previous && previous !== sourcePath)
        {
            throw new Error(`Character library source alias "${value}" maps to multiple paths`);
        }
        aliases.set(value, sourcePath);
    }
}

function MergeSourceMetadata(target, incoming, sourcePath)
{
    for (const key of [ "profile", "build", "checksum" ])
    {
        if (target[key] && incoming[key] && target[key] !== incoming[key])
        {
            throw new Error(`Character library source "${sourcePath}" has conflicting ${key}`);
        }
        if (!target[key]) target[key] = incoming[key];
    }
    if (target.byteLength && incoming.byteLength && target.byteLength !== incoming.byteLength)
    {
        throw new Error(`Character library source "${sourcePath}" has conflicting byteLength`);
    }
    if (!target.byteLength) target.byteLength = incoming.byteLength;
}

function NormalizeSourceRefs(value)
{
    if (value instanceof Map) return Object.fromEntries(value);
    return utils.requireObject(value, "Character library sourceRefs");
}

function NormalizeByteLength(value)
{
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0)
    {
        throw new TypeError(`Character library source byteLength must be a non-negative integer, received ${value}`);
    }
    return number;
}

function SortAndValidateCatalog(catalog, records)
{
    const ids = new Set();
    const result = records.map((record, index) =>
    {
        const source = utils.requireObject(record, `Character library ${catalog}[${index}]`);
        const id = String(source.id || "");
        if (!id) throw new Error(`Character library ${catalog}[${index}] is missing id`);
        if (ids.has(id)) throw new Error(`Character library duplicate ${catalog} id "${id}"`);
        ids.add(id);
        return { ...source };
    });
    return result.sort((a, b) => CompareIds(String(a.id), String(b.id)));
}

function ValidateLegacySourceReferences(data, aliases, dataCatalogs)
{
    if (!aliases.size) return;
    for (const catalog of dataCatalogs)
    {
        for (const record of data[catalog])
        {
            const references = [
                ...(record.sourceId ? [ record.sourceId ] : []),
                ...(Array.isArray(record.sourceIds) ? record.sourceIds : [])
            ];
            for (const reference of references)
            {
                if (!aliases.has(String(reference)))
                {
                    throw new Error(`Character library ${catalog} "${record.id}" references unknown source "${reference}"`);
                }
            }
        }
    }
}

function RemoveLegacySourceReferences(data, dataCatalogs)
{
    for (const catalog of dataCatalogs)
    {
        for (const record of data[catalog])
        {
            delete record.sourceId;
            delete record.sourceIds;
        }
    }
}

function CompareIds(a, b)
{
    return a < b ? -1 : a > b ? 1 : 0;
}

function CompareEntries([ a ], [ b ])
{
    return CompareIds(a, b);
}

function NormalizeStringList(value)
{
    if (!Array.isArray(value)) throw new TypeError("Character resource paths must be an array");
    return value.map(String).sort(CompareIds);
}

function CloneObject(value, label)
{
    utils.requireObject(value, label);
    return JSON.parse(JSON.stringify(value));
}
