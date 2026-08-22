/**
 * How each decoded FSD table becomes export rows.
 *
 * These are specs, not code: `ProjectRecords` reads them. Every rename here is
 * a measured difference between what the client stores and what CCP's export
 * publishes, verified field by field against the export at build 3466501, so a
 * rename that looks arbitrary is the exporter's choice rather than ours.
 *
 * Fields the client stores and the export does not publish are simply absent
 * from `copy`. Two of those are worth naming because they look like omissions:
 * `dogmaAttributes.attributeID` and `dogmaEffects.effectID` repeat the record
 * key, and `dogmaEffects.sfxName` has no non-empty value but `"None"`.
 */

/** Item categories. */
export const CATEGORIES_PROJECTION = Object.freeze({
    table: "categories",
    copy: Object.freeze([ "iconID", "published" ]),
    identifiers: Object.freeze([ "iconID" ]),
    labels: Object.freeze({ nameID: "name" }),
});

/** Item groups, which categories own and types belong to. */
export const GROUPS_PROJECTION = Object.freeze({
    table: "groups",
    copy: Object.freeze([
        "anchorable", "anchored", "categoryID", "fittableNonSingleton",
        "iconID", "published", "useBasePrice",
    ]),
    identifiers: Object.freeze([ "categoryID", "iconID" ]),
    labels: Object.freeze({ nameID: "name" }),
});

/** The market tree. */
export const MARKET_GROUPS_PROJECTION = Object.freeze({
    table: "marketGroups",
    copy: Object.freeze([ "hasTypes", "iconID", "parentGroupID" ]),
    identifiers: Object.freeze([ "iconID", "parentGroupID" ]),
    labels: Object.freeze({ descriptionID: "description", nameID: "name" }),
});

/** Tech tiers, which carry the colour the client tints their icons with. */
export const META_GROUPS_PROJECTION = Object.freeze({
    table: "metaGroups",
    copy: Object.freeze([ "iconID", "iconSuffix" ]),
    identifiers: Object.freeze([ "iconID" ]),
    // Three channels, not four: the export drops alpha from this table while
    // keeping it in graphicMaterialSets.
    colors: Object.freeze({
        color: Object.freeze({ channels: Object.freeze([ "b", "g", "r" ]), precision: 6 }),
    }),
    labels: Object.freeze({ descriptionID: "description", nameID: "name" }),
});

/** Each type's attribute values and effects. */
export const TYPE_DOGMA_PROJECTION = Object.freeze({
    table: "typeDogma",
    lists: Object.freeze({
        dogmaAttributes: Object.freeze({
            fields: Object.freeze([ "attributeID", "value" ]),
            identifiers: Object.freeze([ "attributeID" ]),
        }),
        dogmaEffects: Object.freeze({
            fields: Object.freeze([ "effectID", "isDefault" ]),
            identifiers: Object.freeze([ "effectID" ]),
        }),
    }),
});

/** Attribute definitions. */
export const DOGMA_ATTRIBUTES_PROJECTION = Object.freeze({
    table: "dogmaAttributes",
    copy: Object.freeze([
        "categoryID", "chargeRechargeTimeID", "dataType", "defaultValue",
        "description", "displayWhenZero", "highIsGood", "iconID",
        "maxAttributeID", "minAttributeID", "name", "published", "stackable",
        "unitID",
    ]),
    identifiers: Object.freeze([
        "categoryID", "chargeRechargeTimeID", "iconID", "maxAttributeID",
        "minAttributeID", "unitID",
    ]),
    singles: Object.freeze([ "defaultValue" ]),
    rename: Object.freeze({ categoryID: "attributeCategoryID" }),
    labels: Object.freeze({
        displayNameID: "displayName",
        tooltipDescriptionID: "tooltipDescription",
        tooltipTitleID: "tooltipTitle",
    }),
});

/** Effect definitions, and the modifiers that make them worth having. */
export const DOGMA_EFFECTS_PROJECTION = Object.freeze({
    table: "dogmaEffects",
    copy: Object.freeze([
        "disallowAutoRepeat", "dischargeAttributeID", "distribution",
        "durationAttributeID", "effectCategory", "effectName",
        "electronicChance", "falloffAttributeID", "fittingUsageChanceAttributeID",
        "guid", "iconID", "isAssistance", "isOffensive", "isWarpSafe",
        "npcActivationChanceAttributeID", "npcUsageChanceAttributeID",
        "propulsionChance", "published", "rangeAttributeID", "rangeChance",
        "resistanceAttributeID", "trackingSpeedAttributeID",
    ]),
    identifiers: Object.freeze([
        "dischargeAttributeID", "durationAttributeID", "falloffAttributeID",
        "fittingUsageChanceAttributeID", "iconID",
        "npcActivationChanceAttributeID", "npcUsageChanceAttributeID",
        "rangeAttributeID", "resistanceAttributeID", "trackingSpeedAttributeID",
    ]),
    rename: Object.freeze({ effectCategory: "effectCategoryID", effectName: "name" }),
    labels: Object.freeze({ descriptionID: "description", displayNameID: "displayName" }),
    lists: Object.freeze({
        modifierInfo: Object.freeze({
            fields: Object.freeze([
                "domain", "effectID", "func", "groupID", "modifiedAttributeID",
                "modifyingAttributeID", "operation", "skillTypeID",
            ]),
            identifiers: Object.freeze([
                "effectID", "groupID", "modifiedAttributeID",
                "modifyingAttributeID", "skillTypeID",
            ]),
        }),
    }),
});

/** What each type reprocesses into. */
export const TYPE_MATERIALS_PROJECTION = Object.freeze({
    table: "typeMaterials",
    lists: Object.freeze({
        materials: Object.freeze({
            fields: Object.freeze([ "materialTypeID", "quantity" ]),
            identifiers: Object.freeze([ "materialTypeID" ]),
        }),
        randomizedMaterials: Object.freeze({
            fields: Object.freeze([ "materialTypeID", "quantityMax", "quantityMin" ]),
            identifiers: Object.freeze([ "materialTypeID" ]),
        }),
    }),
});

/**
 * Named sets of types, as includes and excludes over three levels.
 *
 * The client file is `typelist.fsdbinary`, singular, which is why this table
 * spent so long filed as having no source.
 */
export const TYPE_LISTS_PROJECTION = Object.freeze({
    table: "typeLists",
    copy: Object.freeze([ "name" ]),
    labels: Object.freeze({
        displayDescriptionID: "displayDescription",
        displayNameID: "displayName",
    }),
    lists: Object.freeze(Object.fromEntries([
        "excludedCategoryIDs", "excludedGroupIDs", "excludedTypeIDs",
        "includedCategoryIDs", "includedGroupIDs", "includedTypeIDs",
    ].map(field => [ field, Object.freeze({ identifier: true }) ]))),
});

/**
 * Which type a type compresses into.
 *
 * The record is a bare identifier rather than an object, so the published field
 * name comes from the exporter and has to be named here.
 */
export const COMPRESSIBLE_TYPES_PROJECTION = Object.freeze({
    table: "compressibleTypes",
    valueField: "compressedTypeID",
    identifiers: Object.freeze([ "compressedTypeID" ]),
});

/** What each control tower consumes. */
export const CONTROL_TOWER_RESOURCES_PROJECTION = Object.freeze({
    table: "controlTowerResources",
    lists: Object.freeze({
        resources: Object.freeze({
            fields: Object.freeze([
                "factionID", "minSecurityLevel", "purpose", "quantity", "resourceTypeID",
            ]),
            identifiers: Object.freeze([ "factionID", "resourceTypeID" ]),
            singles: Object.freeze([ "minSecurityLevel" ]),
        }),
    }),
});

/**
 * Blueprints, which need no layout work and almost no projection.
 *
 * `blueprints.static` is a SQLite container whose values are already the
 * export's own JSON, so this is passthrough plus the exporter's one habit of
 * omitting empty lists. 5,082 of 5,082 rows then match exactly.
 */
export const BLUEPRINTS_PROJECTION = Object.freeze({
    table: "blueprints",
    container: "static",
    passthrough: true,
    pruneEmptyArrays: true,
});


/** The SKINR design components, and the tables that classify them. */
export const SKINR_COMPONENTS_PROJECTION = Object.freeze({
    table: "skinrComponents",
    copy: Object.freeze([
        "category", "finish", "iconFile", "projectionTypeU", "projectionTypeV",
        "published", "rarity", "resourceFile",
    ]),
    identifiers: Object.freeze([ "category", "rarity" ]),
    // Not a naming convention: the value stored in the client is wrong, and the
    // export and the API publish the corrected one. So this is a correction
    // rather than a rename, the published side is authoritative, and the
    // direction is deliberately the inverse of what the words say. Applying it
    // the intuitive way round mismatches 514 of the 544 components.
    enums: Object.freeze({
        projectionTypeU: Object.freeze({ Clamp: "clamp-to-border", Border: "clamp-to-edge", Repeat: "repeat" }),
        projectionTypeV: Object.freeze({ Clamp: "clamp-to-border", Border: "clamp-to-edge", Repeat: "repeat" }),
    }),
    labels: Object.freeze({ nameID: "name" }),
    lists: Object.freeze({
        associatedTypeIds: Object.freeze({
            fields: Object.freeze([ "licenseUsesGranted", "typeID" ]),
            identifiers: Object.freeze([ "typeID" ]),
        }),
    }),
    objects: Object.freeze({
        sequenceBinder: Object.freeze({
            fields: Object.freeze([ "count", "itemTypeID" ]),
            identifiers: Object.freeze([ "itemTypeID" ]),
        }),
    }),
});

/** Three tables that are a key and an internal name. */
export const SKINR_COMPONENT_CATEGORIES_PROJECTION = Object.freeze({ table: "skinrComponentCategories", copy: Object.freeze([ "name" ]) });
export const SKINR_SLOT_NAMES_PROJECTION = Object.freeze({ table: "skinrSlotNames", copy: Object.freeze([ "name" ]) });
export const SKINR_SLOT_CATEGORIES_PROJECTION = Object.freeze({ table: "skinrSlotCategories", copy: Object.freeze([ "name" ]) });

/** Rarity tiers. */
export const SKINR_COMPONENT_RARITIES_PROJECTION = Object.freeze({
    table: "skinrComponentRarities",
    copy: Object.freeze([ "rank" ]),
    labels: Object.freeze({ nameID: "name" }),
});

/** Two map-of-map tables the export flattens to key/value pairs. */
export const SKINR_COMPONENT_POINT_VALUES_PROJECTION = Object.freeze({ table: "skinrComponentPointValues", entriesField: "_value" });
export const SKINR_TIER_THRESHOLDS_PROJECTION = Object.freeze({ table: "skinrTierThresholds", entriesField: "_value" });

/** The eight cosmetic slots. */
export const SKINR_SLOTS_PROJECTION = Object.freeze({
    table: "skinrSlots",
    copy: Object.freeze([ "category" ]),
    identifiers: Object.freeze([ "category" ]),
    labels: Object.freeze({ nameID: "name" }),
    lists: Object.freeze({ allowedDesignComponentCategories: Object.freeze({ identifier: true }) }),
});

/** Which slots a ship gets. */
export const SKINR_SLOT_CONFIGURATIONS_PROJECTION = Object.freeze({
    table: "skinrSlotConfigurations",
    copy: Object.freeze([ "allowAllShips", "name", "priority" ]),
    lists: Object.freeze({
        config: Object.freeze({ identifier: true }),
        ships: Object.freeze({ identifier: true }),
    }),
});

/**
 * The industry family, all five `.static` and all five nearly free.
 *
 * Their only differences from the export are editorial: snake_case field names
 * the exporter camelCases, empty lists it omits, a repeated record key it drops,
 * and two fields it renames.
 */
export const INDUSTRY_ACTIVITIES_PROJECTION = Object.freeze({
    table: "industryActivities", container: "static", passthrough: true,
    camelCaseKeys: true, pruneEmptyArrays: true,
    rename: Object.freeze({ activityName: "name" }),
    drop: Object.freeze([ "activityID" ]),
});
export const INDUSTRY_MODIFIER_SOURCES_PROJECTION = Object.freeze({
    table: "industryModifierSources", container: "static", passthrough: true,
    camelCaseKeys: true, pruneEmptyArrays: true,
});
export const INDUSTRY_TARGET_FILTERS_PROJECTION = Object.freeze({
    table: "industryTargetFilters", container: "static", passthrough: true,
    camelCaseKeys: true, pruneEmptyArrays: true,
});
export const INDUSTRY_ASSEMBLY_LINES_PROJECTION = Object.freeze({
    table: "industryAssemblyLines", container: "static", passthrough: true,
    camelCaseKeys: true, pruneEmptyArrays: true, pruneEmptyStrings: true,
    rename: Object.freeze({ activity: "activityID" }),
    // `typeListId` is dropped on ONE ROW of evidence: exactly one of the 146
    // assembly lines has a `detailsPerTypeList`, and CCP's export publishes its
    // entry with the two multipliers and no identifier. Dropping it reproduces
    // the export exactly, and it is the only observation available - so treat
    // this as matched behaviour rather than an established rule, and note that
    // the client does carry the identifier we are discarding.
    drop: Object.freeze([ "ID", "typeListID" ]),
});
export const INDUSTRY_INSTALLATION_TYPES_PROJECTION = Object.freeze({
    table: "industryInstallationTypes", container: "static", passthrough: true,
    camelCaseKeys: true, pruneEmptyArrays: true,
    rename: Object.freeze({ assemblyLine: "assemblyLineID" }),
    drop: Object.freeze([ "typeID" ]),
});

/**
 * The icon table.
 *
 * The client also stores `iconType` and `obsolete`; the export publishes
 * neither, and `iconType` holds values like `""`, `png` and
 * `LifeSupport_unit.png`, so it is not a type in any sense worth carrying.
 */
export const ICONS_PROJECTION = Object.freeze({
    table: "icons",
    copy: Object.freeze([ "description", "iconFile" ]),
});


/**
 * Regions.
 *
 * The first table here that comes from a schema-bound container rather than an
 * FSD one. Nothing about the projection changes for that: the reader hands over
 * records with the client's own field names, and the exporter's habits - rename
 * the centre, resolve the label identifiers, drop what a join reconstructs - are
 * the same habits as everywhere else.
 */
export const MAP_REGIONS_PROJECTION = Object.freeze({
    table: "mapRegions",
    copy: Object.freeze([ "center", "factionID", "nebulaID", "wormholeClassID" ]),
    rename: Object.freeze({ center: "position" }),
    lists: Object.freeze({ constellationIDs: {} }),
    labels: Object.freeze({ nameID: "name", descriptionID: "description" }),
});

/** Constellations. */
export const MAP_CONSTELLATIONS_PROJECTION = Object.freeze({
    table: "mapConstellations",
    copy: Object.freeze([ "center", "factionID", "regionID", "wormholeClassID" ]),
    rename: Object.freeze({ center: "position" }),
    lists: Object.freeze({ solarSystemIDs: {} }),
    labels: Object.freeze({ nameID: "name" }),
});

/**
 * Solar systems.
 *
 * This one is deliberately partial. The container carries what a system IS -
 * where it sits, what owns it, how safe it is, what it connects to - and the
 * export's remaining columns describe what is INSIDE it, which comes from a
 * different container this package cannot yet read. See the coverage page.
 *
 * `factionID` is deliberately absent for a different reason. The client stores
 * one on 2,671 systems and the export publishes 70, and the rule that selects
 * those 70 is not in this container: 36 of them differ from their constellation
 * and the other 34 agree with it, so no test on the data here reproduces the
 * set. Emitting the field on 2,671 rows would make a join against this export
 * answer differently from a join against CCP's, which is worse than not having
 * the column. `wormholeClassID` looked like the same problem and is not - its
 * rule is exactly inheritance, and it reproduces on all 8,490 rows.
 */
export const MAP_SOLAR_SYSTEMS_PROJECTION = Object.freeze({
    table: "mapSolarSystems",
    copy: Object.freeze([
        "center", "constellationID", "regionID", "securityClass",
        "securityStatus", "wormholeClassID",
    ]),
    rename: Object.freeze({ center: "position", planetItemIDs: "planetIDs" }),
    // A float32 widened to a double, published at six places like every other
    // single in this export.
    singles: Object.freeze([ "securityStatus" ]),
    omitWhenEmpty: Object.freeze([ "securityClass" ]),
    omitWhenInherited: Object.freeze({ wormholeClassID: "constellationID" }),
    lists: Object.freeze({ planetItemIDs: {} }),
    // The client stores each edge as a neighbour record; the export publishes
    // only the stargate that reaches it, in identifier order rather than the
    // container's own.
    pluck: Object.freeze({ neighbours: { field: "stargateID", as: "stargateIDs", sorted: true } }),
    labels: Object.freeze({ nameID: "name" }),
});


/** Dogma buff collections, whose values are already the export's own JSON. */
export const DBUFF_COLLECTIONS_PROJECTION = Object.freeze({
    table: "dbuffCollections",
    passthrough: true,
    sortKeys: true,
    pruneEmptyArrays: true,
    labels: Object.freeze({ displayNameID: "displayName" }),
});

/** The three fighter ability slots a fighter type carries. */
export const FIGHTER_ABILITIES_BY_TYPE_PROJECTION = Object.freeze({
    table: "fighterAbilitiesByType",
    passthrough: true,
    sortKeys: true,
});

/** Fighter abilities themselves. */
export const FIGHTER_ABILITIES_PROJECTION = Object.freeze({
    table: "fighterAbilities",
    copy: Object.freeze([
        "disallowInHighSec", "disallowInLowSec", "iconID", "targetMode",
        "turretGraphicID",
    ]),
    identifiers: Object.freeze([ "iconID", "turretGraphicID" ]),
    labels: Object.freeze({ displayNameID: "displayName", tooltipTextID: "tooltipText" }),
});

/** Alpha clone states. The client's internal description IS the export's name. */
export const CLONE_GRADES_PROJECTION = Object.freeze({
    table: "cloneGrades",
    copy: Object.freeze([ "internalDescription" ]),
    rename: Object.freeze({ internalDescription: "name" }),
    lists: Object.freeze({ skills: { fields: [ "level", "typeID" ], identifiers: [ "typeID" ] } }),
});

/**
 * Landmarks.
 *
 * The container carries a `landmarkType` and a two-dimensional position that
 * the export does not publish.
 */
export const LANDMARKS_PROJECTION = Object.freeze({
    table: "landmarks",
    copy: Object.freeze([ "iconID", "locationID", "position" ]),
    identifiers: Object.freeze([ "iconID", "locationID" ]),
    // A position is published at six decimal places like every other single.
    positions: Object.freeze([ "position" ]),
    labels: Object.freeze({ landmarkNameID: "name", descriptionID: "description" }),
});

/** Character ancestries. */
export const ANCESTRIES_PROJECTION = Object.freeze({
    table: "ancestries",
    copy: Object.freeze([
        "bloodlineID", "charisma", "iconID", "intelligence", "memory",
        "perception", "shortDescription", "willpower",
    ]),
    identifiers: Object.freeze([ "bloodlineID", "iconID" ]),
    labels: Object.freeze({ nameID: "name", descriptionID: "description" }),
});

/** Character bloodlines. */
export const BLOODLINES_PROJECTION = Object.freeze({
    table: "bloodlines",
    copy: Object.freeze([
        "charisma", "corporationID", "iconID", "intelligence", "memory",
        "perception", "raceID", "willpower",
    ]),
    identifiers: Object.freeze([ "corporationID", "iconID", "raceID" ]),
    labels: Object.freeze({ nameID: "name", descriptionID: "description" }),
});

/**
 * Player races.
 *
 * `skills` is a map of skill type to level in the client and a sorted list of
 * key/value pairs in the export, which is the same flattening `typeElements`
 * would need.
 */
export const RACES_PROJECTION = Object.freeze({
    table: "races",
    copy: Object.freeze([ "iconID", "shipTypeID" ]),
    identifiers: Object.freeze([ "iconID", "shipTypeID" ]),
    maps: Object.freeze({ skills: "skills" }),
    labels: Object.freeze({ nameID: "name", descriptionID: "description" }),
});

/** The four empires and the other named factions. `npcTag` is client-only. */
export const FACTIONS_PROJECTION = Object.freeze({
    table: "factions",
    copy: Object.freeze([
        "corporationID", "flatLogo", "flatLogoWithName", "iconID",
        "militiaCorporationID", "sizeFactor", "solarSystemID", "uniqueName",
    ]),
    identifiers: Object.freeze([ "corporationID", "iconID", "militiaCorporationID", "solarSystemID" ]),
    singles: Object.freeze([ "sizeFactor" ]),
    lists: Object.freeze({ memberRaces: Object.freeze({ identifier: true }) }),
    labels: Object.freeze({
        descriptionID: "description",
        nameID: "name",
        shortDescriptionID: "shortDescription",
    }),
});

/** Station services. The record is its two labels and nothing else. */
export const STATION_SERVICES_PROJECTION = Object.freeze({
    table: "stationServices",
    labels: Object.freeze({ descriptionID: "description", serviceNameID: "serviceName" }),
});

/** What a station does, and the ratios that place it. */
export const STATION_OPERATIONS_PROJECTION = Object.freeze({
    table: "stationOperations",
    copy: Object.freeze([
        "activityID", "border", "corridor", "fringe", "hub",
        "manufacturingFactor", "ratio", "researchFactor",
    ]),
    identifiers: Object.freeze([ "activityID" ]),
    // manufacturingFactor and researchFactor are stored as doubles and need no
    // rounding; the five placement ratios are singles and do.
    singles: Object.freeze([ "border", "corridor", "fringe", "hub", "ratio" ]),
    lists: Object.freeze({ services: Object.freeze({ identifier: true }) }),
    maps: Object.freeze({ stationTypes: "stationTypes" }),
    labels: Object.freeze({ descriptionID: "description", operationNameID: "operationName" }),
});

/** What an NPC corporation does. One label per record. */
export const CORPORATION_ACTIVITIES_PROJECTION = Object.freeze({
    table: "corporationActivities",
    labels: Object.freeze({ nameID: "name" }),
});

/**
 * Corporation roles.
 *
 * The export also publishes `roleGroupIDs`, which the client does not store: it
 * is derived from `corporationRoleGroups.roleMask`, so the build adds it after
 * projection rather than a spec operator inventing it here. See
 * `CjsCorporationRolesReader` for the derivation and for role 61, which belongs
 * to no group and is published without the field.
 */
export const CORPORATION_ROLES_PROJECTION = Object.freeze({
    table: "corporationRoles",
    copy: Object.freeze([ "roleName" ]),
    rename: Object.freeze({ roleName: "shortName" }),
    labels: Object.freeze({ descriptionID: "description", nameID: "name" }),
});

/**
 * Role groups. `roleMask` and `roleGroupName` are client-only - the mask is the
 * source of `corporationRoles.roleGroupIDs` and is not itself published.
 */
export const CORPORATION_ROLE_GROUPS_PROJECTION = Object.freeze({
    table: "corporationRoleGroups",
    copy: Object.freeze([ "appliesTo", "appliesToGrantable", "isDivisional", "isLocational" ]),
    labels: Object.freeze({ roleGroupNameID: "name" }),
});

/**
 * The ten corporation divisions.
 *
 * The rename is not cosmetic. The client's inline `description` string is what
 * the export publishes as `displayName`, and the export's `description` is the
 * resolved `descriptionID`. Passing `description` through unchanged publishes
 * the wrong one of the two.
 */
export const NPC_CORPORATION_DIVISIONS_PROJECTION = Object.freeze({
    table: "npcCorporationDivisions",
    copy: Object.freeze([ "description", "internalName" ]),
    rename: Object.freeze({ description: "displayName" }),
    labels: Object.freeze({
        descriptionID: "description",
        leaderTypeNameID: "leaderTypeName",
        nameID: "name",
    }),
});

/**
 * NPC corporations.
 *
 * `url`, `publicShares` and `DesignerDescriptionID` are stored and never
 * published. `taxRate` is a single and needs the rounding every widened float32
 * in this export needs; `divisions` is the record-valued map shape.
 */
export const NPC_CORPORATIONS_PROJECTION = Object.freeze({
    table: "npcCorporations",
    copy: Object.freeze([
        "ceoID", "deleted", "enemyID", "extent", "factionID", "friendID",
        "hasPlayerPersonnelManager", "iconID", "initialPrice", "mainActivityID",
        "memberLimit", "minSecurity", "minimumJoinStanding", "raceID",
        "secondaryActivityID", "sendCharTerminationMessage", "shares", "size",
        "sizeFactor", "solarSystemID", "stationID", "taxRate", "tickerName",
        "uniqueName",
    ]),
    identifiers: Object.freeze([
        "ceoID", "enemyID", "factionID", "friendID", "iconID",
        "mainActivityID", "raceID", "secondaryActivityID", "solarSystemID", "stationID",
    ]),
    singles: Object.freeze([ "sizeFactor", "taxRate" ]),
    lists: Object.freeze({
        allowedMemberRaces: Object.freeze({ identifier: true }),
        lpOfferTables: Object.freeze({ identifier: true }),
    }),
    maps: Object.freeze({
        corporationTrades: "corporationTrades",
        exchangeRates: "exchangeRates",
        investors: "investors",
        divisions: Object.freeze({
            as: "divisions",
            fields: Object.freeze([ "divisionNumber", "leaderID", "size" ]),
            identifiers: Object.freeze([ "leaderID" ]),
        }),
    }),
    labels: Object.freeze({ descriptionID: "description", nameID: "name" }),
});

/** Dogma units. `name` is inline text rather than a label. */
export const DOGMA_UNITS_PROJECTION = Object.freeze({
    table: "dogmaUnits",
    copy: Object.freeze([ "name" ]),
    labels: Object.freeze({ descriptionID: "description", displayNameID: "displayName" }),
});

/** Attribute categories. Both fields are inline text, so nothing is resolved. */
export const DOGMA_ATTRIBUTE_CATEGORIES_PROJECTION = Object.freeze({
    table: "dogmaAttributeCategories",
    copy: Object.freeze([ "description", "name" ]),
});

/** Mutaplasmid ranges, and which type each input turns into. */
export const DYNAMIC_ITEM_ATTRIBUTES_PROJECTION = Object.freeze({
    table: "dynamicItemAttributes",
    maps: Object.freeze({
        attributeIDs: Object.freeze({
            as: "attributeIDs",
            fields: Object.freeze([ "highIsGood", "max", "min" ]),
            singles: Object.freeze([ "max", "min" ]),
        }),
    }),
    lists: Object.freeze({
        inputOutputMapping: Object.freeze({
            fields: Object.freeze([ "applicableTypes", "resultingType" ]),
            identifierLists: Object.freeze([ "applicableTypes" ]),
            identifiers: Object.freeze([ "resultingType" ]),
        }),
    }),
});

/** What each faction does about each contraband type. */
export const CONTRABAND_TYPES_PROJECTION = Object.freeze({
    table: "contrabandTypes",
    maps: Object.freeze({
        factions: Object.freeze({
            as: "factions",
            fields: Object.freeze([ "attackMinSec", "confiscateMinSec", "fineByValue", "standingLoss" ]),
            singles: Object.freeze([ "attackMinSec", "confiscateMinSec", "fineByValue", "standingLoss" ]),
        }),
    }),
});

/**
 * Expert systems. `skillsGranted` is a scalar map the export gave real names,
 * so it is published as `[{ level, typeID }]` rather than as key/value pairs.
 */
export const EXPERT_SYSTEMS_PROJECTION = Object.freeze({
    table: "expertSystems",
    copy: Object.freeze([ "durationDays", "esHidden", "esRetired", "internalName" ]),
    rename: Object.freeze({ esHidden: "hidden", esRetired: "retired" }),
    lists: Object.freeze({ associatedShipTypes: Object.freeze({ identifier: true }) }),
    maps: Object.freeze({
        skillsGranted: Object.freeze({
            as: "skillsGranted",
            key: "typeID",
            value: "level",
        }),
    }),
});

/**
 * Skill plans. `milestones` and `skillRequirements` are genuine lists of the
 * same shape at different strides; `npcCorporationDivision` is a plain number
 * rather than an identifier, so it is not converted.
 */
export const SKILL_PLANS_PROJECTION = Object.freeze({
    table: "skillPlans",
    // The client's inline `name` is the export's `internalName`; the export's
    // `name` is the resolved `nameID`. Same collision as npcCorporationDivisions.
    copy: Object.freeze([ "careerPathID", "factionID", "name", "npcCorporationDivision" ]),
    rename: Object.freeze({ name: "internalName" }),
    identifiers: Object.freeze([ "careerPathID", "factionID" ]),
    lists: Object.freeze({
        milestones: Object.freeze({
            fields: Object.freeze([ "level", "typeID" ]),
            identifiers: Object.freeze([ "typeID" ]),
        }),
        skillRequirements: Object.freeze({
            fields: Object.freeze([ "level", "typeID" ]),
            identifiers: Object.freeze([ "typeID" ]),
        }),
    }),
    labels: Object.freeze({ descriptionID: "description", nameID: "name" }),
});

/** A scalar-valued map: the record is one name. */
export const AGENT_TYPES_PROJECTION = Object.freeze({
    table: "agentTypes",
    valueField: "name",
});

/** Agents that sit in space rather than in a station. */
export const AGENTS_IN_SPACE_PROJECTION = Object.freeze({
    table: "agentsInSpace",
    copy: Object.freeze([ "dungeonID", "solarSystemID", "spawnPointID", "typeID" ]),
    identifiers: Object.freeze([ "dungeonID", "solarSystemID", "spawnPointID", "typeID" ]),
});

/** Starting schools. `titleID` is a label despite the name not saying so. */
export const SCHOOLS_PROJECTION = Object.freeze({
    table: "schools",
    copy: Object.freeze([ "careerID", "corporationID", "iconID", "isStarterSpaceSchool", "raceID" ]),
    identifiers: Object.freeze([ "careerID", "corporationID", "iconID", "raceID" ]),
    lists: Object.freeze({
        careerAgents: Object.freeze({ identifier: true }),
        startingStations: Object.freeze({ identifier: true }),
    }),
    labels: Object.freeze({
        characterDescriptionID: "characterDescription",
        descriptionID: "description",
        nameID: "name",
        titleID: "title",
    }),
});

/** Which solar system each school is in. Keyed in its own right, not by school. */
export const SCHOOL_MAP_PROJECTION = Object.freeze({
    table: "schoolMap",
    copy: Object.freeze([ "schoolID", "solarSystemID" ]),
    identifiers: Object.freeze([ "schoolID", "solarSystemID" ]),
});

/**
 * Epic arcs. `comments` is authoring text and is never published. `missions` is
 * a record-valued map whose entries carry an identifier list of their own.
 */
export const EPIC_ARCS_PROJECTION = Object.freeze({
    table: "epicArcs",
    copy: Object.freeze([ "arcRestartInterval", "factionID", "iconID" ]),
    identifiers: Object.freeze([ "factionID", "iconID" ]),
    maps: Object.freeze({
        missions: Object.freeze({
            as: "missions",
            fields: Object.freeze([ "agentID", "failMissionID", "nextMissions" ]),
            identifiers: Object.freeze([ "agentID", "failMissionID" ]),
            identifierLists: Object.freeze([ "nextMissions" ]),
        }),
    }),
    labels: Object.freeze({ epicArcNameID: "name" }),
});

/**
 * Which ship-tree element each type occupies, by position.
 *
 * **This publishes 467 rows where CCP publishes 423, deliberately.** The 44 CCP
 * drops are Expert Systems: all 44 sit in category 2100, and only one of the
 * 423 CCP keeps does (type 57199, which looks like an oversight on their side).
 * So the filter is "exclude Expert Systems" to within one record - but Expert
 * Systems are wanted here, they are real client data, and `expertSystems` is a
 * generated table in its own right. A consumer that wants CCP's exact row set
 * can filter on category; a consumer given CCP's row set cannot recover these.
 */
export const TYPE_ELEMENTS_PROJECTION = Object.freeze({
    table: "typeElements",
    maps: Object.freeze({ elements: "elements" }),
});

/** The labelled boxes of the Ship Tree. */
export const SHIP_TREE_ELEMENTS_PROJECTION = Object.freeze({
    table: "shipTreeElements",
    copy: Object.freeze([ "icon" ]),
    labels: Object.freeze({ descriptionID: "description", nameID: "name" }),
});

/** Each faction's ordering of the tree's elements. */
export const SHIP_TREE_FACTIONS_PROJECTION = Object.freeze({
    table: "shipTreeFactions",
    copy: Object.freeze([ "icon" ]),
    maps: Object.freeze({ elements: "elements" }),
    labels: Object.freeze({ descriptionID: "description" }),
});

/**
 * Ship groups, their icons and their prerequisites.
 *
 * `preReqSkills` is two maps deep - faction to `{skills: skill to
 * {display, level}}` - and `display` is stored as 0 or 1 where the export
 * publishes a boolean.
 */
export const SHIP_TREE_GROUPS_PROJECTION = Object.freeze({
    table: "shipTreeGroups",
    copy: Object.freeze([ "icon", "iconLarge", "iconSmall", "iconSmallNPC" ]),
    maps: Object.freeze({
        elements: "elements",
        preReqSkills: Object.freeze({
            as: "preReqSkills",
            fields: Object.freeze([ "skills" ]),
            maps: Object.freeze({
                skills: Object.freeze({
                    as: "skills",
                    fields: Object.freeze([ "display", "level" ]),
                    booleans: Object.freeze([ "display" ]),
                }),
            }),
        }),
    }),
    labels: Object.freeze({ descriptionID: "description", nameID: "name" }),
});

/**
 * The bonuses shown on a type's info panel.
 *
 * `types` is a map whose values are lists of bonus records, and each bonus
 * carries a label: the client stores `nameID` and the export publishes the
 * resolved text as `bonusText`.
 */
const TYPE_BONUS_ENTRY = Object.freeze({
    // `isPositive` is a real boolean in the client, on the entries that state a
    // penalty rather than a bonus. The export publishes it 265 times out of the
    // 266 the client carries it, and the one omission (type 37605, its last
    // misc bonus) follows no rule the data supports - nine other entries of the
    // same shape publish it. So it is always published here, and that one row
    // is the whole difference between this table and CCP's.
    fields: Object.freeze([ "bonus", "importance", "isPositive", "unitID" ]),
    labels: Object.freeze({ nameID: "bonusText" }),
});

export const TYPE_BONUS_PROJECTION = Object.freeze({
    table: "typeBonus",
    copy: Object.freeze([ "iconID" ]),
    identifiers: Object.freeze([ "iconID" ]),
    lists: Object.freeze({
        miscBonuses: TYPE_BONUS_ENTRY,
        roleBonuses: TYPE_BONUS_ENTRY,
    }),
    maps: Object.freeze({
        types: Object.freeze({ as: "types", valueList: TYPE_BONUS_ENTRY }),
    }),
});

/** Certificates, and the skill levels each of their five tiers wants. */
export const CERTIFICATES_PROJECTION = Object.freeze({
    table: "certificates",
    copy: Object.freeze([ "groupID" ]),
    identifiers: Object.freeze([ "groupID" ]),
    lists: Object.freeze({ recommendedFor: Object.freeze({ identifier: true }) }),
    maps: Object.freeze({
        skillTypes: Object.freeze({
            as: "skillTypes",
            fields: Object.freeze([ "advanced", "basic", "elite", "improved", "standard" ]),
        }),
    }),
    labels: Object.freeze({ descriptionID: "description", nameID: "name" }),
});

/**
 * Which certificates each type's mastery levels require.
 *
 * The record *is* a map - mastery level to a list of certificate identifiers -
 * so the whole row is one flattened field the exporter named `_value`.
 */
export const MASTERIES_PROJECTION = Object.freeze({
    table: "masteries",
    entriesField: "_value",
});

/** Every spec, keyed by export table. */
export const CJS_TOOL_SDE_TABLE_PROJECTIONS = Object.freeze({
    categories: CATEGORIES_PROJECTION,
    dogmaAttributes: DOGMA_ATTRIBUTES_PROJECTION,
    dogmaEffects: DOGMA_EFFECTS_PROJECTION,
    groups: GROUPS_PROJECTION,
    marketGroups: MARKET_GROUPS_PROJECTION,
    metaGroups: META_GROUPS_PROJECTION,
    typeDogma: TYPE_DOGMA_PROJECTION,
    typeMaterials: TYPE_MATERIALS_PROJECTION,
    blueprints: BLUEPRINTS_PROJECTION,
    industryActivities: INDUSTRY_ACTIVITIES_PROJECTION,
    industryAssemblyLines: INDUSTRY_ASSEMBLY_LINES_PROJECTION,
    industryInstallationTypes: INDUSTRY_INSTALLATION_TYPES_PROJECTION,
    industryModifierSources: INDUSTRY_MODIFIER_SOURCES_PROJECTION,
    industryTargetFilters: INDUSTRY_TARGET_FILTERS_PROJECTION,
    compressibleTypes: COMPRESSIBLE_TYPES_PROJECTION,
    controlTowerResources: CONTROL_TOWER_RESOURCES_PROJECTION,
    typeLists: TYPE_LISTS_PROJECTION,
    icons: ICONS_PROJECTION,
    skinrComponents: SKINR_COMPONENTS_PROJECTION,
    skinrComponentCategories: SKINR_COMPONENT_CATEGORIES_PROJECTION,
    skinrComponentPointValues: SKINR_COMPONENT_POINT_VALUES_PROJECTION,
    skinrComponentRarities: SKINR_COMPONENT_RARITIES_PROJECTION,
    skinrSlotCategories: SKINR_SLOT_CATEGORIES_PROJECTION,
    skinrSlotConfigurations: SKINR_SLOT_CONFIGURATIONS_PROJECTION,
    skinrSlotNames: SKINR_SLOT_NAMES_PROJECTION,
    skinrSlots: SKINR_SLOTS_PROJECTION,
    skinrTierThresholds: SKINR_TIER_THRESHOLDS_PROJECTION,
    mapRegions: MAP_REGIONS_PROJECTION,
    mapConstellations: MAP_CONSTELLATIONS_PROJECTION,
    mapSolarSystems: MAP_SOLAR_SYSTEMS_PROJECTION,
    dbuffCollections: DBUFF_COLLECTIONS_PROJECTION,
    fighterAbilitiesByType: FIGHTER_ABILITIES_BY_TYPE_PROJECTION,
    fighterAbilities: FIGHTER_ABILITIES_PROJECTION,
    cloneGrades: CLONE_GRADES_PROJECTION,
    landmarks: LANDMARKS_PROJECTION,
    ancestries: ANCESTRIES_PROJECTION,
    bloodlines: BLOODLINES_PROJECTION,
    races: RACES_PROJECTION,
    factions: FACTIONS_PROJECTION,
    stationServices: STATION_SERVICES_PROJECTION,
    stationOperations: STATION_OPERATIONS_PROJECTION,
    corporationActivities: CORPORATION_ACTIVITIES_PROJECTION,
    corporationRoles: CORPORATION_ROLES_PROJECTION,
    corporationRoleGroups: CORPORATION_ROLE_GROUPS_PROJECTION,
    npcCorporationDivisions: NPC_CORPORATION_DIVISIONS_PROJECTION,
    npcCorporations: NPC_CORPORATIONS_PROJECTION,
    dogmaUnits: DOGMA_UNITS_PROJECTION,
    dogmaAttributeCategories: DOGMA_ATTRIBUTE_CATEGORIES_PROJECTION,
    dynamicItemAttributes: DYNAMIC_ITEM_ATTRIBUTES_PROJECTION,
    contrabandTypes: CONTRABAND_TYPES_PROJECTION,
    expertSystems: EXPERT_SYSTEMS_PROJECTION,
    skillPlans: SKILL_PLANS_PROJECTION,
    agentTypes: AGENT_TYPES_PROJECTION,
    agentsInSpace: AGENTS_IN_SPACE_PROJECTION,
    schools: SCHOOLS_PROJECTION,
    schoolMap: SCHOOL_MAP_PROJECTION,
    epicArcs: EPIC_ARCS_PROJECTION,
    typeElements: TYPE_ELEMENTS_PROJECTION,
    typeBonus: TYPE_BONUS_PROJECTION,
    shipTreeGroups: SHIP_TREE_GROUPS_PROJECTION,
    shipTreeElements: SHIP_TREE_ELEMENTS_PROJECTION,
    shipTreeFactions: SHIP_TREE_FACTIONS_PROJECTION,
    certificates: CERTIFICATES_PROJECTION,
    masteries: MASTERIES_PROJECTION,
});

export default CJS_TOOL_SDE_TABLE_PROJECTIONS;
