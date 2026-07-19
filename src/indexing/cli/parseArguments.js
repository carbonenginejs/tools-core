const BooleanOptions = new Set([
    "all",
    "help",
    "indexes",
    "no-cache",
    "refresh",
    "sde-auto-prepare",
]);

/**
 * Parses `--key:value`, `--key=value`, and `--key value` CLI options.
 */
export function parseArguments(values)
{
    const args = { _: [] };

    for (let index = 0; index < values.length; index++)
    {
        const value = values[index];

        if (!value.startsWith("--"))
        {
            args._.push(value);
            continue;
        }

        const option = value.slice(2);
        const separator = option.search(/[:=]/u);
        const rawKey = separator === -1 ? option : option.slice(0, separator);
        let item = separator === -1 ? true : option.slice(separator + 1);

        if (separator === -1
            && !BooleanOptions.has(rawKey)
            && values[index + 1] !== undefined
            && !values[index + 1].startsWith("--"))
        {
            item = values[++index];
        }

        if (!rawKey)
        {
            throw new Error(`Invalid option: ${value}`);
        }

        const key = rawKey.replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());

        args[key] = item;
    }

    return args;
}
