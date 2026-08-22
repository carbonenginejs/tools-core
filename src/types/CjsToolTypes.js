import { ReadDerivation } from "../sde/CjsToolSdeDerivations.js";
import { ReadName } from "../dogma/CjsToolDogma.js";
// One owner for the `.red` -> `.black` and case rule. It was verified once,
// against every planet family, and a second copy is a second thing to get wrong.
import { ToResourcePath } from "../map/CjsToolMap.js";

/**
 * One composed answer about a type: its identity, and the fields the published
 * SDE does not carry.
 *
 * A composed answer rather than a table row. `sde/types/{id}` already returns
 * the published row and must go on meaning exactly that - it is the source's
 * own data and nothing else. This topic is where readings that are ours get
 * combined with it, which is the same separation the sidecar keeps on disk.
 *
 * Deliberately narrow. `dogma`, `industry` and `skills` are their own answers,
 * they are expensive, and a panel wants them separately anyway. Widening this
 * to absorb them would make every type lookup pay for all three.
 */

/** Identity fields taken straight from the source's own row. */
const IDENTITY = Object.freeze([
    "basePrice", "capacity", "factionID", "groupID", "iconID", "graphicID",
    "marketGroupID", "mass", "metaGroupID", "metaLevel", "packagedVolume",
    "portionSize", "published", "raceID", "radius", "techLevel", "volume",
]);

/**
 * What a type is, in words as well as identifiers.
 *
 * Each entry names the identifier the answer already carries, the table that
 * labels it, and the field the label lands in. A consumer showing "Frigate"
 * beside a hull otherwise reads four tables to say four words, and every one of
 * those reads is a chance to join on the wrong build or forget the language.
 */
const TAXONOMY = Object.freeze([
    Object.freeze({ id: "groupID", table: "groups", name: "groupName" }),
    Object.freeze({ id: "metaGroupID", table: "metaGroups", name: "metaGroupName" }),
    Object.freeze({ id: "factionID", table: "factions", name: "factionName" }),
    Object.freeze({ id: "raceID", table: "races", name: "raceName" }),
]);

/**
 * The certificate field each mastery tier reads, by the source's own index.
 *
 * The SDE stores five levels as five *named* fields on one skill row rather
 * than as a list, so the tier index is the only thing that says which field to
 * read.
 */
const MASTERY_TIERS = Object.freeze([
    "basic", "standard", "improved", "advanced", "elite",
]);

export class CjsToolTypes
{

    #source;

    #localisation;

    #extras;

    #corporations;

    constructor(source, options = {})
    {
        this.#source = source;
        this.#localisation = options.localisation ?? null;
        this.#extras = undefined;
        this.#corporations = undefined;
    }

    /** What this answer is built from, for a caller checking provenance. */
    Identity()
    {
        return Object.freeze({
            target: this.#source.target,
            game: this.#source.game,
            provider: this.#source.provider,
            build: this.#source.build,
        });
    }

    /**
     * Composes one type.
     *
     * @param {number|string} typeID Type identifier.
     * @param {object} [options] Answer options.
     * @param {string} [options.language] Language to prefer for resolved text.
     * @returns {Promise<object|null>} The composed type, or null when unknown.
     */
    async Answer(typeID, options = {})
    {
        const key = String(typeID);
        const row = (await this.#source.Table("types").Get(key))?.payload ?? null;

        if (!row) return null;

        const language = options.language ?? null;
        const answer = { typeID: Number(key) };

        for (const field of IDENTITY)
        {
            if (row[field] !== undefined) answer[field] = row[field];
        }

        for (const field of [ "name", "description" ])
        {
            const read = ReadName(row[field], language);

            if (read) answer[field] = read;
        }

        await this.#Compose(answer, row, key, language);

        return answer;
    }

    /**
     * The types that are variations of the same thing this one is.
     *
     * The SDE models this as one pointer: a variation names its parent, and
     * the parent names nobody. So the answer is anchored on the parent - a
     * caller asking about a Tech II hull means "what else is this ship", not
     * "what descends from this exact row" - and the parent is included, first.
     *
     * @param {number|string} typeID Type identifier.
     * @param {object} [options] Answer options.
     * @param {string} [options.language] Language to prefer for resolved text.
     * @returns {Promise<object|null>} The composed answer, or null when unknown.
     */
    async Variations(typeID, options = {})
    {
        const key = String(typeID);
        const selected = (await this.#source.Table("types").Get(key))?.payload ?? null;

        if (!selected) return null;

        const language = options.language ?? null;
        const parentID = Number(selected.variationParentTypeID) || Number(key);
        const rows = new Map([ [ parentID, null ] ]);

        for (const item of await this.#Find("types", "variationParentTypeID", parentID))
        {
            const id = Number(item?.payload?._key ?? item?.id);

            // Unpublished types are the source's own record of things removed
            // from the game. Listing them beside current hulls presents a
            // Tech I frigate nobody can fly as a choice.
            if (id && item.payload?.published !== false) rows.set(id, item.payload);
        }

        const variations = [];

        for (const [ id, row ] of rows)
        {
            const payload = row ?? (await this.#Record("types", id));

            if (!payload) continue;

            const entry = { typeID: id };
            const name = ReadName(payload.name, language);

            if (name) entry.name = name;
            if (payload.groupID) entry.groupID = Number(payload.groupID);

            const group = payload.groupID ? await this.#Record("groups", payload.groupID) : null;
            const groupName = ReadName(group?.name, language);
            const categoryID = Number(group?.categoryID);

            if (groupName) entry.groupName = groupName;
            if (Number.isFinite(categoryID)) entry.categoryID = categoryID;

            variations.push(entry);
        }

        return { typeID: Number(key), parentTypeID: parentID, variations };
    }

    /**
     * What a hull is good at: its per-skill bonuses and its role bonuses.
     *
     * The text is the source's own, markup included - it carries
     * `<a href=showinfo:3307>` links naming the things a bonus applies to, and
     * stripping them here would throw away the only machine-readable part of a
     * human sentence. A consumer that cannot render links strips them; one that
     * can, resolves them.
     *
     * The number is kept apart from the sentence because that is how the SDE
     * stores it: "5" and "% bonus to Large Hybrid Turret rate of fire" are two
     * fields, and joining them into one string is a presentation decision this
     * layer does not get to make for everybody.
     *
     * @param {number|string} typeID Type identifier.
     * @param {object} [options] Answer options.
     * @param {string} [options.language] Language to prefer for resolved text.
     * @returns {Promise<object|null>} The composed answer, or null when unknown.
     */
    async Traits(typeID, options = {})
    {
        const key = String(typeID);

        if (!await this.#Record("types", key)) return null;

        const language = options.language ?? null;
        const row = await this.#Record("typeBonus", key);
        const answer = { typeID: Number(key), skillBonuses: [], roleBonuses: [] };

        // A type with no bonus row is the ordinary case, not a failure: most
        // things in the game have no traits at all.
        if (!row) return answer;

        for (const entry of row.types ?? [])
        {
            const skillTypeID = Number(entry?._key);

            if (!skillTypeID) continue;

            const bonuses = await this.#Bonuses(entry._value, language);

            if (!bonuses.length) continue;

            const group = { skillTypeID, bonuses };
            const name = ReadName((await this.#Record("types", skillTypeID))?.name, language);

            if (name) group.skillName = name;

            answer.skillBonuses.push(group);
        }

        answer.roleBonuses = await this.#Bonuses(row.roleBonuses, language);

        return answer;
    }

    /** One bonus list, with its unit resolved and its order made explicit. */
    async #Bonuses(records, language)
    {
        const bonuses = [];

        for (const record of records ?? [])
        {
            const text = ReadName(record?.bonusText, language);

            if (!text) continue;

            const bonus = { text };
            const value = Number(record.bonus);
            const unitID = Number(record.unitID);
            const importance = Number(record.importance);

            if (Number.isFinite(value)) bonus.bonus = value;
            if (Number.isFinite(importance)) bonus.importance = importance;

            if (Number.isFinite(unitID))
            {
                bonus.unitID = unitID;

                // The unit is a lookup, not a hardcoded "%". Consumers all
                // special-case 105 because nothing told them what else exists.
                const unit = ReadName((await this.#Record("dogmaUnits", unitID))?.displayName, language);

                if (unit) bonus.unit = unit;
            }

            bonuses.push(bonus);
        }

        return bonuses.sort((left, right) => (left.importance ?? 0) - (right.importance ?? 0));
    }

    /**
     * The skills each mastery level of a hull requires.
     *
     * A three-table join - masteries name certificates, certificates name
     * skills, and each certificate states a different level per mastery tier -
     * and the highest requirement across the certificates in a tier wins.
     *
     * `complete` is part of the answer because a partial join cannot support a
     * mastery claim, and the failure is silent in the worst direction: an
     * unreadable certificate drops its requirements, and a requirement set that
     * lost members looks *easier*, which reads as a mastery already achieved.
     * So an incomplete join answers with no levels and says why.
     *
     * @param {number|string} typeID Type identifier.
     * @param {object} [options] Answer options.
     * @param {string} [options.language] Language to prefer for resolved text.
     * @returns {Promise<object|null>} The composed answer, or null when unknown.
     */
    async Mastery(typeID, options = {})
    {
        const key = String(typeID);

        if (!await this.#Record("types", key)) return null;

        const language = options.language ?? null;
        const row = await this.#Record("masteries", key);
        const answer = { typeID: Number(key), complete: true, levels: [] };

        if (!row) return answer;

        const certificates = new Map();

        for (const entry of row._value ?? [])
        {
            for (const value of entry?._value ?? [])
            {
                const id = Number(value);

                if (!id || certificates.has(id)) continue;

                certificates.set(id, await this.#Record("certificates", id));
            }
        }

        if ([ ...certificates.values() ].some(record => !record))
        {
            return { ...answer, complete: false };
        }

        for (const entry of row._value ?? [])
        {
            const tier = Number(entry?._key);
            const field = MASTERY_TIERS[tier];

            if (!field) continue;

            const required = new Map();
            let certificateCount = 0;

            for (const value of entry?._value ?? [])
            {
                const certificate = certificates.get(Number(value));

                if (!certificate) continue;

                certificateCount++;

                for (const skill of certificate.skillTypes ?? [])
                {
                    const skillTypeID = Number(skill?._key ?? skill?.typeID);
                    const level = Number(skill?.[field]);

                    // Level 0 is the SDE saying this skill is not required at
                    // this tier, not a requirement of zero.
                    if (!skillTypeID || !(level >= 1 && level <= 5)) continue;
                    if (level > (required.get(skillTypeID) ?? 0)) required.set(skillTypeID, level);
                }
            }

            const requirements = [];

            for (const [ skillTypeID, level ] of required)
            {
                const requirement = { typeID: skillTypeID, level };
                const name = ReadName((await this.#Record("types", skillTypeID))?.name, language);

                if (name) requirement.name = name;

                requirements.push(requirement);
            }

            // Tier is a zero-based index in the SDE and a one-based level
            // everywhere it is shown. Converting here means one place gets it
            // wrong instead of every consumer.
            answer.levels.push({ level: tier + 1, certificateCount, requirements });
        }

        answer.levels.sort((left, right) => left.level - right.level);

        return answer;
    }

    /** Rows matching one field, or an empty list when the query cannot run. */
    async #Find(table, field, value)
    {
        try
        {
            const found = await this.#source.Table(table).Find(field, String(value), { limit: 200 });

            return Array.isArray(found) ? found : found?.items ?? [];
        }
        catch
        {
            return [];
        }
    }

    /**
     * Adds the fields the SDE may not carry.
     *
     * Order is SDE, then sidecar, then silence. The SDE wins where both could
     * answer: it is the target's own data, and the sidecar exists only to fill
     * what an acquired SDE could not carry.
     *
     * A field with no reading is **omitted**, never defaulted. Three answers are
     * distinct and the consumer needs all three: absent means we have no reading
     * for this type, an empty list means the reading says it has none, and a
     * value is that reading's answer. Only a few hundred of some fifty thousand
     * types carry these, so absent is the ordinary case rather than the edge.
     */
    async #Compose(answer, row, key, language)
    {
        const sidecar = (await this.#Extras())?.types?.[key] ?? null;
        const manufacturers = row.manufacturers ?? sidecar?.manufacturers ?? null;

        if (manufacturers)
        {
            answer.manufacturers = manufacturers.map(Number);

            const names = await this.#ManufacturerNames(answer.manufacturers, language);

            // Beside the identifiers, never instead of them. The identifier is
            // the join key into npcCorporations and stays primary; the name is
            // added because corporation names are per-world, and this answer
            // knows which world it is serving while a consumer joining by hand
            // has to get that right in every consumer, forever.
            if (names) answer.manufacturerNames = names;
        }

        for (const field of [ "quote", "quoteAuthor" ])
        {
            const read = ReadName(row[field] ?? sidecar?.[field], language);

            if (read) answer[field] = read;
        }

        await this.#ComposeTaxonomy(answer, language);
        await this.#ComposeGraphics(answer);
    }

    /**
     * Where this type's artwork lives, as loadable paths.
     *
     * Same shape as the map topic's: `graphicID` is the provenance pointer and
     * `graphics` maps a role to a path the resource route actually serves. The
     * SDE names a `.red` container that is not served, so emitting its
     * string verbatim hands a consumer an address that 404s and makes a naming
     * convention look like a missing asset.
     */
    async #ComposeGraphics(answer)
    {
        if (!answer.graphicID) return;

        const graphic = await this.#Record("graphics", answer.graphicID);

        if (!graphic) return;

        const graphics = {};

        if (graphic.graphicFile) graphics.model = ToResourcePath(graphic.graphicFile);

        // The folder, not a file: an icon name is composed from it, and
        // which name depends on what is being shown.
        if (graphic.iconFolder) graphics.iconFolder = ToResourcePath(graphic.iconFolder);

        if (Object.keys(graphics).length) answer.graphics = graphics;
    }

    /**
     * Names the type's group, meta group and faction, and its category.
     *
     * Names beside the identifiers, as with manufacturers: the identifier is
     * the join key and stays primary, and the name is added because it is
     * per-world and per-language, and this answer knows which world and which
     * language it is serving while a consumer joining by hand has to get that
     * right in every consumer, forever.
     *
     * The category is the group's, not the type's - the SDE puts
     * `categoryID` on the group - and it is the field that answers "is this a
     * ship", which is the question a consumer most often reaches for a raw
     * table to settle.
     *
     * Anything unreadable is omitted rather than defaulted, and a failed lookup
     * never fails the type: an answer with identifiers alone is strictly better
     * than no answer over a missing label.
     */
    async #ComposeTaxonomy(answer, language)
    {
        for (const entry of TAXONOMY)
        {
            const identifier = answer[entry.id];

            if (!identifier) continue;

            const record = await this.#Record(entry.table, identifier);
            const read = ReadName(record?.name, language);

            if (read) answer[entry.name] = read;

            if (entry.table !== "groups" || !record) continue;

            const categoryID = Number(record.categoryID);

            if (!Number.isFinite(categoryID)) continue;

            answer.categoryID = categoryID;

            const category = ReadName((await this.#Record("categories", categoryID))?.name, language);

            if (category) answer.categoryName = category;
        }
    }

    /** One source row, or null when the table or the record is absent. */
    async #Record(table, id)
    {
        try
        {
            return (await this.#source.Table(table).Get(String(id)))?.payload ?? null;
        }
        catch
        {
            return null;
        }
    }

    /** Resolves manufacturer names from this build's own corporation table. */
    async #ManufacturerNames(identifiers, language)
    {
        const corporations = await this.#Corporations();

        if (!corporations) return null;

        const names = {};

        for (const identifier of identifiers)
        {
            const read = ReadName(corporations[String(identifier)]?.name, language);

            if (read) names[String(identifier)] = read;
        }

        return Object.keys(names).length ? names : null;
    }

    /**
     * The sidecar, or null.
     *
     * Absent is normal and not an error: a source that carries these fields
     * itself has no sidecar, and one that has neither simply answers without
     * them. Where the file comes from is not this package's concern - it
     * consumes a documented name beside the database and asks nothing else.
     */
    async #Extras()
    {
        if (this.#extras !== undefined) return this.#extras;

        const file = this.#source.DatabaseFile?.();

        this.#extras = file ? await ReadDerivation(file, "typeExtras") : null;

        return this.#extras;
    }

    /** This build's corporation names, loaded once, or null when absent. */
    async #Corporations()
    {
        if (this.#corporations !== undefined) return this.#corporations;

        try
        {
            const tables = await this.#source.LoadTables([ "npcCorporations" ]);

            this.#corporations = tables?.npcCorporations ?? null;
        }
        catch
        {
            // A source without the table answers with identifiers alone, which
            // is strictly better than failing the whole type lookup over a name.
            this.#corporations = null;
        }

        return this.#corporations;
    }

}

export default CjsToolTypes;
