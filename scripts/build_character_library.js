import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import CjsYamlFormat from "@carbonenginejs/runtime-resource/formats/yaml";

import {
    CjsToolCache,
    CjsToolCharacter,
    CjsToolCharacterCompiler,
    CjsToolCharacterNormalizer,
} from "../src/index.js";
import * as utils from "../src/utils.js";

const HELP = `Usage:
  node scripts/build_character_library.js --index <resfileindex.txt> --cache <cache-dir> --out <library.json> --build <id>

Options:
  --index <file>         CCP resfileindex.txt for the selected build.
  --cache <dir>          Hash-addressed cache root containing index storage paths.
  --out <file>           Canonical character library JSON output.
  --report <file>        Build report output; defaults beside --out.
  --build <id>           Source build identifier.
  --target <name>        Audited library target; defaults to eve.
  --generated-at <time>  Optional reproducible generation timestamp.
  --include-sources      Include sourceRefs and source metadata in the library.
  --compact              Emit compact library JSON.
  --help, -h             Show this help.

Acquisition:
  This builder performs no remote reads. Use @carbonenginejs/tools-core/index
  for provider/build/index/download work, then supply local inputs here.

Target notice:
  Library builders are target-specific. --target, --build, the selected index,
  and every cached input must describe the same target/build. Frontier and
  NetEase character builds remain disabled until audited.
`;

const TAG_HANDLERS = {
    "tag:yaml.org,2002:python/tuple": value => value,
    "tag:yaml.org,2002:python/unicode": value => value,
    "tag:yaml.org,2002:python/object:paperDoll.ProjectedDecal": value => value,
    "tag:yaml.org,2002:python/object:paperDoll.AvatarPartMetaData": value => value
};

const MODEL_EXTENSIONS = new Set([ ".black", ".gr2" ]);
const TEXTURE_EXTENSIONS = new Set([ ".dds", ".jpeg", ".jpg", ".png", ".tga" ]);

await Main(process.argv.slice(2));

async function Main(argv)
{
    const options = ParseArgs(argv);
    if (options.help)
    {
        process.stdout.write(HELP);
        return;
    }
    for (const name of [ "index", "cache", "out", "build" ])
    {
        if (!options[name]) throw new Error(`Missing --${name}`);
    }

    const sourceBuild = utils.normalizeExactBuild(options.build, {
        message: "--build requires an exact numeric build",
    });

    const character = new CjsToolCharacter();
    const target = character.ResolveTarget({
        target: options.target,
        game: options.game,
        provider: options.provider,
    });

    const indexPath = path.resolve(options.index);
    const cacheRoot = path.resolve(options.cache);
    if (!fs.existsSync(indexPath)) throw new Error(`Index file not found: ${indexPath}`);
    if (!fs.statSync(cacheRoot).isDirectory()) throw new Error(`Cache directory not found: ${cacheRoot}`);

    const inventory = await ReadIndex(indexPath);
    const built = await BuildCatalogs(
        inventory,
        new CjsToolCache(cacheRoot),
        sourceBuild,
    );
    const expanded = character.Assemble(built.catalogs, {
        sourceTarget: target.id,
        sourceGame: target.game,
        sourceProvider: target.provider,
        sourceBuild,
        generatedAt: options.generatedAt
    });
    if (!options.includeSources)
    {
        character.OmitSourceProvenance(expanded);
    }
    const data = character.Compile(expanded, {
        partSourceResources: built.partSourceResources,
    });

    built.report.catalogs = Object.fromEntries([
        [ "partMetadata", expanded.partMetadata.length ],
        [ "partSources", Object.keys(data.partSources).length ],
        [ "types", expanded.parts.length ],
        [ "materials", expanded.materials.length ],
        [ "projections", expanded.projections.length ],
        [ "poses", expanded.poses.length ],
        [ "presets", expanded.presets.length ],
        [ "sculptFields", expanded.sculptFields.length ],
        [ "blendshapeLimits", expanded.blendshapeLimits.length ],
        [ "uniqueCharacters", expanded.uniqueCharacters.length ],
        [ "modifierNames", Object.values(expanded.modifierNames).reduce((total, groups) => total + Object.values(groups).reduce((count, names) => count + names.length, 0), 0) ],
        [ "faceBindPoses", Object.keys(expanded.faceSetup.bindPoses).length ],
        [ "faceAnimationProfiles", Object.keys(expanded.faceSetup.animation).length ],
        [ "faceControlProfiles", Object.values(expanded.faceSetup.controls).filter(controls => Object.keys(controls).length).length ],
        [ "partAuthoring", Object.keys(expanded.partAuthoring).length ],
        [ "presentationProfiles", Object.values(expanded.presentation).reduce((total, profiles) => total + Object.keys(profiles).length, 0) ]
    ]);
    built.report.output = path.resolve(options.out);
    built.report.sourceTarget = expanded.sourceTarget;
    built.report.sourceGame = expanded.sourceGame;
    built.report.sourceProvider = expanded.sourceProvider;
    built.report.sourceBuild = sourceBuild;

    const outputPath = path.resolve(options.out);
    const reportPath = path.resolve(options.report || DefaultReportPath(outputPath));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(outputPath, `${character.Stringify(data, { compact: options.compact })}\n`);
    fs.writeFileSync(reportPath, `${JSON.stringify(built.report, null, 2)}\n`);

    process.stdout.write(`Wrote character library JSON to ${outputPath}\n`);
    process.stdout.write(`Wrote character library build report to ${reportPath}\n`);
    process.stdout.write(`${JSON.stringify(built.report.catalogs)}\n`);
}

async function ReadIndex(indexPath)
{
    const entries = [];
    const folders = new Map();
    const extensions = new Map();
    const lines = readline.createInterface({
        input: fs.createReadStream(indexPath, { encoding: "utf8" }),
        crlfDelay: Infinity
    });

    for await (const line of lines)
    {
        const [ logicalPath, storagePath, checksum, byteLength, compressedLength ] = line.split(",");
        if (!logicalPath?.toLowerCase().startsWith("res:/graphics/character/")) continue;
        const entry = {
            logicalPath,
            lowerPath: logicalPath.toLowerCase(),
            storagePath,
            checksum: checksum || "",
            byteLength: Number(byteLength || 0),
            compressedLength: Number(compressedLength || 0)
        };
        entries.push(entry);

        const folder = path.posix.dirname(entry.lowerPath);
        if (!folders.has(folder)) folders.set(folder, []);
        folders.get(folder).push(entry);

        const extension = path.posix.extname(entry.lowerPath) || "<none>";
        extensions.set(extension, (extensions.get(extension) || 0) + 1);
    }

    return { entries, folders, extensions };
}

async function BuildCatalogs(inventory, cache, build)
{
    const catalogs = {
        sources: [],
        partMetadata: [],
        parts: [],
        materials: [],
        projections: [],
        poses: [],
        presets: [],
        sculptFields: [],
        blendshapeLimits: [],
        uniqueCharacters: [],
        modifierNames: { female: {}, male: {} },
        faceSetup: { bindPoses: {}, animation: {}, controls: {}, tweakSettings: null },
        partAuthoring: {},
        presentation: {}
    };
    const report = {
        schema: "carbonenginejs.characterLibraryBuildReport",
        schemaVersion: 1,
        indexedCharacterFiles: inventory.entries.length,
        selectedProfiles: {},
        indexedExtensions: Object.fromEntries(Array.from(inventory.extensions).sort(([ a ], [ b ]) => Compare(a, b))),
        relaxedDuplicateKeyFiles: [],
        missingCacheFiles: [],
        errors: [],
        catalogs: {}
    };
    const metadata = new Map();
    const partContexts = [];

    for (const entry of inventory.entries)
    {
        const profile = ClassifyProfile(entry.lowerPath);
        if (!profile) continue;
        report.selectedProfiles[profile] = (report.selectedProfiles[profile] || 0) + 1;

        try
        {
            const cached = await cache.ReadRemote(entry.storagePath, {
                ...(entry.checksum ? { md5: entry.checksum } : {}),
                ...(entry.byteLength > 0 ? { size: entry.byteLength } : {}),
            });

            if (!cached)
            {
                report.missingCacheFiles.push(entry.logicalPath);
                continue;
            }

            const text = Buffer.from(cached.bytes).toString("utf8");
            const value = ReadProfileYaml(text, entry, report);
            const source = {
                id: entry.logicalPath,
                path: entry.logicalPath,
                profile,
                build,
                checksum: entry.checksum,
                byteLength: entry.byteLength
            };
            catalogs.sources.push(source);
            AddProfile(catalogs, metadata, partContexts, profile, value, entry);
        }
        catch (error)
        {
            report.errors.push({ path: entry.logicalPath, profile, message: error.message });
        }
    }

    if (report.missingCacheFiles.length || report.errors.length)
    {
        const firstError = report.errors[0];
        const detail = firstError ? `; first error: ${firstError.path}: ${firstError.message}` : "";
        throw new Error(`Character library build failed: ${report.missingCacheFiles.length} cache misses, ${report.errors.length} profile errors${detail}`);
    }

    PopulateUniqueCharacterResources(catalogs.uniqueCharacters, inventory.folders);
    const linked = LinkParts(catalogs, metadata, partContexts, inventory.folders);
    report.links = linked.report;
    return { catalogs, report, partSourceResources: linked.partSourceResources };
}

function ReadProfileYaml(text, entry, report)
{
    const options = {
        sourceName: entry.logicalPath,
        tagHandlers: TAG_HANDLERS
    };
    try
    {
        return CjsYamlFormat.readRaw(text, options);
    }
    catch (error)
    {
        if (!/Map keys must be unique/u.test(error.message)) throw error;
        report.relaxedDuplicateKeyFiles.push(entry.logicalPath);
        return CjsYamlFormat.readRaw(text, { ...options, uniqueKeys: false });
    }
}

function AddProfile(catalogs, metadata, partContexts, profile, value, entry)
{
    const paperdoll = PaperdollLocation(entry.lowerPath);
    const relativeId = CharacterRelativeId(entry.lowerPath);
    const baseName = path.posix.basename(entry.lowerPath, path.posix.extname(entry.lowerPath));

    if (profile === "recipe")
    {
        catalogs.presets.push(CjsToolCharacterNormalizer.normalizeRecipeProfile(value, { id: relativeId, name: baseName }));
    }
    else if (profile === "pose")
    {
        catalogs.poses.push(CjsToolCharacterNormalizer.normalizePoseProfile(value, { id: paperdoll ? `${paperdoll.sex}/${StripExtension(paperdoll.relative)}` : relativeId, name: baseName }));
    }
    else if (profile === "projection")
    {
        catalogs.projections.push(CjsToolCharacterNormalizer.normalizeProjectionProfile(value, { id: paperdoll ? `${paperdoll.sex}/${StripExtension(paperdoll.relative)}` : relativeId }));
    }
    else if (profile === "type")
    {
        RequirePaperdollLocation(paperdoll, entry);
        const part = CjsToolCharacterNormalizer.normalizeTypeProfile(value, {
            id: `${paperdoll.sex}/${StripExtension(paperdoll.relative)}`,
            name: baseName,
            category: path.posix.dirname(path.posix.dirname(paperdoll.relative)),
            sex: paperdoll.sex,
            sourcePath: entry.logicalPath
        });
        catalogs.parts.push(part);
        partContexts.push({
            part,
            baseFolder: `res:/graphics/character/${paperdoll.sex}/paperdoll/${part.path}`.toLowerCase(),
            sourceFolder: path.posix.dirname(path.posix.dirname(paperdoll.relative))
        });
    }
    else if (profile === "color")
    {
        RequirePaperdollLocation(paperdoll, entry);
        const partPath = path.posix.dirname(paperdoll.relative);
        catalogs.materials.push(CjsToolCharacterNormalizer.normalizeColorProfile(value, {
            id: `${paperdoll.sex}/${partPath}/${baseName}`,
            slot: partPath
        }));
    }
    else if (profile === "baseColor")
    {
        RequirePaperdollLocation(paperdoll, entry);
        const partPath = path.posix.dirname(paperdoll.relative);
        catalogs.materials.push(CjsToolCharacterNormalizer.normalizeColorProfile({ colors: [ value ] }, {
            id: `${paperdoll.sex}/${StripExtension(paperdoll.relative)}`,
            slot: partPath
        }));
    }
    else if (profile === "metadata")
    {
        RequirePaperdollLocation(paperdoll, entry);
        const partPath = path.posix.dirname(paperdoll.relative);
        const record = CjsToolCharacterNormalizer.normalizePartMetadataProfile(value, { id: `${paperdoll.sex}/${partPath}` });
        catalogs.partMetadata.push(record);
        metadata.set(record.id.toLowerCase(), record.id);
    }
    else if (profile === "limits")
    {
        catalogs.blendshapeLimits.push(CjsToolCharacterNormalizer.normalizeBlendshapeLimitsProfile(value, { id: relativeId }));
    }
    else if (profile === "sculpt")
    {
        catalogs.sculptFields.push(...CjsToolCharacterNormalizer.normalizeSculptFieldsProfile(value, { idPrefix: `${relativeId}/` }));
    }
    else if (profile === "presentation")
    {
        const location = PresentationLocation(entry.lowerPath);
        if (!location) throw new Error(`Expected a paperdoll presentation path: ${entry.logicalPath}`);
        const profiles = catalogs.presentation[location.group] ||= {};
        if (Object.hasOwn(profiles, location.id))
        {
            throw new Error(`Duplicate character presentation profile "${location.group}/${location.id}"`);
        }
        profiles[location.id] = CjsToolCharacterNormalizer.normalizePresentationProfile(value, location);
    }
    else if (profile === "uniqueBlendshapes" || profile === "uniqueAnimationOffsets")
    {
        const id = UniqueCharacterId(entry.lowerPath);
        if (!id) throw new Error(`Expected a unique character-select path: ${entry.logicalPath}`);
        const record = GetUniqueCharacter(catalogs.uniqueCharacters, id);
        if (profile === "uniqueBlendshapes") record.blendshapeWeights = CjsToolCharacterNormalizer.normalizeUniqueBlendshapeWeightsProfile(value);
        else record.animationOffsets = CjsToolCharacterNormalizer.normalizeUniqueAnimationOffsetsProfile(value);
    }
    else if (profile === "modifierNames")
    {
        const location = ModifierNamesLocation(entry.lowerPath);
        if (!location) throw new Error(`Expected a paperdoll modifier-names path: ${entry.logicalPath}`);
        catalogs.modifierNames[location.sex][location.group] = CjsToolCharacterNormalizer.normalizeModifierNamesProfile(value);
    }
    else if (profile === "faceBindPose")
    {
        const sex = baseName.includes("female") ? "female" : "male";
        catalogs.faceSetup.bindPoses[sex] = CjsToolCharacterNormalizer.normalizePoseProfile(value, { id: relativeId, name: baseName });
    }
    else if (profile === "faceAnimation")
    {
        catalogs.faceSetup.animation = CjsToolCharacterNormalizer.normalizeFaceAnimationProfile(value);
    }
    else if (profile === "faceControls")
    {
        const sex = baseName.includes("male") ? "male" : "female";
        catalogs.faceSetup.controls[sex] = CjsToolCharacterNormalizer.normalizeFaceControlsProfile(value);
    }
    else if (profile === "faceTweakSettings")
    {
        catalogs.faceSetup.tweakSettings = CjsToolCharacterNormalizer.normalizeFaceTweakSettingsProfile(value);
    }
    else if (profile === "materialInfo")
    {
        RequirePaperdollLocation(paperdoll, entry);
        const sourceId = `${paperdoll.sex}/${path.posix.dirname(paperdoll.relative)}`;
        if (catalogs.partAuthoring[sourceId]) throw new Error(`Duplicate character material info for "${sourceId}"`);
        catalogs.partAuthoring[sourceId] = { materialInfo: CjsToolCharacterNormalizer.normalizeMaterialInfoProfile(value) };
    }
}

function GetUniqueCharacter(records, id)
{
    let record = records.find(value => value.id === id);
    if (!record)
    {
        const sex = id.endsWith("femaleclothing") ? "female" : id.endsWith("maleclothing") ? "male" : null;
        record = { id, sex, resources: { configPaths: [], texturePaths: [] }, blendshapeWeights: {}, animationOffsets: {} };
        records.push(record);
    }
    return record;
}

function PopulateUniqueCharacterResources(records, folders)
{
    for (const record of records)
    {
        const folder = `res:/graphics/character/unique/characterselect/${record.id}`;
        const entries = folders.get(folder) || [];
        record.resources = {
            configPaths: entries.filter(entry => path.posix.extname(entry.lowerPath) === ".black").map(entry => entry.logicalPath).sort(Compare),
            texturePaths: entries.filter(entry => TEXTURE_EXTENSIONS.has(path.posix.extname(entry.lowerPath))).map(entry => entry.logicalPath).sort(Compare)
        };
    }
}

function LinkParts(catalogs, metadata, partContexts, folders)
{
    const materialIds = new Set(catalogs.materials.map(value => value.id));
    const partSourceResources = {};
    const report = {
        partsWithResources: 0,
        resourcePaths: 0,
        partsWithMetadata: 0,
        partsWithColorVariant: 0,
        partsWithMaterialReference: 0,
        partsWithImplicitDefaultMaterial: 0,
        partsWithSourceFolderMaterial: 0,
        partsWithSharedPaletteMaterial: 0,
        partsWithSharedBaseMaterial: 0,
        exactModelFolders: 0,
        singleModelFamilyFallbackFolders: 0,
        lodModelFolders: 0,
        unresolvedMaterialVariants: []
    };
    for (const { part, baseFolder, sourceFolder } of partContexts)
    {
        const selectedFolder = part.resourceVersion ? `${baseFolder}/${part.resourceVersion.toLowerCase()}` : baseFolder;
        const sourceId = `${part.sex}/${part.path}`.toLowerCase();
        const baseResources = SelectPartResources(part, baseFolder, folders, report);
        const previousBaseResources = partSourceResources[sourceId];
        if (previousBaseResources && JSON.stringify(previousBaseResources) !== JSON.stringify(baseResources))
        {
            throw new Error(`Character part source "${sourceId}" has conflicting shared resources`);
        }
        partSourceResources[sourceId] = baseResources;
        const versionResources = selectedFolder === baseFolder ? [] : SelectPartResources(part, selectedFolder, folders, report);
        part.resourcePaths = ResolvePartResources(baseResources, versionResources);

        const metadataKey = `${part.sex}/${part.path}${part.resourceVersion ? `/${part.resourceVersion}` : ""}`.toLowerCase();
        part.metadataId = metadata.get(metadataKey) || metadata.get(`${part.sex}/${part.path}`.toLowerCase()) || null;

        const materialLink = CjsToolCharacterCompiler.resolvePartMaterialLink(part, materialIds, { sourceFolder });
        part.colorIds = materialLink ? [ materialLink.id ] : [];
        if (part.resourcePaths.length) report.partsWithResources++;
        report.resourcePaths += part.resourcePaths.length;
        if (part.metadataId) report.partsWithMetadata++;
        if (part.colorVariant) report.partsWithColorVariant++;
        if (part.colorIds.length)
        {
            report.partsWithMaterialReference++;
            if (materialLink.implicit) report.partsWithImplicitDefaultMaterial++;
            if (materialLink.mode === "sourceFolder") report.partsWithSourceFolderMaterial++;
            if (materialLink.mode === "sharedPalette") report.partsWithSharedPaletteMaterial++;
            if (materialLink.mode === "sharedBase") report.partsWithSharedBaseMaterial++;
        }
        else if (part.colorVariant)
        {
            report.unresolvedMaterialVariants.push({
                partId: part.id,
                expectedMaterialId: `${part.sex}/${part.path}/${part.colorVariant}`.toLowerCase()
            });
        }
    }
    return { report, partSourceResources };
}

function ResolvePartResources(inherited, overrides)
{
    const result = [];
    for (const extensions of [ [ ".black" ], [ ".gr2" ], [ ".dds", ".jpeg", ".jpg", ".png", ".tga" ] ])
    {
        const baseValues = inherited.filter(value => extensions.includes(path.posix.extname(value).toLowerCase()));
        const overrideValues = overrides.filter(value => extensions.includes(path.posix.extname(value).toLowerCase()));
        result.push(...(overrideValues.length ? overrideValues : baseValues));
    }
    return result;
}

function SelectPartResources(part, selectedFolder, folders, report)
{
    const baseEntries = folders.get(selectedFolder) || [];
    const lodFolder = selectedFolder.replace("/paperdoll/", "/paperdoll_lod/");
    const lodEntries = lodFolder === selectedFolder ? [] : folders.get(lodFolder) || [];
    const textures = baseEntries.filter(entry => TEXTURE_EXTENSIONS.has(path.posix.extname(entry.lowerPath)));
    const models = [
        ...SelectModelFamily(part, selectedFolder, baseEntries, report),
        ...SelectModelFamily(part, lodFolder, lodEntries, report, true)
    ];
    const unique = new Map();

    for (const entry of [ ...models, ...textures ]) unique.set(entry.lowerPath, entry);
    return Array.from(unique.values())
        .sort(CompareResourceEntries)
        .map(entry => entry.logicalPath);
}

function SelectModelFamily(part, folder, entries, report, isLodFolder = false)
{
    const families = new Map();
    for (const entry of entries)
    {
        if (!MODEL_EXTENSIONS.has(path.posix.extname(entry.lowerPath))) continue;
        const family = ModelFamily(path.posix.basename(entry.lowerPath, path.posix.extname(entry.lowerPath)));
        if (!families.has(family)) families.set(family, []);
        families.get(family).push(entry);
    }
    if (!families.size) return [];

    const target = NormalizeResourceStem(path.posix.basename(part.path));
    let selected = families.get(target);
    if (selected) report.exactModelFolders++;
    else if (families.size === 1)
    {
        selected = families.values().next().value;
        report.singleModelFamilyFallbackFolders++;
    }
    else
    {
        throw new Error(`Character part "${part.id}" has ambiguous model families in ${folder}: ${Array.from(families.keys()).join(", ")}`);
    }
    if (isLodFolder) report.lodModelFolders++;
    return selected;
}

function ModelFamily(stem)
{
    return NormalizeResourceStem(stem
        .replace(/_lod\d+.*$/iu, "")
        .replace(/_(?:nosim|wopockets)$/iu, ""));
}

function NormalizeResourceStem(value)
{
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function CompareResourceEntries(a, b)
{
    const extensionA = path.posix.extname(a.lowerPath);
    const extensionB = path.posix.extname(b.lowerPath);
    const groupA = extensionA === ".black" ? 0 : extensionA === ".gr2" ? 1 : 2;
    const groupB = extensionB === ".black" ? 0 : extensionB === ".gr2" ? 1 : 2;
    if (groupA !== groupB) return groupA - groupB;

    const lodA = ResourceLod(a.lowerPath);
    const lodB = ResourceLod(b.lowerPath);
    if (lodA !== lodB) return lodA - lodB;
    return Compare(a.lowerPath, b.lowerPath);
}

function ResourceLod(resourcePath)
{
    const match = path.posix.basename(resourcePath).match(/_lod(\d+)/iu);
    return match ? Number(match[1]) : -1;
}

function ClassifyProfile(logicalPath)
{
    if (logicalPath.startsWith("res:/graphics/character/global/paperdolllibrary/") && logicalPath.endsWith(".yaml")) return "presentation";
    if (/^res:\/graphics\/character\/unique\/characterselect\/[^/]+\/blendshapes\.yaml$/u.test(logicalPath)) return "uniqueBlendshapes";
    if (/^res:\/graphics\/character\/unique\/characterselect\/[^/]+\/animationoffsets\.yaml$/u.test(logicalPath)) return "uniqueAnimationOffsets";
    if (/^res:\/graphics\/character\/(?:female|male)\/paperdoll\/(?:bodyshapes|facemodifiers|utilityshapes)\/modifiernames\.yaml$/u.test(logicalPath)) return "modifierNames";
    if (/^res:\/graphics\/character\/global\/facesetup\/base(?:female|male)bindpose\.yaml$/u.test(logicalPath)) return "faceBindPose";
    if (logicalPath === "res:/graphics/character/global/facesetup/animationdata.yaml") return "faceAnimation";
    if (/^res:\/graphics\/character\/global\/facesetup\/basicface(?:male)?\.face$/u.test(logicalPath)) return "faceControls";
    if (logicalPath === "res:/graphics/character/global/facesetup/facetweaksettings.yaml") return "faceTweakSettings";
    if (/^res:\/graphics\/character\/(?:female|male)\/paperdoll\/.+\.info$/u.test(logicalPath)) return "materialInfo";
    if (logicalPath.endsWith(".prs")) return "recipe";
    if (logicalPath.endsWith(".pose")) return "pose";
    if (logicalPath.endsWith(".proj")) return "projection";
    if (logicalPath.endsWith(".type")) return "type";
    if (logicalPath.endsWith(".color")) return "color";
    if (logicalPath.endsWith(".base")) return "baseColor";
    if (logicalPath.endsWith("/metadata.yaml")) return "metadata";
    if (logicalPath.endsWith("_blendshape_limits.yaml")) return "limits";
    if (logicalPath.endsWith(".trif")) return "sculpt";
    return null;
}

function UniqueCharacterId(logicalPath)
{
    return logicalPath.match(/^res:\/graphics\/character\/unique\/characterselect\/([^/]+)\//u)?.[1] || null;
}

function ModifierNamesLocation(logicalPath)
{
    const match = logicalPath.match(/^res:\/graphics\/character\/(female|male)\/paperdoll\/(bodyshapes|facemodifiers|utilityshapes)\/modifiernames\.yaml$/u);
    if (!match) return null;
    return {
        sex: match[1],
        group: ({ bodyshapes: "body", facemodifiers: "face", utilityshapes: "utility" })[match[2]]
    };
}

function PresentationLocation(logicalPath)
{
    const prefix = "res:/graphics/character/global/paperdolllibrary/";
    if (!logicalPath.startsWith(prefix) || !logicalPath.endsWith(".yaml")) return null;
    const relative = logicalPath.slice(prefix.length);
    const separator = relative.indexOf("/");
    if (separator <= 0) return null;
    return {
        group: relative.slice(0, separator),
        id: StripExtension(relative.slice(separator + 1))
    };
}

function PaperdollLocation(logicalPath)
{
    const match = logicalPath.match(/^res:\/graphics\/character\/(female|male)\/paperdoll\/(.+)$/u);
    return match ? { sex: match[1], relative: match[2] } : null;
}

function RequirePaperdollLocation(location, entry)
{
    if (!location) throw new Error(`Expected a sex-specific paperdoll path: ${entry.logicalPath}`);
}

function CharacterRelativeId(logicalPath)
{
    return StripExtension(logicalPath.replace(/^res:\/graphics\/character\//u, ""));
}

function StripExtension(value)
{
    return value.slice(0, value.length - path.posix.extname(value).length);
}

function DefaultReportPath(outputPath)
{
    const extension = path.extname(outputPath);
    return `${outputPath.slice(0, outputPath.length - extension.length)}.report.json`;
}

function ParseArgs(argv)
{
    const options = { compact: false, includeSources: false };
    for (let index = 0; index < argv.length; index++)
    {
        const argument = argv[index];
        if (argument === "--help" || argument === "-h") options.help = true;
        else if (argument === "--compact") options.compact = true;
        else if (argument === "--include-sources") options.includeSources = true;
        else if ([
            "--index",
            "--cache",
            "--out",
            "--report",
            "--build",
            "--target",
            "--game",
            "--provider",
            "--generated-at",
        ].includes(argument))
        {
            const value = argv[++index];
            if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
            options[ToOptionName(argument)] = value;
        }
        else throw new Error(`Unknown argument ${argument}`);
    }
    return options;
}

function ToOptionName(argument)
{
    return argument.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
}

function Compare(a, b)
{
    return a < b ? -1 : a > b ? 1 : 0;
}
