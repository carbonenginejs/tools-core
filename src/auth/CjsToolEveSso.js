import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const AUTHORIZE_URL = "https://login.eveonline.com/v2/oauth/authorize";
const TOKEN_URL = "https://login.eveonline.com/v2/oauth/token";

/** Base64url, which the OAuth PKCE parameters require over plain base64. */
function base64url(buffer)
{
    return buffer.toString("base64")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_")
        .replace(/=+$/u, "");
}

/**
 * EVE SSO OAuth v2, authorization code with PKCE.
 *
 * A PUBLIC client: there is no client secret, which is what makes it safe to
 * run locally at all. The proof is the code verifier - a fresh random string
 * per login whose SHA-256 goes out in the authorize URL and whose plaintext is
 * only ever sent on the token exchange. An attacker who intercepts the
 * redirect gets a code they cannot spend.
 *
 * This is the shared service half. It holds NO tokens and does NO storage:
 * pending logins live here only until they are consumed, so a caller cannot
 * accidentally persist a verifier. Token custody belongs to the caller.
 */
export class CjsToolEveSso
{

    #pending = new Map();

    /**
     * @param {Object} options
     * @param {String} options.clientId - from the EVE developers application
     * @param {String} options.callback - must match the registered redirect exactly
     * @param {Array<String>} [options.scopes]
     * @param {Number} [options.pendingTtlMs] - how long an unfinished login lives
     */
    constructor({ clientId, callback, scopes = [], pendingTtlMs = 10 * 60 * 1000 } = {})
    {
        if (!clientId) throw new TypeError("EVE SSO requires a clientId");
        if (!callback) throw new TypeError("EVE SSO requires a callback url");

        this.clientId = String(clientId);
        this.callback = String(callback);
        this.scopes = [ ...scopes ];
        this.pendingTtlMs = pendingTtlMs;
    }

    /**
     * Starts a login and remembers the state/verifier pair until it is claimed.
     *
     * The verifier is deliberately NOT returned: handing it back invites a
     * caller to put it in a cookie or a log, and nothing outside this object
     * needs it. The callback leg claims it by state.
     *
     * @param {Number} now - epoch ms, passed in so expiry is testable
     * @returns {{url: String, state: String}}
     */
    BeginLogin(now = Date.now())
    {
        this.#Sweep(now);

        const state = base64url(randomBytes(24));
        const codeVerifier = base64url(randomBytes(32));
        const challenge = base64url(createHash("sha256").update(codeVerifier).digest());

        const url = new URL(AUTHORIZE_URL);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("redirect_uri", this.callback);
        url.searchParams.set("client_id", this.clientId);
        url.searchParams.set("state", state);
        url.searchParams.set("code_challenge", challenge);
        url.searchParams.set("code_challenge_method", "S256");
        if (this.scopes.length) url.searchParams.set("scope", this.scopes.join(" "));

        this.#pending.set(state, { codeVerifier, expiresAt: now + this.pendingTtlMs });

        return { url: url.toString(), state };
    }

    /**
     * Claims a pending login by state, exactly once.
     *
     * Single use and constant-time compared. A replayed state is the shape a
     * CSRF attempt takes here, and returning the verifier twice would let a
     * second code be spent against the first login.
     *
     * @param {String} state
     * @param {Number} now
     * @returns {String} the code verifier
     */
    ClaimLogin(state, now = Date.now())
    {
        this.#Sweep(now);

        const candidate = String(state ?? "");
        let found = null;

        for (const [ key, value ] of this.#pending)
        {
            if (Equal(key, candidate)) { found = [ key, value ]; break; }
        }

        if (!found) throw new TypeError("Unknown or expired SSO login state");

        this.#pending.delete(found[0]);

        return found[1].codeVerifier;
    }

    /**
     * Completes a login: claims the state, then exchanges the code.
     * @param {Object} query - the callback's query parameters
     * @returns {Promise<Object>} the raw token response
     */
    async CompleteLogin({ code, state } = {}, now = Date.now())
    {
        if (!code) throw new TypeError("SSO callback requires a code");

        const codeVerifier = this.ClaimLogin(state, now);

        return this.#TokenRequest({
            grant_type: "authorization_code",
            code,
            code_verifier: codeVerifier,
            client_id: this.clientId,
        });
    }

    /**
     * Exchanges a refresh token. EVE rotates refresh tokens, so the response's
     * refresh_token replaces the one sent - storing the old one strands the
     * session at the next refresh.
     * @param {String} refreshToken
     * @returns {Promise<Object>}
     */
    async Refresh(refreshToken)
    {
        if (!refreshToken) throw new TypeError("SSO refresh requires a refresh token");

        return this.#TokenRequest({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: this.clientId,
        });
    }

    #Sweep(now)
    {
        for (const [ key, value ] of this.#pending)
        {
            if (value.expiresAt <= now) this.#pending.delete(key);
        }
    }

    /** Pending logins awaiting their callback. Diagnostics only - never the values. */
    get pendingCount()
    {
        return this.#pending.size;
    }

    async #TokenRequest(params)
    {
        const response = await fetch(TOKEN_URL, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                host: "login.eveonline.com",
            },
            body: new URLSearchParams(params).toString(),
        });

        if (!response.ok)
        {
            const body = await response.text().catch(() => "");

            // The body can echo request parameters, so it is truncated and the
            // grant type is named rather than the parameters themselves.
            throw new Error(
                `EVE SSO ${params.grant_type} failed (${response.status}): ${body.slice(0, 200)}`,
            );
        }

        return response.json();
    }

}

/** Constant-time string comparison that tolerates differing lengths. */
function Equal(left, right)
{
    const a = Buffer.from(String(left));
    const b = Buffer.from(String(right));

    if (a.length !== b.length) return false;

    return timingSafeEqual(a, b);
}
