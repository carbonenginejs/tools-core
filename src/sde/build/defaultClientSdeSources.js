/**
 * Where each static-data export table comes from in the NetEase client.
 *
 * These are the tables an export assembled here can supply, so it drops into
 * the same consumer as an official CCP export. Their client sources are not one
 * format: the three skin tables are `.static` SQLite containers whose values
 * are JSON, the map tables are `.static` containers whose layout ships beside
 * them as a `.schema`, the rest are FSD containers that need a registered
 * layout in the runtime resource layer, and `materialSets` has no client-side origin at all.
 *
 * This list is not the goal. The goal is every table CCP's export publishes -
 * 102 of them - and what is here is the compulsory set plus the dogma family.
 * `docs/reference/export-coverage.md` tracks the distance.
 *
 * Measured 2026-08-14 against NetEase build 3466057 and CCP build 3466501,
 * extended 2026-08-15. `container` is a fact about the file; `required` mirrors
 * the official archive, which treats `materialSets` as optional.
 */
export const CJS_TOOL_SDE_CLIENT_SOURCES = Object.freeze([
    Object.freeze({
        table: "skins",
        path: "res:/staticdata/skins.static",
        container: "static",
        required: true,
    }),
    Object.freeze({
        table: "skinMaterials",
        path: "res:/staticdata/skinmaterials.static",
        container: "static",
        required: true,
    }),
    Object.freeze({
        table: "skinLicenses",
        path: "res:/staticdata/skinlicenses.static",
        container: "static",
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
        table: "graphicMaterialSets",
        path: "res:/staticdata/graphicmaterialsets.fsdbinary",
        container: "fsdbinary",
        required: true,
    }),
    Object.freeze({
        table: "blueprints",
        path: "res:/staticdata/blueprints.static",
        container: "static",
        required: false,
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
        required: false,
    }),
    Object.freeze({
        table: "metaGroups",
        path: "res:/staticdata/metagroups.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "typeDogma",
        path: "res:/staticdata/typedogma.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "dogmaAttributes",
        path: "res:/staticdata/dogmaattributes.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "dogmaEffects",
        path: "res:/staticdata/dogmaeffects.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "typeMaterials",
        path: "res:/staticdata/typematerials.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "typeLists",
        path: "res:/staticdata/typelist.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "compressibleTypes",
        path: "res:/staticdata/compressibletypes.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "controlTowerResources",
        path: "res:/staticdata/controltowerresources.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "skinrComponents",
        path: "res:/staticdata/ship_skin_design_components.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "skinrComponentCategories",
        path: "res:/staticdata/ship_skin_design_component_categories.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "skinrComponentPointValues",
        path: "res:/staticdata/ship_skin_design_component_point_values.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "skinrComponentRarities",
        path: "res:/staticdata/ship_skin_design_component_rarities.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "skinrSlotCategories",
        path: "res:/staticdata/ship_cosmetic_slot_categories.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "skinrSlotConfigurations",
        path: "res:/staticdata/ship_cosmetic_slot_configurations.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "skinrSlotNames",
        path: "res:/staticdata/ship_cosmetic_slot_names.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "skinrSlots",
        path: "res:/staticdata/ship_cosmetic_slots.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "skinrTierThresholds",
        path: "res:/staticdata/ship_skin_design_tier_thresholds.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "mapRegions",
        path: "res:/staticdata/regions.static",
        container: "schemabound",
        required: false,
    }),
    Object.freeze({
        table: "mapConstellations",
        path: "res:/staticdata/constellations.static",
        container: "schemabound",
        required: false,
    }),
    Object.freeze({
        table: "mapSolarSystems",
        path: "res:/staticdata/systems.static",
        container: "schemabound",
        required: false,
    }),
    Object.freeze({
        table: "mapPlanets",
        path: "res:/staticdata/solarsystemcontent.static",
        container: "embeddedschema",
        required: false,
    }),
    Object.freeze({
        table: "mapMoons",
        path: "res:/staticdata/solarsystemcontent.static",
        container: "embeddedschema",
        required: false,
    }),
    Object.freeze({
        table: "mapAsteroidBelts",
        path: "res:/staticdata/solarsystemcontent.static",
        container: "embeddedschema",
        required: false,
    }),
    Object.freeze({
        table: "mapStars",
        path: "res:/staticdata/solarsystemcontent.static",
        container: "embeddedschema",
        required: false,
    }),
    Object.freeze({
        table: "mapStargates",
        path: "res:/staticdata/solarsystemcontent.static",
        container: "embeddedschema",
        required: false,
    }),
    Object.freeze({
        table: "mapSecondarySuns",
        path: "res:/staticdata/solarsystemcontent.static",
        container: "embeddedschema",
        required: false,
    }),
    Object.freeze({
        table: "dbuffCollections",
        path: "res:/staticdata/dbuffcollections.static",
        container: "static",
        required: false,
    }),
    Object.freeze({
        table: "fighterAbilitiesByType",
        path: "res:/staticdata/fighterabilitiesbytype.static",
        container: "static",
        required: false,
    }),
    Object.freeze({
        table: "fighterAbilities",
        path: "res:/staticdata/fighterabilities.static",
        container: "static",
        required: false,
    }),
    Object.freeze({
        table: "cloneGrades",
        path: "res:/staticdata/clonegrades.static",
        container: "static",
        required: false,
    }),
    Object.freeze({
        table: "landmarks",
        path: "res:/staticdata/landmarks.static",
        container: "embeddedschema",
        required: false,
    }),
    Object.freeze({
        table: "ancestries",
        path: "res:/staticdata/ancestries.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "bloodlines",
        path: "res:/staticdata/bloodlines.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "races",
        path: "res:/staticdata/races.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "factions",
        path: "res:/staticdata/factions.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "stationServices",
        path: "res:/staticdata/stationservices.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "stationOperations",
        path: "res:/staticdata/stationoperations.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "corporationActivities",
        path: "res:/staticdata/corporationactivities.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "corporationRoles",
        path: "res:/staticdata/corporationroles.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "corporationRoleGroups",
        path: "res:/staticdata/corporationrolegroups.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "npcCorporationDivisions",
        path: "res:/staticdata/npccorporationdivisions.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "npcCorporations",
        path: "res:/staticdata/npccorporations.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "dogmaUnits",
        path: "res:/staticdata/dogmaunits.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "dogmaAttributeCategories",
        path: "res:/staticdata/dogmaattributecategories.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "dynamicItemAttributes",
        path: "res:/staticdata/dynamicitemattributes.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "contrabandTypes",
        path: "res:/staticdata/contrabandtypes.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "expertSystems",
        path: "res:/staticdata/expertsystems.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "skillPlans",
        path: "res:/staticdata/skillplans.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "agentTypes",
        path: "res:/staticdata/agenttypes.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "agentsInSpace",
        path: "res:/staticdata/agentsinspace.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "schools",
        path: "res:/staticdata/schools.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "schoolMap",
        path: "res:/staticdata/schoolmap.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "epicArcs",
        path: "res:/staticdata/epicarcs.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "typeBonus",
        path: "res:/staticdata/infobubbles.static",
        container: "static",
        dataset: "infoBubbleTypeBonuses",
        required: false,
    }),
    Object.freeze({
        table: "typeElements",
        path: "res:/staticdata/infobubbles.static",
        container: "static",
        dataset: "infoBubbleTypeElements",
        required: false,
    }),
    Object.freeze({
        table: "shipTreeGroups",
        path: "res:/staticdata/infobubbles.static",
        container: "static",
        dataset: "infoBubbleGroups",
        required: false,
    }),
    Object.freeze({
        table: "shipTreeElements",
        path: "res:/staticdata/infobubbles.static",
        container: "static",
        dataset: "infoBubbleElements",
        required: false,
    }),
    Object.freeze({
        table: "shipTreeFactions",
        path: "res:/staticdata/infobubbles.static",
        container: "static",
        dataset: "infoBubbleFactions",
        required: false,
    }),
    Object.freeze({
        table: "certificates",
        path: "res:/staticdata/certificates.static",
        container: "embeddedschema",
        dataset: "certificates",
        required: false,
    }),
    Object.freeze({
        table: "masteries",
        path: "res:/staticdata/certificates.static",
        container: "embeddedschema",
        dataset: "masteries",
        required: false,
    }),
    Object.freeze({
        table: "industryActivities",
        path: "res:/staticdata/industry_activities.static",
        container: "static",
        required: false,
    }),
    Object.freeze({
        table: "industryModifierSources",
        path: "res:/staticdata/industry_activity_modifier_sources.static",
        container: "static",
        required: false,
    }),
    Object.freeze({
        table: "industryTargetFilters",
        path: "res:/staticdata/industry_activity_target_filters.static",
        container: "static",
        required: false,
    }),
    Object.freeze({
        table: "industryAssemblyLines",
        path: "res:/staticdata/industry_assembly_lines.static",
        container: "static",
        required: false,
    }),
    Object.freeze({
        table: "industryInstallationTypes",
        path: "res:/staticdata/industry_installation_types.static",
        container: "static",
        required: false,
    }),
    Object.freeze({
        table: "icons",
        path: "res:/staticdata/iconids.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "materialSets",
        path: null,
        container: null,
        required: false,
    }),
]);

/** Returns the source description for one export table, or null. */
export function findClientSdeSource(table)
{
    return CJS_TOOL_SDE_CLIENT_SOURCES.find((source) => source.table === table) ?? null;
}

/** Returns the sources carried by one container family. */
export function clientSdeSourcesByContainer(container)
{
    return CJS_TOOL_SDE_CLIENT_SOURCES.filter((source) => source.container === container);
}
