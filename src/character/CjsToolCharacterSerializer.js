/** Deterministic character-library JSON serialization. */
export class CjsToolCharacterSerializer
{

    static stringify(value, options = {})
    {
        return options.compact ? JSON.stringify(value) : StringifyReadable(value);
    }

}

function StringifyReadable(value, depth = 0)
{
    if (value === null || typeof value !== "object") return JSON.stringify(value);

    const indentation = "  ".repeat(depth);
    const childIndentation = "  ".repeat(depth + 1);
    if (Array.isArray(value))
    {
        if (!value.length) return "[]";
        if (value.every(item => item === null || typeof item !== "object"))
        {
            return `[${value.map(item => JSON.stringify(item)).join(", ")}]`;
        }
        return `[` + "\n" + value
            .map(item => `${childIndentation}${StringifyReadable(item, depth + 1)}`)
            .join(",\n") + `\n${indentation}]`;
    }

    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    return `{` + "\n" + entries
        .map(([ key, item ]) => `${childIndentation}${JSON.stringify(key)}: ${StringifyReadable(item, depth + 1)}`)
        .join(",\n") + `\n${indentation}}`;
}
