// The per-table FSD schemas are optional. A runtime without them (they are
// quarantined pending provenance) leaves the client profiles registered but
// readerless, so only a Serenity, Infinity or Frontier build fails; the module
// and every other SDE path still load. Only a missing module is tolerated.
let FsdReaders = null;
let fsdReadersUnavailable = null;

try
{
    FsdReaders = await import("@carbonenginejs/runtime/resource/formats/fsd/64/readers");
}
catch (error)
{
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" && error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    fsdReadersUnavailable = `FSD schemas unavailable in this runtime (${error.code})`;
}

/** Why the client profiles carry no FSD readers, or null when they do. */
export const CJS_TOOL_SDE_FSD_READERS_UNAVAILABLE = fsdReadersUnavailable;

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

    // Frontier's own universe. It ships every file the map tables are built
    // from - its regions, constellations and systems files are each LARGER than
    // Tranquility's - along with the schema sidecars `schemabound` needs.
    //
    // No reader class: these containers carry their own schema, so unlike
    // `types` and `graphicids` above there is nothing layout-specific to pin.
    // Optional, because a build that cannot decode one of them should lose that
    // table rather than the whole SDE.
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
    // Crafting, from build 3573151: material properties and each type's range
    // for them. Optional because the builds before it do not ship them.
    Object.freeze({
        table: "property",
        path: "res:/staticdata/property.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    Object.freeze({
        table: "neoTypeProperty",
        path: "res:/staticdata/neotypeproperty.fsdbinary",
        container: "fsdbinary",
        required: false,
    }),
    // From build 3573151 the map above is gone from res:/staticdata and the
    // celestials ship as SQLite in the app tree instead, supplied with the
    // indexes. The one file fills every table `ProjectMapObjects` lists; the
    // entries here declare the two only it provides, since the rest are declared
    // above. The builds before it have no such file and skip it.
    Object.freeze({
        table: "mapLagrangePoints",
        path: "app:/bin64/staticdata/mapObjects.db",
        container: "mapobjects",
        required: false,
    }),
    Object.freeze({
        table: "npcStations",
        path: "app:/bin64/staticdata/mapObjects.db",
        container: "mapobjects",
        required: false,
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
function CreateFrontierProfile(R)
{
    return Object.freeze({
        target: "frontier",
        game: "Frontier",
        provider: "ccp",
        sources: Object.freeze(CJS_TOOL_SDE_FRONTIER_SOURCES.map(source => Object.freeze({ ...source }))),
        readers: R === null ? Object.freeze({}) : Object.freeze({
            icons: new R.CjsFsd64SchemaIcons(),
            types: new R.CjsFsd64SchemaFrontierTypes(),
            graphics: new R.CjsFsd64SchemaFrontierGraphicIds(),
            categories: new R.CjsFsd64SchemaCategories(),
            groups: new R.CjsFsd64SchemaGroups(),
            // Build 3512930 carries the same schema identities as these readers.
            marketGroups: new R.CjsFsd64SchemaMarketGroups(),
            typeDogma: new R.CjsFsd64SchemaTypeDogma(),
            // The station tables are fsdbinary and so still need a reader; the
            // map sources beside them carry their own schema and do not.
            stationServices: new R.CjsFsd64SchemaStationServices(),
            stationOperations: new R.CjsFsd64SchemaStationOperations(),
            property: new R.CjsFsd64SchemaProperty(),
            neoTypeProperty: new R.CjsFsd64SchemaNeoTypeProperty(),
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
export const DefaultSdeBuildProfileData = CreateDefaultSdeBuildProfileData(FsdReaders);

/**
 * Builds the client-generated profiles from a runtime FSD schema module.
 *
 * @param {object|null} R The runtime's `fsd/64/readers` module, or null when
 *   it is unavailable: the profiles then register without readers.
 * @returns {ReadonlyArray<object>} Serenity, Infinity and Frontier profile data.
 */
export function CreateDefaultSdeBuildProfileData(R)
{
    return Object.freeze([
        CreateClientProfile("serenity", R),
        CreateClientProfile("infinity", R),
        CreateFrontierProfile(R),
    ]);
}

function CreateClientProfile(target, R)
{
    return Object.freeze({
        target,
        game: "Eve",
        provider: "netease",
        sources: Object.freeze(CJS_TOOL_SDE_CLIENT_SOURCES.map(source => Object.freeze({ ...source }))),
        readers: R === null ? Object.freeze({}) : CreateFsdReaders(R),
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

function CreateFsdReaders(R)
{
    return Object.freeze({
        types: new R.CjsFsd64SchemaTypes(),
        graphics: new R.CjsFsd64SchemaGraphicIds(),
        graphicMaterialSets: new R.CjsFsd64SchemaGraphicMaterialSets(),
        categories: new R.CjsFsd64SchemaCategories(),
        groups: new R.CjsFsd64SchemaGroups(),
        marketGroups: new R.CjsFsd64SchemaMarketGroups(),
        metaGroups: new R.CjsFsd64SchemaMetaGroups(),
        typeDogma: new R.CjsFsd64SchemaTypeDogma(),
        dogmaAttributes: new R.CjsFsd64SchemaDogmaAttributes(),
        dogmaEffects: new R.CjsFsd64SchemaDogmaEffects(),
        typeMaterials: new R.CjsFsd64SchemaTypeMaterials(),
        typeLists: new R.CjsFsd64SchemaTypeLists(),
        icons: new R.CjsFsd64SchemaIcons(),
        compressibleTypes: new R.CjsFsd64SchemaCompressibleTypes(),
        controlTowerResources: new R.CjsFsd64SchemaControlTowerResources(),
        skinrComponents: new R.CjsFsd64SchemaSkinrComponents(),
        skinrComponentCategories: new R.CjsFsd64SchemaSkinrComponentCategories(),
        skinrComponentPointValues: new R.CjsFsd64SchemaSkinrComponentPointValues(),
        skinrComponentRarities: new R.CjsFsd64SchemaSkinrComponentRarities(),
        skinrSlotCategories: new R.CjsFsd64SchemaSkinrSlotCategories(),
        skinrSlotConfigurations: new R.CjsFsd64SchemaSkinrSlotConfigurations(),
        skinrSlotNames: new R.CjsFsd64SchemaSkinrSlotNames(),
        skinrSlots: new R.CjsFsd64SchemaSkinrSlots(),
        skinrTierThresholds: new R.CjsFsd64SchemaSkinrTierThresholds(),
        ancestries: new R.CjsFsd64SchemaAncestries(),
        bloodlines: new R.CjsFsd64SchemaBloodlines(),
        races: new R.CjsFsd64SchemaRaces(),
        factions: new R.CjsFsd64SchemaFactions(),
        stationServices: new R.CjsFsd64SchemaStationServices(),
        stationOperations: new R.CjsFsd64SchemaStationOperations(),
        corporationActivities: new R.CjsFsd64SchemaCorporationActivities(),
        corporationRoles: new R.CjsFsd64SchemaCorporationRoles(),
        corporationRoleGroups: new R.CjsFsd64SchemaCorporationRoleGroups(),
        npcCorporationDivisions: new R.CjsFsd64SchemaNpcCorporationDivisions(),
        npcCorporations: new R.CjsFsd64SchemaNpcCorporations(),
        dogmaUnits: new R.CjsFsd64SchemaDogmaUnits(),
        dogmaAttributeCategories: new R.CjsFsd64SchemaDogmaAttributeCategories(),
        dynamicItemAttributes: new R.CjsFsd64SchemaDynamicItemAttributes(),
        contrabandTypes: new R.CjsFsd64SchemaContrabandTypes(),
        expertSystems: new R.CjsFsd64SchemaExpertSystems(),
        skillPlans: new R.CjsFsd64SchemaSkillPlans(),
        agentTypes: new R.CjsFsd64SchemaAgentTypes(),
        agentsInSpace: new R.CjsFsd64SchemaAgentsInSpace(),
        schools: new R.CjsFsd64SchemaSchools(),
        schoolMap: new R.CjsFsd64SchemaSchoolMap(),
        epicArcs: new R.CjsFsd64SchemaEpicArcs(),
    });
}
