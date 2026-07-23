// Builds the deterministic audio library JSON from local inputs. Performs no
// remote reads - use @carbonenginejs/tools-core/index for provider/build/
// index/download work first, then supply local inputs here (mirrors
// build_character_library.js).
//
// Usage:
//   npm run build:audio -- --index <resfileindex.txt> --cache <dir>
//     --soundbanksinfo <path-or-res-lookup> --build <id> [--out <library.json>]
//     [--target <eve>]
//     [--enrichment <audio-metadata.json>] [--event-media] [--music]
//     [--language <bcp47-tag>]
//     [--generated-at <iso>] [--compact]
//
// --enrichment accepts a caller-supplied plain-JSON metadata overlay.
import fs from "node:fs";
import path from "node:path";
import {
    CjsToolAudio,
    CjsToolAudioBuilder,
    CjsToolAudioSource,
} from "../src/audio/index.js";
import { CjsToolCache } from "../src/cache/index.js";
import { CjsToolLibraryArtifact } from "../src/library/index.js";
import * as utils from "../src/utils.js";
// Bank format reader: inspection (typed HIRC fields) + the event-graph walk
// grouped under the wwise static. No resource lifecycle pulled in.
import { CjsBnkFormat } from "@carbonenginejs/runtime-resource/formats/bnk";

function ParseArgs(argv)
{
    const options = {
        compact: false,
        enrichment: null,
        game: null,
        generatedAt: null,
        provider: null,
        soundbanksinfo: null,
    };
    for (let i = 0; i < argv.length; i++)
    {
        const flag = argv[i];
        if (flag === "--help" || flag === "-h")
        {
            options.help = true;
            continue;
        }
        if (flag === "--compact")
        {
            options.compact = true;
            continue;
        }
        if (flag === "--event-media")
        {
            options.eventMedia = true;
            continue;
        }
        if (flag === "--music")
        {
            options.music = true;
            continue;
        }
        if (!flag.startsWith("--"))
        {
            throw new Error(`Unknown argument: ${flag}`);
        }
        const value = argv[++i];
        if (value === undefined)
        {
            throw new Error(`Missing value for ${flag}`);
        }
        const name = flag.slice(2).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
        options[name] = value;
    }
    return options;
}

async function Main(argv)
{
    const options = ParseArgs(argv);
    if (options.help)
    {
        console.log("build_audio_library --index <resfileindex.txt> --cache <dir> --soundbanksinfo <file> --build <id> [--out <file>] [--target <eve|frontier>] [--enrichment <file>] [--event-media] [--music] [--language <bcp47-tag>] [--generated-at <iso>] [--compact]");
        console.log("Library builders are target-specific. Only targets explicitly audited for audio can be selected.");
        return 0;
    }
    for (const required of ["index", "cache", "soundbanksinfo", "build"])
    {
        if (!options[required])
        {
            throw new Error(`Missing required --${required}`);
        }
    }

    const sourceBuild = utils.normalizeExactBuild(options.build, {
        message: "--build requires an exact numeric build",
    });

    const audio = new CjsToolAudio();
    const target = audio.ResolveTarget({
        target: options.target ?? undefined,
        game: options.game ?? undefined,
        provider: options.provider ?? undefined,
    });

    const indexText = fs.readFileSync(path.resolve(options.index), "utf8");
    const indexEntries = CjsToolAudioBuilder.parseIndexEntries(indexText);
    const cache = new CjsToolCache(options.cache);

    // The SoundbanksInfo argument is a local file path; when given a res:/
    // logical path instead, resolve it through the index into the cache.
    let soundbanksBytes;

    if (options.soundbanksinfo.toLowerCase().startsWith("res:/"))
    {
        const entry = indexEntries.find(item => item.logicalPath.toLowerCase() === options.soundbanksinfo.toLowerCase());
        if (!entry)
        {
            throw new Error(`SoundbanksInfo logical path not in index: ${options.soundbanksinfo}`);
        }

        const cached = await cache.ReadRemote(entry.storagePath, CacheExpectation(entry));

        if (!cached)
        {
            throw new Error(`SoundbanksInfo logical path is not cached: ${entry.logicalPath}`);
        }

        soundbanksBytes = cached.bytes;
    }
    else
    {
        soundbanksBytes = fs.readFileSync(path.resolve(options.soundbanksinfo));
    }

    const soundbanksInfo = JSON.parse(Buffer.from(soundbanksBytes).toString("utf8"));
    const enrichment = options.enrichment
        ? JSON.parse(fs.readFileSync(path.resolve(options.enrichment), "utf8"))
        : null;

    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const eventMediaLanguage = NormalizeLanguage(options.language ?? "en-us");
    const buildOptions = {
        indexEntries,
        soundbanksInfo,
        enrichment,
        sourceTarget: target.id,
        sourceGame: target.game,
        sourceProvider: target.provider,
        sourceBuild,
        generatedAt
    };
    let library = audio.Build(buildOptions);

    // --event-media extracts event -> media edges and embedded-media windows.
    // --music implies that inspection and additionally projects the dynamic
    // music graph. Every bank is read exactly once and its payload views are
    // compacted before the next bank is opened.
    if (options.eventMedia || options.music)
    {
        if (options.music)
        {
            const availableBankNames = new Set(
                Object.values(library.banks)
                    .map(bank => BankSourceName(bank.resPath)),
            );
            const missingMusicBanks = [
                "common.bnk",
                "music.bnk",
                "music_essential.bnk",
            ].filter(name => !availableBankNames.has(name));

            if (missingMusicBanks.length)
            {
                throw new Error(
                    "--music requires indexed banks: "
                    + missingMusicBanks.join(", "),
                );
            }
        }

        const missing = [];
        const inspections = [];
        const bankIdentities = {};
        const embeddedMedia = {};
        // Sequential inspection with a compaction pass: HIRC payload views are
        // copied so the multi-hundred-MB bank buffers never coexist in memory.
        for (const [ sourceID, bank ] of Object.entries(library.banks))
        {
            const cached = await cache.ReadRemote(bank.storagePath, CacheExpectation(bank));

            if (!cached)
            {
                missing.push(`${sourceID} -> ${bank.storagePath}`);
                continue;
            }

            const bytes = ToUint8Array(cached.bytes);
            const source = BankSourceName(bank.resPath);
            const inspection = CjsBnkFormat.inspect(bytes, { source });
            const inspectedSourceID = `${inspection.bankId >>> 0}:${inspection.languageId >>> 0}`;

            bankIdentities[bank.resPath.toLowerCase()] = {
                bankID: inspection.bankId,
                languageID: inspection.languageId,
            };
            inspections.push({
                source,
                resPath: bank.resPath,
                bankId: inspection.bankId,
                languageId: inspection.languageId,
                language: bank.language,
                hirc: inspection.hirc.map(entry => ({
                    ...entry,
                    payload: entry.payload.slice(),
                })),
                media: inspection.media.map(entry => ({ ...entry })),
            });

            for (const record of inspection.media)
            {
                const id = String(record.id);

                if (!record.available || library.media[id])
                {
                    continue;
                }

                const descriptor = {
                    sourceID: `embedded:${id}:${inspectedSourceID}`,
                    bank: inspectedSourceID,
                    offset: record.absoluteOffset,
                    byteLength: record.length,
                    language: bank.language,
                    mediaType: CjsToolAudioBuilder.mediaTypeFromMagic(
                        bytes,
                        record.absoluteOffset,
                    ),
                };
                const current = embeddedMedia[id];

                if (current === undefined)
                {
                    embeddedMedia[id] = descriptor;
                }
                else if (Array.isArray(current))
                {
                    current.push(descriptor);
                }
                else
                {
                    embeddedMedia[id] = [ current, descriptor ];
                }
            }
        }
        if (missing.length)
        {
            const option = options.music ? "--music" : "--event-media";

            throw new Error(`${option} requires cached banks; missing:\n  ${missing.join("\n  ")}`);
        }

        // EVE keeps events in common.bnk and their targets in the media
        // banks: edges only resolve over the merged graph.
        const merged = CjsToolAudioBuilder.createEventMediaGraphs(
            inspections,
            {
                knownWemIds: Object.keys(library.media),
                language: eventMediaLanguage,
            },
        );
        const eventMedia = CjsToolAudioBuilder.createEventMediaTable(
            library.metadata,
            merged,
        );

        library = audio.Build({
            ...buildOptions,
            bankIdentities,
            eventMedia,
            eventMediaLanguage,
            embeddedMedia,
        });

        if (options.music)
        {
            const music = CjsToolAudioBuilder.createMusicGraph({
                inspections: inspections.filter(inspection =>
                    [ "common.bnk", "music.bnk", "music_essential.bnk" ]
                        .includes(BankSourceName(inspection.source))),
                metadata: library.metadata,
                media: library.media,
                embeddedMedia: library.embeddedMedia,
            });

            library = audio.Build({
                ...buildOptions,
                bankIdentities,
                eventMedia,
                eventMediaLanguage,
                embeddedMedia,
                music,
            });
        }
    }

    const outPath = options.out
        ? path.resolve(options.out)
        : cache.GetCustomPath({
            game: target.game,
            provider: target.provider,
            build: sourceBuild,
            name: "audio",
            version: "v2",
        });
    CjsToolAudioSource.validateLibrary(library);
    const artifacts = await CjsToolLibraryArtifact.write(outPath, library, {
        compact: options.compact,
    });
    console.log(JSON.stringify({
        out: artifacts.jsonPath,
        gzip: artifacts.gzipPath,
        schemaVersion: library.schemaVersion,
        jsonBytes: artifacts.jsonBytes,
        gzipBytes: artifacts.gzipBytes,
        target: library.sourceTarget,
        game: library.sourceGame,
        provider: library.sourceProvider,
        build: library.sourceBuild,
        events: Object.keys(library.metadata.Events).length,
        soundBanks: Object.keys(library.metadata.SoundBanks).length,
        media: Object.keys(library.media).length,
        banks: Object.keys(library.banks).length,
        enriched: !!enrichment,
        eventMedia: library.eventMedia ? Object.keys(library.eventMedia).length : 0,
        eventMediaLanguage: library.eventMediaLanguage ?? null,
        embeddedMedia: library.embeddedMedia
            ? Object.keys(library.embeddedMedia).length
            : 0,
        musicNodes: library.music ? Object.keys(library.music.nodes).length : 0,
    }, null, 2));
    return 0;
}

function CacheExpectation(entry)
{
    return {
        ...(entry.checksum ? { md5: entry.checksum } : {}),
        ...(Number(entry.byteLength) > 0 ? { size: Number(entry.byteLength) } : {}),
    };
}

function BankSourceName(value)
{
    return String(value ?? "")
        .trim()
        .replaceAll("\\", "/")
        .split("/")
        .pop()
        .toLowerCase();
}

function NormalizeLanguage(value)
{
    const language = String(value ?? "")
        .trim()
        .replaceAll("_", "-")
        .toLowerCase();

    if (!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u.test(language))
    {
        throw new TypeError(`Invalid audio language tag: ${value}`);
    }

    return language;
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

    throw new TypeError("Cached bank bytes must be an ArrayBuffer view");
}

try
{
    process.exitCode = await Main(process.argv.slice(2));
}
catch (error)
{
    console.error(error.message);
    process.exitCode = 1;
}
