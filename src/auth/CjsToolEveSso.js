import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { CjsToolBoundedFetch } from "../internal/CjsToolBoundedFetch.js";

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
    constructor({
        clientId,
        callback,
        scopes = [],
        pendingTtlMs = 10 * 60 * 1000,
        fetch: fetchImplementation = globalThis.fetch,
        requestTimeoutMs = 10000,
        maxResponseBytes = 64 * 1024,
    } = {})
    {
        if (!clientId) throw new TypeError("EVE SSO requires a clientId");
        if (!callback) throw new TypeError("EVE SSO requires a callback url");

        if (typeof fetchImplementation !== "function")
        {
            throw new TypeError("EVE SSO fetch option must be a function");
        }

        CjsToolBoundedFetch.normalizeLimit(requestTimeoutMs, "requestTimeoutMs");
        CjsToolBoundedFetch.normalizeLimit(maxResponseBytes, "maxResponseBytes");

        this.clientId = String(clientId);
        this.callback = String(callback);
        this.scopes = [ ...scopes ];
        this.pendingTtlMs = pendingTtlMs;
        this.fetch = fetchImplementation;
        this.requestTimeoutMs = requestTimeoutMs;
        this.maxResponseBytes = maxResponseBytes;
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
     * Reads the character out of an EVE access token.
     *
     * The token is a JWT and its `sub` claim is `CHARACTER:EVE:<id>`. The
     * signature is deliberately NOT verified, and that is safe here for a
     * specific reason rather than by convenience: nothing downstream makes a
     * trust decision on this value. It labels the operator's own session and
     * fills the `character_id` path parameter of a call that ESI authorises
     * against the bearer token itself - a wrong id gets a 403, never somebody
     * else's data. The token also arrives over TLS from the token endpoint, so
     * it is not attacker-supplied in the first place.
     *
     * Verifying it properly would mean fetching and rotating EVE's JWKS, which
     * buys nothing given the above.
     *
     * @param {String} accessToken
     * @returns {{characterId: Number, characterName: String, scopes: Array<String>}|null}
     *   null when the token is not a JWT or carries no character
     */
    static describeToken(accessToken)
    {
        const payload = String(accessToken ?? "").split(".")[1];

        if (!payload) return null;

        let claims;

        try
        {
            claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        }
        catch
        {
            // A token we cannot read is not an error: identity is a label, and
            // every call still works without it.
            return null;
        }

        const subject = /^CHARACTER:EVE:(\d+)$/u.exec(String(claims?.sub ?? ""));

        if (!subject) return null;

        return {
            characterId: Number(subject[1]),
            characterName: typeof claims.name === "string" ? claims.name : null,
            // What the grant actually covers. EVE puts it in `scp`, as a string
            // for a single scope and an array for several. Capturing it is what
            // lets a route answer "this token has no fittings access" without
            // calling ESI and reading a 403 back - the difference between
            // telling the operator to authorize again and telling them the
            // service is broken.
            scopes: ReadScopes(claims.scp),
        };
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

    /**
     * Bounded, like every other outbound call in this package: a token endpoint
     * that hangs must not hang the service, and a response that grows must not
     * be buffered. An unbounded read here is worse than most - the caller is
     * usually a login the operator is waiting on.
     */
    async #TokenRequest(params)
    {
        const limits = {
            label: `EVE SSO ${params.grant_type}`,
            timeoutMs: this.requestTimeoutMs,
            maxBytes: this.maxResponseBytes,
        };

        const response = await CjsToolBoundedFetch.request(this.fetch, TOKEN_URL, {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                host: "login.eveonline.com",
            },
            body: new URLSearchParams(params).toString(),
        }, limits);

        if (!response.ok)
        {
            // The failure body can echo request parameters, so nothing from it
            // is interpolated: the grant type and status say what failed, and
            // the code, verifier and refresh token stay out of the message and
            // therefore out of the logs.
            throw new Error(`EVE SSO ${params.grant_type} failed (${response.status})`);
        }

        return CjsToolBoundedFetch.readJson(response, limits);
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

/**
 * The scopes a token was granted.
 *
 * EVE writes `scp` as a bare string when one scope was granted and as an array
 * when several were, so a reader that assumes either shape is wrong half the
 * time. An absent claim yields an empty list, which reads as "granted nothing"
 * - correct for a token issued with no scopes at all, which is what tools-core
 * has used until now.
 */
function ReadScopes(claim)
{
    if (Array.isArray(claim)) return claim.map(entry => String(entry));
    if (typeof claim === "string" && claim) return [ claim ];

    return [];
}
