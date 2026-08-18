import factionSlotDefinitions from "../../definitions/skinr-faction-slots-v2-2026-08-10.json" with { type: "json" };
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

    /**
     * Cosmetic-slot to mesh-material-layer conversion, keyed by factionID and
     * served as the library's skinrSlotsToMaterialLayerByFactionId section.
     * slotID is the cosmetic slot (1 primary_nanocoating,
     * 2 secondary_nanocoating, 3 tertiary_nanocoating, 4 tech_area); materialID
     * is the mesh material layer (material1-4) that slot's component feeds.
     *
     * factionID is an attribute of a typeID and does NOT map to a SOF faction.
     * v1 of this file was keyed by SOF faction name, which no consumer can
     * resolve correctly - the values were right, the key was not. The shape
     * here matches the pending ESI endpoint, so the served table can replace
     * the authored one without a conversion step.
     *
     * The authored copy lives in
     * definitions/skinr-faction-slots-v2-2026-08-10.json. It is authored
     * because the SDE does not carry the conversion - not because no
     * source for it exists, which is what v1 claimed.
     */
    static skinrSlotsToMaterialLayerByFactionId = factionSlotDefinitions.slotsToMaterialLayerByFactionId;

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
        // The four ship-tree tables are OPTIONAL. Decided 2026-08-15.
        //
        // They were required by accident rather than by intent: each was passed
        // straight to `mapRecords`, so an absent one arrived as `undefined` and
        // threw out of `tableEntries` with a message about its type. Nothing in
        // the organization reads them — they are mapped, cross-validated, written
        // into the payload, and never consumed — while `materialSets` and
        // `groups` were already optional for exactly that reason.
        //
        // The cost of the accident was real: a manually generated SDE covers 11
        // of the 15 tables this builder lists and no source carries these four,
        // so the SKINR library could not be built for Serenity or Infinity at
        // all.
        // They are still emitted when present, so nothing that has them changes.
        const shipTreeElements = mapRecords(
            tables.shipTreeElements ?? {},
            "shipTreeElements",
            "shipTreeElementID",
        );
        const shipTreeFactions = mapRecords(
            tables.shipTreeFactions ?? {},
            "shipTreeFactions",
            "factionID",
            NormalizeShipTreeRecord,
        );
        const shipTreeGroups = mapRecords(
            tables.shipTreeGroups ?? {},
            "shipTreeGroups",
            "shipTreeGroupID",
            (record, id) => ({
                ...NormalizeShipTreeRecord(record),
                preReqSkills: NormalizePrerequisiteSkills(record.preReqSkills),
                tierThresholds: tierThresholds[id]?.tierThresholds ?? [],
            }),
        );
        const typeElements = mapRecords(
            tables.typeElements ?? {},
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

        const typesToFactions = BuildTypeFactions(tables.types, groups);
        const skinrSlotsToMaterialLayerByFactionId = this.skinrSlotsToMaterialLayerByFactionId;

        ValidateReferences({
            componentCategories,
            componentRarities,
            components,
            skinrSlotsToMaterialLayerByFactionId,
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
            skinrSlotsToMaterialLayerByFactionId,
            slotCategories,
            slotConfigurations,
            slotNames,
            slots,
            tierThresholds,
            shipTreeElements,
            shipTreeFactions,
            shipTreeGroups,
            typeElements,
            typesToFactions,
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

/**
 * typeID -> factionID, for every ship type that carries one.
 *
 * factionID is an attribute of a typeID in the SDE, so this is a join, not
 * authored data. It exists because the consumer cannot get it anywhere else:
 * ESI's /universe/types/{id} carries neither a faction_id field nor a
 * faction-valued dogma attribute (verified 2026-08-10 against type 85087,
 * Tholos - 15 top-level fields, 98 dogma attributes, no faction in either).
 *
 * Rides the SKINR library because that is what selects a hull's cosmetic-slot
 * conversion, and it means a consumer holding a ship_type_id needs no second
 * service to resolve one.
 *
 * Ships only (categoryID 6), matching BuildTypeSlotConfigurations - a faction
 * module's factionID is not this library's business. Types with no factionID
 * are omitted rather than recorded as null: most types have none, and an
 * absent key says "no faction" as clearly as a null while keeping the section
 * to the few thousand that do.
 */
function BuildTypeFactions(table, groups)
{
    const result = {};

    for (const [ typeID, record ] of tableEntries(table, "types"))
    {
        const group = requireRecord(groups, record.groupID, "Type group");

        if (group.categoryID !== 6) continue;
        if (record.factionID === undefined || record.factionID === null) continue;

        result[typeID] = normalizeId(record.factionID, `type ${typeID} faction`);
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

    // Authored data, not table-derived: each faction entry must assign all four
    // cosmetic slots to all four mesh material layers, one to one. Both halves
    // are checked - a repeated slotID is as broken as a repeated materialID,
    // and the positional array this replaced could only ever express the second.
    for (const [ factionID, pairs ] of Object.entries(data.skinrSlotsToMaterialLayerByFactionId))
    {
        const slotIDs = new Set((pairs || []).map(pair => pair?.slotID));
        const materialIDs = new Set((pairs || []).map(pair => pair?.materialID));
        const permutes = set => set.size === 4 && [ 1, 2, 3, 4 ].every(value => set.has(value));

        if (!Array.isArray(pairs) || pairs.length !== 4 || !permutes(slotIDs) || !permutes(materialIDs))
        {
            throw new Error(
                `Faction slot conversion for factionID ${factionID} must map cosmetic slots 1-4 onto material layers 1-4 one to one`,
            );
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
