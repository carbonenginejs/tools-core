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
    CjsFsd64SchemaFrontierGraphicIds,
    CjsFsd64SchemaFrontierTypes,
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
} from "@carbonenginejs/runtime/resource/formats/fsd/64/readers";

import { CJS_TOOL_SDE_CLIENT_SOURCES } from "./defaultClientSdeSources.js";
import { CJS_TOOL_SDE_TABLE_PROJECTIONS } from "./tableProjections.js";
import { ProjectGraphicMaterialSets } from "./projectGraphicMaterialSets.js";
import { ProjectGraphics } from "./projectGraphics.js";
import { ProjectTypes } from "./projectTypes.js";
import { BuildTypeExtras } from "./buildTypeExtras.js";

/**
 * The tables EVE Frontier can supply today.
 *
 * Frontier has no published export, so there is no oracle and no coverage
 * target to measure against - the list is what the client stores in a layout
 * this package has pinned, including the four tables an identity join needs:
 * a type, the group and category it belongs to, and the graphic that carries
 * its SOF hull, plus market groups and dogma for the weapon catalog.
 *
 * Its `types` and `graphicids` are **not** Tranquility's layout, so they take
 * the Frontier readers. `groups` and `categories` are: both files carry the
 * same layout identity as the EVE build and decode with the same reader, which
 * is measured rather than assumed.
 */
const CJS_TOOL_SDE_FRONTIER_SOURCES = Object.freeze([
    Object.freeze({
        table: "icons",
        path: "res:/staticdata/iconids.fsdbinary",
        container: "fsdbinary",
        required: true,
    }),
    Object.freeze({
        table: "types",
        path: "res:/staticdata/types.fsdbinary",
        container: "fsdbinary",
        required: true,
    }),
    Object.freeze({
        table: "graphics",
        path: "res:/staticdata/graphicids.fsdbinary",
        container: "fsdbinary",
        required: true,
    }),
    Object.freeze({
        table: "categories",
        path: "res:/staticdata/categories.fsdbinary",
        container: "fsdbinary",
        required: true,
    }),
    Object.freeze({
        table: "groups",
        path: "res:/staticdata/groups.fsdbinary",
        container: "fsdbinary",
        required: true,
    }),
    Object.freeze({
        table: "marketGroups",
        path: "res:/staticdata/marketgroups.fsdbinary",
        container: "fsdbinary",
        required: true,
    }),
    Object.freeze({
        table: "typeDogma",
        path: "res:/staticdata/typedogma.fsdbinary",
        container: "fsdbinary",
        required: true,
    }),
]);

/**
 * EVE Frontier's profile.
 *
 * Separate from the client profiles above rather than another argument to them:
 * it shares neither their source list nor their readers, and the one thing it
 * does share - the projections - it shares because the export row shape is the
 * same shape, not because the games are.
 *
 * `typeExtras` is deliberately absent. It is a derivation over the NetEase
 * export's full type set, and nothing downstream asks Frontier for it yet.
 */
function CreateFrontierProfile()
{
    return Object.freeze({
        target: "frontier",
        game: "Frontier",
        provider: "ccp",
        sources: Object.freeze(CJS_TOOL_SDE_FRONTIER_SOURCES.map(source => Object.freeze({ ...source }))),
        readers: Object.freeze({
            icons: new CjsFsd64SchemaIcons(),
            types: new CjsFsd64SchemaFrontierTypes(),
            graphics: new CjsFsd64SchemaFrontierGraphicIds(),
            categories: new CjsFsd64SchemaCategories(),
            groups: new CjsFsd64SchemaGroups(),
            // Build 3512930 carries the same schema identities as these readers.
            marketGroups: new CjsFsd64SchemaMarketGroups(),
            typeDogma: new CjsFsd64SchemaTypeDogma(),
        }),
        projections: Object.freeze({ ...CJS_TOOL_SDE_TABLE_PROJECTIONS }),
        projectors: Object.freeze({
            types: (records, context) => ProjectTypes(
                records,
                context.localization,
                { language: context.language },
            ),
            graphics: records => ProjectGraphics(records),
        }),
    });
}

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
    CreateFrontierProfile(),
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
