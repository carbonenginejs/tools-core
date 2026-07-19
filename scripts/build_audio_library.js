// Builds the deterministic audio library JSON from local inputs. Performs no
// remote reads - use @carbonenginejs/tools-core/index for provider/build/
// index/download work first, then supply local inputs here (mirrors
// build_character_library.js).
//
// Usage:
//   npm run build:audio -- --index <resfileindex.txt> --cache <dir>
//     --soundbanksinfo <path-or-res-lookup> --out <library.json> --build <id>
//     [--target <eve>]
//     [--enrichment <audio-metadata.json>] [--generated-at <iso>] [--compact]
//
// --enrichment accepts a caller-supplied plain-JSON metadata overlay.
import fs from "node:fs";
import path from "node:path";
import { CjsToolAudio, CjsToolAudioBuilder } from "../src/audio/index.js";
import { CjsToolCache } from "../src/cache/index.js";
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
        console.log("build_audio_library --index <resfileindex.txt> --cache <dir> --soundbanksinfo <file> --out <file> --build <id> [--target <eve|frontier>] [--enrichment <file>] [--event-media] [--generated-at <iso>] [--compact]");
        console.log("Library builders are target-specific. Only targets explicitly audited for audio can be selected.");
        return 0;
    }
    for (const required of ["index", "cache", "soundbanksinfo", "out", "build"])
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
    let library = audio.Build({
        indexEntries,
        soundbanksInfo,
        enrichment,
        sourceTarget: target.id,
        sourceGame: target.game,
        sourceProvider: target.provider,
        sourceBuild,
        generatedAt
    });

    // --event-media: extract exact event -> wem edges from the banks' HIRC
    // graphs. Still no remote reads: every bank must already sit in --cache
    // (acquire beforehand); missing banks fail loudly with their paths.
    if (options.eventMedia)
    {
        const missing = [];
        const inspections = [];
        const inspectionBankNames = [];
        // Sequential inspection with a compaction pass: HIRC payload views are
        // copied so the multi-hundred-MB bank buffers never coexist in memory.
        for (const [bankName, bank] of Object.entries(library.banks))
        {
            const cached = await cache.ReadRemote(bank.storagePath, CacheExpectation(bank));

            if (!cached)
            {
                missing.push(`${bankName} -> ${bank.storagePath}`);
                continue;
            }

            const inspection = CjsBnkFormat.inspect(new Uint8Array(cached.bytes));
            inspections.push({
                hirc: inspection.hirc.map(entry => ({ ...entry, payload: entry.payload.slice() })),
                media: inspection.media.map(entry => ({ ...entry }))
            });
            inspectionBankNames.push(bankName);
        }
        if (missing.length)
        {
            throw new Error(`--event-media requires cached banks; missing:\n  ${missing.join("\n  ")}`);
        }
        // EVE keeps events in common.bnk and their targets in the media
        // banks: edges only resolve over the merged graph.
        const merged = CjsBnkFormat.wwise.eventMediaFromBanks(inspections, { knownWemIds: Object.keys(library.media) });

        // Embedded media directory: wems living inside bank DATA (absent
        // from the streamed index). Streamed wems win when present in both
        // (music prefetch heads embed a truncated copy).
        const embeddedMedia = {};
        for (const [inspectionIndex, inspection] of inspections.entries())
        {
            for (const record of inspection.media)
            {
                const id = String(record.id);
                if (record.available && !library.media[id] && !embeddedMedia[id])
                {
                    embeddedMedia[id] = {
                        bank: inspectionBankNames[inspectionIndex],
                        offset: record.absoluteOffset,
                        byteLength: record.length
                    };
                }
            }
        }

        library = audio.Build({
            indexEntries,
            soundbanksInfo,
            enrichment,
            eventMedia: CjsToolAudioBuilder.createEventMediaTable(library.metadata, [merged]),
            embeddedMedia,
            sourceTarget: target.id,
            sourceGame: target.game,
            sourceProvider: target.provider,
            sourceBuild,
            generatedAt
        });
    }

    const outPath = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(library, null, options.compact ? 0 : 2)}\n`, "utf8");
    console.log(JSON.stringify({
        out: outPath,
        target: library.sourceTarget,
        game: library.sourceGame,
        provider: library.sourceProvider,
        build: library.sourceBuild,
        events: Object.keys(library.metadata.Events).length,
        soundBanks: Object.keys(library.metadata.SoundBanks).length,
        media: Object.keys(library.media).length,
        banks: Object.keys(library.banks).length,
        enriched: !!enrichment,
        eventMedia: library.eventMedia ? Object.keys(library.eventMedia).length : 0
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

try
{
    process.exitCode = await Main(process.argv.slice(2));
}
catch (error)
{
    console.error(error.message);
    process.exitCode = 1;
}
