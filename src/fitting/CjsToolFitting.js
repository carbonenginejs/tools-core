/**
 * The fitting topic: text in, one normalized loadout out.
 *
 * `CjsToolFittingCodec` reads the formats and knows no data; this supplies the
 * data half from an exact build, so the pair is correct for whichever source
 * is open and stays correct when that source renumbers something.
 *
 * ## Where a slot actually comes from
 *
 * Not from the text. A module declares its slot by carrying one dogma effect,
 * and there are exactly six:
 *
 * | effect | slot |
 * | --- | --- |
 * | `loPower` | low |
 * | `medPower` | medium |
 * | `hiPower` | high |
 * | `rigSlot` | rig |
 * | `subSystem` | subsystem |
 * | `serviceSlot` | service |
 *
 * They are looked up by name rather than by the IDs they happen to have
 * (11, 13, 12, 2663, 3772, 6306 on one reference build), for the same reason
 * the dogma service resolves attributes by name: a hard-coded ID is the
 * likeliest thing to be quietly wrong on a target nobody checked.
 *
 * ## Two traps in the category chain
 *
 * A type reaches its category through its group - `types.groupID` ->
 * `groups.categoryID` - and there is no denormalized category on the type.
 *
 * **Tech III subsystems are category 32, not 7.** Anything deciding "is this
 * fittable" by `categoryID === 7` silently drops every subsystem on a
 * Tengu or a Loki. Rigs, by contrast, *are* category 7 despite occupying their
 * own slot, so the category cannot decide the slot either. The effect decides
 * the slot; the category only says what kind of thing it is.
 *
 * ## Resolving a name
 *
 * EFT carries localized type names, so this indexes names per language and
 * falls back to English. Measured on one reference build: of 26992
 * *published* types, 26976 names are unique. The 12 duplicated names are SKINs, gift crates and a
 * drink - nothing fittable - so a name lookup is unambiguous for anything that
 * can appear in a fit. Unpublished types are excluded from the index entirely,
 * which is what removes the other 1000-odd collisions, most of them retired
 * duplicates like the "OLD Loki ..." subsystems.
 */

import { Payload } from "../dogma/CjsToolDogma.js";
import { FormatAll, ParseFitting, UNFITTED_FLAGS } from "./CjsToolFittingCodec.js";
import { DescribeFlags, ReadFlag } from "./CjsToolFittingFlags.js";

/** Tables this service reads. */
export const FITTING_TABLES = Object.freeze([ "types", "groups", "categories", "dogmaEffects", "typeDogma" ]);

/** The effect that marks each slot, by the source's own effect name. */
export const SLOT_EFFECTS = Object.freeze({
    loPower: "low",
    medPower: "medium",
    hiPower: "high",
    rigSlot: "rig",
    subSystem: "subsystem",
    serviceSlot: "service"
});

/**
 * What a type is, by category.
 *
 * Only what a fitting has to tell apart. `subsystem` is listed because Tech III
 * subsystems sit in their own category rather than under Module.
 */
export const FITTING_CATEGORIES = Object.freeze({
    6: "ship",
    7: "module",
    8: "charge",
    18: "drone",
    32: "subsystem",
    66: "structureModule",
    87: "fighter"
});

/** Joins parsed fitting text to exact-build type, category, and slot-effect data. */
export class CjsToolFitting
{

    #source;

    #names;

    #slotEffects;

    #classified;

    #categories;

    /** Initializes lazy fitting indexes over an exact-build table source. */
    constructor(source)
    {
        this.#source = source;
        this.#names = new Map();
        this.#slotEffects = null;
        this.#classified = new Map();
        this.#categories = null;
    }

    /** Target, provider and the exact numeric build a fit was resolved against. */
    Identity()
    {
        return {
            target: this.#source.target,
            provider: this.#source.provider,
            build: this.#source.build
        };
    }

    /**
     * Reads any supported fitting text and returns the record with every wire
     * form beside it.
     *
     * One call answers "what is this fit" and "give me a link for it", which is
     * what a caller pasting a fit almost always wants next.
     */
    async Parse(text, options = {})
    {
        const record = await ParseFitting(text, this.Resolver(options.language ?? null), options);

        return { ...this.Identity(), ...FormatAll(record) };
    }

    /**
     * Turns an ESI saved fitting into the same record the codec produces.
     *
     * ESI is the only source that states where the pilot actually had each
     * module, so its `flag` is kept as authority and the slot is derived from
     * it. Where a flag is absent or unrecognised the type decides, exactly as
     * for pasted text.
     */
    async FromEsi(fitting, options = {})
    {
        const language = options.language ?? null;
        const items = [];

        for (const item of fitting?.items ?? [])
        {
            const typeID = Number(item.typeID ?? item.type_id);

            if (!Number.isSafeInteger(typeID)) continue;

            const classified = await this.Classify(typeID, language);
            const flag = item.flag ?? null;
            const placed = ReadFlag(flag);

            items.push({
                typeID,
                name: classified?.name ?? null,
                quantity: Number(item.quantity ?? 1),
                flag,
                slot: placed?.slot ?? null,
                position: placed?.position ?? null,
                fitted: placed !== null,
                category: classified?.category ?? null
            });
        }

        const shipTypeID = Number(fitting?.shipTypeID ?? fitting?.ship_type_id);
        const ship = await this.Classify(shipTypeID, language);

        return {
            ...this.Identity(),
            ...FormatAll({
                source: { kind: "esi", fittingID: fitting?.fittingID ?? fitting?.fitting_id ?? null },
                name: fitting?.name ?? null,
                description: fitting?.description ?? "",
                shipTypeID,
                shipName: ship?.name ?? null,
                items
            })
        };
    }

    /** The codec's resolver, bound to a language. */
    Resolver(language = null)
    {
        return {
            Resolve: name => this.Resolve(name, language),
            Classify: typeID => this.Classify(typeID, language)
        };
    }

    /** A localized type name to its type, or null when the source has no such name. */
    async Resolve(name, language = null)
    {
        const wanted = String(name ?? "").trim();

        if (!wanted) return null;

        for (const key of [ language, "en" ])
        {
            if (!key) continue;

            const index = await this.#NameIndex(key);
            const typeID = index.get(wanted);

            if (typeID) return { typeID, name: wanted };
        }

        return null;
    }

    /** What a type is and where it goes, or null when it is not in this source. */
    async Classify(typeID, language = null)
    {
        const id = Number(typeID);

        if (!Number.isSafeInteger(id) || id <= 0) return null;

        const key = `${id}\0${language ?? ""}`;

        if (this.#classified.has(key)) return this.#classified.get(key);

        const type = await this.#Row("types", id);

        if (!type)
        {
            this.#classified.set(key, null);

            return null;
        }

        const categories = await this.#Categories();
        const category = FITTING_CATEGORIES[categories.get(Number(type.groupID))] ?? null;
        const result = Object.freeze({
            typeID: id,
            name: ReadName(type.name, language),
            groupID: type.groupID ?? null,
            category,
            slot: await this.#Slot(id)
        });

        this.#classified.set(key, result);

        return result;
    }

    /** The slot a type occupies, from the effect it carries. */
    async #Slot(typeID)
    {
        const effects = await this.#SlotEffects();
        const dogma = await this.#Row("typeDogma", typeID);

        for (const entry of dogma?.dogmaEffects ?? [])
        {
            const slot = effects.get(Number(entry.effectID));

            if (slot) return slot;
        }

        return null;
    }

    /** Effect ID to slot, resolved from the source's own effect names. */
    async #SlotEffects()
    {
        if (this.#slotEffects) return this.#slotEffects;

        const table = this.#source.Table("dogmaEffects");
        const effects = new Map();
        let offset = 0;

        for (;;)
        {
            const page = await table.List({ limit: 1000, offset });

            if (!page.length) break;

            for (const record of page)
            {
                const slot = SLOT_EFFECTS[Payload(record)?.name];

                if (slot) effects.set(Number(record.id), slot);
            }

            offset += page.length;
        }

        this.#slotEffects = effects;

        return effects;
    }

    /** Group ID to category ID, read once. */
    async #Categories()
    {
        if (this.#categories) return this.#categories;

        const table = this.#source.Table("groups");
        const groups = new Map();
        let offset = 0;

        for (;;)
        {
            const page = await table.List({ limit: 1000, offset });

            if (!page.length) break;

            for (const record of page) groups.set(Number(record.id), Number(Payload(record)?.categoryID));

            offset += page.length;
        }

        this.#categories = groups;

        return groups;
    }

    /**
     * Type names to IDs for one language, published types only.
     *
     * Unpublished types are excluded because they are where the name collisions
     * live - retired duplicates that would shadow the real type of the same
     * name. Nothing unpublished can be in a fit anyway.
     */
    async #NameIndex(language)
    {
        if (this.#names.has(language)) return this.#names.get(language);

        const table = this.#source.Table("types");
        const index = new Map();
        let offset = 0;

        for (;;)
        {
            const page = await table.List({ limit: 1000, offset });

            if (!page.length) break;

            for (const record of page)
            {
                const row = Payload(record);

                if (row?.published !== true) continue;

                const name = row.name?.[language];

                // First writer wins, so a later duplicate cannot displace a
                // name already resolved. The 12 published duplicates on the
                // reference build are SKINs and crates, none of them fittable.
                if (name && !index.has(name)) index.set(name, Number(record.id));
            }

            offset += page.length;
        }

        this.#names.set(language, index);

        return index;
    }

    /**
     * Reads one table record and returns its payload without the source
     * envelope.
     */
    async #Row(table, id)
    {
        const record = await this.#source.Table(table).Get(String(id));

        return record ? Payload(record) : null;
    }

}

/** A name in the language asked for, falling back to English then anything. */
function ReadName(value, language)
{
    if (!value) return null;
    if (typeof value === "string") return value;

    return value[language] ?? value.en ?? Object.values(value)[0] ?? null;
}

export { UNFITTED_FLAGS, DescribeFlags };
