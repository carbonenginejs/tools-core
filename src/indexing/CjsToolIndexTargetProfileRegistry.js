import { DefaultIndexProfileData } from "./defaultIndexProfiles.js";
import { CjsToolIndexTargetProfile, normalizeIndexTargetId } from "./CjsToolIndexTargetProfile.js";

/**
 * Immutable registry of target-keyed remote acquisition profiles.
 */
export class CjsToolIndexTargetProfileRegistry
{

    #profiles;

    /**
     * Creates an immutable registry from target-profile-shaped values.
     */
    constructor(profiles = DefaultIndexProfileData)
    {
        this.#profiles = new Map();

        for (const value of profiles)
        {
            const profile = CjsToolIndexTargetProfile.from(value);

            if (this.#profiles.has(profile.target))
            {
                throw new TypeError(`Duplicate index target profile: ${profile.target}`);
            }

            this.#profiles.set(profile.target, profile);
        }

        if (this.#profiles.size === 0)
        {
            throw new TypeError("Index target profile registry requires at least one profile");
        }

        this.defaultTarget = this.#profiles.keys().next().value;
        Object.freeze(this);
    }

    /**
     * Gets an acquisition profile by its unique target identity.
     */
    Get(target = this.defaultTarget)
    {
        const targetId = normalizeIndexTargetId(target);
        const profile = this.#profiles.get(targetId);

        if (!profile)
        {
            throw new Error(`Index target profile not found: ${targetId}`);
        }

        return profile;
    }

    /**
     * Checks whether a target acquisition profile is registered.
     */
    Has(target)
    {
        return this.#profiles.has(normalizeIndexTargetId(target));
    }

    /**
     * Lists profiles in deterministic registration order.
     */
    List()
    {
        return Object.freeze([...this.#profiles.values()]);
    }

}
