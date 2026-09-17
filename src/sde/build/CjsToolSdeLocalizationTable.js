import { CjsPickleFormat } from "@carbonenginejs/runtime/resource/formats/pickle";

const ENTRY_PATTERN = /I(\d+)\n\(V([^\n]*)\n/gu;
const PROTO = 0x80;

/**
 * Limits sized for a localization container rather than for an untrusted blob.
 *
 * The defaults are deliberately small because a pickle is an attacker-shaped
 * input. These files are neither small nor untrusted: the largest CCP ships is
 * 32 MB and holds a quarter of a million messages, which is millions of opcodes
 * and one memo entry per message. The bound that still matters is the input
 * size, so it is the one raised least.
 */
const LOCALIZATION_LIMITS = Object.freeze({
    maxOperations: 200000000,
    maxContainerItems: 20000000,
    maxMemoEntries: 20000000,
    maxMemoID: 20000000,
    maxStackDepth: 1000000,
    maxInputBytes: 64 * 1024 * 1024,
});

/**
 * Indexes one client localization pickle.
 *
 * Two containers ship under the same name and neither is a version of the
 * other. CCP's EVE clients write **protocol 0**, a line-oriented text pickle
 * this reader scans without materializing the object graph. EVE Frontier writes
 * **protocol 4**, which is binary and cannot be scanned that way, so it is
 * decoded properly through the runtime pickle format and then indexed.
 *
 * The decoded protocol-4 shape is `(language, {messageID: (text, ...)})`, and
 * the text is the tuple's first element.
 */
export class CjsToolSdeLocalizationTable
{
    #labels;

    /**
     * Creates a SDE build sde localization table from caller-supplied
     * configuration.
     */
    constructor(labels)
    {
        this.#labels = labels;
    }

    /** Number of labels in the table. */
    get size()
    {
        return this.#labels.size;
    }

    /** Resolves one label exactly as the client table stores it. */
    Get(labelId)
    {
        if (labelId === null || labelId === undefined) return null;

        return this.#labels.get(Number(labelId)) ?? null;
    }

    /** Resolves and normalizes one label for an export comparison or join. */
    GetNormalized(labelId)
    {
        return CjsToolSdeLocalizationTable.normalize(this.Get(labelId));
    }

    /** Reports identifiers this table cannot resolve. */
    Missing(labelIds)
    {
        const missing = [];

        for (const labelId of labelIds)
        {
            if (labelId === null || labelId === undefined) continue;
            if (!this.#labels.has(Number(labelId))) missing.push(Number(labelId));
        }

        return missing;
    }

    /** Builds a label table from whichever pickle protocol the client wrote. */
    static fromBytes(bytes)
    {
        const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

        // Protocol 0 is printable text with no header, and PROTO is the one
        // opcode it cannot begin with. The first byte separates them.
        if (view.length && view[0] === PROTO) return this.fromBinaryPickle(view);

        const text = new TextDecoder("latin1").decode(view);
        const labels = new Map();

        for (const match of text.matchAll(ENTRY_PATTERN))
        {
            labels.set(Number(match[1]), DecodeRawUnicodeEscape(match[2]));
        }

        if (labels.size === 0)
        {
            const error = new Error(
                "No localization entries found. This reader understands the protocol-0 "
                + "`I<id>\\n(V<text>\\n` shape and nothing else."
            );

            error.code = "CJS_SDE_LOCALIZATION_EMPTY";
            throw error;
        }

        return new CjsToolSdeLocalizationTable(labels);
    }

    /** Builds a label table from a decoded binary-protocol pickle. */
    static fromBinaryPickle(view)
    {
        const decoded = CjsPickleFormat.readPayload(view, { limits: LOCALIZATION_LIMITS });
        const messages = Array.isArray(decoded) ? decoded[1] : decoded;
        const labels = new Map();

        if (!messages || typeof messages !== "object" || Array.isArray(messages))
        {
            const error = new Error(
                "A binary-protocol localization pickle holds `(language, {messageID: (text, ...)})`, "
                + "and this one does not."
            );

            error.code = "CJS_SDE_LOCALIZATION_SHAPE";
            throw error;
        }

        for (const [ id, entry ] of Object.entries(messages))
        {
            const text = Array.isArray(entry) ? entry[0] : entry;

            if (typeof text === "string") labels.set(Number(id), text);
        }

        if (labels.size === 0)
        {
            const error = new Error("No localization entries found in the decoded pickle.");

            error.code = "CJS_SDE_LOCALIZATION_EMPTY";
            throw error;
        }

        return new CjsToolSdeLocalizationTable(labels);
    }

    /** Normalizes label text in the same form used for export comparisons. */
    static normalize(text)
    {
        if (text === null || text === undefined) return null;

        const normalized = String(text).replace(/\r\n/gu, "\n").trim();

        return normalized === "" ? null : normalized;
    }
}

function DecodeRawUnicodeEscape(raw)
{
    if (!raw.includes("\\")) return raw;

    return raw.replace(/\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\\(.)/gu, (_match, unicode, hex, simple) =>
    {
        if (unicode !== undefined) return String.fromCharCode(parseInt(unicode, 16));
        if (hex !== undefined) return String.fromCharCode(parseInt(hex, 16));

        switch (simple)
        {
            case "n": return "\n";
            case "r": return "\r";
            case "t": return "\t";
            case "\\": return "\\";
            case "'": return "'";
            default: return simple;
        }
    });
}

export default CjsToolSdeLocalizationTable;
