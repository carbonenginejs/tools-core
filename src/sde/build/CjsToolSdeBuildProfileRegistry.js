import { CjsToolSdeBuildProfile } from "./CjsToolSdeBuildProfile.js";
import { DefaultSdeBuildProfileData } from "./defaultSdeBuildProfiles.js";

/** Target-keyed registry of SDE source and output profiles. */
export class CjsToolSdeBuildProfileRegistry
{

    #profiles;

    /**
     * Creates a SDE build sde build profile registry from caller-supplied
     * configuration.
     */
    constructor(values = DefaultSdeBuildProfileData)
    {
        this.#profiles = new Map();

        for (const value of values)
        {
            const profile = CjsToolSdeBuildProfile.from(value);

            if (this.#profiles.has(profile.target))
            {
                throw new TypeError(`Duplicate SDE build profile: ${profile.target}`);
            }

            this.#profiles.set(profile.target, profile);
        }

        if (!this.#profiles.size)
        {
            throw new TypeError("SDE build profile registry requires at least one profile");
        }

        this.defaultTarget = this.#profiles.keys().next().value;
        Object.freeze(this);
    }

    /** Returns the registered item for one canonical identifier. */
    Get(target = this.defaultTarget)
    {
        const name = String(target ?? "").trim().toLowerCase();
        const profile = this.#profiles.get(name);

        if (!profile)
        {
            const error = new Error(`SDE build profile not found: ${name}`);

            error.statusCode = 404;
            throw error;
        }

        return profile;
    }

    /** Reports whether one canonical identifier is registered. */
    Has(target)
    {
        return this.#profiles.has(String(target ?? "").trim().toLowerCase());
    }

    /** Returns registered items in deterministic declaration order. */
    List()
    {
        return Object.freeze([ ...this.#profiles.values() ]);
    }

}
