/**
 * Thin in-memory join layer for prepared EVE SDE identity tables.
 */
export class CjsSde
{

    #types;

    #graphics;

    #skins;

    #skinMaterials;

    #skinLicenses;

    #materialSets;

    #graphicMaterialSets;

    #typesByName;

    #skinsByName;

    /** Creates indexes over caller-supplied, already-decoded SDE tables. */
    constructor(data = {})
    {
        this.build = NormalizeOptionalBuild(data.build);
        this.#types = ToRecordMap(data.types);
        this.#graphics = ToRecordMap(data.graphics);
        this.#skins = ToRecordMap(data.skins);
        this.#skinMaterials = ToRecordMap(data.skinMaterials);
        this.#skinLicenses = ToRecordMap(data.skinLicenses);
        this.#materialSets = ToRecordMap(data.materialSets);
        this.#graphicMaterialSets = ToRecordMap(data.graphicMaterialSets);
        this.#typesByName = IndexTypeNames(this.#types);
        this.#skinsByName = IndexSkinNames(this.#skins);
    }

    /** Returns one type record or null. */
    GetType(typeID)
    {
        return this.#types.get(NormalizeId(typeID)) ?? null;
    }

    /** Returns one graphic record or null. */
    GetGraphic(graphicID)
    {
        return this.#graphics.get(NormalizeId(graphicID)) ?? null;
    }

    /** Returns one skin record or null. */
    GetSkin(skinID)
    {
        return this.#skins.get(NormalizeId(skinID)) ?? null;
    }

    /** Returns the GraphicID referenced by one TypeID. */
    GetGraphicID(typeID)
    {
        const type = RequireExisting(this.GetType(typeID), `type ${typeID}`);

        return RequireForeignId(type, [ "graphicID", "graphicId" ], `type ${typeID}`);
    }

    /** Returns every TypeID explicitly associated with one SkinID. */
    GetSkinTypeIDs(skinID)
    {
        const normalizedSkinID = NormalizeId(skinID);
        const skin = RequireExisting(this.GetSkin(normalizedSkinID), `skin ${normalizedSkinID}`);
        const result = new Set(ParseIds(GetFirst(
            skin,
            "types",
            "typeIDs",
            "typeIds",
            "typeID",
            "typeId"
        )));

        for (const license of this.#skinLicenses.values())
        {
            const licenseSkinID = NormalizeOptionalId(GetFirst(license, "skinID", "skinId"));
            const licenseTypeID = NormalizeOptionalId(GetFirst(license, "typeID", "typeId"));

            if (licenseSkinID === normalizedSkinID && licenseTypeID)
            {
                result.add(licenseTypeID);
            }
        }

        return Object.freeze([ ...result ].sort(CompareIds));
    }

    /** Returns every type sharing one graphic ID in deterministic ID order. */
    GetTypesForGraphic(graphicID)
    {
        const expected = NormalizeId(graphicID);

        return Object.freeze([ ...this.#types.values() ]
            .filter(record => NormalizeOptionalId(GetFirst(record, "graphicID", "graphicId")) === expected)
            .sort(CompareRecordId));
    }

    /** Resolves an exact case-insensitive type name, rejecting ambiguity. */
    GetTypeByName(name)
    {
        const normalized = NormalizeName(name);
        const matches = this.#typesByName.get(normalized) ?? [];

        if (matches.length > 1)
        {
            throw new Error(`SDE type name "${name}" is ambiguous`);
        }

        return matches[0] ?? null;
    }

    /** Returns every exact case-insensitive type or skin name candidate. */
    LookupName(name)
    {
        const normalized = NormalizeName(name);

        return BuildNameCandidates(
            this.#typesByName.get(normalized) ?? [],
            this.#skinsByName.get(normalized) ?? [],
            this
        );
    }

    /** Returns punctuation- and spacing-normalized name candidates. */
    SearchName(name)
    {
        const normalized = NormalizeSearchName(name);

        return BuildNameCandidates(
            CollectSearchMatches(this.#typesByName, normalized),
            CollectSearchMatches(this.#skinsByName, normalized),
            this
        );
    }

    /** Resolves one exact name to a unique TypeID or TypeID+SkinID identity. */
    ResolveName(name)
    {
        return ResolveNameCandidates(this.LookupName(name), name);
    }

    /** Resolves one punctuation-normalized name to a unique identity. */
    ResolveSearchName(name)
    {
        return ResolveNameCandidates(this.SearchName(name), name);
    }

    /** Resolves a TypeID to its graphic and base SOF DNA. */
    ResolveType(typeID)
    {
        return this.Resolve({ typeID });
    }

    /** Resolves a GraphicID directly to base SOF DNA. */
    ResolveGraphic(graphicID)
    {
        return this.Resolve({ graphicID });
    }

    /** Resolves a SkinID, with an optional TypeID when the skin is ambiguous. */
    ResolveSkin(skinID, typeID = null)
    {
        return this.Resolve({ skinID, typeID });
    }

    /** Resolves a TypeID directly to base SOF DNA. */
    ResolveTypeDna(typeID)
    {
        return this.ResolveType(typeID).dna;
    }

    /** Resolves a GraphicID directly to base SOF DNA. */
    ResolveGraphicDna(graphicID)
    {
        return this.ResolveGraphic(graphicID).dna;
    }

    /** Resolves a SkinID directly to SOF DNA when its type identity is unique. */
    ResolveSkinDna(skinID, typeID = null)
    {
        return this.ResolveSkin(skinID, typeID).dna;
    }

    /** Resolves a type/graphic/skin selection and returns its complete join. */
    Resolve(selection = {})
    {
        const normalized = ExpandNameSelection(selection, this);
        const skinID = NormalizeOptionalId(normalized.skinID);
        let type = ResolveType(normalized, this);
        let typeID = type ? RecordId(type) : null;
        let graphicID = NormalizeOptionalId(
            normalized.graphicID
            ?? GetFirst(type, "graphicID", "graphicId")
        );

        if (skinID && !graphicID)
        {
            const skinTypeIDs = this.GetSkinTypeIDs(skinID);

            if (!skinTypeIDs.length)
            {
                throw new Error(`Skin ${skinID} does not resolve to a TypeID`);
            }

            const graphicIDs = [ ...new Set(skinTypeIDs.map(id => this.GetGraphicID(id))) ];

            if (graphicIDs.length !== 1)
            {
                throw new Error(
                    `Skin ${skinID} resolves to multiple GraphicIDs; provide a TypeID`
                );
            }

            graphicID = graphicIDs[0];

            if (skinTypeIDs.length === 1)
            {
                typeID = skinTypeIDs[0];
                type = this.GetType(typeID);
            }
        }

        if (!graphicID)
        {
            throw new Error("SDE selection does not resolve to a graphicID");
        }

        const graphic = RequireRecord(this.#graphics, graphicID, "graphic");
        const baseDna = BuildBaseDna(graphic);

        if (!skinID)
        {
            return Object.freeze({
                typeID,
                graphicID,
                skinID: null,
                skinMaterialID: null,
                materialSetID: null,
                graphicMaterialSetID: null,
                dna: baseDna
            });
        }

        const skin = RequireRecord(this.#skins, skinID, "skin");

        ValidateSkinType(this.GetSkinTypeIDs(skinID), skinID, typeID);

        const skinMaterialID = RequireForeignId(
            skin,
            [ "skinMaterialID", "skinMaterialId" ],
            `skin ${skinID}`
        );
        const skinMaterial = RequireRecord(
            this.#skinMaterials,
            skinMaterialID,
            "skin material"
        );
        const materialSetID = RequireForeignId(
            skinMaterial,
            [ "materialSetID", "materialSetId" ],
            `skin material ${skinMaterialID}`
        );
        const graphicMaterialSetID = NormalizeOptionalId(
            GetFirst(skinMaterial, "graphicMaterialSetID", "graphicMaterialSetId")
        ) ?? materialSetID;
        const materialSet = this.#materialSets.get(materialSetID) ?? null;
        const graphicMaterialSet = RequireRecord(
            this.#graphicMaterialSets,
            graphicMaterialSetID,
            "graphic material set"
        );
        const skinName = NormalizeOptionalText(
            GetFirst(skin, "internalName", "name", "skinName")
        );
        const dna = BuildSkinDna(baseDna, graphicMaterialSet);

        return Object.freeze({
            typeID,
            graphicID,
            skinID,
            skinMaterialID,
            materialSetID,
            graphicMaterialSetID,
            typeName: NormalizeOptionalText(GetFirst(type, "name", "typeName")),
            skinName,
            materialSetName: NormalizeOptionalText(
                GetFirst(materialSet, "name", "materialSetName")
                ?? GetFirst(graphicMaterialSet, "description", "name")
            ),
            dna
        });
    }

    /** Resolves a type/graphic/skin selection directly to SOF DNA. */
    ResolveDna(selection = {})
    {
        return this.Resolve(selection).dna;
    }

}

function ExpandNameSelection(selection, sde)
{
    if (typeof selection === "number" || typeof selection === "bigint")
    {
        return { typeID: selection };
    }

    if (typeof selection === "string")
    {
        return sde.ResolveName(selection);
    }

    if (!selection || typeof selection !== "object" || Array.isArray(selection))
    {
        throw new TypeError("SDE selection must be an identity object, name, or TypeID");
    }

    const hasIdentity = [
        selection.typeID,
        selection.graphicID,
        selection.skinID
    ].some(value => NormalizeOptionalId(value));

    if (hasIdentity)
    {
        return selection;
    }

    const name = selection.name ?? selection.typeName ?? selection.skinName;

    if (name === undefined || name === null || !String(name).trim())
    {
        return selection;
    }

    return { ...selection, ...sde.ResolveName(name), name: undefined };
}

function BuildNameCandidates(types, skins, sde)
{
    const candidates = [];

    for (const type of types)
    {
        candidates.push(Object.freeze({
            kind: "type",
            typeID: RecordId(type),
            skinID: null
        }));
    }

    for (const skin of skins)
    {
        const skinID = RecordId(skin);
        const typeIDs = sde.GetSkinTypeIDs(skinID);

        if (!typeIDs.length)
        {
            candidates.push(Object.freeze({ kind: "skin", typeID: null, skinID }));
        }

        for (const typeID of typeIDs)
        {
            candidates.push(Object.freeze({ kind: "skin", typeID, skinID }));
        }
    }

    return Object.freeze(candidates.sort(CompareNameCandidates));
}

function CollectSearchMatches(index, normalized)
{
    const matches = new Map();

    for (const [ name, records ] of index)
    {
        if (NormalizeSearchName(name) !== normalized)
        {
            continue;
        }

        for (const record of records)
        {
            matches.set(RecordId(record), record);
        }
    }

    return [ ...matches.values() ].sort(CompareRecordId);
}

function ResolveNameCandidates(candidates, name)
{
    if (!candidates.length)
    {
        throw new Error(`SDE name "${name}" not found`);
    }

    if (candidates.length > 1)
    {
        throw new Error(
            `SDE name "${name}" is ambiguous (${candidates.length} identities)`
        );
    }

    return candidates[0];
}

function ResolveType(selection, sde)
{
    const typeID = NormalizeOptionalId(selection.typeID);

    if (typeID)
    {
        return RequireExisting(sde.GetType(typeID), `type ${typeID}`);
    }

    const name = selection.name ?? selection.typeName;

    if (name !== undefined && name !== null && String(name).trim())
    {
        return RequireExisting(sde.GetTypeByName(name), `type name "${name}"`);
    }

    return null;
}

function BuildBaseDna(graphic)
{
    const direct = GetFirst(
        graphic,
        "sofDna",
        "sofDNA",
        "sof_dna",
        "graphicFile",
        "graphic_file"
    );

    if (direct && String(direct).includes(":"))
    {
        return String(direct).toLowerCase();
    }

    const hull = GetFirst(graphic, "sofHullName", "sof_hull_name");
    const faction = GetFirst(graphic, "sofFactionName", "sof_faction_name");
    const race = GetFirst(graphic, "sofRaceName", "sof_race_name");

    if (!hull || !faction || !race)
    {
        throw new Error("Graphic record does not include enough SOF data to build DNA");
    }

    return `${hull}:${faction}:${race}`.toLowerCase();
}

function BuildSkinDna(dna, materialSet)
{
    const parts = String(dna || "").split(":");

    if (parts.length < 3)
    {
        throw new Error(`Invalid SOF DNA format: ${dna}`);
    }

    const commands = ParseDnaCommands(parts.slice(3), dna);
    const hull = parts[0];
    const faction = GetFirst(materialSet, "sofFactionName", "sof_faction_name") ?? parts[1];
    const race = parts[2];
    const mesh = [ 1, 2, 3, 4 ].map(index => NormalizeMaterial(
        GetFirst(materialSet, `material${index}`, `material_${index}`)
    ));
    const pattern = [
        GetFirst(materialSet, "sofPatternName", "sof_pattern_name"),
        GetFirst(
            materialSet,
            "patternMaterial1",
            "pattern_material_1",
            "customMaterial1",
            "custommaterial1"
        ),
        GetFirst(
            materialSet,
            "patternMaterial2",
            "pattern_material_2",
            "customMaterial2",
            "custommaterial2"
        )
    ].map(NormalizeMaterial);
    const insert = NormalizeOptionalText(
        GetFirst(materialSet, "resPathInsert", "res_path_insert")
        ?? commands.RESPATHINSERT?.[0]
    );
    const result = [ `${hull}:${faction}:${race}` ];

    if (mesh.some(value => value !== "none"))
    {
        result.push(`mesh?${mesh.join(";")}`);
    }

    if (pattern.some(value => value !== "none"))
    {
        result.push(`pattern?${pattern.join(";")}`);
    }

    if (insert)
    {
        result.push(`respathinsert?${insert}`);
    }

    return result.join(":").toLowerCase();
}

function ParseDnaCommands(parts, dna)
{
    const commands = {};

    for (const part of parts)
    {
        const separator = part.indexOf("?");

        if (separator <= 0 || separator === part.length - 1)
        {
            throw new Error(`Invalid SOF DNA format: ${dna}`);
        }

        commands[part.slice(0, separator).toUpperCase()] = part
            .slice(separator + 1)
            .split(";");
    }

    return commands;
}

function ValidateSkinType(allowed, skinID, typeID)
{
    if (typeID && allowed.length && !allowed.includes(typeID))
    {
        throw new Error(`Skin ${skinID} is not available for type ${typeID}`);
    }
}

function ToRecordMap(input)
{
    const result = new Map();

    if (!input)
    {
        return result;
    }

    if (input instanceof Map)
    {
        for (const [ id, value ] of input)
        {
            result.set(NormalizeId(id), NormalizeRecord(id, value));
        }

        return result;
    }

    if (Array.isArray(input))
    {
        for (const value of input)
        {
            const id = RecordId(value);

            result.set(id, NormalizeRecord(id, value));
        }

        return result;
    }

    if (typeof input === "object")
    {
        for (const [ id, value ] of Object.entries(input))
        {
            result.set(NormalizeId(id), NormalizeRecord(id, value));
        }

        return result;
    }

    throw new TypeError("Prepared SDE tables must be maps, arrays, or objects");
}

function NormalizeRecord(id, value)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError(`Prepared SDE record ${id} must be an object`);
    }

    const payload = value.payload && typeof value.payload === "object"
        ? value.payload
        : value;

    return Object.freeze({ ...payload, id: NormalizeId(value.id ?? id) });
}

function IndexTypeNames(types)
{
    const result = new Map();

    for (const record of types.values())
    {
        const name = NormalizeOptionalText(GetFirst(record, "name", "typeName"));

        if (!name)
        {
            continue;
        }

        const key = NormalizeName(name);

        if (!result.has(key))
        {
            result.set(key, []);
        }

        result.get(key).push(record);
    }

    for (const matches of result.values())
    {
        matches.sort(CompareRecordId);
        Object.freeze(matches);
    }

    return result;
}

function IndexSkinNames(skins)
{
    const result = new Map();

    for (const record of skins.values())
    {
        const names = [
            GetFirst(record, "internalName"),
            GetFirst(record, "name", "skinName")
        ].map(NormalizeOptionalText).filter(Boolean);

        for (const name of new Set(names))
        {
            const key = NormalizeName(name);

            if (!result.has(key))
            {
                result.set(key, []);
            }

            result.get(key).push(record);
        }
    }

    for (const matches of result.values())
    {
        matches.sort(CompareRecordId);
        Object.freeze(matches);
    }

    return result;
}

function GetFirst(record, ...names)
{
    if (!record)
    {
        return undefined;
    }

    for (const name of names)
    {
        if (record[name] !== undefined)
        {
            return record[name];
        }
    }

    return undefined;
}

function RequireForeignId(record, fields, label)
{
    const value = NormalizeOptionalId(GetFirst(record, ...fields));

    if (!value)
    {
        throw new Error(`${label} does not define ${fields[0]}`);
    }

    return value;
}

function RequireRecord(records, id, label)
{
    return RequireExisting(records.get(id), `${label} ${id}`);
}

function RequireExisting(value, label)
{
    if (!value)
    {
        throw new Error(`${label} not found`);
    }

    return value;
}

function RecordId(record)
{
    return NormalizeId(record?.id ?? record?.typeID ?? record?.typeId);
}

function NormalizeId(value)
{
    const id = String(value ?? "").trim();

    if (!id)
    {
        throw new TypeError("SDE record ID must be non-empty");
    }

    return id;
}

function NormalizeOptionalId(value)
{
    return value === undefined || value === null || String(value).trim() === ""
        ? null
        : NormalizeId(value);
}

function NormalizeOptionalBuild(value)
{
    if (value === undefined || value === null || value === "")
    {
        return null;
    }

    const build = Number(value);

    if (!Number.isSafeInteger(build) || build < 0)
    {
        throw new TypeError(`Invalid SDE build "${value}"`);
    }

    return build;
}

function NormalizeOptionalText(value)
{
    if (value && typeof value === "object" && !Array.isArray(value))
    {
        value = value.en ?? value.enUS ?? value.en_us ?? Object.values(value)[0];
    }

    const text = String(value ?? "").trim();

    return text || null;
}

function NormalizeName(value)
{
    const name = NormalizeOptionalText(value);

    if (!name)
    {
        throw new TypeError("SDE type name must be non-empty");
    }

    return name.toLocaleLowerCase("en-US");
}

function NormalizeSearchName(value)
{
    return NormalizeName(value)
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .replace(/\s+/gu, " ");
}

function NormalizeMaterial(value)
{
    return NormalizeOptionalText(value) ?? "none";
}

function ParseIds(value)
{
    if (value === undefined || value === null)
    {
        return [];
    }

    if (Array.isArray(value))
    {
        return value.map(NormalizeId);
    }

    if (value instanceof Set)
    {
        return [ ...value ].map(NormalizeId);
    }

    if (typeof value === "object")
    {
        return Object.keys(value).map(NormalizeId);
    }

    return String(value)
        .split(/[;,\s]+/u)
        .filter(Boolean)
        .map(NormalizeId);
}

function CompareRecordId(left, right)
{
    return String(left.id).localeCompare(String(right.id), "en");
}

function CompareIds(left, right)
{
    return String(left).localeCompare(String(right), "en", { numeric: true });
}

function CompareNameCandidates(left, right)
{
    const kind = left.kind.localeCompare(right.kind, "en");

    if (kind)
    {
        return kind;
    }

    const type = CompareIds(left.typeID ?? "", right.typeID ?? "");

    return type || CompareIds(left.skinID ?? "", right.skinID ?? "");
}
