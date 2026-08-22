const IdentityPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const GameNames = Object.freeze({
    eve: "Eve",
    frontier: "Frontier",
});

/**
 * Immutable remote-acquisition profile selected by target.
 *
 * `provider` and `game` are provenance metadata. Only `target` selects this
 * profile, its clients, endpoints, build metadata, indexes, and cache paths.
 */
export class CjsToolIndexTargetProfile
{

    #clients;

    /**
     * Creates a validated immutable target acquisition profile.
     */
    constructor(data)
    {
        if (!data || typeof data !== "object" || Array.isArray(data))
        {
            throw new TypeError("Index target profile must be an object");
        }

        this.target = normalizeIndexTargetId(data.target);
        this.game = normalizeGame(data.game ?? "Eve");
        this.gameId = this.game.toLowerCase();
        this.provider = normalizeProviderId(data.provider);
        this.label = normalizeOptionalString(data.label) ?? this.target;
        this.defaultBuildRef = normalizeBuildReference(data.defaultBuildRef ?? "latest");
        this.remote = normalizeRemote(data.remote);
        this.#clients = normalizeClients(data.clients ?? data.versions ?? {});
        this.clients = Object.freeze(Object.fromEntries(
            [...this.#clients.entries()].map(([ id, client ]) => [ id, client ]),
        ));

        Object.freeze(this);
    }

    /**
     * Resolves a target client name, metadata token, or alias.
     */
    ResolveClient(value)
    {
        const reference = normalizeBuildReference(value);

        for (const client of this.#clients.values())
        {
            if (client.references.includes(reference))
            {
                return client;
            }
        }

        return null;
    }

    /**
     * Serializes the profile without its private lookup map.
     */
    toJSON()
    {
        return {
            target: this.target,
            game: this.game,
            provider: this.provider,
            label: this.label,
            defaultBuildRef: this.defaultBuildRef,
            remote: this.remote,
            clients: Object.fromEntries(
                Object.entries(this.clients).map(([ id, client ]) => [
                    id,
                    {
                        metadataToken: client.metadataToken,
                        localFolder: client.localFolder,
                    },
                ]),
            ),
        };
    }

    /**
     * Normalizes an existing profile or target-profile-shaped object.
     */
    static from(value)
    {
        return value instanceof this ? value : new this(value);
    }

}

/**
 * Normalizes a numeric or friendly build reference.
 */
export function normalizeBuildReference(value)
{
    if (typeof value !== "string" && typeof value !== "number")
    {
        throw new TypeError("Build reference must be a string or number");
    }

    const reference = String(value).trim().toLowerCase();

    if (!reference || reference.includes("/") || reference.includes("\\"))
    {
        throw new TypeError(`Invalid build reference: ${value}`);
    }

    return reference;
}

/**
 * Normalizes a supported game classification to its public name.
 */
export function normalizeGame(value)
{
    const gameId = normalizeOptionalString(value)?.toLowerCase();
    const game = GameNames[gameId];

    if (!game)
    {
        throw new TypeError(`Invalid game: ${value}`);
    }

    return game;
}

/**
 * Normalizes a provider id used within one game.
 */
export function normalizeProviderId(value)
{
    const id = normalizeOptionalString(value)?.toLowerCase();

    if (!id || !IdentityPattern.test(id))
    {
        throw new TypeError(`Invalid provider id: ${value}`);
    }

    return id;
}

/** Normalizes the unique identity used to select an acquisition profile. */
export function normalizeIndexTargetId(value)
{
    const id = normalizeOptionalString(value)?.toLowerCase();

    if (!id || !IdentityPattern.test(id))
    {
        throw new TypeError(`Invalid index target id: ${value}`);
    }

    return id;
}

function normalizeRemote(value)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError("Index target remote configuration must be an object");
    }

    return Object.freeze({
        metadataBaseUrl: normalizeRemoteUrl(value.metadataBaseUrl, "metadataBaseUrl"),
        indexBaseUrl: normalizeRemoteUrl(value.indexBaseUrl, "indexBaseUrl"),
        appBaseUrl: normalizeRemoteUrl(value.appBaseUrl, "appBaseUrl"),
        resBaseUrl: normalizeRemoteUrl(value.resBaseUrl, "resBaseUrl"),
    });
}

function normalizeRemoteUrl(value, name)
{
    const text = normalizeOptionalString(value);

    if (!text)
    {
        throw new TypeError(`Index target remote.${name} is required`);
    }

    const url = new URL(text);

    if (url.protocol !== "https:" && url.protocol !== "http:")
    {
        throw new TypeError(`Index target remote.${name} must use HTTP(S)`);
    }

    return url.toString().replace(/\/$/u, "");
}

function normalizeClients(value)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError("Index target clients must be an object");
    }

    const clients = new Map();

    for (const [ rawId, rawClient ] of Object.entries(value))
    {
        const id = normalizeProviderId(rawId);

        if (!rawClient || typeof rawClient !== "object" || Array.isArray(rawClient))
        {
            throw new TypeError(`Target client ${id} must be an object`);
        }

        const metadataToken = normalizeOptionalString(rawClient.metadataToken);

        if (!metadataToken)
        {
            throw new TypeError(`Target client ${id} requires metadataToken`);
        }

        // The folder this client installs into, under whatever root the
        // launcher was pointed at: `<clientRoot>/tq/`, `<clientRoot>/sisi/`.
        // That is where its `resfileindex.txt` sits, so anything reading an
        // installed client rather than downloading from the CDN needs it.
        //
        // Derived from the metadata token, because in every case anyone here
        // has installed it *is* the token in lower case: TQ/tq, SISI/sisi,
        // STILLNESS/stillness. That equivalence is also why the field this
        // replaces was inert — it was declared as `aliases: ["tq"]`, extra
        // spellings of the client name, while `references` already derived
        // `tq` from the token. The same fact stated twice from two sides, so
        // the list resolved nothing that would not resolve without it.
        //
        // Overridable, not assumed. Three cases are not a rule, the tokens are
        // already case-sensitive in a way nothing predicts, and a wrong folder
        // reads an installation that is not there. A client that breaks the
        // convention says so here and costs one line.
        const localFolder = normalizeOptionalString(rawClient.localFolder)
            ?? metadataToken.toLowerCase();
        const references = Object.freeze([...new Set([
            id,
            metadataToken.toLowerCase(),
            ...(localFolder ? [ normalizeBuildReference(localFolder) ] : []),
        ])]);

        clients.set(id, Object.freeze({
            id,
            metadataToken,
            localFolder,
            references,
        }));
    }

    return clients;
}

function normalizeOptionalString(value)
{
    if (value === undefined || value === null)
    {
        return null;
    }

    if (typeof value !== "string")
    {
        throw new TypeError("Expected a string");
    }

    const result = value.trim();

    return result || null;
}
