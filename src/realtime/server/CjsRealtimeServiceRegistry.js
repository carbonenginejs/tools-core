import { CjsRealtimeProtocol } from "../CjsRealtimeProtocol.js";

/** Registers independently authored realtime services before host startup. */
export class CjsRealtimeServiceRegistry
{

    #entries;

    #sealed;

    constructor()
    {
        this.#entries = new Map();
        this.#sealed = false;
    }

    /** Registers one structural realtime service. */
    Register(service)
    {
        if (this.#sealed)
        {
            throw new Error("Realtime service registry is sealed");
        }

        if (!service || typeof service.Describe !== "function"
            || typeof service.Start !== "function" || typeof service.Stop !== "function")
        {
            throw new TypeError(
                "Realtime services require Describe(), Start(context), and Stop()",
            );
        }

        const description = CjsRealtimeProtocol.normalizeServiceDescription(service.Describe());

        if (this.#entries.has(description.id))
        {
            throw new Error(`Realtime service is already registered: ${description.id}`);
        }

        if (description.snapshot && typeof service.GetSnapshot !== "function")
        {
            throw new TypeError(`Realtime service ${description.id} advertises no GetSnapshot()`);
        }

        if (description.resources && typeof service.OpenResource !== "function")
        {
            throw new TypeError(`Realtime service ${description.id} advertises no OpenResource()`);
        }

        if (description.commands.length && typeof service.HandleCommand !== "function")
        {
            throw new TypeError(`Realtime service ${description.id} advertises no HandleCommand()`);
        }

        const entry = Object.freeze({ service, description });

        this.#entries.set(description.id, entry);

        return description;
    }

    /** Prevents registration changes after host startup begins. */
    Seal()
    {
        this.#sealed = true;
    }

    /** Returns one registered service entry. */
    Get(serviceId)
    {
        return this.#entries.get(serviceId) ?? null;
    }

    /** Lists registered entries in deterministic service-ID order. */
    List()
    {
        return [ ...this.#entries.values() ]
            .sort((left, right) => left.description.id.localeCompare(right.description.id));
    }

}
