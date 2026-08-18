import { patternBlendMode, projectionType } from "./helpers.js";

/**
 * Builds the SOF pattern and DNA for a SKINR skin payload.
 *
 * This is the translation that used to live in ccpwgl's TnySkinrApiProvider,
 * moved here because every input it needs is SKINR library data: the cosmetic
 * slot names, the components, the factionID slot conversion and the
 * typeID -> factionID join. Doing it there meant four round trips and a copy of
 * the conversion rules in a file that cannot even be committed.
 *
 * Output is plain JSON in the shape of an EveSOFDataPattern - the consumer
 * hydrates it. No runtime classes cross this boundary, so the emitter has no
 * dependency on a SOF runtime and the result is cacheable and diffable.
 *
 * `applicationGroups` is deliberately absent. It is real upstream structure,
 * but a generated skin targets exactly one hull and needs no per-area-type variation,
 * and nothing in the consuming runtime reads the field.
 */
export class CjsToolSkinrPattern
{

    static schema = "carbonenginejs.skinrSofPattern";

    /** Cosmetic slot names by slot position 1-4, in slot order. */
    static MaterialSlotNames = Object.freeze([
        "primary_nanocoating",
        "secondary_nanocoating",
        "tertiary_nanocoating",
        "tech_area",
    ]);

    /**
     * The two pattern layers. materialSource is 0-based over
     * [material1-4, patternMaterial1, patternMaterial2], so the pattern layers
     * carry 4 and 5 - matching shipped SOF patterns (holiday2022_deathless).
     */
    static PatternLayers = Object.freeze([
        Object.freeze({ slot: "pattern", textureName: "PatternMask1Map", materialSource: 4, materialSlot: "pattern_material" }),
        Object.freeze({ slot: "secondary_pattern", textureName: "PatternMask2Map", materialSource: 5, materialSlot: "secondary_pattern_material" }),
    ]);

    static EMPTY_TEXTURE_RES_FILE_PATH = "res:/texture/global/black.dds";

    /**
     * @param {Object} options
     * @param {Object} options.library - a built SKINR library
     * @param {Object} options.skin - the SKINR skin payload
     * @param {String} options.dna - the hull's resolved SOF DNA (hull:faction:race)
     * @returns {{name:String|null, dna:String, pattern:Object|null, factionID:Number|null}}
     */
    static generate({ library, skin, dna } = {})
    {
        if (!library) throw new TypeError("SKINR pattern generation requires a built library");
        if (!dna) throw new TypeError("SKINR pattern generation requires the hull's SOF DNA");

        const { ship_type_id: shipTypeID, id, layout } = skin ?? {};

        if (shipTypeID === undefined || shipTypeID === null || !id || !layout || !Array.isArray(layout.slots))
        {
            throw new TypeError("SKINR pattern generation requires ship_type_id, id and layout.slots");
        }

        const [ hullName, factionName, raceName ] = String(dna).toLowerCase().split(":");

        // Cosmetic slot id -> slot name -> the payload's configuration for it.
        const bySlotName = {};
        for (const slot of layout.slots)
        {
            if (!slot) continue;
            const record = library.slotNames?.[slot.id];
            if (!record) throw new Error(`SKINR slot name ${slot.id} not found`);
            bySlotName[record.name] = slot.configuration || {};
        }

        const componentIn = (slotName, kind) =>
        {
            const entry = bySlotName[slotName]?.[kind];
            if (!entry || entry.id === undefined || entry.id === null) return null;
            const component = library.components?.[entry.id];
            if (!component) throw new Error(`SKINR component ${entry.id} not found`);
            return { component, configuration: entry.configuration || {} };
        };

        const materialFromSlot = slotName => componentIn(slotName, "nanocoating")?.component.sofPattern || "none";

        // factionID selects which cosmetic slot feeds which mesh material
        // layer. It is an attribute of a typeID, NOT the SOF faction in the DNA
        // above - see definitions/skinr-faction-slots-v2.
        const factionID = ResolveFactionId(skin, library, shipTypeID);
        const slotsToLayers = FlattenConversion(library.skinrSlotsToMaterialLayerByFactionId?.[factionID]);

        const meshSlotNames = CjsToolSkinrPattern.MaterialSlotNames;
        const mesh = [];
        for (let layer = 1; layer <= 4; layer++)
        {
            const slotIndex = slotsToLayers ? slotsToLayers.indexOf(layer) : layer - 1;
            mesh.push(slotIndex === -1 ? "none" : materialFromSlot(meshSlotNames[slotIndex]));
        }

        let result = `${hullName}:${factionName}:${raceName}`;
        if (mesh.some(value => value !== "none")) result += `:mesh?${mesh.join(";")}`;

        // Kept as authored rather than folded to "overlay": `normal` IS the
        // overlay blend, and the runtime resolves both to the same value, so
        // rewriting it only makes the generated file harder to check against
        // the payload it came from.
        const blendMode = patternBlendMode(layout.pattern_blend_mode);

        const built = CjsToolSkinrPattern.PatternLayers.map(definition =>
            BuildLayer(definition, { bySlotName, componentIn, blendMode, slotsToLayers }));

        let pattern = null;

        if (built.some(Boolean))
        {
            const patternName = String(id).toLowerCase();

            pattern = {
                name: patternName,
                sof6: false,
                layer1: built[0]?.layer ?? null,
                layer2: built[1]?.layer ?? null,
                projections: [ {
                    name: hullName,
                    transformLayer1: built[0]?.transform ?? null,
                    transformLayer2: built[1]?.transform ?? null,
                } ],
            };

            const materials = CjsToolSkinrPattern.PatternLayers
                .map(definition => materialFromSlot(definition.materialSlot));

            result += `:pattern?${patternName};${materials.join(";")}`;
        }

        return { name: skin.name ?? null, dna: result, pattern, factionID };
    }

}

/**
 * factionID from the payload if the caller holds one, else the library's
 * typeID -> factionID join. Null is a real answer: most hulls have no faction,
 * and the mesh assignment falls back to slot order for them.
 */
function ResolveFactionId(skin, library, shipTypeID)
{
    const known = skin?.faction_id ?? skin?.factionID;
    if (known !== undefined && known !== null) return Number(known);

    const joined = library.typesToFactions?.[shipTypeID];
    return joined === undefined || joined === null ? null : Number(joined);
}

/** [{slotID, materialID}] -> positional array indexed by slot, or null. */
function FlattenConversion(pairs)
{
    if (!Array.isArray(pairs) || !pairs.length) return null;

    const out = [];
    for (const pair of pairs) out[pair.slotID - 1] = pair.materialID;
    return out;
}

function BuildLayer(definition, { componentIn, blendMode, slotsToLayers })
{
    const found = componentIn(definition.slot, "pattern");
    if (!found) return null;

    const { component, configuration } = found;
    const { projection, transform, mirrored } = configuration;

    // A SKINR component's `projectionTypeU` is a LABEL ("clamp-to-edge"); a SOF
    // pattern layer's `projectionTypeU` is a NUMBER. Same field name, two
    // vocabularies - convert, never copy. The component also carries the
    // derived `addressUMode`, which is a third vocabulary and not this one.
    const layer = {
        isTargetMtl1: false,
        isTargetMtl2: false,
        isTargetMtl3: false,
        isTargetMtl4: false,
        blendMode,
        materialSource: definition.materialSource,
        projectionTypeU: projectionType(component.projectionTypeU),
        projectionTypeV: projectionType(component.projectionTypeV),
        textureName: definition.textureName,
        textureResFilePath: component.resourceFile || CjsToolSkinrPattern.EMPTY_TEXTURE_RES_FILE_PATH,
    };

    // The payload's projection flags are keyed by cosmetic slot; convert them
    // to the mesh material layers those slots feed, with the same faction
    // conversion the nanocoatings used. An absent `projection` targets all.
    const targets = [ false, false, false, false ];
    for (let slot = 1; slot <= 4; slot++)
    {
        const targetLayer = slotsToLayers ? slotsToLayers[slot - 1] : slot;
        if (!projection || projection[`slot${slot}`]) targets[targetLayer - 1] = true;
    }
    layer.isTargetMtl1 = targets[0];
    layer.isTargetMtl2 = targets[1];
    layer.isTargetMtl3 = targets[2];
    layer.isTargetMtl4 = targets[3];

    const { position, rotation, scaling } = transform ?? {};

    return {
        layer,
        transform: {
            isMirrored: !!mirrored,
            position: position ? [ position.x, position.y, position.z ] : [ 0, 0, 0 ],
            rotation: rotation ? [ rotation.x, rotation.y, rotation.z, rotation.w ] : [ 0, 0, 0, 1 ],
            scaling: scaling ? [ scaling.x, scaling.y, scaling.z ] : [ 1, 1, 1 ],
        },
    };
}
