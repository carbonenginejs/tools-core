import { CjsBoundedFetch } from "../internal/CjsBoundedFetch.js";

import { ESI_COMPATIBILITY_DATE } from "../auth/CjsEsiCompatibilityDate.js";

const ESI_ROOT = "https://esi.evetech.net";

/**
 * ESI reads that carry no token, for the routes that need none.
 *
 * `/characters/{id}`, `/corporations/{id}` and `/alliances/{id}` are public.
 * `CjsToolPublicIdentity` says so in its own header — "this can answer for a
 * logged-out visitor" — and then could not, because the only ESI client here
 * sends a bearer and refuses to work without a stored refresh token. A
 * deployment with no login therefore answered `501 No identity service
 * configured` and every character on the page read UNKNOWN CAPSULEER.
 *
 * So this is the same `Get(path)` shape with the authorization header removed
 * and nothing else changed: same bounded fetch, same timeout and size limits,
 * same error shape, same compatibility date.
 *
 * ## It is not a fallback for the authenticated client
 *
 * Anything scope-gated still needs `CjsToolEsiClient`. Handing a 403 route to
 * this one would turn "you are not signed in" into "upstream refused", which is
 * the kind of wrong that sends somebody looking at the wrong layer. Give it
 * public routes only.
 */
export class CjsToolPublicEsi
{

    /**
     * @param {Object} [options]
     * @param {String} [options.compatibilityDate] - REQUIRED by every ESI route,
     *   and it must be a date that has already passed; see `CjsToolEsiClient`.
     */
    constructor({
        compatibilityDate = ESI_COMPATIBILITY_DATE,
        root = ESI_ROOT,
        fetch: fetchImplementation = globalThis.fetch,
        requestTimeoutMs = 20000,
        maxResponseBytes = 4 * 1024 * 1024,
    } = {})
    {
        this.compatibilityDate = String(compatibilityDate);
        this.root = String(root).replace(/\/+$/u, "");
        this.fetch = fetchImplementation;
        this.requestTimeoutMs = requestTimeoutMs;
        this.maxResponseBytes = maxResponseBytes;
    }

    /**
     * GETs a public ESI path.
     *
     * No retry: there is no token to refresh, so a 401 here means the route was
     * not public after all — which is a caller's mistake and should surface as
     * one rather than being retried into a timeout.
     *
     * @param {String} path - e.g. "/characters/2124595574"
     * @returns {Promise<Object>}
     */
    async Get(path)
    {
        return (await this.Read(path)).body;
    }

    /**
     * POSTs to a public ESI path.
     *
     * Two of the public routes are POSTs and neither is a write:
     * `/universe/ids` turns names into ids and `/universe/names` turns ids into
     * names, both taking a LIST so a caller can ask about several things in one
     * request. They are POSTs because the question is a body, not because they
     * change anything.
     *
     * @param {String} path - e.g. "/universe/ids"
     * @param {*} body - JSON-serialisable
     * @returns {Promise<Object|Array>}
     */
    async Post(path, body)
    {
        return (await this.Read(path, { method: "POST", body })).body;
    }

    /**
     * A public read, with the response's HEADERS.
     *
     * Most callers want the body and nothing else, which is what `Get` and
     * `Post` are. Market data is the exception and needs two things that only
     * live in the headers: `x-pages`, because a region's order book does not fit
     * in one response, and `expires`, because ESI says how long its own answer
     * stays true and re-asking sooner is rude at best and rate-limited at worst.
     *
     * @param {String} path
     * @param {Object} [options]
     * @param {String} [options.method]
     * @param {*} [options.body] - JSON-serialisable, for a POST
     * @returns {Promise<{body: *, headers: Headers, status: Number}>}
     */
    async Read(path, { method = "GET", body = undefined } = {})
    {
        const headers = {
            accept: "application/json",
            "x-compatibility-date": this.compatibilityDate,
        };

        if (body !== undefined) headers["content-type"] = "application/json";

        const response = await CjsBoundedFetch.request(this.fetch, `${this.root}${path}`, {
            method,
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }, {
            label: `ESI ${path}`,
            timeoutMs: this.requestTimeoutMs,
            maxBytes: this.maxResponseBytes,
        });

        if (!response.ok)
        {
            const error = new Error(`ESI ${path} failed (${response.status})`);

            error.statusCode = response.status === 404 ? 404 : 502;
            error.upstreamStatus = response.status;
            throw error;
        }

        return {
            body: await CjsBoundedFetch.readJson(response, {
                label: `ESI ${path}`,
                timeoutMs: this.requestTimeoutMs,
                maxBytes: this.maxResponseBytes,
            }),
            headers: response.headers,
            status: response.status,
        };
    }

}

export default CjsToolPublicEsi;
