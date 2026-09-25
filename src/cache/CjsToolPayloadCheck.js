import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { isResFileAddressFor, parseResFileAddress } from "@carbonenginejs/runtime/utils/resfile";

// Every resource hash check routes through this class, and it is the one place
// that states how a stored payload relates to the bytes CCP published.
//
// DO YOU EVEN NEED TO CALL IT? Almost never. A payload is hashed once, when it
// is first downloaded (CjsToolIndexSource, CjsToolIndexReader) or installed
// from a supplied overlay (CjsToolIndexOverlayStore), and the cache writes
// atomically, so anything already stored is either complete or absent.
// Re-checking stored files guards against disk corruption and hand edits, and
// if either happens the cache is deletable. verifyStored exists so that, if a
// check IS wanted, nobody has to rediscover these rules to write it.
//
// The rules:
//
// - An ADDRESS is `<shard>/<pathHash>_<md5>` (runtime utils/resfile). The md5
//   is of the ORIGINAL file as CCP published it, never of any stored form.
// - `<address>.gz` is the same payload gzipped. The cache migrates originals to
//   this form in place and deletes the raw file (CjsToolIndex), so an original
//   may exist only here; the address still names the unzipped bytes. It exists
//   because a CDN caches by extension and ignored extensionless files.
// - `<address>.<suffix>` is a CONVERSION of that original - a translated shader
//   (`.webgpu`, `.webgl2`), an image (`.png`) - keyed by its source's address so
//   the source version stays known. Its own bytes are not the md5 in its name;
//   only the index record for the converted file knows their hash. So it is
//   checked through its source, plus that record when one is supplied.
// - Anything else (a logical-path overlay layout, an authored file) is not an
//   address, and only a supplied record can check it.
// - `.gz` and `.<suffix>` are OUR storage conventions, not Carbon naming:
//   Carbon's RemoteFileCache knows only the index line
//   `resPath,hashedName,md5,size`.
//
// These rules stay here, not in runtime utils/resfile: they describe how THIS
// provider stores payloads, and the library must work with any index and
// source (CCP's own servers serve plain addresses only). readOriginal uses
// gunzipSync, fine for tools but blocking if it ever runs on a service
// request path.
// - The path half of an address is checkable without the bytes, against the
//   logical path it claims to be for.

/** Validates resource bytes, and stored payloads, against their published identity. */
export class CjsToolPayloadCheck
{

    /**
     * Validates bytes against a record's `uncompressedSize` and `checksum`
     * (md5), throwing on a mismatch; returns them as a Buffer. The check every
     * first download goes through.
     */
    static validateBytes(bytes, record, label = record?.logicalPath ?? "resource")
    {
        const buffer = Buffer.from(bytes);

        if (record?.uncompressedSize !== null
            && record?.uncompressedSize !== undefined
            && buffer.byteLength !== record.uncompressedSize)
        {
            throw new Error(
                `Invalid byte length for ${label}: expected ${record.uncompressedSize}, got ${buffer.byteLength}`,
            );
        }

        if (record?.checksum && CjsToolPayloadCheck.md5(buffer) !== String(record.checksum).toLowerCase())
        {
            throw new Error(`Invalid checksum for ${label}`);
        }

        return buffer;
    }

    /** Hex md5 of some bytes. */
    static md5(bytes)
    {
        return crypto.createHash("md5").update(bytes).digest("hex");
    }

    /**
     * Says what a stored payload name is: an `original`, its `compressed` copy,
     * a `converted` form keyed by its source address, or `unaddressed`.
     */
    static describe(storedName)
    {
        const name = String(storedName ?? "").trim().toLowerCase();
        const compressed = name.endsWith(".gz");
        const base = compressed ? name.slice(0, -3) : name;

        const address = parseResFileAddress(base);
        if (address)
        {
            return {
                kind: compressed ? "compressed" : "original",
                address: base,
                checksum: address.checksum,
                compressed,
            };
        }

        const dot = base.indexOf(".");
        const source = dot === -1 ? null : parseResFileAddress(base.slice(0, dot));
        if (source)
        {
            return {
                kind: "converted",
                address: base.slice(0, dot),
                checksum: source.checksum,
                suffix: base.slice(dot + 1),
                compressed,
            };
        }

        return { kind: "unaddressed", name, compressed };
    }

    /**
     * Reads a payload's ORIGINAL bytes from the cache, raw or unzipped from its
     * `.gz` copy, or null when neither is stored.
     */
    static async readOriginal(cache, address)
    {
        const raw = await cache.ReadRemote(address);
        if (raw) return Buffer.from(raw.bytes);

        const gzipped = await cache.ReadRemote(`${address}.gz`);
        return gzipped ? gunzipSync(Buffer.from(gzipped.bytes)) : null;
    }

    /**
     * Verifies one stored payload by name (see the note above on whether you
     * should). A converted payload is verified through its source; an optional
     * index `record` for the stored name additionally checks its own bytes, and
     * an optional `logicalPath` checks the address's path half.
     *
     * @returns {Promise<{status: "ok"|"mismatch"|"missing"|"unverifiable", reason: String, description: Object}>}
     */
    static async verifyStored(cache, storedName, { record = null, logicalPath = null } = {})
    {
        const description = CjsToolPayloadCheck.describe(storedName);
        const result = (status, reason) => ({ status, reason, description });

        if (description.kind !== "unaddressed" && logicalPath !== null
            && !isResFileAddressFor(description.address, logicalPath))
        {
            return result("mismatch", `address is not for ${logicalPath}`);
        }

        if (record)
        {
            const stored = await cache.ReadRemote(String(storedName).trim());
            if (!stored) return result("missing", "stored payload is absent");
            const bytes = description.compressed ? gunzipSync(Buffer.from(stored.bytes)) : stored.bytes;
            try
            {
                CjsToolPayloadCheck.validateBytes(bytes, record, storedName);
            }
            catch (error)
            {
                return result("mismatch", error.message);
            }
        }

        if (description.kind === "unaddressed")
        {
            return record
                ? result("ok", "matches its record")
                : result("unverifiable", "not a content address and no record supplied");
        }

        const original = await CjsToolPayloadCheck.readOriginal(cache, description.address);
        if (!original)
        {
            return result("missing", description.kind === "converted"
                ? `source ${description.address} is not stored, raw or gzipped`
                : "original is not stored, raw or gzipped");
        }

        return CjsToolPayloadCheck.md5(original) === description.checksum
            ? result("ok", description.kind === "converted" ? "source matches its address" : "matches its address")
            : result("mismatch", "original bytes do not match the md5 in the address");
    }

}
