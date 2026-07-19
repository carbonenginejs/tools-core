import { DefaultProviderData } from "./defaultProviders.js";
import { CjsIndexProvider } from "./CjsIndexProvider.js";

/**
 * Immutable registry of remote provider profiles.
 */
export class CjsIndexProviderRegistry
{

    #providers;

    /**
     * Creates an immutable registry from provider-shaped values.
     */
    constructor(providers = DefaultProviderData)
    {
        this.#providers = new Map();

        for (const value of providers)
        {
            const provider = CjsIndexProvider.from(value);

            const key = getProviderKey(provider.game, provider.id);

            if (this.#providers.has(key))
            {
                throw new TypeError(`Duplicate provider: ${provider.game}/${provider.id}`);
            }

            this.#providers.set(key, provider);
        }

        if (this.#providers.size === 0)
        {
            throw new TypeError("Provider registry requires at least one provider");
        }

        const defaultProfile = this.#providers.values().next().value;

        this.defaultGame = defaultProfile.game;
        this.defaultProvider = defaultProfile.id;
        Object.freeze(this);
    }

    /**
     * Gets a provider by id or throws when it is not registered.
     */
    Get(id = this.defaultProvider, game = this.defaultGame)
    {
        const providerId = String(id ?? "").trim().toLowerCase();
        const provider = this.#providers.get(getProviderKey(game, providerId));

        if (!provider)
        {
            throw new Error(`Provider not found: ${game}/${providerId}`);
        }

        return provider;
    }

    /**
     * Checks whether a provider id is registered.
     */
    Has(id, game = this.defaultGame)
    {
        return this.#providers.has(getProviderKey(game, id));
    }

    /**
     * Lists providers in deterministic registration order.
     */
    List()
    {
        return Object.freeze([...this.#providers.values()]);
    }

}

function getProviderKey(game, provider)
{
    return `${String(game ?? "").trim().toLowerCase()}:${String(provider ?? "").trim().toLowerCase()}`;
}
