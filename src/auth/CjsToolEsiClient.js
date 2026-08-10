import { CjsBoundedFetch } from "../internal/CjsBoundedFetch.js";

const ESI_ROOT = "https://esi.evetech.net";

/**
 * Authenticated ESI reads for the tools service.
 *
 * Small on purpose. It holds no validated-record cache and does no scope
 * checking, because it exists only while the SKINR endpoints are insider-gated
 * and every endpoint it calls takes "any valid token". When the gate lifts this
 * whole file goes.
 *
 * Custody is injected: the refresh token lives wherever the caller keeps it,
 * and a rotated one is handed straight back so the caller can persist it. EVE
 * rotates on every refresh, so dropping the new token strands the session.
 */
export class CjsToolEsiClient
{

    #refreshing;

    /**
     * @param {Object} options
     * @param {CjsToolEveSso} options.sso - performs the refresh
     * @param {Object} options.tokens - CjsToolTokenFile, or anything with Read/Write
     * @param {String} [options.compatibilityDate] - REQUIRED by every ESI route
     */
    constructor({
        sso,
        tokens,
        compatibilityDate = "2099-01-01",
        root = ESI_ROOT,
        fetch: fetchImplementation = globalThis.fetch,
        requestTimeoutMs = 20000,
        maxResponseBytes = 4 * 1024 * 1024,
    } = {})
    {
        if (!sso || typeof sso.Refresh !== "function")
        {
            throw new TypeError("ESI client requires an SSO client");
        }

        if (!tokens || typeof tokens.Read !== "function")
        {
            throw new TypeError("ESI client requires token custody");
        }

        this.sso = sso;
        this.tokens = tokens;
        this.compatibilityDate = String(compatibilityDate);
        this.root = String(root).replace(/\/+$/u, "");
        this.fetch = fetchImplementation;
        this.requestTimeoutMs = requestTimeoutMs;
        this.maxResponseBytes = maxResponseBytes;
        this.#refreshing = null;
    }

    /**
     * GETs an ESI path, refreshing once on a 401.
     *
     * `X-Compatibility-Date` is sent on every request because ESI requires it -
     * omitting it fails the call outright rather than degrading, so it is not a
     * caller's option.
     *
     * @param {String} path - e.g. "/cosmetics/skinr/<id>"
     * @returns {Promise<Object>}
     */
    async Get(path)
    {
        let response = await this.#Send(path, await this.#AccessToken());

        if (response.status === 401)
        {
            // One retry, on a token refreshed for this reason. A second 401
            // means the grant is gone, not that the token was stale.
            response = await this.#Send(path, await this.#AccessToken({ force: true }));
        }

        if (!response.ok)
        {
            const error = new Error(`ESI ${path} failed (${response.status})`);
            error.statusCode = response.status === 404 ? 404 : 502;
            throw error;
        }

        return CjsBoundedFetch.readJson(response, {
            label: `ESI ${path}`,
            timeoutMs: this.requestTimeoutMs,
            maxBytes: this.maxResponseBytes,
        });
    }

    #Send(path, accessToken)
    {
        return CjsBoundedFetch.request(this.fetch, `${this.root}${path}`, {
            method: "GET",
            headers: {
                accept: "application/json",
                authorization: `Bearer ${accessToken}`,
                "x-compatibility-date": this.compatibilityDate,
            },
        }, {
            label: `ESI ${path}`,
            timeoutMs: this.requestTimeoutMs,
            maxBytes: this.maxResponseBytes,
        });
    }

    /**
     * An access token, refreshing when forced.
     *
     * Refreshes are serialised: concurrent callers share one in-flight refresh
     * rather than each spending the refresh token. EVE rotates it on use, so
     * parallel refreshes would invalidate each other and the last writer would
     * win by luck.
     */
    async #AccessToken({ force = false } = {})
    {
        const stored = await this.tokens.Read();

        if (!stored?.refreshToken)
        {
            const error = new Error(
                "Not signed in to EVE. Start the service and run: npm run login",
            );
            error.statusCode = 401;
            throw error;
        }

        if (!force && stored.accessToken && stored.expiresAt > Date.now() + 30_000)
        {
            return stored.accessToken;
        }

        if (!this.#refreshing)
        {
            this.#refreshing = this.#Refresh(stored.refreshToken)
                .finally(() => { this.#refreshing = null; });
        }

        return this.#refreshing;
    }

    async #Refresh(refreshToken)
    {
        const tokens = await this.sso.Refresh(refreshToken);

        // The ROTATED refresh token replaces the old one. Keeping the old one
        // strands the session at the next refresh.
        await this.tokens.Write({
            refreshToken: tokens.refresh_token ?? refreshToken,
            accessToken: tokens.access_token,
            expiresAt: Date.now() + (Number(tokens.expires_in) || 0) * 1000,
        });

        return tokens.access_token;
    }

}
