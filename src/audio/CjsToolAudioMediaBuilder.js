import crypto from "node:crypto";

import { resFileAddress } from "@carbonenginejs/runtime/utils/resfile";

import { CjsToolCache } from "../cache/CjsToolCache.js";

const GENERATED_INDEX_NAME = "audio";
const GENERATED_MEDIA_VERSION = 1;

/** Materializes raw Wwise bank members as a hash-safe generated index group. */
export class CjsToolAudioMediaBuilder
{

    #cache;

    #indexes;

    /** Creates a media builder over the shared cache and index authority. */
    constructor({ cache, indexes } = {})
    {
        if (!(cache instanceof CjsToolCache))
        {
            throw new TypeError(
                "CjsToolAudioMediaBuilder cache must be a CjsToolCache",
            );
        }
        if (!indexes || typeof indexes.InstallGeneratedIndex !== "function")
        {
            throw new TypeError(
                "CjsToolAudioMediaBuilder indexes must install generated indexes",
            );
        }

        this.#cache = cache;
        this.#indexes = indexes;
        Object.freeze(this);
    }

    /** Writes extractable WEM members and returns the augmented library. */
    async Build({
        target,
        game,
        provider,
        build,
        library,
        bankBytes,
    } = {})
    {
        RequireLibrary(library);

        if (!(bankBytes instanceof Map))
        {
            throw new TypeError("Materialized audio bankBytes must be a Map");
        }

        const media = CloneMediaTable(library.media);
        const entries = new Map();
        const bankProvenance = {};

        for (const [ mediaID, value ] of Object.entries(
            library.embeddedMedia ?? {},
        ))
        {
            const records = Array.isArray(value) ? value : [ value ];

            for (const record of records)
            {
                if (!IsWem(record.mediaType))
                {
                    continue;
                }

                const bankKey = String(record.bank ?? "");
                const bank = library.banks[bankKey];
                const bytes = bankBytes.get(bankKey);

                if (!bank || !(bytes instanceof Uint8Array))
                {
                    throw new Error(
                        `Materialized audio source bank is unavailable: ${bankKey}`,
                    );
                }

                const [ bankID, languageID ] = ParseBankKey(bankKey);
                const offset = ExactInteger(
                    record.offset,
                    `Audio media ${mediaID} offset`,
                );
                const byteLength = ExactInteger(
                    record.byteLength,
                    `Audio media ${mediaID} byteLength`,
                );
                const end = offset + byteLength;

                if (byteLength === 0 || end > bytes.byteLength)
                {
                    throw new RangeError(
                        `Audio media ${mediaID} exceeds bank ${bankKey}`,
                    );
                }

                const payload = bytes.subarray(offset, end);
                const logicalPath =
                    `res:/audio/bnk/${bankID}/${languageID}/${mediaID}.wem`;
                const checksum = crypto.createHash("md5")
                    .update(payload)
                    .digest("hex");
                const storagePath = resFileAddress(logicalPath, checksum);

                await this.#cache.WriteRemote(storagePath, payload, {
                    md5: checksum,
                    size: byteLength,
                });

                const entry = {
                    logicalPath,
                    location: storagePath,
                    checksum,
                    uncompressedSize: byteLength,
                    compressedSize: byteLength,
                };
                const existing = entries.get(logicalPath);

                if (existing
                    && (existing.location !== entry.location
                        || existing.uncompressedSize !== entry.uncompressedSize))
                {
                    throw new Error(
                        `Conflicting generated audio media: ${logicalPath}`,
                    );
                }
                entries.set(logicalPath, entry);
                AddMediaRecord(media, mediaID, {
                    sourceID: String(
                        record.sourceID
                        ?? `embedded:${mediaID}:${bankID}:${languageID}`,
                    ),
                    resPath: logicalPath,
                    storagePath,
                    checksum,
                    byteLength,
                    mediaType: "wem",
                    language: String(record.language ?? bank.language ?? ""),
                    ...(record.essential === undefined
                        ? {}
                        : { essential: Boolean(record.essential) }),
                });

                bankProvenance[bankKey] = {
                    bankID,
                    languageID,
                    resPath: String(bank.resPath),
                    storagePath: String(bank.storagePath ?? ""),
                    checksum: String(bank.checksum ?? ""),
                };
            }
        }

        if (entries.size === 0)
        {
            return Object.freeze({
                library,
                index: null,
                mediaCount: 0,
                byteLength: 0,
            });
        }

        const index = await this.#indexes.InstallGeneratedIndex({
            target,
            game,
            provider,
            build,
            name: GENERATED_INDEX_NAME,
            entries: [ ...entries.values() ],
            provenance: {
                schema: "carbon.audioBankMedia",
                version: GENERATED_MEDIA_VERSION,
                banks: SortedRecord(bankProvenance),
            },
        });
        const augmented = {
            ...library,
            media: SortedRecord(media),
        };

        return Object.freeze({
            library: augmented,
            index,
            mediaCount: entries.size,
            byteLength: [ ...entries.values() ].reduce(
                (total, entry) => total + entry.uncompressedSize,
                0,
            ),
        });
    }

    static indexName = GENERATED_INDEX_NAME;

    static version = GENERATED_MEDIA_VERSION;

    /** Reports whether a source carries the matching generated group stamp. */
    static isCurrent(library, source)
    {
        const overlay = source?.overlays?.find(value =>
            value.name === GENERATED_INDEX_NAME
            && value.storageKind === "generated-cache");
        const provenance = overlay?.provenance;

        if (provenance?.schema !== "carbon.audioBankMedia"
            || provenance?.version !== GENERATED_MEDIA_VERSION)
        {
            return false;
        }

        const bankKeys = MaterializableBankKeys(library);
        const recordedBankKeys = Object.keys(provenance.banks ?? {})
            .sort((left, right) => left.localeCompare(right, "en"));

        if (bankKeys.length !== recordedBankKeys.length
            || bankKeys.some((bankKey, index) =>
                bankKey !== recordedBankKeys[index]))
        {
            return false;
        }

        return bankKeys.every(bankKey =>
        {
            const bank = library.banks?.[bankKey];
            const recorded = provenance.banks?.[bankKey];

            return recorded
                && recorded.resPath === String(bank?.resPath ?? "")
                && recorded.storagePath === String(bank?.storagePath ?? "")
                && recorded.checksum === String(bank?.checksum ?? "");
        });
    }

}

function RequireLibrary(value)
{
    if (!value
        || typeof value !== "object"
        || Array.isArray(value)
        || value.schema !== "carbonenginejs.audioLibrary"
        || value.schemaVersion !== 2
        || !value.media
        || !value.banks)
    {
        throw new TypeError(
            "Materialized audio requires a schema-v2 audio library",
        );
    }
}

function ParseBankKey(value)
{
    const match = String(value).match(/^(0|[1-9]\d*):(0|[1-9]\d*)$/u);

    if (!match)
    {
        throw new TypeError(`Invalid materialized audio bank identity: ${value}`);
    }

    return [ match[1], match[2] ];
}

function ExactInteger(value, label)
{
    const result = Number(value);

    if (!Number.isSafeInteger(result) || result < 0)
    {
        throw new TypeError(`${label} must be a non-negative integer`);
    }

    return result;
}

function IsWem(value)
{
    return [ "wem", "audio/x-wem", "application/x-wem" ]
        .includes(String(value ?? "").trim().toLowerCase());
}

function CloneMediaTable(value)
{
    const result = {};

    for (const [ mediaID, record ] of Object.entries(value ?? {}))
    {
        const records = (Array.isArray(record) ? record : [ record ])
            .filter(item => !IsGeneratedMediaRecord(item));

        if (records.length)
        {
            result[mediaID] = records.length === 1 ? records[0] : records;
        }
    }

    return result;
}

function IsGeneratedMediaRecord(value)
{
    const resPath = String(
        value?.resPath ?? value?.logicalPath ?? value?.path ?? "",
    ).toLowerCase();

    return IsWem(value?.mediaType)
        && /^res:\/audio\/bnk\/\d+\/\d+\/\d+\.wem$/u.test(resPath);
}

function AddMediaRecord(table, mediaID, record)
{
    const current = table[mediaID];
    const records = current === undefined
        ? []
        : Array.isArray(current)
            ? [ ...current ]
            : [ current ];

    records.push(record);
    const unique = new Map();

    for (const value of records)
    {
        const path = String(
            value?.resPath ?? value?.logicalPath ?? value?.path ?? "",
        );
        const sourceID = String(value?.sourceID ?? "");
        const key = sourceID || path
            ? `${sourceID}\0${path}`
            : JSON.stringify(value);

        unique.set(key, value);
    }

    const normalized = [ ...unique.values() ];

    normalized.sort((left, right) => [
        String(left?.sourceID ?? ""),
        String(left?.resPath ?? left?.logicalPath ?? left?.path ?? ""),
    ].join("\0").localeCompare([
        String(right?.sourceID ?? ""),
        String(right?.resPath ?? right?.logicalPath ?? right?.path ?? ""),
    ].join("\0"), "en"));
    table[mediaID] = normalized.length === 1 ? normalized[0] : normalized;
}

function SortedRecord(value)
{
    return Object.fromEntries(Object.entries(value)
        .sort(([ left ], [ right ]) => left.localeCompare(right, "en")));
}

function MaterializableBankKeys(library)
{
    const result = new Set();

    for (const value of Object.values(library?.embeddedMedia ?? {}))
    {
        for (const record of Array.isArray(value) ? value : [ value ])
        {
            if (IsWem(record?.mediaType))
            {
                result.add(String(record.bank ?? ""));
            }
        }
    }

    return [ ...result ].sort((left, right) => left.localeCompare(right, "en"));
}
