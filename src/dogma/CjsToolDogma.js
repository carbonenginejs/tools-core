/**
 * The dogma topic: what a hull's numbers are, and what they become with skills.
 *
 * ## What this is, in one line
 *
 * Given a type and a set of skill levels, it returns the published attribute
 * values, the values after every modifier that applies, and a trace of what
 * changed each one.
 *
 * ## Why the evaluation is data-driven rather than a table of known bonuses
 *
 * It would be quicker to hard-code "CPU Management gives 5% per level" for a
 * dozen fitting skills. That was rejected: those percentages are data and
 * upstream changes them, the same list would then have to be maintained per
 * game version, and the three versions this serves are already not identical.
 * Infinity carries 7200 dogma effects where Eve carries 3417.
 *
 * So nothing here knows what a skill does. It reads `dogmaEffects.modifierInfo`
 * and applies the arithmetic the data describes, which is the mechanism that
 * data is written for. `CjsToolDogmaOperations` documents the opcodes and works the
 * CPU chain through end to end.
 *
 * ## Attributes are resolved by name, never by number
 *
 * `cpuOutput` is attribute 48 on all three current targets, and this service
 * still looks it up by name every time. Hard-coded IDs are the single most
 * likely thing to be quietly wrong on a target we did not check, and the cost
 * of resolving names is one cached pass over `dogmaAttributes`.
 *
 * ## What it deliberately does not do
 *
 * This evaluates a bare hull. Modules, charges, rigs, subsystems, implants,
 * boosters, fleet effects, heat, and stacking penalties are not applied, and a
 * modifier that would need them is reported in `unsupportedEffects` rather than
 * skipped. Anything claiming fitting parity with the game or with Pyfa needs
 * all of that first.
 */

import { CjsToolDogmaProfile } from "./CjsToolDogmaProfile.js";
import {
    ApplyModifiers,
    DogmaOperation,
    KNOWN_MODIFIER_FUNCTIONS,
    SUPPORTED_MODIFIER_FUNCTIONS
} from "./CjsToolDogmaOperations.js";

/**
 * Tables this service reads. All four exist on every target checked, and a
 * missing one is reported rather than assumed.
 */
export const DOGMA_TABLES = Object.freeze([ "types", "typeDogma", "dogmaAttributes", "dogmaEffects" ]);

/**
 * The attribute that carries a skill's trained level.
 *
 * Named because the evaluation injects the caller's level into it: a skill's
 * published `skillLevel` is 0 in the data, and every per-level bonus is
 * computed from it.
 */
export const SKILL_LEVEL_ATTRIBUTE = "skillLevel";

/**
 * The sections a caller may request, defined by attribute name.
 *
 * `fitting` is an empty hull's capacity - what the in-game Fitting panel shows
 * before anything is fitted. Sections exist so a caller asks for what it will
 * display: evaluating everything a hull has would apply modifiers nobody reads.
 */
export const DOGMA_SECTIONS = Object.freeze({
    fitting: Object.freeze([
        "cpuOutput",
        "powerOutput",
        "upgradeCapacity",
        "hiSlots",
        "medSlots",
        "lowSlots",
        "rigSlots",
        "turretSlotsLeft",
        "launcherSlotsLeft",
        "droneCapacity",
        "droneBandwidth"
    ]),
    // The three layers together, resistances included, because a hull's
    // survivability is not readable one layer at a time - and the resonances
    // are the same question as the hitpoints they protect.
    defense: Object.freeze([
        "shieldCapacity",
        "shieldRechargeRate",
        "armorHP",
        "hp",
        "shieldEmDamageResonance",
        "shieldThermalDamageResonance",
        "shieldKineticDamageResonance",
        "shieldExplosiveDamageResonance",
        "armorEmDamageResonance",
        "armorThermalDamageResonance",
        "armorKineticDamageResonance",
        "armorExplosiveDamageResonance",
        "emDamageResonance",
        "thermalDamageResonance",
        "kineticDamageResonance",
        "explosiveDamageResonance"
    ]),
    capacitor: Object.freeze([
        "capacitorCapacity",
        "rechargeRate"
    ]),
    navigation: Object.freeze([
        "maxVelocity",
        "agility",
        "warpSpeedMultiplier"
    ]),
    targeting: Object.freeze([
        "maxTargetRange",
        "maxLockedTargets",
        "signatureRadius",
        "scanResolution",
        "scanRadarStrength",
        "scanLadarStrength",
        "scanMagnetometricStrength",
        "scanGravimetricStrength"
    ]),
    drones: Object.freeze([
        "droneCapacity",
        "droneBandwidth"
    ]),
    // The published requirement pairs, for a caller that cannot use the skills
    // topic - a target with no skills service configured still has these on the
    // type. `skills/types/{id}` remains the better answer where it exists: it
    // resolves the whole closure, and these six pairs are only the first level.
    skillRequirements: Object.freeze([
        "requiredSkill1", "requiredSkill1Level",
        "requiredSkill2", "requiredSkill2Level",
        "requiredSkill3", "requiredSkill3Level",
        "requiredSkill4", "requiredSkill4Level",
        "requiredSkill5", "requiredSkill5Level",
        "requiredSkill6", "requiredSkill6Level"
    ])
});

/** The section used when a caller names none. */
export const DEFAULT_SECTIONS = Object.freeze([ "fitting" ]);

/**
 * Evaluates exact-build hull dogma attributes against an explicit skill profile
 * with modifier traces.
 */
export class CjsToolDogma
{

    #source;

    #attributesByName;

    #attributesByID;

    #effects;

    #localisation;

    /**
     * `localisation` is optional and only does anything for a source with no
     * English of its own: it names a type from a reference source by ID, with the
     * evidence for that identity attached. See `CjsToolLocalisation`.
     */
    constructor(source, { localisation = null } = {})
    {
        this.#source = source;
        this.#attributesByName = null;
        this.#attributesByID = null;
        this.#effects = new Map();
        this.#localisation = localisation;
    }

    /** Target, provider and the exact numeric build every answer was computed from. */
    Identity()
    {
        return {
            target: this.#source.target,
            provider: this.#source.provider,
            build: this.#source.build
        };
    }

    /**
     * Evaluates one type against one profile.
     *
     * Returns null when the type does not exist, so the caller can answer 404
     * rather than an empty result that looks like a hull with no statistics.
     */
    async Evaluate(typeID, profileInput = {}, options = {})
    {
        const sections = NormalizeSections(options.sections);
        const language = options.language ?? null;
        const profile = profileInput instanceof CjsToolDogmaProfile
            ? profileInput
            : CjsToolDogmaProfile.normalize(profileInput);

        const id = NormalizeTypeID(typeID);
        const type = await this.#Row("types", id);

        if (!type) return null;

        const attributes = await this.#Attributes();
        const wanted = [];

        for (const section of sections)
        {
            for (const name of DOGMA_SECTIONS[section]) wanted.push(name);
        }

        const requested = new Map();
        const unavailable = [];

        for (const name of new Set(wanted))
        {
            const attribute = attributes.byName.get(name);

            if (!attribute)
            {
                // The name is absent from this source rather than from this
                // type: a real difference between game versions, and the caller
                // needs to see it rather than read a missing key as a zero.
                unavailable.push({ attribute: name, reason: "attribute-not-in-export" });
                continue;
            }

            requested.set(attribute.attributeID, attribute);
        }

        const shipValues = await this.#TypeAttributes(id);
        const base = {};

        for (const [ attributeID, attribute ] of requested)
        {
            const published = shipValues.get(attributeID);
            const value = published ?? attribute.defaultValue ?? null;

            if (value === null)
            {
                unavailable.push({ attribute: attribute.name, reason: "no-published-value" });
                continue;
            }

            base[attribute.name] = value;
        }

        const { modifiers, unsupported } = await this.#SkillModifiers(profile, requested, attributes);
        const effective = { ...base };
        const applied = [];

        for (const [ attributeID, attribute ] of requested)
        {
            if (!(attribute.name in base)) continue;

            const forAttribute = modifiers.filter(modifier => modifier.attributeID === attributeID);

            if (!forAttribute.length) continue;

            const result = ApplyModifiers(base[attribute.name], forAttribute);

            effective[attribute.name] = result.value;
            applied.push(...result.applied);
        }

        return {
            ...this.Identity(),
            typeID: id,
            name: await ResolveName(type, id, language, this.#localisation),
            groupID: type.groupID ?? null,
            profile: profile.Describe(),
            sections,
            base,
            effective,
            applied,
            unsupportedEffects: unsupported,
            unavailableAttributes: unavailable
        };
    }

    /**
     * Every modifier the supplied skills contribute to the requested attributes.
     *
     * Two passes, because a skill's bonus is itself computed. First the skill's
     * own attributes are resolved with its level injected - that is what turns
     * `cpuOutputBonus2` from 5 into 25 at level V - and only then can the ship
     * modifier be given an amount.
     */
    async #SkillModifiers(profile, requested, attributes)
    {
        const modifiers = [];
        const unsupported = [];
        const levelAttribute = attributes.byName.get(SKILL_LEVEL_ATTRIBUTE);

        for (const skill of profile.skills)
        {
            // A level-0 skill contributes nothing by definition, and skipping it
            // early keeps a full untrained character list cheap.
            if (skill.level === 0) continue;

            const dogma = await this.#Row("typeDogma", skill.typeID);

            if (!dogma) continue;

            const self = new Map();

            for (const entry of dogma.dogmaAttributes ?? [])
            {
                self.set(Number(entry.attributeID), Number(entry.value));
            }

            if (levelAttribute) self.set(levelAttribute.attributeID, skill.level);

            const effects = [];

            for (const entry of dogma.dogmaEffects ?? [])
            {
                const effect = await this.#Effect(Number(entry.effectID));

                if (effect) effects.push(effect);
            }

            // Pass one: the skill's own attributes, in operation order.
            for (const effect of effects)
            {
                for (const modifier of effect.modifierInfo ?? [])
                {
                    if (modifier.domain !== "itemID") continue;
                    if (!SUPPORTED_MODIFIER_FUNCTIONS.includes(modifier.func)) continue;

                    const target = Number(modifier.modifiedAttributeID);
                    const amount = self.get(Number(modifier.modifyingAttributeID));
                    const operation = DogmaOperation(modifier.operation);

                    // No value for the modifying attribute means the data does
                    // not give this skill that input at all, so nothing can
                    // apply it. This is also what protects the injected
                    // level: the shared `skillEffect` would otherwise add a
                    // training-time attribute onto `skillLevel` itself.
                    if (amount === undefined || !operation) continue;

                    self.set(target, operation.apply(self.get(target) ?? 0, amount));
                }
            }

            // Pass two: what the skill does to the ship.
            for (const effect of effects)
            {
                for (const modifier of effect.modifierInfo ?? [])
                {
                    if (modifier.domain === "itemID") continue;

                    const attributeID = Number(modifier.modifiedAttributeID);
                    const attribute = requested.get(attributeID);

                    // Only a modifier aimed at something the caller asked for is
                    // interesting - the rest belong to statistics outside this
                    // request, and reporting them would drown the real ones.
                    if (!attribute) continue;

                    const reason = UnsupportedReason(modifier);

                    if (reason)
                    {
                        unsupported.push({
                            effectID: effect.effectID,
                            effect: effect.name ?? null,
                            attributeID,
                            attribute: attribute.name,
                            sourceTypeID: skill.typeID,
                            func: modifier.func ?? null,
                            domain: modifier.domain ?? null,
                            operation: modifier.operation ?? null,
                            reason
                        });
                        continue;
                    }

                    const amount = self.get(Number(modifier.modifyingAttributeID));

                    if (amount === undefined) continue;

                    modifiers.push({
                        attributeID,
                        attribute: attribute.name,
                        amount,
                        operation: modifier.operation,
                        effectID: effect.effectID,
                        effect: effect.name ?? null,
                        sourceTypeID: skill.typeID,
                        sourceLevel: skill.level
                    });
                }
            }
        }

        return { modifiers, unsupported };
    }

    /** Published attribute values for one type, by attribute ID. */
    async #TypeAttributes(typeID)
    {
        const dogma = await this.#Row("typeDogma", typeID);
        const values = new Map();

        for (const entry of dogma?.dogmaAttributes ?? [])
        {
            values.set(Number(entry.attributeID), Number(entry.value));
        }

        return values;
    }

    /**
     * The attribute catalog, by name and by ID.
     *
     * Read once per open build and held: it is a few thousand small rows, and
     * every evaluation needs the name-to-ID direction.
     */
    async #Attributes()
    {
        if (this.#attributesByName) return { byName: this.#attributesByName, byID: this.#attributesByID };

        const table = this.#source.Table("dogmaAttributes");
        const byName = new Map();
        const byID = new Map();
        let offset = 0;

        for (;;)
        {
            const page = await table.List({ limit: 1000, offset });

            if (!page.length) break;

            for (const record of page)
            {
                const row = Payload(record);
                const attributeID = Number(record.id ?? row._key);
                const entry = Object.freeze({
                    attributeID,
                    // `name` is the source's stable code name. There is no
                    // `displayName` on this table and no localisation, so a
                    // consumer wanting a pretty label must supply its own.
                    name: row.name ?? null,
                    unitID: row.unitID ?? null,
                    defaultValue: row.defaultValue ?? null,
                    highIsGood: row.highIsGood ?? null,
                    published: row.published ?? null
                });

                byID.set(attributeID, entry);
                if (entry.name) byName.set(entry.name, entry);
            }

            offset += page.length;
        }

        this.#attributesByName = byName;
        this.#attributesByID = byID;

        return { byName, byID };
    }

    /** One effect, cached, because skills share effects heavily. */
    async #Effect(effectID)
    {
        if (this.#effects.has(effectID)) return this.#effects.get(effectID);

        const row = await this.#Row("dogmaEffects", effectID);
        const effect = row
            ? Object.freeze({
                effectID,
                name: row.name ?? null,
                modifierInfo: Array.isArray(row.modifierInfo) ? row.modifierInfo : []
            })
            : null;

        this.#effects.set(effectID, effect);

        return effect;
    }

    /** One row's payload, or null. */
    async #Row(table, id)
    {
        const record = await this.#source.Table(table).Get(String(id));

        return record ? Payload(record) : null;
    }

}

/**
 * The stored row lives under `payload`; older callers handed the row itself
 * around. Reading through one helper keeps that detail in a single place.
 */
export function Payload(record)
{
    return record?.payload ?? record ?? null;
}

/**
 * Picks a language from a localised name dictionary.
 *
 * Never assumes English. Serenity and Infinity carry `zh` and no `en` at all,
 * so an `en`-only reader reports every type on them as nameless.
 */
export function ReadName(value, language = null)
{
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return { text: value, language: null };

    const languages = Object.keys(value);

    if (!languages.length) return null;

    const chosen = (language && value[language] !== undefined && language)
        || (value.en !== undefined && "en")
        || languages[0];

    return { text: value[chosen], language: chosen };
}

/**
 * A type's name, in the language asked for, falling back to English by identity.
 *
 * The fallback fires only when English was asked for and the source has none.
 * It carries `source` and `evidence` so a consumer can see that the name came
 * from the reference source rather than this one, and how that identity was
 * corroborated. `local` keeps the source's own name beside it,
 * because a rebranded item should still be displayable under its local name.
 */
export async function ResolveName(record, typeID, language, localisation)
{
    const published = ReadName(record?.name, language);

    if (!localisation || language !== "en" || published?.language === "en")
    {
        return published ? { ...published, source: "published", evidence: null } : null;
    }

    const english = await localisation.English(typeID, record);

    if (!english) return published ? { ...published, source: "published", evidence: null } : null;

    return {
        text: english.text,
        language: "en",
        source: english.source,
        evidence: english.evidence,
        ...(english.referenceBuild ? { referenceBuild: english.referenceBuild } : {}),
        local: published
    };
}

/** Why a modifier cannot be applied, or null when it can. */
function UnsupportedReason(modifier)
{
    if (!KNOWN_MODIFIER_FUNCTIONS.includes(modifier.func)) return "unknown-modifier-function";

    // The location functions modify other items in a location - the modules and
    // drones of a fitting. A bare hull has none, so the effect is real and
    // simply out of scope for this slice.
    if (!SUPPORTED_MODIFIER_FUNCTIONS.includes(modifier.func)) return "requires-fitted-items";

    if (!DogmaOperation(modifier.operation)) return "unknown-operation";

    return null;
}

/** Validates the requested sections, rejecting an unknown one at the boundary. */
export function NormalizeSections(sections)
{
    if (sections === undefined || sections === null) return [ ...DEFAULT_SECTIONS ];

    const list = Array.isArray(sections) ? sections : [ sections ];

    if (!list.length) return [ ...DEFAULT_SECTIONS ];

    const normalized = [];

    for (const section of list)
    {
        if (!Object.hasOwn(DOGMA_SECTIONS, section))
        {
            throw new TypeError(`Unknown dogma section: ${section}`);
        }

        if (!normalized.includes(section)) normalized.push(section);
    }

    return normalized;
}

/** Type IDs arrive from paths and JSON bodies alike, so both are checked here. */
export function NormalizeTypeID(value)
{
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id <= 0)
    {
        throw new TypeError(`Type ID must be a positive integer: ${value}`);
    }

    return id;
}
