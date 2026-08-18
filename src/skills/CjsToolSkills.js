/**
 * The skills topic: what a thing needs trained, and what a skill unlocks.
 *
 * ## Why this is a service rather than three lookups per caller
 *
 * The SDE never states "the Viator needs these skills" in one place. It
 * states it as six attribute pairs on the type - `requiredSkill1..6` and
 * `requiredSkill1Level..6` - whose IDs are not adjacent (182-184, 277-279, then
 * 1285-1290). Every consumer that wants a skill list therefore reassembles the
 * same join, and gets the pairing wrong in the same way, because the numbering
 * looks regular for the first three and is not.
 *
 * ## Requirements are a tree, not a list
 *
 * A skill has prerequisites of its own: the Viator needs Gallente Hauler at V,
 * which needs Spaceship Command at III. A caller asking "what must I train"
 * wants the closure, and a caller drawing the Show Info panel wants the direct
 * list, so both are returned and neither is derived by the reader.
 *
 * The closure keeps the **highest** level any path demands. Two routes to the
 * same skill at III and V mean V, and reporting III because it was found first
 * would produce a plan that does not actually unlock the hull.
 *
 * ## No authorization, and all three targets
 *
 * This is the published requirement, not anybody's progress. It needs no ESI -
 * which matters, because Serenity and Infinity have none - and works on any
 * prepared SDE.
 */

import { Payload } from "../dogma/CjsToolDogma.js";
import { ResolveName } from "../dogma/CjsToolDogma.js";

/** Tables this service reads. */
export const SKILLS_TABLES = Object.freeze([ "types", "typeDogma", "dogmaAttributes", "masteries", "certificates" ]);

/**
 * The attribute pairs that carry a requirement.
 *
 * Resolved by name rather than by these IDs, which are listed only to show why
 * the pairing cannot be computed: `requiredSkill4` is 1285 while its level is
 * 1286, but `requiredSkill5` is 1289 with its level at 1287. Anything assuming
 * `skill + 95` or `skill + 1` silently mispairs the last three.
 */
export const REQUIREMENT_SLOTS = Object.freeze([
    { skill: "requiredSkill1", level: "requiredSkill1Level" },
    { skill: "requiredSkill2", level: "requiredSkill2Level" },
    { skill: "requiredSkill3", level: "requiredSkill3Level" },
    { skill: "requiredSkill4", level: "requiredSkill4Level" },
    { skill: "requiredSkill5", level: "requiredSkill5Level" },
    { skill: "requiredSkill6", level: "requiredSkill6Level" }
]);

/** How deep a prerequisite chain may run before we call it a cycle. */
const MAX_DEPTH = 12;

export class CjsToolSkills
{

    #source;

    #attributes;

    #unlocks;

    constructor(source)
    {
        this.#source = source;
        this.#attributes = null;
        this.#unlocks = null;
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
     * What a type requires, directly and in full.
     *
     * Returns null when the type does not exist, so the route can answer 404
     * rather than "requires nothing", which is a real answer for many types.
     */
    async Requirements(typeID, options = {})
    {
        const id = Number(typeID);
        const language = options.language ?? null;
        const type = await this.#Row("types", id);

        if (!type) return null;

        const direct = await this.#Direct(id, language);
        const closure = await this.#Closure(direct, language);

        return {
            ...this.Identity(),
            typeID: id,
            name: await ResolveName(type, id, language, null),
            required: direct,
            // Sorted deepest last so a caller can train straight down the list.
            closure: closure.sort((left, right) => left.depth - right.depth || left.typeID - right.typeID),
            masteries: await this.#Masteries(id, language)
        };
    }

    /**
     * What must be trained to reach one or more skills at given levels.
     *
     * The other two answers start from a **thing** - a hull needs these skills.
     * This one starts from the **skills themselves**, at a level the caller
     * chose, which is the question anyone planning training actually has and
     * the only one of the three that takes a level as input.
     *
     * Several targets are merged rather than answered separately, because the
     * useful answer is one plan. Two ships wanting the same skill at III and V
     * is one entry at V, not two lists to reconcile by hand - and reconciling
     * them by hand is exactly where a consumer takes the first level it sees
     * and produces a plan that does not unlock the second ship.
     *
     * A requested skill appears in the plan as itself, carrying `requested`.
     * Its prerequisites do not change with the level asked for - a skill's
     * requirements are fixed on the skill - but the level does decide what the
     * caller must train, so it is what the entry reports.
     *
     * @param {Array<{typeID: number|string, level: number}>} targets Wanted skills.
     * @param {object} [options] Answer options.
     * @param {string} [options.language] Language to prefer for names.
     * @returns {Promise<object|null>} The plan, or null when no target resolves.
     */
    async Plan(targets, options = {})
    {
        const language = options.language ?? null;
        const wanted = [];

        // Skill identifiers, nothing else. A level was taken here once and it
        // was noise: a skill's prerequisites are fixed on the skill and do not
        // vary with the level being trained to, so asking the caller for one
        // invited a number that could only ever be ignored.
        for (const target of Array.isArray(targets) ? targets : [])
        {
            const id = Number(target?.typeID ?? target);

            if (!Number.isSafeInteger(id) || id <= 0) continue;

            const row = await this.#Row("types", id);

            if (!row) continue;

            wanted.push({ typeID: id, name: await ResolveName(row, id, language, null), level: null });
        }

        if (!wanted.length) return null;

        // Seeded with the targets themselves so a requested skill that is also
        // somebody else's prerequisite merges to the higher of the two.
        const merged = new Map();

        for (const entry of wanted)
        {
            const existing = merged.get(entry.typeID);

            if (!merged.has(entry.typeID)) merged.set(entry.typeID, { ...entry, depth: 0, requested: true, requiredBy: [] });
        }

        let frontier = [ ...merged.values() ];
        let depth = 0;

        while (frontier.length && depth < MAX_DEPTH)
        {
            const next = [];

            for (const entry of frontier)
            {
                for (const parent of await this.#Direct(entry.typeID, language))
                {
                    const existing = merged.get(parent.typeID);

                    // Same rule as the closure: the highest level any path
                    // demands wins, and the shallowest depth is kept so the
                    // ordering below stays meaningful.
                    if (existing)
                    {
                        // A requested skill has no level of its own; a required
                        // one keeps the highest any path demands.
                        existing.level = existing.level === null ? parent.level : Math.max(existing.level, parent.level);
                        existing.depth = Math.min(existing.depth, entry.depth + 1);

                        // Every skill that demanded it, not just the first. This
                        // is a graph rather than a tree: one plan here has a
                        // single skill required by three different targets, so a
                        // singular parent would silently drop two of the reasons
                        // it is in the plan.
                        if (!existing.requiredBy.includes(entry.typeID)) existing.requiredBy.push(entry.typeID);
                        continue;
                    }

                    const seeded = {
                        ...parent,
                        depth: entry.depth + 1,
                        requested: false,
                        requiredBy: [ entry.typeID ],
                    };

                    merged.set(parent.typeID, seeded);
                    next.push(seeded);
                }
            }

            frontier = next;
            depth++;
        }

        // Keyed by skill, because that is how a consumer uses it: "do I have
        // this one, and at what level". A list would make every lookup a scan,
        // and the same skill can be reached by several paths.
        //
        // Deliberately NOT nested. The edges are here as `requiredBy`, so a
        // caller wanting a tree builds one from a single source of truth; two
        // representations of the same graph in one payload can disagree, and
        // this one would, because a skill required by three targets appears
        // three times in a tree and once here.
        const skills = {};

        for (const entry of [ ...merged.values() ].sort((left, right) => right.depth - left.depth || left.typeID - right.typeID))
        {
            skills[String(entry.typeID)] = {
                level: entry.level,
                // Deepest first is trainable order: a prerequisite is deeper
                // than the thing it unlocks, so following the keys in order
                // never reaches a skill whose own requirements are untrained.
                depth: entry.depth,
                requested: entry.requested,
                requiredBy: entry.requiredBy.sort((left, right) => left - right),
                name: entry.name ?? null,
            };
        }

        return {
            ...this.Identity(),
            requested: wanted,
            skills,
            outline: await this.#Outline(wanted, language, 0),
        };
    }

    /**
     * The same requirements as the game draws them: one line per edge.
     *
     * Not the same answer as `skills`, and both are needed on one screen. This
     * is a depth-first expansion with repeats preserved - the panel shows
     * Spaceship Command five times at I through V, once per parent that demands
     * it, and Capital Ships twice - because the panel explains WHY each
     * requirement is there. `depth` is the indent.
     *
     * `skills` is the same graph collapsed: one entry per skill at the highest
     * level any path demands. That is what a training plan and a skill-point
     * total need, and rendering it would silently drop the repeats the panel is
     * made of.
     */
    async #Outline(nodes, language, depth)
    {
        if (depth >= MAX_DEPTH) return [];

        const lines = [];

        for (const node of nodes)
        {
            lines.push({
                typeID: node.typeID,
                name: node.name ?? null,
                level: node.level,
                depth,
            });

            lines.push(...await this.#Outline(await this.#Direct(node.typeID, language), language, depth + 1));
        }

        return lines;
    }

    /**
     * One skill: what it costs to train, what it needs, and what it opens up.
     *
     * `unlocks` is the reverse of every other answer here and the reason this
     * service holds an index at all - the SDE has no such direction.
     */
    async Skill(typeID, options = {})
    {
        const id = Number(typeID);
        const language = options.language ?? null;
        const type = await this.#Row("types", id);

        if (!type) return null;

        const values = await this.#Values(id);
        const attributes = await this.#Attributes();
        const Value = name => values.get(attributes.byName.get(name)?.attributeID);
        const unlocks = await this.#Unlocks();
        const opened = [];

        for (const entry of unlocks.get(id) ?? [])
        {
            const unlocked = await this.#Row("types", entry.typeID);

            if (!unlocked || unlocked.published !== true) continue;

            opened.push({
                typeID: entry.typeID,
                name: await ResolveName(unlocked, entry.typeID, language, null),
                level: entry.level
            });
        }

        return {
            ...this.Identity(),
            typeID: id,
            name: await ResolveName(type, id, language, null),
            // The training-time multiplier. Named `skillTimeConstant` in the
            // SDE and "rank" everywhere a player would read it.
            rank: Value("skillTimeConstant") ?? null,
            primaryAttribute: Value("primaryAttribute") ?? null,
            secondaryAttribute: Value("secondaryAttribute") ?? null,
            required: await this.#Direct(id, language),
            unlocks: opened.sort((left, right) => left.typeID - right.typeID)
        };
    }

    /** The requirements written on one type, in slot order. */
    async #Direct(typeID, language)
    {
        const values = await this.#Values(typeID);
        const attributes = await this.#Attributes();
        const required = [];

        for (const slot of REQUIREMENT_SLOTS)
        {
            const skillAttribute = attributes.byName.get(slot.skill);
            const levelAttribute = attributes.byName.get(slot.level);

            if (!skillAttribute || !levelAttribute) continue;

            const skillTypeID = values.get(skillAttribute.attributeID);
            const level = values.get(levelAttribute.attributeID);

            if (!skillTypeID) continue;

            const skill = await this.#Row("types", skillTypeID);

            required.push({
                typeID: Number(skillTypeID),
                name: skill ? await ResolveName(skill, skillTypeID, language, null) : null,
                // A requirement with no level is a requirement at I; the SDE
                // omits the level rather than writing 1.
                level: level === undefined ? 1 : Number(level)
            });
        }

        return required;
    }

    /**
     * Every skill reachable from a direct list, at the highest level demanded.
     *
     * Breadth-first, with a depth cap standing in for a cycle check: the SDE
     * should not contain one, and an unbounded walk on data that did would hang
     * the request rather than answer it.
     */
    async #Closure(direct, language)
    {
        const found = new Map();
        let frontier = direct.map(entry => ({ ...entry, depth: 0 }));
        let depth = 0;

        while (frontier.length && depth < MAX_DEPTH)
        {
            const next = [];

            for (const entry of frontier)
            {
                const existing = found.get(entry.typeID);

                // The highest level any path demands wins. Taking the first
                // would produce a plan that does not unlock the thing.
                if (existing)
                {
                    if (entry.level > existing.level) existing.level = entry.level;
                    if (entry.depth < existing.depth) existing.depth = entry.depth;
                    continue;
                }

                found.set(entry.typeID, { ...entry });

                for (const parent of await this.#Direct(entry.typeID, language))
                {
                    next.push({ ...parent, depth: entry.depth + 1 });
                }
            }

            frontier = next;
            depth++;
        }

        return [ ...found.values() ];
    }

    /** The mastery certificates for a type, by level. */
    async #Masteries(typeID, language)
    {
        const row = await this.#Row("masteries", typeID);

        if (!row) return [];

        const levels = [];

        for (const entry of row._value ?? [])
        {
            const certificates = [];

            for (const certificateID of entry._value ?? [])
            {
                const certificate = await this.#Row("certificates", certificateID);

                certificates.push({
                    certificateID: Number(certificateID),
                    name: certificate?.name
                        ? await ResolveName(certificate, certificateID, language, null)
                        : null
                });
            }

            levels.push({ level: Number(entry._key), certificates });
        }

        return levels.sort((left, right) => left.level - right.level);
    }

    /**
     * Skill to the types that require it, built once.
     *
     * A whole pass over `typeDogma` - 26828 rows on one reference build -
     * because the SDE publishes only the forward direction. Held afterwards, since the
     * question "what does this skill let me use" is asked far more than once.
     */
    async #Unlocks()
    {
        if (this.#unlocks) return this.#unlocks;

        const attributes = await this.#Attributes();
        const pairs = REQUIREMENT_SLOTS
            .map(slot => [ attributes.byName.get(slot.skill)?.attributeID, attributes.byName.get(slot.level)?.attributeID ])
            .filter(([ skill, level ]) => skill && level);

        const table = this.#source.Table("typeDogma");
        const unlocks = new Map();
        let offset = 0;

        for (;;)
        {
            const page = await table.List({ limit: 1000, offset });

            if (!page.length) break;

            for (const record of page)
            {
                const values = new Map((Payload(record)?.dogmaAttributes ?? [])
                    .map(entry => [ Number(entry.attributeID), Number(entry.value) ]));

                for (const [ skillAttribute, levelAttribute ] of pairs)
                {
                    const skillTypeID = values.get(skillAttribute);

                    if (!skillTypeID) continue;

                    if (!unlocks.has(skillTypeID)) unlocks.set(skillTypeID, []);

                    unlocks.get(skillTypeID).push({
                        typeID: Number(record.id),
                        level: values.get(levelAttribute) ?? 1
                    });
                }
            }

            offset += page.length;
        }

        this.#unlocks = unlocks;

        return unlocks;
    }

    /** Published attribute values for one type, by attribute ID. */
    async #Values(typeID)
    {
        const dogma = await this.#Row("typeDogma", typeID);
        const values = new Map();

        for (const entry of dogma?.dogmaAttributes ?? [])
        {
            values.set(Number(entry.attributeID), Number(entry.value));
        }

        return values;
    }

    /** The attribute catalog, by name. */
    async #Attributes()
    {
        if (this.#attributes) return this.#attributes;

        const table = this.#source.Table("dogmaAttributes");
        const byName = new Map();
        let offset = 0;

        for (;;)
        {
            const page = await table.List({ limit: 1000, offset });

            if (!page.length) break;

            for (const record of page)
            {
                const name = Payload(record)?.name;

                if (name) byName.set(name, { attributeID: Number(record.id), name });
            }

            offset += page.length;
        }

        this.#attributes = { byName };

        return this.#attributes;
    }

    async #Row(table, id)
    {
        const record = await this.#source.Table(table).Get(String(id));

        return record ? Payload(record) : null;
    }

}
