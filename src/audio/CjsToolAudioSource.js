import crypto from "node:crypto";

import * as utils from "../utils.js";

const OPAQUE_MEDIA_TYPE = "application/octet-stream";

/** Resolves and reads playable media from one immutable audio library. */
export class CjsToolAudioSource
{

    #banks;

    #defaultLanguage;

    #embeddedMedia;

    #media;

    #paths;

    #selections = new WeakMap();

    #source;

    /** Validates a prepared v1 or v2 audio-library document. */
    static validateLibrary(library)
    {
        RequireAudioLibrary(library);
        return true;
    }

    constructor({ library, source, defaultLanguage = null } = {})
    {
        this.constructor.validateLibrary(library);

        if (!source
            || (typeof source.Fetch !== "function"
                && typeof source.FetchAudio !== "function"))
        {
            throw new TypeError(
                "CjsToolAudioSource source must provide Fetch(path) or FetchAudio(path)",
            );
        }

        this.#source = source;
        this.#defaultLanguage = NormalizeLanguage(
            defaultLanguage ?? library.eventMediaLanguage ?? "",
        );
        this.#paths = new Map();
        this.#media = CreateMediaIndex(library.media, source, this.#paths);
        this.#banks = CreateBankIndex(library.banks, source, this.#paths);
        this.#embeddedMedia = CreateEmbeddedIndex(
            library.embeddedMedia,
            this.#banks,
        );

        this.library = library;
        this.sourceTarget = String(library.sourceTarget ?? source.target ?? "");
        this.sourceGame = String(library.sourceGame ?? source.game ?? "");
        this.sourceProvider = String(library.sourceProvider ?? source.provider ?? "");
        this.sourceBuild = String(library.sourceBuild ?? source.build ?? "");

        RequireMatchingIdentity("target", library.sourceTarget, source.target);
        RequireMatchingIdentity("game", library.sourceGame, source.game);
        RequireMatchingIdentity("provider", library.sourceProvider, source.provider);
        RequireMatchingIdentity("build", library.sourceBuild, source.build);
        Object.freeze(this);
    }

    /** Resolves one canonical media ID without reading its source bytes. */
    ResolveMediaByID(mediaID, { mediaTypes = [], languages = [] } = {})
    {
        const id = NormalizeMediaID(mediaID);
        const candidates = [
            ...(this.#media.get(id) ?? []),
            ...(this.#embeddedMedia.get(id) ?? []),
        ];

        if (!candidates.length)
        {
            throw CreateStatusError(`Audio media ID not found: ${id}`, 404);
        }

        const acceptedTypes = NormalizeMediaTypes(mediaTypes);
        const acceptedLanguages = NormalizeLanguages(languages);
        const accepted = candidates
            .map(candidate => ({
                candidate,
                mediaTypeRank: MediaTypeRank(candidate.mediaType, acceptedTypes),
                languageRank: LanguageRank(
                    candidate.language,
                    acceptedLanguages,
                    this.#defaultLanguage,
                ),
            }))
            .filter(item =>
                Number.isFinite(item.mediaTypeRank)
                && Number.isFinite(item.languageRank))
            .sort((left, right) =>
                left.mediaTypeRank - right.mediaTypeRank
                || left.languageRank - right.languageRank
                || left.candidate.sourceRank - right.candidate.sourceRank
                || left.candidate.sourceID.localeCompare(
                    right.candidate.sourceID,
                    "en",
                ));

        if (!accepted.length)
        {
            throw CreateStatusError(
                `No acceptable representation is available for audio media ID ${id}`,
                406,
            );
        }

        return this.#CreateSelection(accepted[0].candidate, {
            mediaID: id,
            path: null,
        });
    }

    /** Resolves one exact registered audio path without selecting a variant. */
    ResolveMediaByPath(audioPath, { mediaTypes = [] } = {})
    {
        const normalized = NormalizeAudioPath(audioPath);
        const descriptor = this.#paths.get(normalized.key);

        if (!descriptor)
        {
            throw CreateStatusError(`Audio path not found: ${normalized.path}`, 404);
        }

        if (!Number.isFinite(
            MediaTypeRank(descriptor.mediaType, NormalizeMediaTypes(mediaTypes)),
        ))
        {
            throw CreateStatusError(
                `Audio path is not available in an acceptable representation: `
                + normalized.path,
                406,
            );
        }

        return this.#CreateSelection(descriptor, {
            mediaID: descriptor.mediaID,
            path: descriptor.path,
        });
    }

    /** Lists the exact registered source paths without reading their bytes. */
    ListSourcePaths()
    {
        return Object.freeze(
            [ ...new Set(
                [ ...this.#paths.values() ].map(descriptor => descriptor.path),
            ) ].sort((left, right) => left.localeCompare(right, "en")),
        );
    }

    /** Reads a complete or partial logical selection as detached bytes. */
    async Read(selection, { offset = 0, byteLength = null } = {})
    {
        const descriptor = this.#selections.get(selection);

        if (!descriptor)
        {
            throw new TypeError("Audio selection does not belong to this source");
        }

        let file;

        try
        {
            file = typeof this.#source.FetchAudio === "function"
                ? await this.#source.FetchAudio(descriptor.path, descriptor.record)
                : await this.#source.Fetch(descriptor.path);
        }
        catch (cause)
        {
            if (Number.isInteger(cause?.statusCode))
            {
                throw cause;
            }

            const unavailable = new Error(
                `Audio source is unavailable: ${descriptor.path}`,
                { cause },
            );

            unavailable.statusCode = 503;
            throw unavailable;
        }

        const sourceBytes = ToUint8Array(file?.bytes ?? file);
        const sourceOffset = descriptor.sourceOffset;
        const available = sourceBytes.byteLength - sourceOffset;
        const totalByteLength = descriptor.byteLength ?? available;

        if (sourceOffset < 0
            || available < 0
            || totalByteLength < 0
            || totalByteLength > available)
        {
            const error = new Error(
                `Indexed audio window exceeds its source bytes: ${descriptor.path}`,
            );

            error.statusCode = 503;
            throw error;
        }

        const range = NormalizeReadRange(offset, byteLength, totalByteLength);
        const start = sourceOffset + range.offset;
        const end = start + range.byteLength;
        const bytes = utils.toArrayBuffer(sourceBytes.subarray(start, end));

        return Object.freeze({
            mediaID: selection.mediaID,
            sourceID: selection.sourceID,
            path: selection.path,
            mediaType: selection.mediaType,
            language: selection.language,
            bytes,
            offset: range.offset,
            byteLength: bytes.byteLength,
            totalByteLength,
            complete: range.offset === 0 && bytes.byteLength === totalByteLength,
            etag: selection.etag,
        });
    }

    #CreateSelection(descriptor, { mediaID, path })
    {
        const selection = Object.freeze({
            mediaID,
            sourceID: descriptor.sourceID,
            path,
            mediaType: descriptor.mediaType,
            language: descriptor.language,
            totalByteLength: descriptor.byteLength,
            acceptRanges: descriptor.byteLength !== null,
            etag: CreateEtag(descriptor),
        });

        this.#selections.set(selection, descriptor);

        return selection;
    }

}

function RequireAudioLibrary(value)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError("Prepared audio library payload must be an object");
    }

    if (value.schema !== "carbonenginejs.audioLibrary")
    {
        throw new TypeError(`Unsupported audio-library schema: ${value.schema}`);
    }

    if (![ 1, 2 ].includes(value.schemaVersion))
    {
        throw new TypeError(
            `Unsupported audio-library schema version: ${value.schemaVersion}`,
        );
    }

    RequireRecordMap(value.media, "audio library media");
    RequireRecordMap(value.banks, "audio library banks");

    if (value.embeddedMedia !== undefined)
    {
        RequireRecordMap(value.embeddedMedia, "audio library embeddedMedia");
    }

    if (value.schemaVersion === 2)
    {
        RequireV2Banks(value.banks);

        if (value.embeddedMedia !== undefined)
        {
            RequireEmbeddedMedia(value.embeddedMedia, value.banks);
        }

        if (value.eventMedia !== undefined)
        {
            RequireEventMedia(
                value.eventMedia,
                value.eventMediaLanguage,
                value.media,
                value.embeddedMedia ?? {},
            );
        }

        if (value.music !== undefined)
        {
            RequireMusicGraph(value.music, value.media, value.embeddedMedia ?? {});
        }
    }
}

function RequireEmbeddedMedia(embeddedMedia, banks)
{
    for (const [ mediaID, mediaRecord ] of Object.entries(embeddedMedia))
    {
        RequirePositiveID(mediaID, `Audio library embedded media ${mediaID}`);

        const records = ExpandMediaRecords(mediaRecord);

        if (!records.length)
        {
            throw new TypeError(
                `Audio library embedded media ${mediaID} has no sources`,
            );
        }

        for (const record of records)
        {
            if (!record || typeof record !== "object" || Array.isArray(record))
            {
                throw new TypeError(
                    `Audio library embedded media ${mediaID} must contain objects`,
                );
            }

            const bank = String(record.bank ?? "");

            if (!banks[bank])
            {
                throw new TypeError(
                    `Audio library embedded media ${mediaID} references `
                    + `unknown bank ${bank}`,
                );
            }

            NormalizeNonNegativeInteger(
                record.offset,
                `Audio library embedded media ${mediaID} offset`,
            );
            NormalizePositiveInteger(
                record.byteLength,
                `Audio library embedded media ${mediaID} byteLength`,
            );
            NormalizeMediaType(record.mediaType);
        }
    }
}

function RequireRecordMap(value, label)
{
    if (!value || typeof value !== "object" || Array.isArray(value))
    {
        throw new TypeError(`${label} must be an object`);
    }
}

function RequireV2Banks(banks)
{
    for (const [ sourceID, bank ] of Object.entries(banks))
    {
        if (!bank || typeof bank !== "object" || Array.isArray(bank))
        {
            throw new TypeError(`Audio library bank ${sourceID} must be an object`);
        }

        const bankID = RequireUnsignedID(
            bank.bankID,
            `Audio library bank ${sourceID} bankID`,
        );
        const languageID = RequireUnsignedID(
            bank.languageID,
            `Audio library bank ${sourceID} languageID`,
        );
        const expected = `${bankID}:${languageID}`;

        if (sourceID !== expected || String(bank.sourceID ?? "") !== expected)
        {
            throw new TypeError(
                `Audio library bank identity must be ${expected}: ${sourceID}`,
            );
        }
    }
}

function RequireEventMedia(eventMedia, language, media, embeddedMedia)
{
    RequireRecordMap(eventMedia, "audio library eventMedia");

    const languageTag = String(language ?? "")
        .trim()
        .replaceAll("_", "-")
        .toLowerCase();

    if (languageTag
        && !/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u.test(languageTag))
    {
        throw new TypeError(
            `Audio library eventMediaLanguage is invalid: ${language}`,
        );
    }

    for (const [ name, values ] of Object.entries(eventMedia))
    {
        if (!Array.isArray(values))
        {
            throw new TypeError(
                `Audio library eventMedia.${name} must be an array`,
            );
        }

        const mediaIDs = values.map(value =>
            RequirePositiveID(value, `Audio library eventMedia.${name}`));

        RequireUniqueValues(mediaIDs, `Audio library eventMedia.${name}`);

        for (const mediaID of mediaIDs)
        {
            if (!media[mediaID] && !embeddedMedia[mediaID])
            {
                throw new TypeError(
                    `Audio library eventMedia.${name} references missing `
                    + `source ${mediaID}`,
                );
            }
        }
    }
}

function RequireMusicGraph(music, media, embeddedMedia)
{
    if (!music || typeof music !== "object" || Array.isArray(music))
    {
        throw new TypeError("Audio library music must be an object");
    }

    if (music.schemaVersion !== 1)
    {
        throw new TypeError(
            `Unsupported audio music schema version: ${music.schemaVersion}`,
        );
    }

    RequireRecordMap(music.nodes, "audio library music nodes");

    if (!Array.isArray(music.banks))
    {
        throw new TypeError("Audio library music banks must be an array");
    }

    const musicBanks = music.banks.map(value => NormalizeBankName(value));

    RequireUniqueValues(musicBanks, "Audio library music banks");

    for (const [ id, node ] of Object.entries(music.nodes))
    {
        RequirePositiveID(id, `Audio library music node ${id}`);

        if (!node || typeof node !== "object" || Array.isArray(node))
        {
            throw new TypeError(`Audio library music node ${id} must be an object`);
        }

        if (![
            "music-segment",
            "music-track",
            "music-switch-container",
            "music-playlist-container",
        ].includes(node.type))
        {
            throw new TypeError(
                `Audio library music node ${id} has invalid type: ${node.type}`,
            );
        }

        if (!musicBanks.includes(NormalizeBankName(node.bank)))
        {
            throw new TypeError(
                `Audio library music node ${id} references unknown bank: ${node.bank}`,
            );
        }

        RequireIDArray(
            node.children ?? [],
            `Audio library music node ${id} children`,
            childID =>
            {
                if (!music.nodes[childID])
                {
                    throw new TypeError(
                        `Audio library music node ${id} references missing child ${childID}`,
                    );
                }
            },
        );

        if (node.type === "music-track")
        {
            if (!Array.isArray(node.sources))
            {
                throw new TypeError(
                    `Audio library music track ${id} sources must be an array`,
                );
            }

            for (const source of node.sources)
            {
                const sourceID = RequirePositiveID(
                    source?.sourceId,
                    `Audio library music track ${id} source`,
                );

                if (!media[sourceID] && !embeddedMedia[sourceID])
                {
                    throw new TypeError(
                        `Audio library music track ${id} references missing source ${sourceID}`,
                    );
                }
            }
        }
    }

    for (const field of [ "eventTargets", "eventStops" ])
    {
        RequireRecordMap(music[field], `audio library music ${field}`);

        for (const [ name, targets ] of Object.entries(music[field]))
        {
            RequireIDArray(
                targets,
                `Audio library music ${field}.${name}`,
                targetID =>
                {
                    if (!music.nodes[targetID])
                    {
                        throw new TypeError(
                            `Audio library music ${field}.${name} `
                            + `references missing node ${targetID}`,
                        );
                    }
                },
            );
        }
    }

    RequireRecordMap(
        music.switchSetters,
        "audio library music switchSetters",
    );

    for (const [ name, setters ] of Object.entries(music.switchSetters))
    {
        if (!Array.isArray(setters))
        {
            throw new TypeError(
                `Audio library music switchSetters.${name} must be an array`,
            );
        }

        const keys = [];

        for (const setter of setters)
        {
            if (!setter || typeof setter !== "object" || Array.isArray(setter)
                || ![ "switch", "state" ].includes(setter.kind))
            {
                throw new TypeError(
                    `Audio library music switchSetters.${name} has an invalid setter`,
                );
            }

            const groupID = RequireUnsignedID(
                setter.groupId,
                `Audio library music switchSetters.${name} groupId`,
            );
            const targetID = RequireUnsignedID(
                setter.targetId,
                `Audio library music switchSetters.${name} targetId`,
            );

            keys.push(`${setter.kind}:${groupID}:${targetID}`);
        }

        RequireUniqueValues(
            keys,
            `Audio library music switchSetters.${name}`,
        );
    }
}

function RequireIDArray(value, label, onID)
{
    if (!Array.isArray(value))
    {
        throw new TypeError(`${label} must be an array`);
    }

    const ids = value.map(item => RequirePositiveID(item, label));

    RequireUniqueValues(ids, label);

    for (const id of ids)
    {
        onID(id);
    }
}

function RequireUniqueValues(values, label)
{
    if (new Set(values).size !== values.length)
    {
        throw new TypeError(`${label} must not contain duplicates`);
    }
}

function RequirePositiveID(value, label)
{
    const id = RequireUnsignedID(value, label);

    if (id === "0")
    {
        throw new TypeError(`${label} must be positive`);
    }

    return id;
}

function RequireUnsignedID(value, label)
{
    const text = String(value ?? "").trim();
    const numeric = Number(text);

    if (!/^(?:0|[1-9]\d*)$/u.test(text)
        || !Number.isSafeInteger(numeric)
        || numeric < 0
        || numeric > 0xffffffff)
    {
        throw new TypeError(`${label} must be an unsigned 32-bit integer`);
    }

    return text;
}

function RequireMatchingIdentity(label, libraryValue, sourceValue)
{
    if (libraryValue !== undefined
        && libraryValue !== null
        && sourceValue !== undefined
        && sourceValue !== null
        && String(libraryValue).toLowerCase() !== String(sourceValue).toLowerCase())
    {
        throw new Error(
            `Audio library ${label} mismatch: ${libraryValue} !== ${sourceValue}`,
        );
    }
}

function CreateMediaIndex(media, source, paths)
{
    const index = new Map();

    for (const [ value, mediaRecord ] of Object.entries(media))
    {
        const mediaID = NormalizeMediaID(value);
        const records = ExpandMediaRecords(mediaRecord);
        const descriptors = records.map((record, recordIndex) =>
            CreateFileDescriptor(record, source, {
                mediaID,
                sourceID: record.sourceID ?? `media:${mediaID}:${recordIndex}`,
                sourceRank: IsPrepared(record) ? 0 : 1,
            }));

        if (!descriptors.length)
        {
            throw new TypeError(`Audio media ${mediaID} has no source records`);
        }

        for (const descriptor of descriptors)
        {
            RegisterPath(paths, descriptor);
        }

        index.set(mediaID, descriptors);
    }

    return index;
}

function ExpandMediaRecords(value)
{
    if (Array.isArray(value))
    {
        return value;
    }

    if (value
        && typeof value === "object"
        && !Array.isArray(value)
        && Array.isArray(value.sources))
    {
        return value.sources;
    }

    return [ value ];
}

function CreateBankIndex(banks, source, paths)
{
    const index = new Map();

    for (const [ bankName, record ] of Object.entries(banks))
    {
        const descriptor = CreateFileDescriptor(record, source, {
            mediaID: null,
            sourceID: record.sourceID ?? `bank:${bankName}`,
            sourceRank: 2,
        });
        const key = NormalizeBankName(bankName);

        if (index.has(key))
        {
            throw new TypeError(`Duplicate audio bank name: ${bankName}`);
        }

        index.set(key, descriptor);
        RegisterPath(paths, descriptor);
    }

    return index;
}

function CreateEmbeddedIndex(embeddedMedia = {}, banks)
{
    const index = new Map();

    for (const [ value, mediaRecord ] of Object.entries(embeddedMedia))
    {
        const mediaID = NormalizeMediaID(value);
        const records = ExpandMediaRecords(mediaRecord);
        const descriptors = [];

        if (!records.length)
        {
            throw new TypeError(
                `Embedded audio media ${mediaID} has no source records`,
            );
        }

        for (const record of records)
        {
            if (!record || typeof record !== "object" || Array.isArray(record))
            {
                throw new TypeError(
                    `Embedded audio media ${mediaID} must contain objects`,
                );
            }

            const bankName = NormalizeBankName(record.bank);
            const bank = banks.get(bankName);

            if (!bank)
            {
                throw new TypeError(
                    `Embedded audio media ${mediaID} references unknown bank: `
                    + record.bank,
                );
            }

            const sourceOffset = NormalizeNonNegativeInteger(
                record.offset,
                `Embedded audio media ${mediaID} offset`,
            );
            const byteLength = NormalizePositiveInteger(
                record.byteLength,
                `Embedded audio media ${mediaID} byteLength`,
            );

            descriptors.push(Object.freeze({
                ...bank,
                mediaID,
                sourceID: record.sourceID
                    ?? `embedded:${mediaID}:${bankName}`,
                sourceOffset,
                byteLength,
                mediaType: NormalizeMediaType(record.mediaType ?? bank.mediaType),
                language: NormalizeLanguage(record.language ?? bank.language),
                sourceRank: 2,
                record,
            }));
        }

        index.set(mediaID, descriptors);
    }

    return index;
}

function CreateFileDescriptor(record, source, options)
{
    const {
        mediaID,
        sourceID,
        sourceRank,
    } = options;

    if (!record || typeof record !== "object" || Array.isArray(record))
    {
        throw new TypeError(`Audio source ${sourceID} must be an object`);
    }

    const normalized = NormalizeAudioPath(
        record.path ?? record.logicalPath ?? record.resPath,
    );
    let byteLength = OptionalByteLength(record.byteLength);

    if (byteLength === null && typeof source.Resolve === "function")
    {
        try
        {
            const resolution = source.Resolve(normalized.path);

            byteLength = OptionalByteLength(
                resolution?.record?.uncompressedSize
                ?? resolution?.record?.byteLength,
            );
        }
        catch
        {
            // A registered generated source may not belong to the app/res index.
        }
    }

    return Object.freeze({
        mediaID,
        sourceID: String(sourceID),
        sourceRank,
        sourceOffset: 0,
        path: normalized.path,
        pathKey: normalized.key,
        byteLength,
        checksum: String(record.checksum ?? record.md5 ?? "").trim().toLowerCase(),
        mediaType: NormalizeMediaType(record.mediaType),
        language: NormalizeLanguage(record.language),
        record,
    });
}

function RegisterPath(paths, descriptor)
{
    const previous = paths.get(descriptor.pathKey);

    if (previous && previous !== descriptor)
    {
        throw new TypeError(`Duplicate audio path: ${descriptor.path}`);
    }

    paths.set(descriptor.pathKey, descriptor);
}

function NormalizeMediaID(value)
{
    const mediaID = String(value ?? "").trim();

    if (!/^[1-9]\d*$/u.test(mediaID))
    {
        throw new TypeError(`Audio media ID must be a canonical positive decimal: ${value}`);
    }

    return mediaID;
}

function NormalizeAudioPath(value)
{
    const path = String(value ?? "").trim().replaceAll("\\", "/");

    if (!path || path.includes("\0"))
    {
        throw new TypeError("Audio path must be non-empty");
    }

    const segments = path.split("/");

    if (segments.some(segment => segment === "." || segment === ".."))
    {
        throw new TypeError(`Audio path contains traversal: ${value}`);
    }

    return Object.freeze({
        path,
        key: path.toLowerCase(),
    });
}

function NormalizeBankName(value)
{
    const bankName = String(value ?? "").trim().toLowerCase();

    if (!bankName || bankName.includes("/") || bankName.includes("\\"))
    {
        throw new TypeError(`Invalid audio bank name: ${value}`);
    }

    return bankName;
}

function NormalizeMediaType(value)
{
    const aliases = {
        wem: "audio/x-wem",
        midi: "audio/midi",
        plugin: OPAQUE_MEDIA_TYPE,
        unknown: OPAQUE_MEDIA_TYPE,
    };
    const input = String(value ?? OPAQUE_MEDIA_TYPE)
        .split(";", 1)[0]
        .trim()
        .toLowerCase();
    const mediaType = aliases[input] ?? input;

    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType))
    {
        throw new TypeError(`Invalid audio media type: ${value}`);
    }

    return mediaType;
}

function NormalizeMediaTypes(values)
{
    if (!Array.isArray(values))
    {
        throw new TypeError("Audio mediaTypes must be an array");
    }

    return values.map(value =>
    {
        const mediaType = String(value ?? "").trim().toLowerCase();

        if (!/^(?:\*\/\*|[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+))$/u
            .test(mediaType))
        {
            throw new TypeError(`Invalid accepted audio media type: ${value}`);
        }

        return mediaType;
    });
}

function MediaTypeRank(mediaType, accepted)
{
    if (!accepted.length)
    {
        return 0;
    }

    for (let index = 0; index < accepted.length; index++)
    {
        const candidate = accepted[index];
        const [ candidateType ] = candidate.split("/");

        if (candidate === "*/*"
            || candidate === mediaType
            || (candidate.endsWith("/*") && mediaType.startsWith(`${candidateType}/`)))
        {
            return index;
        }
    }

    return Number.POSITIVE_INFINITY;
}

function NormalizeLanguages(values)
{
    if (!Array.isArray(values))
    {
        throw new TypeError("Audio languages must be an array");
    }

    return values.map(value =>
    {
        const language = NormalizeLanguage(value);

        if (language !== "*" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(language))
        {
            throw new TypeError(`Invalid accepted audio language: ${value}`);
        }

        return language;
    });
}

function NormalizeLanguage(value)
{
    return String(value ?? "").trim().replaceAll("_", "-").toLowerCase();
}

function LanguageRank(language, accepted, defaultLanguage)
{
    if (accepted.length)
    {
        for (let index = 0; index < accepted.length; index++)
        {
            if (LanguageMatches(language, accepted[index]))
            {
                return index;
            }
        }

        return language ? Number.POSITIVE_INFINITY : accepted.length;
    }

    if (defaultLanguage)
    {
        if (LanguageMatches(language, defaultLanguage))
        {
            return 0;
        }

        return language ? 2 : 1;
    }

    return 0;
}

function LanguageMatches(language, accepted)
{
    if (accepted === "*")
    {
        return true;
    }

    return language === accepted
        || language.startsWith(`${accepted}-`)
        || accepted.startsWith(`${language}-`);
}

function IsPrepared(record)
{
    const kind = String(record.sourceKind ?? record.kind ?? "").toLowerCase();

    return record.prepared === true
        || [ "converted", "prepared" ].includes(kind);
}

function OptionalByteLength(value)
{
    if (value === undefined || value === null || value === "")
    {
        return null;
    }

    const byteLength = Number(value);

    return Number.isSafeInteger(byteLength) && byteLength >= 0
        ? byteLength
        : null;
}

function NormalizeNonNegativeInteger(value, label)
{
    const result = Number(value);

    if (!Number.isSafeInteger(result) || result < 0)
    {
        throw new TypeError(`${label} must be a non-negative integer`);
    }

    return result;
}

function NormalizePositiveInteger(value, label)
{
    const result = Number(value);

    if (!Number.isSafeInteger(result) || result < 1)
    {
        throw new TypeError(`${label} must be a positive integer`);
    }

    return result;
}

function NormalizeReadRange(offsetValue, byteLengthValue, totalByteLength)
{
    const offset = NormalizeNonNegativeInteger(offsetValue, "Audio read offset");
    const byteLength = byteLengthValue === null || byteLengthValue === undefined
        ? totalByteLength - offset
        : NormalizeNonNegativeInteger(byteLengthValue, "Audio read byteLength");

    if (offset > totalByteLength || byteLength > totalByteLength - offset)
    {
        throw new RangeError(
            `Audio read range exceeds ${totalByteLength} bytes`,
        );
    }

    return { offset, byteLength };
}

function ToUint8Array(value)
{
    if (value instanceof Uint8Array)
    {
        return value;
    }

    if (value instanceof ArrayBuffer)
    {
        return new Uint8Array(value);
    }

    throw new TypeError("Audio source bytes must be a Uint8Array or ArrayBuffer");
}

function CreateEtag(descriptor)
{
    const identity = [
        descriptor.checksum,
        descriptor.pathKey,
        descriptor.sourceOffset,
        descriptor.byteLength ?? "",
        descriptor.mediaType,
    ].join("\0");
    const digest = crypto.createHash("sha256").update(identity).digest("hex");

    return descriptor.checksum ? `"${digest}"` : `W/"${digest}"`;
}

function CreateStatusError(message, statusCode)
{
    const error = new Error(message);

    error.statusCode = statusCode;

    return error;
}
