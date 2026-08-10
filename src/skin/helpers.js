/** Compares numeric SDE identities without losing deterministic string fallback. */
export function compareIds(left, right)
{
    const leftNumber = Number(left);
    const rightNumber = Number(right);

    if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber))
    {
        return leftNumber - rightNumber;
    }

    return CompareText(String(left), String(right));
}

/** Converts one official numeric identity into its public JSON representation. */
export function normalizeId(value, label = "SDE identity")
{
    const id = Number(value);

    if (!Number.isSafeInteger(id) || id < 0)
    {
        throw new TypeError(`${label} must be a non-negative safe integer: ${value}`);
    }

    return id;
}

/** Returns deterministic entries from one prepared SDE table. */
export function tableEntries(value, label)
{
    let entries;

    if (value instanceof Map)
    {
        entries = [ ...value.entries() ];
    }
    else if (Array.isArray(value))
    {
        entries = value.map((record) => [ record?._key, record ]);
    }
    else if (value && typeof value === "object")
    {
        entries = Object.entries(value);
    }
    else
    {
        throw new TypeError(`${label} must be an object, array, or Map`);
    }

    return entries.map(([ key, record ]) =>
    {
        if (!record || typeof record !== "object" || Array.isArray(record))
        {
            throw new TypeError(`${label} record ${key} must be an object`);
        }

        const id = normalizeId(record._key ?? key, `${label} record ID`);

        return [ id, record ];
    }).sort(([ left ], [ right ]) => compareIds(left, right));
}

/** Builds an ID-addressable JSON object while replacing the transport `_key`. */
export function mapRecords(value, label, idField, transform = null, options = {})
{
    const output = {};

    for (const [ id, source ] of tableEntries(value, label))
    {
        const { _key, ...record } = source;
        const transformed = transform ? transform(record, id) : record;

        if (transformed === null && options.omitNull === true)
        {
            continue;
        }

        output[id] = sortValue({
            [idField]: id,
            ...transformed,
        });
    }

    return output;
}

/** Normalizes the official `_key`/`_value` pair-array representation. */
export function normalizePairs(value, keyField, valueField)
{
    if (!Array.isArray(value))
    {
        return [];
    }

    return value.map((entry) => ({
        [keyField]: normalizeId(entry?._key, keyField),
        [valueField]: sortValue(entry?._value),
    })).sort((left, right) => compareIds(left[keyField], right[keyField]));
}

/** Sorts and de-duplicates one numeric ID array. */
export function normalizeIdArray(value, label)
{
    if (value === undefined || value === null)
    {
        return [];
    }

    if (!Array.isArray(value))
    {
        throw new TypeError(`${label} must be an array`);
    }

    return [ ...new Set(value.map(item => normalizeId(item, label))) ].sort(compareIds);
}

/** Normalizes one numeric ID array while preserving authored sequence. */
export function normalizeOrderedIdArray(value, label)
{
    if (value === undefined || value === null)
    {
        return [];
    }

    if (!Array.isArray(value))
    {
        throw new TypeError(`${label} must be an array`);
    }

    return [ ...new Set(value.map(item => normalizeId(item, label))) ];
}

/** Recursively sorts object keys without changing authored array order. */
export function sortValue(value)
{
    if (Array.isArray(value))
    {
        return value.map(sortValue);
    }

    if (!value || typeof value !== "object")
    {
        return value;
    }

    const output = {};

    for (const key of Object.keys(value).sort(CompareText))
    {
        if (value[key] !== undefined)
        {
            output[key] = sortValue(value[key]);
        }
    }

    return output;
}

/** Returns the extension-free final segment of one authored resource path. */
export function resourceBaseName(value)
{
    const name = String(value ?? "").split("/").pop() ?? "";
    const separator = name.lastIndexOf(".");

    return separator > 0 ? name.slice(0, separator) : name;
}

/** Converts current projection labels to Carbon texture address-mode values. */
export function projectionAddressMode(value)
{
    const modes = {
        "clamp-to-border": 4,
        "clamp-to-edge": 3,
        repeat: 1,
    };
    const key = String(value ?? "").trim().toLowerCase();

    if (!Object.hasOwn(modes, key))
    {
        throw new Error(`Unsupported SKINR projection type: ${value}`);
    }

    return modes[key];
}

/**
 * Converts current projection labels to authored SOF projection types.
 *
 * This is the form an EveSOFDataPattern layer stores - `projectionTypeU/V` -
 * NOT the address mode above. The two are one substitution apart and it is
 * worth keeping both: consumers assembling a pattern want this one, consumers
 * setting a sampler want the other.
 *
 * Equivalent to composing projectionAddressMode() with ccpwgl's
 * EveSOFDataPatternLayer.FromAddressMode (4 -> 2, 3 -> 1, else 0), stated
 * directly so a generated pattern does not have to round-trip through a
 * vocabulary it never uses.
 */
export function projectionType(value)
{
    const types = {
        "clamp-to-border": 2,
        "clamp-to-edge": 1,
        repeat: 0,
    };
    const key = String(value ?? "").trim().toLowerCase();

    if (!Object.hasOwn(types, key))
    {
        throw new Error(`Unsupported SKINR projection type: ${value}`);
    }

    return types[key];
}

/**
 * Validates a SKINR pattern blend mode.
 *
 * These five are the whole vocabulary a payload may carry, and they are not in
 * static data - the value is authored, not derived, so there is no table to
 * check it against at build time. `normal` is the overlay blend.
 *
 * They are lowercase and the consuming runtime upper-cases and substitutes
 * separators before matching, so no rename is needed. What does NOT survive is
 * anything outside the set: the runtime's lookup falls back to 0 for an
 * unrecognised string, so an unknown blend mode arrives looking exactly like a
 * deliberate `normal`. Rejecting it here turns that into a build failure - the
 * one place it can still be noticed.
 */
export function patternBlendMode(value, fallback = "normal")
{
    const key = String(value ?? "").trim().toLowerCase();

    if (!key) return fallback;

    const known = new Set([
        "normal",
        "subtract",
        "exclusion",
        "nested",
        "nested_inverted",
    ]);

    if (!known.has(key))
    {
        throw new Error(`Unsupported SKINR pattern blend mode: ${value}`);
    }

    return key;
}

/** Requires one ID-addressable record used by a generated join. */
export function requireRecord(records, id, label)
{
    const record = records[id];

    if (!record)
    {
        throw new Error(`${label} ${id} not found`);
    }

    return record;
}

/** Normalizes the exact source identity embedded in every generated library. */
export function normalizeSourceIdentity(options, label)
{
    const identity = {
        sourceTarget: String(options.sourceTarget ?? "").trim().toLowerCase(),
        sourceGame: String(options.sourceGame ?? "").trim(),
        sourceProvider: String(options.sourceProvider ?? "").trim().toLowerCase(),
        sourceBuild: String(options.sourceBuild ?? "").trim(),
    };

    if (!identity.sourceTarget || !identity.sourceGame || !identity.sourceProvider)
    {
        throw new TypeError(`${label} requires target, game, and provider source identity`);
    }

    if (!/^\d+$/u.test(identity.sourceBuild))
    {
        throw new TypeError(`${label} requires an exact numeric source build`);
    }

    return identity;
}

function CompareText(left, right)
{
    return left < right ? -1 : left > right ? 1 : 0;
}
