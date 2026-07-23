import { CjsRealtimeError } from "../../realtime/CjsRealtimeError.js";
import { CjsBoundedFetch } from "../../internal/CjsBoundedFetch.js";

/** Validates externally acquired Twitch user tokens and serializes optional refresh. */
export class CjsTwitchOAuthTokenProvider
{

    #acquiring;

    #clientId;

    #clock;

    #fetch;

    #getAccessToken;

    #maxResponseBytes;

    #record;

    #refreshAccessToken;

    #requestTimeoutMs;

    #validationIntervalMs;

    constructor({
        clientId,
        getAccessToken,
        refreshAccessToken = null,
        fetch: fetchImplementation = globalThis.fetch,
        clock = () => Date.now(),
        validationIntervalMs = 60 * 60 * 1000,
        requestTimeoutMs = 10000,
        maxResponseBytes = 64 * 1024,
    } = {})
    {
        if (typeof clientId !== "string" || clientId.length === 0)
        {
            throw new TypeError("Twitch OAuth provider requires a clientId");
        }

        if (typeof getAccessToken !== "function")
        {
            throw new TypeError("Twitch OAuth provider requires getAccessToken()");
        }

        if (refreshAccessToken !== null && typeof refreshAccessToken !== "function")
        {
            throw new TypeError("Twitch OAuth refreshAccessToken must be a function");
        }

        if (typeof fetchImplementation !== "function" || typeof clock !== "function")
        {
            throw new TypeError("Twitch OAuth fetch and clock options must be functions");
        }

        if (!Number.isSafeInteger(validationIntervalMs) || validationIntervalMs < 1000
            || validationIntervalMs > 60 * 60 * 1000)
        {
            throw new TypeError(
                "Twitch OAuth validationIntervalMs must be between 1000 and one hour",
            );
        }

        CjsBoundedFetch.normalizeLimit(requestTimeoutMs, "requestTimeoutMs");
        CjsBoundedFetch.normalizeLimit(maxResponseBytes, "maxResponseBytes");

        this.#clientId = clientId;
        this.#getAccessToken = getAccessToken;
        this.#refreshAccessToken = refreshAccessToken;
        this.#fetch = fetchImplementation;
        this.#clock = clock;
        this.#validationIntervalMs = validationIntervalMs;
        this.#requestTimeoutMs = requestTimeoutMs;
        this.#maxResponseBytes = maxResponseBytes;
        this.#record = null;
        this.#acquiring = null;
        Object.freeze(this);
    }

    /** Returns one currently validated user token with the required Twitch scopes. */
    async Acquire({ requiredScopes = [], expectedUserId = null, force = false } = {})
    {
        const scopes = CjsTwitchOAuthTokenProvider.normalizeScopes(requiredScopes);
        const cached = this.#record;

        if (!force && cached && this.#clock() < cached.validateAfter)
        {
            CjsTwitchOAuthTokenProvider.requireIdentity(cached, scopes, expectedUserId);

            return cached;
        }

        if (!this.#acquiring)
        {
            const operation = CjsBoundedFetch.run(
                signal => this.#Acquire(signal),
                {
                    timeoutMs: this.#requestTimeoutMs,
                    label: "Twitch token acquisition",
                },
            ).catch(error =>
            {
                if (error instanceof CjsRealtimeError)
                {
                    throw error;
                }

                throw new CjsRealtimeError(
                    "twitch_unavailable",
                    "Twitch token validation is unavailable",
                    { retryable: true, cause: error },
                );
            });

            this.#acquiring = operation;
            operation.then(
                () =>
                {
                    if (this.#acquiring === operation)
                    {
                        this.#acquiring = null;
                    }
                },
                () =>
                {
                    if (this.#acquiring === operation)
                    {
                        this.#acquiring = null;
                    }
                },
            );
        }

        const record = await this.#acquiring;

        CjsTwitchOAuthTokenProvider.requireIdentity(record, scopes, expectedUserId);

        return record;
    }

    /** Invalidates the cached validation before a reactive 401 retry. */
    Invalidate()
    {
        this.#record = null;
    }

    async #Acquire(signal)
    {
        let accessToken;

        try
        {
            accessToken = CjsTwitchOAuthTokenProvider.normalizeToken(
                await this.#getAccessToken(),
            );
        }
        catch (error)
        {
            if (error instanceof CjsRealtimeError)
            {
                throw error;
            }

            throw new CjsRealtimeError(
                "twitch_unauthorized",
                "Twitch authorization is not available",
                { cause: error },
            );
        }

        CjsBoundedFetch.requireActive(signal, "Twitch token acquisition");

        let response = await this.#Validate(accessToken, signal);

        if (response.status === 401 && this.#refreshAccessToken)
        {
            try
            {
                accessToken = CjsTwitchOAuthTokenProvider.normalizeToken(
                    await this.#refreshAccessToken({
                        clientId: this.#clientId,
                        accessToken,
                    }),
                );
            }
            catch (error)
            {
                throw new CjsRealtimeError(
                    "twitch_unauthorized",
                    "Twitch authorization could not be refreshed",
                    { cause: error },
                );
            }

            CjsBoundedFetch.requireActive(signal, "Twitch token refresh");

            response = await this.#Validate(accessToken, signal);
        }

        if (!response.ok)
        {
            throw new CjsRealtimeError(
                response.status === 401 ? "twitch_unauthorized" : "twitch_unavailable",
                response.status === 401
                    ? "Twitch authorization is no longer valid"
                    : "Twitch token validation is unavailable",
                { retryable: response.status !== 401 },
            );
        }

        let value;

        try
        {
            value = await CjsBoundedFetch.readJson(response, {
                maxBytes: this.#maxResponseBytes,
                label: "Twitch token validation response",
                signal,
            });
        }
        catch
        {
            throw new CjsRealtimeError(
                "twitch_invalid_response",
                "Twitch token validation returned an invalid response",
                { retryable: true },
            );
        }

        if (value?.client_id !== this.#clientId || typeof value.user_id !== "string"
            || value.user_id.length === 0 || typeof value.login !== "string"
            || !Array.isArray(value.scopes) || !Number.isSafeInteger(value.expires_in)
            || value.expires_in <= 0)
        {
            throw new CjsRealtimeError(
                "twitch_unauthorized",
                "Twitch authorization identity does not match this application",
            );
        }

        const validatedAt = this.#clock();

        this.#record = Object.freeze({
            accessToken,
            clientId: this.#clientId,
            userId: value.user_id,
            login: value.login.toLowerCase(),
            scopes: Object.freeze([ ...new Set(value.scopes) ].sort()),
            expiresIn: value.expires_in,
            validatedAt,
            validateAfter: validatedAt + Math.min(
                this.#validationIntervalMs,
                Math.max(1000, value.expires_in * 1000),
            ),
        });

        return this.#record;
    }

    async #Validate(accessToken, signal)
    {
        try
        {
            const response = await this.#fetch("https://id.twitch.tv/oauth2/validate", {
                method: "GET",
                headers: { authorization: `OAuth ${accessToken}` },
                signal,
            });

            if (!response || !Number.isSafeInteger(response.status))
            {
                throw new TypeError("Twitch OAuth fetch returned an invalid response");
            }

            return response;
        }
        catch
        {
            throw new CjsRealtimeError(
                "twitch_unavailable",
                "Twitch token validation is unavailable",
                { retryable: true },
            );
        }
    }

    /** Validates a callback-supplied access token without reflecting it. */
    static normalizeToken(value)
    {
        const source = typeof value === "string" ? value : value?.accessToken;
        const token = typeof source === "string"
            ? source.replace(/^oauth:/iu, "")
            : null;

        if (typeof token !== "string" || token.length < 8 || /\s/u.test(token))
        {
            throw new CjsRealtimeError(
                "twitch_unauthorized",
                "Twitch authorization is not available",
            );
        }

        return token;
    }

    /** Normalizes the provider-specific scope requirement. */
    static normalizeScopes(value)
    {
        if (!Array.isArray(value) || value.some(scope =>
            typeof scope !== "string" || scope.length === 0))
        {
            throw new TypeError("Twitch OAuth requiredScopes must be a string array");
        }

        return Object.freeze([ ...new Set(value) ].sort());
    }

    /** Requires the validated token to match identity and scope policy. */
    static requireIdentity(record, requiredScopes, expectedUserId)
    {
        if (expectedUserId !== null && record.userId !== expectedUserId)
        {
            throw new CjsRealtimeError(
                "twitch_unauthorized",
                "Twitch authorization user does not match the configured identity",
            );
        }

        if (!requiredScopes.every(scope => record.scopes.includes(scope)))
        {
            throw new CjsRealtimeError(
                "twitch_scope_required",
                "Twitch authorization is missing a required scope",
            );
        }
    }

}
