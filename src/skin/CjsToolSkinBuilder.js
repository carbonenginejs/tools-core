import {
    compareIds,
    mapRecords,
    normalizeId,
    normalizeIdArray,
    normalizeSourceIdentity,
    requireRecord,
    sortValue,
    tableEntries,
} from "./helpers.js";

export const CJS_SKIN_TABLES = Object.freeze([
    "skins",
    "skinMaterials",
    "skinLicenses",
    "graphicMaterialSets",
    "types",
]);

/** Builds the deterministic offline library for developer-authored SKINs. */
export class CjsToolSkinBuilder
{

    static schema = "carbonenginejs.skinLibrary";

    static build(options = {})
    {
        const tables = options.tables ?? options;
        const skins = mapRecords(tables.skins, "skins", "skinID", (record, skinID) => ({
            ...record,
            skinMaterialID: normalizeId(record.skinMaterialID, `skin ${skinID} material`),
            types: normalizeIdArray(record.types, `skin ${skinID} types`),
        }));
        const skinMaterials = mapRecords(
            tables.skinMaterials,
            "skinMaterials",
            "skinMaterialID",
            (record, skinMaterialID) => ({
                ...record,
                iconPath: `res:/ui/texture/classes/skins/icons/${skinMaterialID}.png`,
                materialSetID: normalizeId(
                    record.materialSetID,
                    `skin material ${skinMaterialID} material set`,
                ),
            }),
        );
        const skinMaterialSets = mapRecords(
            tables.graphicMaterialSets,
            "graphicMaterialSets",
            "materialSetID",
            NormalizeMaterialSet,
        );
        const skinLicenses = mapRecords(
            tables.skinLicenses,
            "skinLicenses",
            "licenseTypeID",
            (record, recordID) => ({
                ...record,
                licenseTypeID: normalizeId(
                    record.licenseTypeID ?? recordID,
                    `skin license ${recordID} type`,
                ),
                skinID: normalizeId(record.skinID, `skin license ${recordID} skin`),
            }),
        );
        const typesToSkins = {};
        const skinMaterialsToTypes = {};
        const skinsToLicenses = {};

        for (const skin of Object.values(skins))
        {
            requireRecord(skinMaterials, skin.skinMaterialID, "Skin material");
            const materialTypes = skinMaterialsToTypes[skin.skinMaterialID] ?? new Set();

            for (const typeID of skin.types)
            {
                (typesToSkins[typeID] ??= new Set()).add(skin.skinID);
                materialTypes.add(typeID);
            }

            skinMaterialsToTypes[skin.skinMaterialID] = materialTypes;
        }

        for (const material of Object.values(skinMaterials))
        {
            requireRecord(skinMaterialSets, material.materialSetID, "Skin material set");
        }

        for (const license of Object.values(skinLicenses))
        {
            (skinsToLicenses[license.skinID] ??= new Set()).add(license.licenseTypeID);
        }

        const names = BuildNameIndex(tables.types, skins);

        return sortValue({
            schema: this.schema,
            schemaVersion: 1,
            ...normalizeSourceIdentity(options, "SKIN library"),
            skins,
            skinMaterials,
            skinMaterialSets,
            skinLicenses,
            names,
            typesToSkins: SetsToArrays(typesToSkins),
            skinMaterialsToTypes: SetsToArrays(skinMaterialsToTypes),
            skinsToLicenses: SetsToArrays(skinsToLicenses),
        });
    }

}

function BuildNameIndex(typeTable, skins)
{
    const names = new Map();

    for (const [ typeID, type ] of tableEntries(typeTable, "types"))
    {
        const name = LocalizedName(type.name ?? type.typeName);

        if (name)
        {
            AddNameCandidate(names, name, {
                kind: "type",
                typeID,
                skinID: null,
            });
        }
    }

    for (const skin of Object.values(skins))
    {
        const name = LocalizedName(skin.internalName ?? skin.name ?? skin.skinName);

        if (!name) continue;

        for (const typeID of skin.types)
        {
            AddNameCandidate(names, name, {
                kind: "skin",
                typeID,
                skinID: skin.skinID,
            });
        }
    }

    return Object.fromEntries([ ...names.entries() ]
        .sort(([ left ], [ right ]) => left.localeCompare(right, "en"))
        .map(([ name, candidates ]) => [
            name,
            [ ...candidates.values() ].sort(CompareNameCandidates),
        ]));
}

function AddNameCandidate(names, name, candidate)
{
    const normalized = NormalizeName(name);
    const candidates = names.get(normalized) ?? new Map();
    const key = `${candidate.kind}:${candidate.typeID}:${candidate.skinID ?? ""}`;

    candidates.set(key, candidate);
    names.set(normalized, candidates);
}

function LocalizedName(value)
{
    if (value && typeof value === "object" && !Array.isArray(value))
    {
        value = value.en ?? value.enUS ?? value.en_us ?? Object.values(value)[0];
    }

    return String(value ?? "").trim() || null;
}

function NormalizeName(value)
{
    return String(value).trim().toLocaleLowerCase("en-US");
}

function CompareNameCandidates(left, right)
{
    return left.kind.localeCompare(right.kind, "en")
        || compareIds(left.typeID, right.typeID)
        || compareIds(left.skinID ?? -1, right.skinID ?? -1);
}

function NormalizeMaterialSet(record)
{
    const {
        custommaterial1,
        custommaterial2,
        ...materialSet
    } = record;

    return {
        ...materialSet,
        ...(custommaterial1 === undefined ? {} : { patternMaterial1: custommaterial1 }),
        ...(custommaterial2 === undefined ? {} : { patternMaterial2: custommaterial2 }),
    };
}

function SetsToArrays(value)
{
    return Object.fromEntries(Object.entries(value).map(([ key, items ]) => [
        key,
        [ ...items ].sort(compareIds),
    ]));
}
