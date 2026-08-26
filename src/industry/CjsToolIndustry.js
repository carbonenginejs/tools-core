/**
 * The industry topic: what a type is made from, and what it breaks down into.
 *
 * ## The distinction this whole service exists to keep
 *
 * Two lists of materials attach to a ship and they are not the same list:
 *
 * - **manufacturing inputs** - `blueprints.activities.manufacturing.materials`,
 *   what you must supply to *build* one from its blueprint;
 * - **reprocessed materials** - `typeMaterials`, what you *get back* when one is
 *   reprocessed. This is the in-game "Reprocessed materials" panel.
 *
 * They overlap enough to look interchangeable and are never equal. Presenting
 * one as the other produces a plausible, wrong shopping list, so they are
 * separate fields here and neither is ever derived from the other.
 *
 * ## Public and base, by construction
 *
 * Everything here comes from the published SDE, so it needs no
 * authorization: it is the *recipe*, not anybody's blueprint. A pilot's owned
 * copies, their material and time efficiency, facility and rig bonuses, the
 * system cost index, taxes, and invention outcomes are all later inputs that
 * modify this answer. None of them may overwrite it - the base recipe is what
 * they are applied to. ESI has no endpoint for this recipe at all; its
 * blueprint endpoints return owned instances, which is why the SDE is
 * required.
 *
 * ## Finding a blueprint from its product
 *
 * `blueprints` is keyed by the blueprint's own type, and a caller has the ship.
 * The reverse direction is not published, so it is built once per open build by
 * reading the table through - about 5000 rows on every current target - and
 * held. That is cheap enough not to need a derivation artifact, and it stays
 * correct when a target ships a different blueprint set, which two of the three
 * already do.
 */

import { Payload, ResolveName } from "../dogma/CjsToolDogma.js";

/** Tables this service reads. */
export const INDUSTRY_TABLES = Object.freeze([ "types", "blueprints", "typeMaterials" ]);

/**
 * The activity whose recipe is returned in full.
 *
 * The others - copying, invention, research - are reported by name so a caller
 * knows they exist without this route growing five shapes at once.
 */
export const PRIMARY_ACTIVITY = "manufacturing";

/**
 * Separates exact-build manufacturing inputs from reprocessing outputs for an
 * SDE type.
 */
export class CjsToolIndustry
{

    #source;

    #productIndex;

    #localisation;

    /** `localisation` names types on a source that carries no English of its own. */
    constructor(source, { localisation = null } = {})
    {
        this.#source = source;
        this.#productIndex = null;
        this.#localisation = localisation;
    }

    /** Target, provider and the exact numeric build this answer came from. */
    Identity()
    {
        return {
            target: this.#source.target,
            provider: this.#source.provider,
            build: this.#source.build
        };
    }

    /**
     * The public industry join for one type.
     *
     * Returns null when the type does not exist. A type that exists but has no
     * blueprint is not null: it answers with `blueprint: null` and says so in
     * `unsupportedSections`, because "cannot be built" is a real answer and
     * differs from "no such type".
     */
    async Type(typeID, options = {})
    {
        const id = Number(typeID);
        const language = options.language ?? null;
        const type = await this.#Row("types", id);

        if (!type) return null;

        const unsupported = [];
        const blueprint = await this.#Blueprint(id, language, unsupported);
        const reprocessed = await this.#Reprocessed(id, language, unsupported);

        return {
            ...this.Identity(),
            type: {
                typeID: id,
                name: await ResolveName(type, id, language, this.#localisation),
                groupID: type.groupID ?? null
            },
            blueprint,
            reprocessedMaterials: reprocessed,
            unsupportedSections: unsupported
        };
    }

    /** The blueprint that produces this type, with its manufacturing recipe. */
    async #Blueprint(productTypeID, language, unsupported)
    {
        const index = await this.#ProductIndex();
        const blueprintTypeID = index.get(productTypeID);

        if (blueprintTypeID === undefined)
        {
            unsupported.push({ section: "blueprint", reason: "no-blueprint-produces-this-type" });

            return null;
        }

        const row = await this.#Row("blueprints", blueprintTypeID);
        const type = await this.#Row("types", blueprintTypeID);
        const activities = row?.activities ?? {};
        const manufacturing = activities[PRIMARY_ACTIVITY] ?? null;

        if (!manufacturing)
        {
            unsupported.push({ section: "manufacturing", reason: "blueprint-has-no-manufacturing-activity" });
        }

        return {
            typeID: blueprintTypeID,
            name: type ? await ResolveName(type, blueprintTypeID, language, this.#localisation) : null,
            maxProductionLimit: row?.maxProductionLimit ?? null,
            // Named so a caller can see that invention or research exist here
            // without this response trying to describe all of them.
            activities: Object.keys(activities).sort(),
            manufacturing: manufacturing
                ? {
                    time: manufacturing.time ?? null,
                    materials: await this.#Items(manufacturing.materials, language),
                    products: await this.#Items(manufacturing.products, language),
                    skills: await this.#Skills(manufacturing.skills, language)
                }
                : null
        };
    }

    /** What reprocessing this type yields. */
    async #Reprocessed(typeID, language, unsupported)
    {
        const row = await this.#Row("typeMaterials", typeID);

        if (!row)
        {
            unsupported.push({ section: "reprocessedMaterials", reason: "type-has-no-material-composition" });

            return [];
        }

        return this.#Items(row.materials, language);
    }

    /**
     * Names a list of `{typeID|materialTypeID, quantity}` entries.
     *
     * Two key spellings because the SDE uses `typeID` in blueprint recipes
     * and `materialTypeID` in `typeMaterials`, for the same idea.
     */
    async #Items(entries, language)
    {
        const list = [];

        for (const entry of entries ?? [])
        {
            const typeID = Number(entry.typeID ?? entry.materialTypeID);

            if (!Number.isFinite(typeID)) continue;

            const type = await this.#Row("types", typeID);
            const item = {
                typeID,
                name: type ? await ResolveName(type, typeID, language, this.#localisation) : null,
                quantity: entry.quantity ?? null
            };

            // Only invention products carry a probability; keeping the key off
            // the others avoids implying a certainty value of 1 that the SDE
            // never states.
            if (entry.probability !== undefined) item.probability = entry.probability;

            list.push(item);
        }

        return list;
    }

    /** The skills an activity requires, at the level it requires them. */
    async #Skills(entries, language)
    {
        const list = [];

        for (const entry of entries ?? [])
        {
            const typeID = Number(entry.typeID);

            if (!Number.isFinite(typeID)) continue;

            const type = await this.#Row("types", typeID);

            list.push({
                typeID,
                name: type ? await ResolveName(type, typeID, language, this.#localisation) : null,
                level: entry.level ?? null
            });
        }

        return list;
    }

    /** Product type to blueprint type, built once per open build. */
    async #ProductIndex()
    {
        if (this.#productIndex) return this.#productIndex;

        const table = this.#source.Table("blueprints");
        const index = new Map();
        let offset = 0;

        for (;;)
        {
            const page = await table.List({ limit: 1000, offset });

            if (!page.length) break;

            for (const record of page)
            {
                const row = Payload(record);
                const blueprintTypeID = Number(row.blueprintTypeID ?? record.id);

                for (const activity of Object.values(row.activities ?? {}))
                {
                    for (const product of activity.products ?? [])
                    {
                        const productTypeID = Number(product.typeID);

                        // First blueprint wins. A product with two blueprints is
                        // not something the current sources contain, and picking
                        // the lowest id keeps the answer stable if one appears.
                        if (!Number.isFinite(productTypeID)) continue;

                        const existing = index.get(productTypeID);

                        if (existing === undefined || blueprintTypeID < existing)
                        {
                            index.set(productTypeID, blueprintTypeID);
                        }
                    }
                }
            }

            offset += page.length;
        }

        this.#productIndex = index;

        return index;
    }

    /** One row's payload, or null. */
    async #Row(table, id)
    {
        const record = await this.#source.Table(table).Get(String(id));

        return record ? Payload(record) : null;
    }

}
