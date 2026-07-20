import {
    compareIds,
    mapRecords,
    normalizeId,
    normalizeIdArray,
    normalizeOrderedIdArray,
    normalizePairs,
    normalizeSourceIdentity,
    projectionAddressMode,
    requireRecord,
    resourceBaseName,
    sortValue,
    tableEntries,
} from "./helpers.js";

export const CJS_SKINR_TABLES = Object.freeze([
    "skinrComponentCategories",
    "skinrComponentPointValues",
    "skinrComponentRarities",
    "skinrComponents",
    "skinrSlotCategories",
    "skinrSlotConfigurations",
    "skinrSlotNames",
    "skinrSlots",
    "skinrTierThresholds",
    "shipTreeElements",
    "shipTreeFactions",
    "shipTreeGroups",
    "typeElements",
    "types",
    "groups",
]);

/** Builds the deterministic offline library for player-authored SKINR data. */
export class CjsToolSkinrBuilder
{

    static schema = "carbonenginejs.skinrLibrary";

    static build(options = {})
    {
        const tables = options.tables ?? options;
        const componentPointValues = mapRecords(
            tables.skinrComponentPointValues,
            "skinrComponentPointValues",
            "componentCategoryID",
            record => ({
                rarityPointValues: normalizePairs(record._value, "rarityID", "value"),
            }),
        );
        const componentCategories = mapRecords(
            tables.skinrComponentCategories,
            "skinrComponentCategories",
            "componentCategoryID",
            (record, id) => ({
                ...record,
                rarityPointValues: componentPointValues[id]?.rarityPointValues ?? [],
            }),
        );
        const componentRarities = mapRecords(
            tables.skinrComponentRarities,
            "skinrComponentRarities",
            "componentRarityID",
        );
        const componentLicenses = {};
        const components = mapRecords(
            tables.skinrComponents,
            "skinrComponents",
            "componentID",
            (record, componentID) => NormalizeComponent(
                record,
                componentID,
                componentLicenses,
            ),
        );
        const slotCategories = mapRecords(
            tables.skinrSlotCategories,
            "skinrSlotCategories",
            "cosmeticSlotCategoryID",
        );
        const slotConfigurations = mapRecords(
            tables.skinrSlotConfigurations,
            "skinrSlotConfigurations",
            "cosmeticSlotConfigurationID",
            (record, id) => ({
                ...record,
                allowAllShips: record.allowAllShips === true,
                config: normalizeOrderedIdArray(
                    record.config,
                    `slot configuration ${id} slots`,
                ),
                ships: normalizeIdArray(record.ships, `slot configuration ${id} ships`),
            }),
        );
        const slotNames = mapRecords(
            tables.skinrSlotNames,
            "skinrSlotNames",
            "cosmeticSlotID",
        );
        const slots = mapRecords(
            tables.skinrSlots,
            "skinrSlots",
            "cosmeticSlotID",
            (record, id) => ({
                ...record,
                allowedDesignComponentCategories: normalizeIdArray(
                    record.allowedDesignComponentCategories,
                    `cosmetic slot ${id} component categories`,
                ),
                cosmeticSlotCategoryID: normalizeId(
                    record.category,
                    `cosmetic slot ${id} category`,
                ),
                category: undefined,
            }),
        );
        const tierThresholds = mapRecords(
            tables.skinrTierThresholds,
            "skinrTierThresholds",
            "shipTreeGroupID",
            record => ({
                tierThresholds: normalizePairs(record._value, "tier", "threshold"),
            }),
        );
        const shipTreeElements = mapRecords(
            tables.shipTreeElements,
            "shipTreeElements",
            "shipTreeElementID",
        );
        const shipTreeFactions = mapRecords(
            tables.shipTreeFactions,
            "shipTreeFactions",
            "factionID",
            NormalizeShipTreeRecord,
        );
        const shipTreeGroups = mapRecords(
            tables.shipTreeGroups,
            "shipTreeGroups",
            "shipTreeGroupID",
            (record, id) => ({
                ...NormalizeShipTreeRecord(record),
                preReqSkills: NormalizePrerequisiteSkills(record.preReqSkills),
                tierThresholds: tierThresholds[id]?.tierThresholds ?? [],
            }),
        );
        const typeElements = mapRecords(
            tables.typeElements,
            "typeElements",
            "typeID",
            record => ({
                elements: normalizePairs(
                    record.elements,
                    "position",
                    "shipTreeElementID",
                ),
            }),
        );
        const groups = mapRecords(tables.groups, "groups", "groupID");
        const typesToSlotConfigurations = BuildTypeSlotConfigurations(
            tables.types,
            groups,
            slotConfigurations,
        );

        ValidateReferences({
            componentCategories,
            componentRarities,
            components,
            slotCategories,
            slotConfigurations,
            slotNames,
            slots,
            shipTreeElements,
            shipTreeGroups,
            typeElements,
            typesToSlotConfigurations,
        });

        return sortValue({
            schema: this.schema,
            schemaVersion: 1,
            ...normalizeSourceIdentity(options, "SKINR library"),
            componentCategories,
            componentPointValues,
            componentRarities,
            components,
            componentLicenses: Object.fromEntries(
                Object.entries(componentLicenses).map(([ id, licenses ]) => [
                    id,
                    licenses.sort((left, right) => compareIds(left.componentID, right.componentID)),
                ]),
            ),
            slotCategories,
            slotConfigurations,
            slotNames,
            slots,
            tierThresholds,
            shipTreeElements,
            shipTreeFactions,
            shipTreeGroups,
            typeElements,
            typesToSlotConfigurations,
        });
    }

}

function NormalizeComponent(record, componentID, componentLicenses)
{
    const componentCategoryID = normalizeId(
        record.category,
        `component ${componentID} category`,
    );
    const componentRarityID = normalizeId(
        record.rarity,
        `component ${componentID} rarity`,
    );
    const associatedTypeIds = (record.associatedTypeIds ?? []).map((association) =>
    {
        const typeID = normalizeId(
            association.typeID,
            `component ${componentID} license type`,
        );
        const license = {
            componentID,
            licenseUsesGranted: Number(association.licenseUsesGranted),
        };

        (componentLicenses[typeID] ??= []).push(license);

        return {
            licenseUsesGranted: license.licenseUsesGranted,
            typeID,
        };
    }).sort((left, right) => compareIds(left.typeID, right.typeID));

    return {
        ...record,
        category: undefined,
        rarity: undefined,
        componentCategoryID,
        componentRarityID,
        associatedTypeIds,
        addressUMode: projectionAddressMode(record.projectionTypeU),
        addressVMode: projectionAddressMode(record.projectionTypeV),
        sofPattern: resourceBaseName(record.resourceFile),
    };
}

function NormalizeShipTreeRecord(record)
{
    return {
        ...record,
        elements: normalizePairs(record.elements, "position", "shipTreeElementID"),
    };
}

function NormalizePrerequisiteSkills(value)
{
    if (!Array.isArray(value))
    {
        return [];
    }

    return value.map(entry => ({
        factionID: normalizeId(entry?._key, "ship-tree prerequisite faction"),
        skills: (entry?.skills ?? []).map(skill => ({
            skillTypeID: normalizeId(skill?._key, "ship-tree prerequisite skill"),
            display: skill?.display === true,
            level: Number(skill?.level),
        })).sort((left, right) => compareIds(left.skillTypeID, right.skillTypeID)),
    })).sort((left, right) => compareIds(left.factionID, right.factionID));
}

function BuildTypeSlotConfigurations(table, groups, configurations)
{
    const rules = Object.values(configurations).sort((left, right) =>
        left.priority - right.priority
        || compareIds(left.cosmeticSlotConfigurationID, right.cosmeticSlotConfigurationID));
    const result = {};

    for (const [ typeID, record ] of tableEntries(table, "types"))
    {
        const group = requireRecord(groups, record.groupID, "Type group");

        if (group.categoryID !== 6)
        {
            continue;
        }

        const rule = rules.find(candidate =>
            candidate.allowAllShips || candidate.ships.includes(typeID));

        if (!rule)
        {
            throw new Error(`No SKINR slot configuration matches type ${typeID}`);
        }

        result[typeID] = rule.cosmeticSlotConfigurationID;
    }

    return result;
}

function ValidateReferences(data)
{
    for (const component of Object.values(data.components))
    {
        requireRecord(
            data.componentCategories,
            component.componentCategoryID,
            "Component category",
        );
        requireRecord(
            data.componentRarities,
            component.componentRarityID,
            "Component rarity",
        );
    }

    for (const slot of Object.values(data.slots))
    {
        requireRecord(data.slotCategories, slot.cosmeticSlotCategoryID, "Slot category");
        requireRecord(data.slotNames, slot.cosmeticSlotID, "Slot name");

        for (const categoryID of slot.allowedDesignComponentCategories)
        {
            requireRecord(data.componentCategories, categoryID, "Component category");
        }
    }

    for (const configuration of Object.values(data.slotConfigurations))
    {
        for (const slotID of configuration.config)
        {
            requireRecord(data.slots, slotID, "Cosmetic slot");
        }
    }

    for (const configurationID of Object.values(data.typesToSlotConfigurations))
    {
        requireRecord(
            data.slotConfigurations,
            configurationID,
            "Type slot configuration",
        );
    }

    for (const record of [
        ...Object.values(data.shipTreeGroups),
        ...Object.values(data.typeElements),
    ])
    {
        for (const element of record.elements)
        {
            requireRecord(
                data.shipTreeElements,
                element.shipTreeElementID,
                "Ship-tree element",
            );
        }
    }

}
