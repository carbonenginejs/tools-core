import {
    CjsFsd64SchemaAgentTypes,
    CjsFsd64SchemaAgentsInSpace,
    CjsFsd64SchemaAncestries,
    CjsFsd64SchemaBloodlines,
    CjsFsd64SchemaCategories,
    CjsFsd64SchemaCompressibleTypes,
    CjsFsd64SchemaContrabandTypes,
    CjsFsd64SchemaControlTowerResources,
    CjsFsd64SchemaCorporationActivities,
    CjsFsd64SchemaCorporationRoleGroups,
    CjsFsd64SchemaCorporationRoles,
    CjsFsd64SchemaDogmaAttributeCategories,
    CjsFsd64SchemaDogmaAttributes,
    CjsFsd64SchemaDogmaEffects,
    CjsFsd64SchemaDogmaUnits,
    CjsFsd64SchemaDynamicItemAttributes,
    CjsFsd64SchemaEpicArcs,
    CjsFsd64SchemaExpertSystems,
    CjsFsd64SchemaFactions,
    CjsFsd64SchemaGraphicIds,
    CjsFsd64SchemaGraphicMaterialSets,
    CjsFsd64SchemaGroups,
    CjsFsd64SchemaIcons,
    CjsFsd64SchemaMarketGroups,
    CjsFsd64SchemaMetaGroups,
    CjsFsd64SchemaNpcCorporationDivisions,
    CjsFsd64SchemaNpcCorporations,
    CjsFsd64SchemaRaces,
    CjsFsd64SchemaSchoolMap,
    CjsFsd64SchemaSchools,
    CjsFsd64SchemaSkillPlans,
    CjsFsd64SchemaSkinrComponentCategories,
    CjsFsd64SchemaSkinrComponentPointValues,
    CjsFsd64SchemaSkinrComponentRarities,
    CjsFsd64SchemaSkinrComponents,
    CjsFsd64SchemaSkinrSlotCategories,
    CjsFsd64SchemaSkinrSlotConfigurations,
    CjsFsd64SchemaSkinrSlotNames,
    CjsFsd64SchemaSkinrSlots,
    CjsFsd64SchemaSkinrTierThresholds,
    CjsFsd64SchemaStationOperations,
    CjsFsd64SchemaStationServices,
    CjsFsd64SchemaTypeDogma,
    CjsFsd64SchemaTypeLists,
    CjsFsd64SchemaTypeMaterials,
    CjsFsd64SchemaTypes,
} from "@carbonenginejs/runtime-resource/formats/fsd/64/readers";

import { CJS_TOOL_SDE_CLIENT_SOURCES } from "./defaultClientSdeSources.js";
import { CJS_TOOL_SDE_TABLE_PROJECTIONS } from "./tableProjections.js";
import { ProjectGraphicMaterialSets } from "./projectGraphicMaterialSets.js";
import { ProjectGraphics } from "./projectGraphics.js";
import { ProjectTypes } from "./projectTypes.js";
import { BuildTypeExtras } from "./buildTypeExtras.js";

/**
 * Built-in client-generated SDE profiles.
 *
 * The records are intentionally separate even while their current mappings
 * match. A target can change one reader or projection without changing the
 * other, and sharing provider metadata never merges their output identities.
 */
export const DefaultSdeBuildProfileData = Object.freeze([
    CreateClientProfile("serenity"),
    CreateClientProfile("infinity"),
]);

function CreateClientProfile(target)
{
    return Object.freeze({
        target,
        game: "Eve",
        provider: "netease",
        sources: Object.freeze(CJS_TOOL_SDE_CLIENT_SOURCES.map(source => Object.freeze({ ...source }))),
        readers: CreateFsdReaders(),
        projections: Object.freeze({ ...CJS_TOOL_SDE_TABLE_PROJECTIONS }),
        projectors: Object.freeze({
            types: (records, context) => ProjectTypes(
                records,
                context.localization,
                { language: context.language },
            ),
            graphics: records => ProjectGraphics(records),
            graphicMaterialSets: records => ProjectGraphicMaterialSets(records),
        }),
        derivations: Object.freeze([
            Object.freeze({
                name: "typeExtras",
                Build: context => context.decoded?.types && context.localization
                    ? BuildTypeExtras(
                        context.decoded.types,
                        context.localization,
                        { language: context.language ?? "en" },
                    )
                    : null,
            }),
        ]),
    });
}

function CreateFsdReaders()
{
    return Object.freeze({
        types: new CjsFsd64SchemaTypes(),
        graphics: new CjsFsd64SchemaGraphicIds(),
        graphicMaterialSets: new CjsFsd64SchemaGraphicMaterialSets(),
        categories: new CjsFsd64SchemaCategories(),
        groups: new CjsFsd64SchemaGroups(),
        marketGroups: new CjsFsd64SchemaMarketGroups(),
        metaGroups: new CjsFsd64SchemaMetaGroups(),
        typeDogma: new CjsFsd64SchemaTypeDogma(),
        dogmaAttributes: new CjsFsd64SchemaDogmaAttributes(),
        dogmaEffects: new CjsFsd64SchemaDogmaEffects(),
        typeMaterials: new CjsFsd64SchemaTypeMaterials(),
        typeLists: new CjsFsd64SchemaTypeLists(),
        icons: new CjsFsd64SchemaIcons(),
        compressibleTypes: new CjsFsd64SchemaCompressibleTypes(),
        controlTowerResources: new CjsFsd64SchemaControlTowerResources(),
        skinrComponents: new CjsFsd64SchemaSkinrComponents(),
        skinrComponentCategories: new CjsFsd64SchemaSkinrComponentCategories(),
        skinrComponentPointValues: new CjsFsd64SchemaSkinrComponentPointValues(),
        skinrComponentRarities: new CjsFsd64SchemaSkinrComponentRarities(),
        skinrSlotCategories: new CjsFsd64SchemaSkinrSlotCategories(),
        skinrSlotConfigurations: new CjsFsd64SchemaSkinrSlotConfigurations(),
        skinrSlotNames: new CjsFsd64SchemaSkinrSlotNames(),
        skinrSlots: new CjsFsd64SchemaSkinrSlots(),
        skinrTierThresholds: new CjsFsd64SchemaSkinrTierThresholds(),
        ancestries: new CjsFsd64SchemaAncestries(),
        bloodlines: new CjsFsd64SchemaBloodlines(),
        races: new CjsFsd64SchemaRaces(),
        factions: new CjsFsd64SchemaFactions(),
        stationServices: new CjsFsd64SchemaStationServices(),
        stationOperations: new CjsFsd64SchemaStationOperations(),
        corporationActivities: new CjsFsd64SchemaCorporationActivities(),
        corporationRoles: new CjsFsd64SchemaCorporationRoles(),
        corporationRoleGroups: new CjsFsd64SchemaCorporationRoleGroups(),
        npcCorporationDivisions: new CjsFsd64SchemaNpcCorporationDivisions(),
        npcCorporations: new CjsFsd64SchemaNpcCorporations(),
        dogmaUnits: new CjsFsd64SchemaDogmaUnits(),
        dogmaAttributeCategories: new CjsFsd64SchemaDogmaAttributeCategories(),
        dynamicItemAttributes: new CjsFsd64SchemaDynamicItemAttributes(),
        contrabandTypes: new CjsFsd64SchemaContrabandTypes(),
        expertSystems: new CjsFsd64SchemaExpertSystems(),
        skillPlans: new CjsFsd64SchemaSkillPlans(),
        agentTypes: new CjsFsd64SchemaAgentTypes(),
        agentsInSpace: new CjsFsd64SchemaAgentsInSpace(),
        schools: new CjsFsd64SchemaSchools(),
        schoolMap: new CjsFsd64SchemaSchoolMap(),
        epicArcs: new CjsFsd64SchemaEpicArcs(),
    });
}
