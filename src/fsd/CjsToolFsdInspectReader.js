import { CjsFsd64Binary } from "@carbonenginejs/runtime/resource/formats/fsd/64";

const DEFAULT_MAX_ROOT_FIELDS = 24;
const DEFAULT_MAX_STRINGS = 160;
const DEFAULT_MAX_POINTERS = 160;
const DEFAULT_MAX_LISTS = 80;
const MIN_STRING_LENGTH = 2;

/**
 * Inspects an FSD container without claiming a complete record layout.
 */
export class CjsToolFsdInspectReader
{
    #path;
    #schemaID;
    #metadata;

    /**
     * Creates a FSD inspection fsd inspect reader from caller-supplied
     * configuration.
     */
    constructor(options = {})
    {
        this.#path = NormalizePath(options.path);
        this.#schemaID = NormalizeOptionalSchema(options.schemaID);
        this.#metadata = FreezeMetadata(options.metadata);
    }

    /** Returns the filesystem source path attached to this inspection reader. */
    get path()
    {
        return this.#path;
    }

    /** Returns the decoded schema identity selected for this FSD input. */
    get schemaID()
    {
        return this.#schemaID;
    }

    /** Decodes the selected FSD input into inspection-safe plain values. */
    Read(bytes, options = {})
    {
        const path = NormalizePath(options.path ?? this.#path);
        const schemaID = NormalizeOptionalSchema(options.schemaID ?? this.#schemaID);
        const binary = new CjsFsd64Binary(bytes, { path });

        if (schemaID)
        {
            binary.AssertSchema(schemaID, path);
        }

        const strings = FindLengthPrefixedStrings(binary, options);

        return {
            path,
            schemaID: binary.SchemaID,
            metadata: this.#metadata,
            byteLength: binary.ByteLength,
            payloadLength: binary.PayloadLength,
            rootFields: ReadRootFields(binary, options),
            strings,
            stringPointers: FindStringPointers(binary, strings, options),
            uint32Lists: FindUint32Lists(binary, options),
        };
    }
}

function ReadRootFields(binary, options)
{
    const maximum = Math.max(0, options.maxRootFields ?? DEFAULT_MAX_ROOT_FIELDS);
    const limit = Math.min(binary.ByteLength, binary.RootOffset + maximum * 8);
    const result = [];

    for (let offset = binary.RootOffset; offset + 8 <= limit; offset += 8)
    {
        const value = binary.TryUint64(offset);
        result.push({
            offset,
            relativeOffset: offset - binary.RootOffset,
            uint64: value,
            asAbsoluteOffset: value !== null && IsPlausibleRelativeOffset(binary, value)
                ? binary.RootOffset + value
                : null,
            asString: value === null ? null : binary.StringAtDataPointer(value, 512),
        });
    }

    return result;
}

function FindLengthPrefixedStrings(binary, options)
{
    const maximum = Math.max(0, options.maxStrings ?? DEFAULT_MAX_STRINGS);
    const result = [];
    const seen = new Set();

    for (let lengthOffset = binary.RootOffset; lengthOffset + 10 <= binary.ByteLength; lengthOffset += 8)
    {
        const length = binary.TryUint64(lengthOffset);
        const dataOffset = lengthOffset + 8;

        if (length === null || length < MIN_STRING_LENGTH || length > 1024 ||
            dataOffset + length > binary.ByteLength)
        {
            continue;
        }

        const value = DecodeAscii(binary.Bytes(dataOffset, length));

        if (value === null)
        {
            continue;
        }

        const key = `${dataOffset}:${value}`;

        if (seen.has(key))
        {
            continue;
        }

        seen.add(key);
        result.push({
            offset: dataOffset,
            relativeOffset: dataOffset - binary.RootOffset,
            length,
            value,
        });

        if (result.length >= maximum)
        {
            break;
        }
    }

    return result;
}

function FindStringPointers(binary, strings, options)
{
    const maximum = Math.max(0, options.maxPointers ?? DEFAULT_MAX_POINTERS);
    const stringByRelativeOffset = new Map(strings.map(value => [ value.relativeOffset, value ]));
    const result = [];

    for (let offset = binary.RootOffset; offset + 8 <= binary.ByteLength; offset += 8)
    {
        const relativeOffset = binary.TryUint64(offset);
        const string = stringByRelativeOffset.get(relativeOffset);

        if (!string)
        {
            continue;
        }

        result.push({
            offset,
            relativeOffset: offset - binary.RootOffset,
            pointsTo: relativeOffset,
            value: string.value,
        });

        if (result.length >= maximum)
        {
            break;
        }
    }

    return result;
}

function FindUint32Lists(binary, options)
{
    const maximum = Math.max(0, options.maxLists ?? DEFAULT_MAX_LISTS);
    const result = [];

    for (let lengthOffset = binary.RootOffset; lengthOffset + 12 <= binary.ByteLength; lengthOffset += 8)
    {
        const count = binary.TryUint64(lengthOffset);
        const dataOffset = lengthOffset + 8;

        if (count === null || count < 1 || count > 128 ||
            dataOffset + count * 4 > binary.ByteLength)
        {
            continue;
        }

        const values = [];
        let plausible = true;

        for (let index = 0; index < count; index++)
        {
            const value = binary.Uint32(dataOffset + index * 4);
            values.push(value);

            if (value > 10_000_000)
            {
                plausible = false;
                break;
            }
        }

        if (!plausible)
        {
            continue;
        }

        result.push({
            offset: dataOffset,
            relativeOffset: dataOffset - binary.RootOffset,
            count,
            values,
        });

        if (result.length >= maximum)
        {
            break;
        }
    }

    return result;
}

function DecodeAscii(bytes)
{
    for (const value of bytes)
    {
        if (value < 32 || value > 126)
        {
            return null;
        }
    }

    return new TextDecoder().decode(bytes);
}

function IsPlausibleRelativeOffset(binary, value)
{
    return Number.isSafeInteger(value) &&
        value >= 0 &&
        binary.RootOffset + value <= binary.ByteLength;
}

function NormalizePath(value)
{
    if (value === undefined || value === null)
    {
        return null;
    }

    if (typeof value !== "string" || value.trim() === "")
    {
        const error = new TypeError("FSD inspect reader path must be a non-empty string.");
        error.code = "CJS_FSD_PATH_INVALID";
        throw error;
    }

    return value.trim().replaceAll("\\", "/").toLowerCase();
}

function NormalizeOptionalSchema(value)
{
    if (value === undefined || value === null || value === "")
    {
        return null;
    }

    const schema = String(value).trim().toLowerCase();

    if (!/^(?:[0-9a-f]{32}|[0-9a-f]{48})$/u.test(schema))
    {
        const error = new TypeError(
            "FSD schema identity must be 32 lowercase hexadecimal characters for a layout, or 48 with its content digest.",
        );
        error.code = "CJS_FSD_SCHEMA_INVALID";
        throw error;
    }

    return schema;
}

function FreezeMetadata(value)
{
    if (value === undefined || value === null)
    {
        return null;
    }

    if (typeof value !== "object")
    {
        const error = new TypeError("FSD inspect metadata must be an object.");
        error.code = "CJS_FSD_METADATA_INVALID";
        throw error;
    }

    return Object.freeze({
        ...value,
        fields: Array.isArray(value.fields)
            ? Object.freeze([ ...value.fields ])
            : value.fields,
    });
}

export default new CjsToolFsdInspectReader();
