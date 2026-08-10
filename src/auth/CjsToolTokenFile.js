import fs from "node:fs/promises";
import path from "node:path";

const SCHEMA = "carbon.tools-core.token";

/**
 * File custody for one OAuth refresh token.
 *
 * The refresh token is the real secret in this flow: long lived, and on its own
 * enough to act as the authenticated identity. The access token is not - it
 * expires in minutes and is never written here.
 *
 * Deliberately a file under the tools cache rather than an OS keychain. The
 * keychain means three platform code paths and a native dependency, and the
 * credential it would protect exists only while the SKINR endpoints are
 * gated - the effort would outlive the requirement.
 *
 * Custody is separate from the SSO client on purpose: CjsToolEveSso holds
 * nothing and writes nothing, so it stays testable offline and secrets stay out
 * of a module that does not need them.
 */
export class CjsToolTokenFile
{

    #file;

    #mode;

    /**
     * @param {Object} options
     * @param {String} options.directory - custody root, normally the tools cache
     * @param {String} [options.name] - one file per identity
     * @param {Number} [options.mode] - POSIX mode; ignored by Windows
     */
    constructor({ directory, name = "esi", mode = 0o600 } = {})
    {
        if (!directory) throw new TypeError("Token file requires a directory");

        const safe = String(name).replace(/[^a-z0-9._-]/giu, "");

        if (!safe) throw new TypeError("Token file requires a usable name");

        this.#file = path.join(path.resolve(String(directory)), `${safe}.json`);
        this.#mode = mode;
    }

    /** The path this store writes. Useful in diagnostics; never the contents. */
    get file()
    {
        return this.#file;
    }

    /**
     * Reads the stored record, or null when nothing is stored.
     *
     * A missing file is an ordinary state - nobody has logged in yet - so it is
     * not an error. Unreadable CONTENT is a different thing and does throw:
     * silently treating a corrupt store as "no token" would send the operator
     * through a fresh login every run with no clue why.
     *
     * @returns {Promise<Object|null>}
     */
    async Read()
    {
        let raw;

        try
        {
            raw = await fs.readFile(this.#file, "utf8");
        }
        catch (error)
        {
            if (error.code === "ENOENT") return null;

            throw error;
        }

        let record = null;
        let reason = "not valid JSON";

        try
        {
            record = JSON.parse(raw);
            reason = record?.schema === SCHEMA ? null : "not a token document";
        }
        catch
        {
            // NOTHING derived from the file reaches the message. Node's own
            // JSON parse error quotes the first ten characters of the input,
            // so interpolating it would print the start of a file whose entire
            // purpose is to hold a credential.
            record = null;
        }

        if (reason)
        {
            // The file is NOT deleted: it is the only copy of a long-lived
            // credential, and a parse failure could be a truncated read or a
            // half-finished edit. Say where it is and let a human look.
            throw new Error(
                `Stored token at ${this.#file} is unreadable (${reason}). `
                + "Delete it to force a fresh login.",
            );
        }

        return record;
    }

    /**
     * Replaces the stored record atomically.
     *
     * Written to a sibling temporary file and renamed, because EVE rotates the
     * refresh token on every use: a torn write during rotation would leave a
     * file that is neither the old token nor the new one, and the session would
     * be unrecoverable without logging in again.
     *
     * The mode is set when the file is CREATED rather than adjusted afterwards.
     * A chmod after the fact leaves a window where the secret is on disk
     * world-readable.
     *
     * @param {Object} record - must carry a refreshToken
     */
    async Write(record)
    {
        const refreshToken = record?.refreshToken;

        if (typeof refreshToken !== "string" || !refreshToken)
        {
            // Guards the case that matters: a failed refresh returning nothing
            // must not overwrite a token that still works.
            throw new TypeError("Refusing to store a token record without a refreshToken");
        }

        const directory = path.dirname(this.#file);
        await fs.mkdir(directory, { recursive: true });

        const temporary = path.join(directory, `.${path.basename(this.#file)}.${process.pid}.tmp`);
        const body = `${JSON.stringify({ ...record, schema: SCHEMA }, null, 2)}\n`;

        let handle = null;

        try
        {
            // wx: fail rather than adopt a stale temporary from a crashed run.
            handle = await fs.open(temporary, "wx", this.#mode);
            await handle.writeFile(body, "utf8");
            // Durable before the rename, so a crash cannot publish a short file.
            await handle.sync();
            await handle.close();
            handle = null;

            await fs.rename(temporary, this.#file);
        }
        catch (error)
        {
            if (handle) await handle.close().catch(() => {});
            await fs.rm(temporary, { force: true }).catch(() => {});

            throw error;
        }

        return this;
    }

    /** Removes the stored record. A missing file is already the desired state. */
    async Clear()
    {
        await fs.rm(this.#file, { force: true });

        return this;
    }

    /**
     * The injected-custody pair the OAuth clients in this package expect, so a
     * caller can hand over custody without exposing the store itself.
     * @returns {{getRefreshToken: Function, setRefreshToken: Function}}
     */
    CreateAccessors()
    {
        return {
            getRefreshToken: async () => (await this.Read())?.refreshToken ?? null,
            setRefreshToken: async (refreshToken, extra = {}) =>
            {
                await this.Write({ ...extra, refreshToken });
            },
        };
    }

}
