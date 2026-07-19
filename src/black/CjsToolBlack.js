import { CjsBlackFormat } from "@carbonenginejs/runtime-resource/formats/black";
import * as utils from "../utils.js";

/**
 * Front-facing Black (`.black`) resource reader: fetch through an index
 * source, then parse.
 *
 * Reads against `@carbonenginejs/runtime-resource`'s single checked-in Black
 * schema snapshot; there is no per-EVE-build schema selection. A resource
 * from a client build far from that snapshot's source tree can fail to parse
 * or silently misread fields if the binary layout drifted since the scan.
 */
export class CjsToolBlack
{

    /**
     * Reads Black bytes into JSON-compatible public payload data. Static
     * helpers use camelCase by convention.
     *
     * @param {ArrayBuffer|ArrayBufferView} bytes Raw Black file bytes.
     * @param {object} [options] Per-call `CjsBlackFormat` read options.
     * @returns {object} Plain JSON-compatible payload data.
     */
    static readJson(bytes, options = {})
    {
        return CjsBlackFormat.toJSON(CjsBlackFormat.readPayload(bytes, options));
    }

    /**
     * Fetches one Black resource through an opened index source and reads it
     * into JSON-compatible public payload data.
     *
     * @param {import("../indexing/CjsIndexSource.js").CjsIndexSource} source Opened cached resource source.
     * @param {string} logicalPath Exact `res:/`-scheme logical path to a `.black` resource.
     * @param {object} [options] `fetch` (source.Fetch options) and `read` (CjsBlackFormat read options).
     * @returns {Promise<object>} Plain JSON-compatible payload data.
     */
    static async fetchJson(source, logicalPath, options = {})
    {
        if (!source || typeof source.Fetch !== "function")
        {
            throw new TypeError("CjsToolBlack.fetchJson requires an opened index source");
        }

        utils.requireObject(options, "CjsToolBlack.fetchJson options");

        const file = await source.Fetch(logicalPath, options.fetch ?? {});

        return CjsToolBlack.readJson(file.bytes, options.read ?? {});
    }

    /**
     * Returns whether a logical or file path names a `.black` resource.
     *
     * @param {string} path Logical or file path to test.
     * @returns {boolean} True for a case-insensitive `.black` extension.
     */
    static isBlackPath(path)
    {
        return /\.black$/iu.test(String(path ?? ""));
    }

}
