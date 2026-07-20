import * as utils from "../utils.js";

export const CJS_WEAPON_TABLES = Object.freeze([
    "graphics",
    "groups",
    "marketGroups",
    "typeDogma",
    "types",
]);

const WEAPON_MARKET_GROUP_ID = 10;
const AMMUNITION_MARKET_GROUP_ID = 11;
const WEAPON_BRANCH_IDS = Object.freeze([
    86,   // Hybrid Turrets
    87,   // Projectile Turrets
    88,   // Energy Turrets
    140,  // Missile Launchers
    1014, // Bomb Launchers
    2431, // Precursor Turrets
    2741, // Vorton Projectors
    3726, // Breacher Pod Launchers
]);
const LAUNCHER_BRANCH_IDS = new Set([ 140, 1014, 3726 ]);
const CHARGE_SIZE_ATTRIBUTE_ID = 128;
const CHARGE_GROUP_ATTRIBUTE_IDS = Object.freeze([ 604, 605, 606, 609, 610 ]);
const LAUNCHER_GROUP_ATTRIBUTE_IDS = Object.freeze([ 137, 602, 603, 2076, 2077, 2078 ]);
const PROJECTILE_GRAPHIC_PATTERN =
    /^res:([/]dx9[/]model[/]turret[/]launcher[/]).+_missile[.]red$/iu;

/** Builds the deterministic SDE-backed weapon and ammunition library. */
export class CjsToolWeaponBuilder
{

    static schema = "carbonenginejs.weaponLibrary";

    static build(options = {})
    {
        const tables = options.tables ?? options;
        const types = TableMap(tables.types, "types");
        const graphics = TableMap(tables.graphics, "graphics");
        const groups = TableMap(tables.groups, "groups");
        const marketGroups = TableMap(tables.marketGroups, "marketGroups");
        const typeDogma = TableMap(tables.typeDogma, "typeDogma");
        const marketTree = BuildMarketTree(marketGroups);
        const weaponMarketGroupIDs = DescendantIDs(marketTree, WEAPON_BRANCH_IDS);
        const weaponTypes = {};
        const weaponBranches = {};

        for (const branchID of WEAPON_BRANCH_IDS)
        {
            for (const marketGroupID of DescendantIDs(marketTree, [ branchID ]))
            {
                weaponBranches[marketGroupID] = branchID;
            }
        }

        for (const [ typeID, type ] of types)
        {
            if (type.published !== true
                || !weaponMarketGroupIDs.has(NormalizeOptionalId(type.marketGroupID)))
            {
                continue;
            }

            const dogma = DogmaAttributes(typeDogma.get(typeID));
            const chargeGroupIDs = AttributeIds(dogma, CHARGE_GROUP_ATTRIBUTE_IDS);

            if (!chargeGroupIDs.length)
            {
                throw new Error(`Renderable weapon type ${typeID} has no charge groups`);
            }

            const graphicID = NormalizeId(type.graphicID, `weapon type ${typeID} graphic`);
            const graphic = RequireMapRecord(graphics, graphicID, "Weapon graphic");
            const graphicFile = NormalizeGraphicFile(
                graphic.graphicFile,
                `weapon graphic ${graphicID}`,
            );
            const marketGroupID = NormalizeId(
                type.marketGroupID,
                `weapon type ${typeID} market group`,
            );
            const branchID = weaponBranches[marketGroupID];

            weaponTypes[typeID] = {
                typeID,
                name: NormalizeName(type.name ?? type.typeName),
                groupID: NormalizeId(type.groupID, `weapon type ${typeID} group`),
                marketGroupID,
                graphicID,
                graphicFile,
                resPath: ToBlackPath(graphicFile),
                kind: LAUNCHER_BRANCH_IDS.has(branchID) ? "launcher" : "turret",
                chargeGroupIDs,
                ...OptionalChargeSize(dogma),
                ammunitionTypeIDs: [],
            };
        }

        const ammunitionGroupIDs = new Set(
            Object.values(weaponTypes).flatMap(type => type.chargeGroupIDs),
        );
        const ammunition = {};

        for (const [ typeID, type ] of types)
        {
            if (type.published !== true
                || !ammunitionGroupIDs.has(NormalizeOptionalId(type.groupID)))
            {
                continue;
            }

            const dogma = DogmaAttributes(typeDogma.get(typeID));
            const graphicID = NormalizeOptionalId(type.graphicID);
            const graphic = graphicID === null ? null : graphics.get(graphicID) ?? null;
            const graphicFile = graphic?.graphicFile
                ? NormalizeGraphicFile(graphic.graphicFile, `ammunition graphic ${graphicID}`)
                : null;

            ammunition[typeID] = {
                typeID,
                name: NormalizeName(type.name ?? type.typeName),
                groupID: NormalizeId(type.groupID, `ammunition type ${typeID} group`),
                ...OptionalIdField("marketGroupID", type.marketGroupID),
                ...OptionalIdField("graphicID", graphicID),
                ...(graphicFile ? {
                    graphicFile,
                    resPath: ToBlackPath(graphicFile),
                    graphicRole: GraphicRole(graphicFile),
                } : {}),
                launcherGroupIDs: AttributeIds(dogma, LAUNCHER_GROUP_ATTRIBUTE_IDS),
                ...OptionalChargeSize(dogma),
                weaponTypeIDs: [],
            };
        }

        BuildCompatibility(weaponTypes, ammunition);

        const projectiles = BuildProjectileGraphics(graphics);
        const selectedGroups = BuildGroups(groups, weaponTypes, ammunition);
        const selectedMarketGroups = BuildMarketGroups(
            marketGroups,
            weaponTypes,
        );
        const names = BuildNameIndex(
            weaponTypes,
            selectedGroups,
            selectedMarketGroups,
        );

        return SortValue({
            schema: this.schema,
            schemaVersion: 1,
            ...NormalizeSourceIdentity(options),
            weaponMarketGroupID: WEAPON_MARKET_GROUP_ID,
            ammunitionMarketGroupID: AMMUNITION_MARKET_GROUP_ID,
            types: weaponTypes,
            ammunition,
            projectiles,
            groups: selectedGroups,
            names,
        });
    }

}

function BuildCompatibility(weaponTypes, ammunition)
{
    const ammunitionByGroup = new Map();

    for (const item of Object.values(ammunition))
    {
        const items = ammunitionByGroup.get(item.groupID) ?? [];

        items.push(item);
        ammunitionByGroup.set(item.groupID, items);
    }

    for (const weapon of Object.values(weaponTypes))
    {
        const compatible = new Map();

        for (const groupID of weapon.chargeGroupIDs)
        {
            for (const item of ammunitionByGroup.get(groupID) ?? [])
            {
                if (weapon.chargeSize !== undefined
                    && item.chargeSize !== weapon.chargeSize)
                {
                    continue;
                }

                compatible.set(item.typeID, item);
            }
        }

        weapon.ammunitionTypeIDs = [ ...compatible.keys() ].sort(CompareIds);

        if (!weapon.ammunitionTypeIDs.length)
        {
            throw new Error(`Weapon type ${weapon.typeID} has no compatible ammunition`);
        }

        for (const item of compatible.values())
        {
            item.weaponTypeIDs.push(weapon.typeID);
        }
    }

    for (const item of Object.values(ammunition))
    {
        item.weaponTypeIDs.sort(CompareIds);
    }
}

function BuildProjectileGraphics(graphics)
{
    const projectiles = {};

    for (const [ graphicID, graphic ] of graphics)
    {
        if (!PROJECTILE_GRAPHIC_PATTERN.test(String(graphic.graphicFile ?? "")))
        {
            continue;
        }

        const graphicFile = NormalizeGraphicFile(
            graphic.graphicFile,
            `projectile graphic ${graphicID}`,
        );

        projectiles[graphicID] = {
            graphicID,
            graphicFile,
            resPath: ToBlackPath(graphicFile),
            graphicRole: "projectile",
        };
    }

    return projectiles;
}

function BuildGroups(groups, weaponTypes, ammunition)
{
    const result = {};

    for (const weapon of Object.values(weaponTypes))
    {
        const group = EnsureGroup(result, groups, weapon.groupID);

        group.weaponTypeIDs.push(weapon.typeID);
    }

    for (const item of Object.values(ammunition))
    {
        const group = EnsureGroup(result, groups, item.groupID);

        group.ammunitionTypeIDs.push(item.typeID);
    }

    for (const group of Object.values(result))
    {
        group.weaponTypeIDs.sort(CompareIds);
        group.ammunitionTypeIDs.sort(CompareIds);
    }

    return result;
}

function EnsureGroup(result, groups, groupID)
{
    if (!result[groupID])
    {
        const source = RequireMapRecord(groups, groupID, "Inventory group");
        const { _key, ...record } = source;

        result[groupID] = {
            groupID,
            ...record,
            weaponTypeIDs: [],
            ammunitionTypeIDs: [],
        };
    }

    return result[groupID];
}

function BuildMarketGroups(marketGroups, weaponTypes)
{
    const selected = new Set();

    for (const weapon of Object.values(weaponTypes))
    {
        AddMarketAncestors(
            selected,
            marketGroups,
            weapon.marketGroupID,
            WEAPON_MARKET_GROUP_ID,
        );
    }

    const result = {};

    for (const marketGroupID of [ ...selected ].sort(CompareIds))
    {
        const source = RequireMapRecord(marketGroups, marketGroupID, "Market group");
        const { _key, ...record } = source;

        result[marketGroupID] = {
            marketGroupID,
            ...record,
            weaponTypeIDs: [],
        };
    }

    for (const weapon of Object.values(weaponTypes))
    {
        result[weapon.marketGroupID].weaponTypeIDs.push(weapon.typeID);
    }

    for (const group of Object.values(result))
    {
        group.weaponTypeIDs.sort(CompareIds);
    }

    return result;
}

function AddMarketAncestors(selected, marketGroups, value, rootID)
{
    let marketGroupID = NormalizeId(value, "market group");
    const visited = new Set();

    while (!visited.has(marketGroupID))
    {
        visited.add(marketGroupID);
        selected.add(marketGroupID);

        if (marketGroupID === rootID) return;

        const record = RequireMapRecord(marketGroups, marketGroupID, "Market group");
        const parentGroupID = NormalizeOptionalId(record.parentGroupID);

        if (parentGroupID === null) return;

        marketGroupID = parentGroupID;
    }

    throw new Error(`Market group ${value} contains an ancestor cycle`);
}

function BuildNameIndex(weaponTypes, groups, marketGroups)
{
    const names = new Map();

    for (const record of Object.values(weaponTypes))
    {
        const name = LocalizedName(record.name);

        if (!name) continue;

        AddNameCandidate(names, name, "weapon", record.typeID);
    }

    for (const group of Object.values(groups))
    {
        AddOptionNameCandidates(names, group.name, "weapon", group.weaponTypeIDs);
    }

    const children = new Map();

    for (const group of Object.values(marketGroups))
    {
        const parentGroupID = NormalizeOptionalId(group.parentGroupID);

        if (parentGroupID === null || !marketGroups[parentGroupID]) continue;

        const items = children.get(parentGroupID) ?? [];

        items.push(group.marketGroupID);
        children.set(parentGroupID, items);
    }

    const weaponOptions = new Map();
    for (const group of Object.values(marketGroups))
    {
        AddOptionNameCandidates(
            names,
            group.name,
            "weapon",
            CollectMarketOptions(
                group.marketGroupID,
                "weaponTypeIDs",
                marketGroups,
                children,
                weaponOptions,
            ),
        );
    }

    return Object.fromEntries([ ...names.entries() ]
        .sort(([ left ], [ right ]) => CompareText(left, right))
        .map(([ name, candidates ]) => [
            name,
            [ ...candidates.values() ].sort((left, right) =>
                CompareText(left.kind, right.kind) || CompareIds(left.typeID, right.typeID)),
        ]));
}

function CollectMarketOptions(groupID, field, marketGroups, children, cache, pending = new Set())
{
    if (cache.has(groupID)) return cache.get(groupID);

    if (pending.has(groupID))
    {
        throw new Error(`Market group ${groupID} contains a descendant cycle`);
    }

    pending.add(groupID);

    const options = new Set(marketGroups[groupID]?.[field] ?? []);

    for (const childID of children.get(groupID) ?? [])
    {
        for (const typeID of CollectMarketOptions(
            childID,
            field,
            marketGroups,
            children,
            cache,
            pending,
        ))
        {
            options.add(typeID);
        }
    }

    pending.delete(groupID);

    const result = [ ...options ].sort(CompareIds);

    cache.set(groupID, result);

    return result;
}

function AddOptionNameCandidates(names, nameValue, kind, typeIDs)
{
    const name = LocalizedName(nameValue);

    if (!name) return;

    for (const typeID of typeIDs)
    {
        AddNameCandidate(names, name, kind, typeID);
    }
}

function AddNameCandidate(names, name, kind, typeID)
{
    const normalized = name.toLocaleLowerCase("en-US");
    const candidates = names.get(normalized) ?? new Map();

    candidates.set(`${kind}:${typeID}`, { kind, typeID });
    names.set(normalized, candidates);
}

function BuildMarketTree(marketGroups)
{
    const tree = new Map();

    for (const [ marketGroupID, record ] of marketGroups)
    {
        const parentGroupID = NormalizeOptionalId(record.parentGroupID);

        if (parentGroupID === null) continue;

        const children = tree.get(parentGroupID) ?? [];

        children.push(marketGroupID);
        tree.set(parentGroupID, children);
    }

    for (const children of tree.values()) children.sort(CompareIds);

    return tree;
}

function DescendantIDs(tree, roots)
{
    const output = new Set(roots.map(value => NormalizeId(value)));
    const pending = [ ...output ];

    while (pending.length)
    {
        for (const child of tree.get(pending.pop()) ?? [])
        {
            if (output.has(child)) continue;

            output.add(child);
            pending.push(child);
        }
    }

    return output;
}

function DogmaAttributes(record)
{
    const attributes = new Map();

    for (const item of record?.dogmaAttributes ?? [])
    {
        const attributeID = NormalizeId(item?.attributeID, "dogma attribute");

        attributes.set(attributeID, item.value);
    }

    return attributes;
}

function AttributeIds(attributes, attributeIDs)
{
    return [ ...new Set(attributeIDs
        .map(attributeID => NormalizeOptionalId(attributes.get(attributeID)))
        .filter(value => value !== null)) ].sort(CompareIds);
}

function OptionalChargeSize(attributes)
{
    const chargeSize = NormalizeOptionalId(attributes.get(CHARGE_SIZE_ATTRIBUTE_ID));

    return chargeSize === null ? {} : { chargeSize };
}

function GraphicRole(graphicFile)
{
    return /_impact(?:_[^/.]+)?\.red$/iu.test(graphicFile) ? "impact" : "graphic";
}

function NormalizeGraphicFile(value, label)
{
    const graphicFile = String(value ?? "").trim();

    if (!/^res:\/.+\.red$/iu.test(graphicFile))
    {
        throw new Error(`${label} must contain a res:/.red graphicFile: ${value}`);
    }

    return graphicFile;
}

function ToBlackPath(value)
{
    return String(value).replace(/\.red$/iu, ".black").toLowerCase();
}

function NormalizeName(value)
{
    if (value && typeof value === "object" && !Array.isArray(value))
    {
        return { ...value };
    }

    const name = String(value ?? "").trim();

    return name || null;
}

function LocalizedName(value)
{
    if (value && typeof value === "object" && !Array.isArray(value))
    {
        value = value.en ?? value.enUS ?? value.en_us ?? Object.values(value)[0];
    }

    return String(value ?? "").trim() || null;
}

function OptionalIdField(name, value)
{
    const id = NormalizeOptionalId(value);

    return id === null ? {} : { [name]: id };
}

function NormalizeOptionalId(value)
{
    return value === undefined || value === null || value === ""
        ? null
        : NormalizeId(value);
}

function NormalizeId(value, label = "SDE identity")
{
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id < 0)
    {
        throw new TypeError(`${label} must be a non-negative safe integer: ${value}`);
    }

    return id;
}

function RequireMapRecord(records, id, label)
{
    const record = records.get(id);

    if (!record) throw new Error(`${label} ${id} not found`);

    return record;
}

function TableMap(value, label)
{
    let entries;

    if (value instanceof Map)
    {
        entries = [ ...value.entries() ];
    }
    else if (Array.isArray(value))
    {
        entries = value.map(record => [ record?._key, record ]);
    }
    else if (value && typeof value === "object")
    {
        entries = Object.entries(value);
    }
    else
    {
        throw new TypeError(`${label} must be an object, array, or Map`);
    }

    return new Map(entries.map(([ key, record ]) =>
    {
        if (!record || typeof record !== "object" || Array.isArray(record))
        {
            throw new TypeError(`${label} record ${key} must be an object`);
        }

        return [ NormalizeId(record._key ?? key, `${label} record ID`), record ];
    }).sort(([ left ], [ right ]) => CompareIds(left, right)));
}

function NormalizeSourceIdentity(options)
{
    const sourceTarget = String(options.sourceTarget ?? "").trim().toLowerCase();
    const sourceGame = String(options.sourceGame ?? "").trim();
    const sourceProvider = String(options.sourceProvider ?? "").trim().toLowerCase();
    const sourceBuild = utils.normalizeExactBuild(options.sourceBuild, {
        message: "Weapon library requires an exact numeric source build",
    });

    if (!sourceTarget || !sourceGame || !sourceProvider)
    {
        throw new TypeError("Weapon library requires target, game, and provider identity");
    }

    return { sourceTarget, sourceGame, sourceProvider, sourceBuild };
}

function SortValue(value)
{
    if (Array.isArray(value)) return value.map(SortValue);
    if (!value || typeof value !== "object") return value;

    const output = {};

    for (const key of Object.keys(value).sort(CompareText))
    {
        if (value[key] !== undefined) output[key] = SortValue(value[key]);
    }

    return output;
}

function CompareIds(left, right)
{
    return Number(left) - Number(right) || CompareText(String(left), String(right));
}

function CompareText(left, right)
{
    return left < right ? -1 : left > right ? 1 : 0;
}
