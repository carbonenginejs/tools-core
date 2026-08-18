/**
 * A skill profile: the supplied half of a Dogma evaluation.
 *
 * ## The three modes are provenance, not arithmetic
 *
 * `none`, `manual` and `automatic` produce identical numbers for identical
 * skill maps - deliberately, and there is a test holding that line. The mode
 * exists so a consumer can say *where the skills came from*:
 *
 * - `none` - nothing was supplied; every skill evaluates at level 0.
 * - `manual` - a user picked the levels, or loaded a preset. An all-V preset is
 *   a manual profile, not a fourth mode.
 * - `automatic` - an application backend authorized a character and read their
 *   real levels.
 *
 * That distinction is the whole reason the mode travels with the profile rather
 * than being inferred. A failed automatic lookup must never arrive here as
 * `none`: it would compute a correct zero-skill answer and display it as the
 * pilot's own, which is a lie the numbers cannot reveal. tools-core cannot
 * enforce that - it never learns who the viewer is - so it preserves the mode
 * exactly as given and echoes it back in the result.
 *
 * ## Identity, and why the character is absent
 *
 * A character ID is not part of this record and must not be added. Two pilots
 * with the same relevant skills produce the same statistics, so identity would
 * only fragment the cache and drag a personal identifier into a deterministic,
 * cacheable computation. The `skillHash` below is the cache identity: it is
 * derived from the normalized levels alone.
 */

import { createHash } from "node:crypto";

/** The provenance states a profile may declare. */
export const PROFILE_MODES = Object.freeze([ "none", "manual", "automatic" ]);

/** EVE trains skills from level 0 to level 5 inclusive. */
export const MAX_SKILL_LEVEL = 5;

/**
 * How many skills one request may carry.
 *
 * A full character has roughly 400 trained skills and the data defines about
 * 500, so this is generous by design while still refusing a payload built to
 * exhaust memory.
 */
export const MAX_PROFILE_SKILLS = 1000;

export class CjsToolDogmaProfile
{

    /**
     * Normalizes and validates a supplied profile.
     *
     * Rejects rather than repairs: a duplicated skill ID or a level of 7 means
     * the caller's model is wrong, and silently keeping the last value would
     * hide that behind a plausible number.
     */
    static normalize(input = {})
    {
        const mode = input?.mode ?? "none";

        if (!PROFILE_MODES.includes(mode))
        {
            throw new TypeError(`Dogma profile mode must be one of ${PROFILE_MODES.join(", ")}`);
        }

        const supplied = input?.skills ?? [];

        if (!Array.isArray(supplied))
        {
            throw new TypeError("Dogma profile skills must be an array");
        }

        if (supplied.length > MAX_PROFILE_SKILLS)
        {
            throw new TypeError(`Dogma profile carries more than ${MAX_PROFILE_SKILLS} skills`);
        }

        // `none` is defined as "every skill at zero", so carrying levels with it
        // is a contradiction rather than extra information.
        if (mode === "none" && supplied.length)
        {
            throw new TypeError("Dogma profile mode none must not supply skills");
        }

        const seen = new Set();
        const skills = [];

        for (const entry of supplied)
        {
            const typeID = Number(entry?.typeID);
            const level = Number(entry?.level);

            if (!Number.isSafeInteger(typeID) || typeID <= 0)
            {
                throw new TypeError(`Dogma profile skill typeID is not a positive integer: ${entry?.typeID}`);
            }

            if (!Number.isInteger(level) || level < 0 || level > MAX_SKILL_LEVEL)
            {
                throw new TypeError(`Dogma profile skill level must be an integer 0-${MAX_SKILL_LEVEL}: ${entry?.level}`);
            }

            if (seen.has(typeID))
            {
                throw new TypeError(`Dogma profile repeats skill typeID ${typeID}`);
            }

            seen.add(typeID);
            skills.push({ typeID, level });
        }

        // Sorted so that the same set of skills hashes identically however the
        // caller happened to order them - the cache key depends on it.
        skills.sort((left, right) => left.typeID - right.typeID);

        return new CjsToolDogmaProfile(mode, skills);
    }

    constructor(mode, skills)
    {
        this.mode = mode;
        this.skills = Object.freeze(skills.map(skill => Object.freeze({ ...skill })));
        this.skillHash = HashSkills(this.skills);
        Object.freeze(this);
    }

    /** Levels by skill type, for the evaluator to look up. */
    Levels()
    {
        return new Map(this.skills.map(skill => [ skill.typeID, skill.level ]));
    }

    /** The provenance half, for echoing back in a result. */
    Describe()
    {
        return { mode: this.mode, skillCount: this.skills.length, skillHash: this.skillHash };
    }

}

/**
 * A stable short hash of the normalized levels.
 *
 * Level-0 skills are dropped first: supplying a skill at zero is exactly the
 * same evaluation as not supplying it, so a client that sends a character's
 * full untrained list must not miss the cache that a client sending only
 * trained skills would hit.
 */
function HashSkills(skills)
{
    const trained = skills.filter(skill => skill.level > 0);

    if (!trained.length) return "none";

    const canonical = trained.map(skill => `${skill.typeID}:${skill.level}`).join(",");

    return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
