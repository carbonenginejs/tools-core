// Audio-library builder: joins publishable sources into one deterministic
// artifact ("carbonenginejs.audioLibrary") that runtime-audio consumes
// headlessly. Mirrors src/character conventions: no remote reads here -
// acquisition happens via @carbonenginejs/tools-core/index beforehand; this
// stage takes local inputs only.
//
// Sources:
// - resfileindex entries filtered to res:/audio/ (bnk/wem storage + sizes)
// - raw Wwise SoundbanksInfo.json (publishable; event->id/banks, wems)
// - OPTIONAL enrichment: caller-supplied plain JSON metadata overlay
//   (radius/loop/2D/vital/stops/essential).
// Targeted subpath import: audioMetadata.js is a dependency-free pure module
// (no schema classes, no core-types) - tools-core loads exactly this file and
// none of runtime-audio's runtime graph.
import { audioMetadataFromSoundbanksInfo } from "@carbonenginejs/runtime-audio/audioMetadata";
import { CjsBnkFormat } from "@carbonenginejs/runtime-resource/formats/bnk";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";

const TargetRegistry = new CjsToolTargetRegistry();
const MUSIC_BANK_NAMES = Object.freeze([ "music.bnk", "music_essential.bnk" ]);
const MUSIC_EVENT_BANK_NAME = "common.bnk";
const MUSIC_HIRC_TYPES = new Set([ 10, 11, 12, 13 ]);
const AUDIO_LANGUAGE_TAGS = Object.freeze({
    chinese: "zh-cn",
    "chinese(prc)": "zh-cn",
    "english(us)": "en-us",
    "french(france)": "fr-fr",
    german: "de",
    japanese: "ja",
    korean: "ko",
    russian: "ru",
    sfx: "",
    spanish: "es",
});

/** Stateless construction of deterministic audio-library artifacts. */
export class CjsToolAudioBuilder
{

    static schema = "carbonenginejs.audioLibrary";

    static schemaVersion = 2;

    static parseIndexEntries(indexText)
    {
        const entries = [];
        for (const line of String(indexText).split(/\r?\n/))
        {
            if (!line)
            {
                continue;
            }
            const [ logicalPath, storagePath, checksum, byteLength ] = line.split(",");
            if (!logicalPath || !logicalPath.toLowerCase().startsWith("res:/audio/"))
            {
                continue;
            }
            entries.push({
                logicalPath,
                storagePath: storagePath || "",
                checksum: checksum || "",
                byteLength: Number(byteLength) || 0
            });
        }
        return entries;
    }

    static createEventMediaTable(metadata, bankResults)
    {
        const namesByID = new Map();
        for (const [ name, record ] of Object.entries(metadata.Events))
        {
            namesByID.set(record.eventID >>> 0, name);
        }
        const table = {};
        for (const result of bankResults)
        {
            for (const [ eventID, wemIDs ] of result.eventMedia)
            {
                const name = namesByID.get(eventID >>> 0);
                if (!name)
                {
                    continue;
                }
                const merged = new Set(table[name] ?? []);
                for (const wemID of wemIDs)
                {
                    merged.add(String(wemID));
                }
                table[name] = [ ...merged ].sort((a, b) => Number(a) - Number(b));
            }
        }
        return table;
    }

    /**
     * Resolves event graphs with explicit bank and language precedence.
     *
     * Localized variants share a bank ID and reuse HIRC object IDs. One
     * requested language is therefore selected before graph resolution rather
     * than unioning incompatible event choices. Source-name ordering preserves
     * authored overlay behavior such as music_essential replacing the
     * corresponding base music objects.
     */
    static createEventMediaGraphs(inspections, options = {})
    {
        if (!Array.isArray(inspections))
        {
            throw new TypeError(
                "Audio event-media construction requires bank inspections",
            );
        }

        const {
            language = "",
            ...graphOptions
        } = options;
        const requestedLanguage = String(language ?? "")
            .trim()
            .replaceAll("_", "-")
            .toLowerCase();
        const groups = new Map();

        for (const inspection of inspections)
        {
            const bankID = NormalizeUnsignedID(
                inspection?.bankId,
                "Audio inspection bankId",
            );
            const languageID = NormalizeUnsignedID(
                inspection?.languageId ?? 0,
                `Audio inspection ${bankID} languageId`,
            );
            const group = groups.get(bankID) ?? [];

            if (group.some(value =>
                NormalizeUnsignedID(value.languageId ?? 0, "Audio languageId")
                    === languageID))
            {
                throw new TypeError(
                    `Duplicate audio inspection identity ${bankID}:${languageID}`,
                );
            }

            group.push(inspection);
            groups.set(bankID, group);
        }

        const shared = [];
        const variants = [];

        for (const group of groups.values())
        {
            group.sort(CompareBankInspections);

            if (group.length === 1
                && !String(group[0].language ?? "").trim())
            {
                shared.push(group[0]);
            }
            else
            {
                variants.push(group);
            }
        }

        if (!variants.length)
        {
            return [
                CjsBnkFormat.wwise.eventMediaFromBanks(
                    [ ...shared ].sort(CompareBankInspections),
                    graphOptions,
                ),
            ];
        }

        const selected = [ ...shared ];
        let matchedLanguage = !requestedLanguage;

        for (const group of variants)
        {
            const exact = group.find(value =>
                String(value.language ?? "").toLowerCase()
                    === requestedLanguage);
            const inspection = exact
                ?? group.find(value =>
                    !String(value.language ?? "").trim())
                ?? (!requestedLanguage ? group[0] : null);

            if (exact)
            {
                matchedLanguage = true;
            }
            if (inspection)
            {
                selected.push(inspection);
            }
        }

        if (!matchedLanguage)
        {
            throw new Error(
                `Audio event-media language is unavailable: ${requestedLanguage}`,
            );
        }

        return [
            CjsBnkFormat.wwise.eventMediaFromBanks(
                selected.sort(CompareBankInspections),
                graphOptions,
            ),
        ];
    }

    /**
     * Builds the dynamic-music section from already inspected BNK files.
     *
     * Inspections must carry their source bank name. The format package owns
     * all HIRC payload decoding; this method only validates and projects the
     * parsed graph into the audio-library contract.
     */
    static createMusicGraph({
        inspections,
        metadata,
        media = {},
        embeddedMedia = {},
        musicBankNames = MUSIC_BANK_NAMES,
        eventBankName = MUSIC_EVENT_BANK_NAME,
    } = {})
    {
        if (!Array.isArray(inspections))
        {
            throw new TypeError("Audio music construction requires bank inspections");
        }

        const byName = new Map();

        for (const inspection of inspections)
        {
            const name = BankSourceName(inspection?.source);

            if (!name)
            {
                throw new TypeError("Audio bank inspection is missing its source name");
            }

            if (byName.has(name))
            {
                throw new TypeError(`Duplicate audio bank inspection source: ${name}`);
            }

            byName.set(name, inspection);
        }

        const requiredNames = [
            ...musicBankNames.map(BankSourceName),
            BankSourceName(eventBankName),
        ];

        for (const name of requiredNames)
        {
            if (!byName.has(name))
            {
                throw new Error(`Music construction requires inspected bank: ${name}`);
            }
        }

        const musicInspections = musicBankNames.map(name =>
            byName.get(BankSourceName(name)));
        const musicEntries = musicInspections.flatMap(inspection =>
            (inspection.hirc ?? [])
                .filter(entry => MUSIC_HIRC_TYPES.has(entry.type)));
        const musicEntryCount = musicEntries.length;
        const uniqueMusicEntryCount = new Set(
            musicEntries.map(entry => entry.id >>> 0),
        ).size;
        let parsed;

        try
        {
            // Authored duplicate IDs are resolved in bank order. The essential
            // bank is intentionally later and therefore replaces the base
            // definition, matching Wwise loading and the transitional builder.
            parsed = CjsBnkFormat.wwise.musicNodesFromBanks(musicInspections);
        }
        catch (cause)
        {
            throw new Error("Music-node parsing failed", { cause });
        }

        if (parsed.diagnostics.failed.length)
        {
            const details = parsed.diagnostics.failed
                .map(failure => `${failure.bank}:${failure.type}:${failure.id}`)
                .join(", ");

            throw new Error(`Music-node parsing failed: ${details}`);
        }

        if (parsed.diagnostics.parsed !== musicEntryCount
            || parsed.nodes.size !== uniqueMusicEntryCount)
        {
            throw new Error(
                "Music-node parsing did not preserve every authored entry",
            );
        }

        const nodes = {};

        for (const [ id, value ] of [ ...parsed.nodes.entries() ]
            .sort(([ left ], [ right ]) => left - right))
        {
            const { id: parsedID, ...node } = value;

            if ((parsedID >>> 0) !== (id >>> 0))
            {
                throw new Error(`Music-node identity mismatch: ${parsedID} !== ${id}`);
            }

            nodes[id] = node;
        }

        ValidateMusicNodeReferences(nodes, media, embeddedMedia);

        const eventProjection = CreateMusicEventProjection(
            byName.get(BankSourceName(eventBankName)),
            metadata,
            nodes,
        );

        return {
            schemaVersion: 1,
            generator: "@carbonenginejs/tools-core/audio",
            banks: musicBankNames.map(BankSourceName),
            nodes,
            ...eventProjection,
        };
    }

    /** Classifies embedded media by its four-byte container magic. */
    static mediaTypeFromMagic(bytes, offset = 0)
    {
        const value = ToUint8Array(bytes);
        const at = Number(offset);

        if (!Number.isSafeInteger(at) || at < 0 || at + 4 > value.byteLength)
        {
            return "unknown";
        }

        const magic = String.fromCharCode(
            value[at],
            value[at + 1],
            value[at + 2],
            value[at + 3],
        );

        if (magic === "RIFF" || magic === "RIFX")
        {
            return "wem";
        }
        if (magic === "MIDI")
        {
            return "midi";
        }
        if (magic === "PLUG")
        {
            return "plugin";
        }
        return "unknown";
    }

    static build(options, { targets = TargetRegistry } = {})
    {
        const {
            indexEntries = [],
            soundbanksInfo,
            enrichment = null,
            eventMedia = null,
            eventMediaLanguage = null,
            embeddedMedia = null,
            bankIdentities = null,
            music = null,
            sourceTarget = null,
            sourceGame = null,
            sourceProvider = null,
            sourceBuild = null,
            generatedAt = null,
        } = options;
        const target = ResolveLibraryTarget({
            target: sourceTarget,
            game: sourceGame,
            provider: sourceProvider,
        }, targets);
        const metadata = audioMetadataFromSoundbanksInfo(soundbanksInfo, enrichment);
        const media = {};
        const banks = CreateBankTable(
            indexEntries,
            soundbanksInfo,
            bankIdentities,
        );

        for (const entry of indexEntries)
        {
            const lower = entry.logicalPath.toLowerCase();
            const base = lower.split("/").pop();
            if (base.endsWith(".wem"))
            {
                const id = base.slice(0, -4);
                AddSourceRecord(media, id, {
                    resPath: entry.logicalPath,
                    storagePath: entry.storagePath,
                    byteLength: entry.byteLength,
                    checksum: entry.checksum,
                    essential: lower.includes("/essential_media/"),
                    language: LanguageSegment(lower)
                });
            }
        }

        const library = {
            schema: this.schema,
            schemaVersion: this.schemaVersion,
            metadata: SortedKeys({
                Events: SortedKeys(metadata.Events),
                SoundBanks: SortedKeys(metadata.SoundBanks),
                WemFileIDs: SortedKeys(metadata.WemFileIDs)
            }),
            media: NormalizeSourceTable(media),
            banks: SortedKeys(banks)
        };
        if (eventMedia && Object.keys(eventMedia).length)
        {
            library.eventMedia = SortedKeys(eventMedia);
            library.eventMediaLanguage = eventMediaLanguage === null
                ? ""
                : String(eventMediaLanguage);
        }
        if (embeddedMedia && Object.keys(embeddedMedia).length)
        {
            library.embeddedMedia = NormalizeSourceTable(embeddedMedia);
        }
        if (music !== null)
        {
            ValidateMusicGraph(
                music,
                library.media,
                library.embeddedMedia ?? {},
            );
            library.music = NormalizeMusicGraph(music);
        }
        if (target)
        {
            library.sourceTarget = target.id;
            library.sourceGame = target.game;
            library.sourceProvider = target.provider;
        }
        if (sourceBuild !== null)
        {
            library.sourceBuild = String(sourceBuild);
        }
        if (generatedAt !== null)
        {
            library.generatedAt = String(generatedAt);
        }
        return library;
    }

}

function CreateBankTable(indexEntries, soundbanksInfo, bankIdentities)
{
    const authoredBanks = CjsBnkFormat.wwise.parseSoundbanksInfo(soundbanksInfo).banks;
    const identities = NormalizeBankIdentities(bankIdentities);
    const banks = {};

    for (const entry of indexEntries)
    {
        const logicalPath = String(entry.logicalPath ?? "");
        const base = logicalPath.toLowerCase().split("/").pop();

        if (!base?.endsWith(".bnk"))
        {
            continue;
        }

        const authored = MatchAuthoredBank(logicalPath, authoredBanks);

        if (!authored)
        {
            throw new TypeError(
                `Audio bank source has no SoundbanksInfo identity: ${logicalPath}`,
            );
        }

        const override = identities.get(logicalPath.toLowerCase()) ?? null;
        const bankID = NormalizeUnsignedID(
            override?.bankID ?? authored.id,
            `Audio bank ${logicalPath} bankID`,
        );
        const authoredLanguageID = authored.language
            ? CjsBnkFormat.wwise.wwiseIdFromName(authored.language)
            : 0;
        const languageID = NormalizeUnsignedID(
            override?.languageID ?? authoredLanguageID,
            `Audio bank ${logicalPath} languageID`,
        );

        if (override?.bankID !== undefined
            && String(bankID) !== String(NormalizeUnsignedID(
                authored.id,
                `SoundbanksInfo bank ${authored.shortName} ID`,
            )))
        {
            throw new Error(
                `Audio bank identity mismatch for ${logicalPath}: `
                + `${bankID} !== ${authored.id}`,
            );
        }
        if (override?.languageID !== undefined
            && String(languageID) !== String(NormalizeUnsignedID(
                authoredLanguageID,
                `SoundbanksInfo bank ${authored.shortName} language ID`,
            )))
        {
            throw new Error(
                `Audio bank language identity mismatch for ${logicalPath}: `
                + `${languageID} !== ${authoredLanguageID}`,
            );
        }

        const sourceID = `${bankID}:${languageID}`;

        if (banks[sourceID])
        {
            throw new TypeError(
                `Duplicate audio bank identity ${sourceID}: `
                + `${banks[sourceID].resPath} and ${logicalPath}`,
            );
        }

        banks[sourceID] = {
            sourceID,
            bankID,
            languageID,
            language: AudioLanguageTag(authored.language),
            authoredLanguage: String(authored.language ?? ""),
            shortName: String(authored.shortName ?? ""),
            resPath: logicalPath,
            storagePath: entry.storagePath,
            byteLength: entry.byteLength,
            checksum: entry.checksum,
        };
    }

    return SortedKeys(banks);
}

function MatchAuthoredBank(logicalPath, authoredBanks)
{
    const path = NormalizeBankPath(logicalPath);
    const tail = path.replace(/^res:\/audio\//u, "");
    const base = tail.split("/").pop();
    const stem = base?.replace(/\.bnk$/u, "") ?? "";
    const scored = [];

    for (const bank of authoredBanks)
    {
        const authoredPath = NormalizeBankPath(bank.path)
            .replace(/^soundbanks\//u, "");
        const authoredBase = authoredPath.split("/").pop()
            || `${String(bank.shortName).toLowerCase()}.bnk`;
        let score = 0;

        if (authoredPath && tail.endsWith(authoredPath)) score += 100;
        if (base === authoredBase) score += 50;
        if (stem === String(bank.id)) score += 50;
        if (stem === String(bank.shortName).toLowerCase()) score += 50;

        const language = NormalizeLanguageToken(bank.language);

        if (language && NormalizeLanguageToken(tail).includes(language))
        {
            score += 20;
        }

        if (score)
        {
            scored.push({ bank, score });
        }
    }

    scored.sort((left, right) => right.score - left.score);

    if (!scored.length)
    {
        return null;
    }

    if (scored.length > 1 && scored[0].score === scored[1].score)
    {
        throw new TypeError(`Ambiguous SoundbanksInfo identity for ${logicalPath}`);
    }

    return scored[0].bank;
}

function NormalizeBankIdentities(value)
{
    const identities = new Map();

    if (value === null || value === undefined)
    {
        return identities;
    }

    const entries = value instanceof Map ? value.entries() : Object.entries(value);

    for (const [ sourcePath, identity ] of entries)
    {
        if (!identity || typeof identity !== "object" || Array.isArray(identity))
        {
            throw new TypeError(`Invalid audio bank identity for ${sourcePath}`);
        }

        identities.set(String(sourcePath).toLowerCase(), identity);
    }

    return identities;
}

function NormalizeUnsignedID(value, label)
{
    const numeric = Number(value);

    if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 0xffffffff)
    {
        throw new TypeError(`${label} must be an unsigned 32-bit integer`);
    }

    return String(numeric >>> 0);
}

function NormalizeBankPath(value)
{
    return String(value ?? "").trim().replaceAll("\\", "/").toLowerCase();
}

function CompareBankInspections(left, right)
{
    return CompareText(
        BankSourceName(left?.source),
        BankSourceName(right?.source),
    )
        || CompareText(
            NormalizeBankPath(left?.resPath),
            NormalizeBankPath(right?.resPath),
        )
        || (Number(left?.bankId ?? 0) >>> 0)
            - (Number(right?.bankId ?? 0) >>> 0)
        || (Number(left?.languageId ?? 0) >>> 0)
            - (Number(right?.languageId ?? 0) >>> 0);
}

function AddSourceRecord(table, key, record)
{
    const current = table[key];

    if (current === undefined)
    {
        table[key] = record;
    }
    else if (Array.isArray(current))
    {
        current.push(record);
    }
    else
    {
        table[key] = [ current, record ];
    }
}

function NormalizeSourceTable(table)
{
    const result = {};

    for (const key of Object.keys(table).sort())
    {
        const input = Array.isArray(table[key]) ? table[key] : [ table[key] ];
        const unique = new Map();

        for (const record of input)
        {
            unique.set(JSON.stringify(record), record);
        }

        const records = [ ...unique.values() ].sort(CompareSourceRecords);

        result[key] = records.length === 1 ? records[0] : records;
    }

    return result;
}

function CompareSourceRecords(left, right)
{
    const leftKey = [
        left?.sourceID,
        left?.bank,
        left?.resPath ?? left?.logicalPath ?? left?.path,
        left?.language,
        left?.offset,
        left?.byteLength,
    ].map(value => String(value ?? "")).join("\0");
    const rightKey = [
        right?.sourceID,
        right?.bank,
        right?.resPath ?? right?.logicalPath ?? right?.path,
        right?.language,
        right?.offset,
        right?.byteLength,
    ].map(value => String(value ?? "")).join("\0");

    return CompareText(leftKey, rightKey)
        || CompareText(JSON.stringify(left), JSON.stringify(right));
}

function CompareText(left, right)
{
    return left < right ? -1 : left > right ? 1 : 0;
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

    if (ArrayBuffer.isView(value))
    {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    throw new TypeError("Audio media classification requires bytes");
}

function NormalizeLanguageToken(value)
{
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function AudioLanguageTag(value)
{
    const input = String(value ?? "").trim().replaceAll("_", "-").toLowerCase();

    if (!input)
    {
        return "";
    }

    if (Object.hasOwn(AUDIO_LANGUAGE_TAGS, input))
    {
        return AUDIO_LANGUAGE_TAGS[input];
    }

    if (/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u.test(input))
    {
        return input;
    }

    return "";
}

function BankSourceName(value)
{
    const normalized = String(value ?? "").trim().replaceAll("\\", "/");

    return normalized.split("/").pop().toLowerCase();
}

function ValidateMusicNodeReferences(nodes, media, embeddedMedia)
{
    for (const [ id, node ] of Object.entries(nodes))
    {
        for (const childID of node.children ?? [])
        {
            if (!nodes[childID])
            {
                throw new Error(
                    `Music node ${id} references missing child ${childID}`,
                );
            }
        }

        if (node.type !== "music-track")
        {
            continue;
        }

        for (const source of node.sources ?? [])
        {
            const sourceID = String(source.sourceId);

            if (!media[sourceID] && !embeddedMedia[sourceID])
            {
                throw new Error(
                    `Music track ${id} references missing source ${sourceID}`,
                );
            }
        }
    }
}

function CreateMusicEventProjection(inspection, metadata, nodes)
{
    const actionsByID = new Map();
    const eventsByID = new Map();

    for (const entry of inspection.hirc ?? [])
    {
        if (entry.typeName === "event-action") actionsByID.set(entry.id, entry);
        else if (entry.typeName === "event") eventsByID.set(entry.id, entry);
    }

    const eventNamesByID = new Map();

    for (const [ name, record ] of Object.entries(metadata?.Events ?? {}))
    {
        eventNamesByID.set(Number(record.eventID) >>> 0, name);
    }

    const eventTargets = {};
    const eventStops = {};
    const switchSetters = {};

    for (const [ eventID, event ] of eventsByID)
    {
        const name = eventNamesByID.get(eventID >>> 0);

        if (!name || !name.toLowerCase().startsWith("music_"))
        {
            continue;
        }

        for (const actionID of EventActionIDs(event))
        {
            const action = actionsByID.get(actionID);

            if (!action)
            {
                continue;
            }

            const fields = ActionFields(action);

            const family = (fields.actionType >> 8) & 0xff;

            if (family === 0x04 && nodes[fields.targetID])
            {
                AddEventTarget(eventTargets, name, fields.targetID);
            }
            else if (family === 0x01 && nodes[fields.targetID])
            {
                AddEventTarget(eventStops, name, fields.targetID);
            }
            else if (family === 0x19 || family === 0x12)
            {
                // runtime-resource types the action family and target. Wwise
                // does not yet expose SetSwitch/SetState's two tail IDs, so
                // this is the deliberately narrow remaining payload read.
                if (!fields.payload || fields.payload.byteLength < 8)
                {
                    throw new Error(
                        `Music setter action ${actionID} has a truncated payload`,
                    );
                }

                const view = new DataView(
                    fields.payload.buffer,
                    fields.payload.byteOffset,
                    fields.payload.byteLength,
                );
                const groupID = view.getUint32(fields.payload.byteLength - 8, true);
                const targetID = view.getUint32(fields.payload.byteLength - 4, true);
                const values = switchSetters[name] ?? (switchSetters[name] = []);

                values.push({
                    kind: family === 0x19 ? "switch" : "state",
                    groupId: groupID,
                    targetId: targetID,
                });
            }
        }
    }

    return {
        eventTargets: NormalizeTargetTable(eventTargets),
        eventStops: NormalizeTargetTable(eventStops),
        switchSetters: NormalizeSetterTable(switchSetters),
    };
}

function EventActionIDs(entry)
{
    const actionIDs = entry.actionIds ?? entry.actions;

    if (!Array.isArray(actionIDs))
    {
        throw new Error(
            `Music event ${entry.id} has no typed action list`,
        );
    }

    return actionIDs;
}

function ActionFields(entry)
{
    const payload = entry.payload instanceof Uint8Array ? entry.payload : null;
    const actionType = entry.actionType;
    const targetID = entry.targetId ?? entry.target;

    if (actionType === undefined || targetID === undefined)
    {
        throw new Error(
            `Music action ${entry.id} has no typed action fields`,
        );
    }

    return {
        actionType: Number(actionType) >>> 0,
        targetID: Number(targetID) >>> 0,
        payload,
    };
}

function AddEventTarget(table, name, targetID)
{
    (table[name] ?? (table[name] = [])).push(targetID >>> 0);
}

function NormalizeTargetTable(table)
{
    const result = {};

    for (const name of Object.keys(table).sort())
    {
        result[name] = [ ...new Set(table[name]) ].sort((left, right) => left - right);
    }

    return result;
}

function NormalizeSetterTable(table)
{
    const result = {};

    for (const name of Object.keys(table).sort())
    {
        const unique = new Map();

        for (const setter of table[name])
        {
            unique.set(
                `${setter.kind}:${setter.groupId}:${setter.targetId}`,
                setter,
            );
        }

        result[name] = [ ...unique.values() ].sort((left, right) =>
            left.kind.localeCompare(right.kind, "en")
            || left.groupId - right.groupId
            || left.targetId - right.targetId);
    }

    return result;
}

function ValidateMusicGraph(music, media, embeddedMedia)
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

    if (!music.nodes || typeof music.nodes !== "object" || Array.isArray(music.nodes))
    {
        throw new TypeError("Audio library music nodes must be an object");
    }

    if (!Array.isArray(music.banks))
    {
        throw new TypeError("Audio library music banks must be an array");
    }

    const bankNames = music.banks.map(BankSourceName);

    if (bankNames.some(name => !name)
        || new Set(bankNames).size !== bankNames.length)
    {
        throw new TypeError(
            "Audio library music banks must be unique source names",
        );
    }

    for (const [ id, node ] of Object.entries(music.nodes))
    {
        if (!node || typeof node !== "object" || Array.isArray(node))
        {
            throw new TypeError(`Audio library music node ${id} must be an object`);
        }

        if (!bankNames.includes(BankSourceName(node.bank)))
        {
            throw new TypeError(
                `Audio library music node ${id} references unknown bank: ${node.bank}`,
            );
        }
    }

    ValidateMusicNodeReferences(music.nodes, media, embeddedMedia);

    for (const field of [ "eventTargets", "eventStops" ])
    {
        if (!music[field] || typeof music[field] !== "object"
            || Array.isArray(music[field]))
        {
            throw new TypeError(`Audio library music ${field} must be an object`);
        }

        for (const [ name, targets ] of Object.entries(music[field]))
        {
            if (!Array.isArray(targets))
            {
                throw new TypeError(
                    `Audio library music ${field}.${name} must be an array`,
                );
            }

            const ids = targets.map(value => Number(value) >>> 0);

            if (new Set(ids).size !== ids.length)
            {
                throw new TypeError(
                    `Audio library music ${field}.${name} has duplicate targets`,
                );
            }

            for (const id of ids)
            {
                if (!music.nodes[id])
                {
                    throw new TypeError(
                        `Audio library music ${field}.${name} `
                        + `references missing node ${id}`,
                    );
                }
            }
        }
    }

    if (!music.switchSetters || typeof music.switchSetters !== "object"
        || Array.isArray(music.switchSetters))
    {
        throw new TypeError("Audio library music switchSetters must be an object");
    }

    for (const [ name, setters ] of Object.entries(music.switchSetters))
    {
        if (!Array.isArray(setters))
        {
            throw new TypeError(
                `Audio library music switchSetters.${name} must be an array`,
            );
        }

        const keys = setters.map(setter =>
        {
            if (!setter || ![ "switch", "state" ].includes(setter.kind))
            {
                throw new TypeError(
                    `Audio library music switchSetters.${name} has an invalid setter`,
                );
            }

            return `${setter.kind}:${setter.groupId}:${setter.targetId}`;
        });

        if (new Set(keys).size !== keys.length)
        {
            throw new TypeError(
                `Audio library music switchSetters.${name} has duplicate setters`,
            );
        }
    }
}

function NormalizeMusicGraph(music)
{
    return {
        schemaVersion: 1,
        generator: String(music.generator ?? "@carbonenginejs/tools-core/audio"),
        banks: [ ...new Set((music.banks ?? []).map(BankSourceName)) ].sort(),
        nodes: SortedKeys(music.nodes),
        eventTargets: NormalizeTargetTable(music.eventTargets),
        eventStops: NormalizeTargetTable(music.eventStops),
        switchSetters: NormalizeSetterTable(music.switchSetters),
    };
}

function ResolveLibraryTarget({ target, game, provider }, targets)
{
    if ([ target, game, provider ].every((value) => value === null || value === undefined))
    {
        return null;
    }

    if (!(targets instanceof CjsToolTargetRegistry))
    {
        throw new TypeError("Audio library targets must be a CjsToolTargetRegistry");
    }

    const resolved = targets.Resolve({
        target: target ?? undefined,
        game: game ?? undefined,
        provider: provider ?? undefined,
    });

    return targets.RequireLibrary(resolved, "audio");
}

// res:/audio/<language>/<id>.wem carries a language folder; Media/ and
// Essential_Media/ do not, matching the authored AudPathResolver routing.
function LanguageSegment(lowerPath)
{
    const segments = lowerPath.split("/");
    if (segments.length === 4 && segments[2] !== "media" && segments[2] !== "essential_media")
    {
        return AudioLanguageTag(segments[2]);
    }
    return "";
}

function SortedKeys(value)
{
    const sorted = {};
    for (const key of Object.keys(value).sort())
    {
        sorted[key] = value[key];
    }
    return sorted;
}
