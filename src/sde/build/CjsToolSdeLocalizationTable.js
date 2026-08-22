const ENTRY_PATTERN = /I(\d+)\n\(V([^\n]*)\n/gu;

/**
 * Indexes one client localization protocol-0 pickle without materializing its
 * complete Python object graph.
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

    /** Builds a label table from the exact line-oriented pickle shape. */
    static fromBytes(bytes)
    {
        const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
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
