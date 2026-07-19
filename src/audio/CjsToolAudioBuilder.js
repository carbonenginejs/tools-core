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
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";

const TargetRegistry = new CjsToolTargetRegistry();

/** Stateless construction of deterministic audio-library artifacts. */
export class CjsToolAudioBuilder
{

    static schema = "carbonenginejs.audioLibrary";

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

    static build(options, { targets = TargetRegistry } = {})
    {
        const {
            indexEntries = [],
            soundbanksInfo,
            enrichment = null,
            eventMedia = null,
            embeddedMedia = null,
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
        const banks = {};

        for (const entry of indexEntries)
        {
            const lower = entry.logicalPath.toLowerCase();
            const base = lower.split("/").pop();
            if (base.endsWith(".wem"))
            {
                const id = base.slice(0, -4);
                media[id] = {
                    resPath: entry.logicalPath,
                    storagePath: entry.storagePath,
                    byteLength: entry.byteLength,
                    checksum: entry.checksum,
                    essential: lower.includes("/essential_media/"),
                    language: LanguageSegment(lower)
                };
            }
            else if (base.endsWith(".bnk"))
            {
                banks[base] = {
                    resPath: entry.logicalPath,
                    storagePath: entry.storagePath,
                    byteLength: entry.byteLength,
                    checksum: entry.checksum
                };
            }
        }

        const library = {
            schema: this.schema,
            schemaVersion: 1,
            metadata: SortedKeys({
                Events: SortedKeys(metadata.Events),
                SoundBanks: SortedKeys(metadata.SoundBanks),
                WemFileIDs: SortedKeys(metadata.WemFileIDs)
            }),
            media: SortedKeys(media),
            banks: SortedKeys(banks)
        };
        if (eventMedia && Object.keys(eventMedia).length)
        {
            library.eventMedia = SortedKeys(eventMedia);
        }
        if (embeddedMedia && Object.keys(embeddedMedia).length)
        {
            library.embeddedMedia = SortedKeys(embeddedMedia);
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
// Essential_Media/ do not (AudPathResolver routing, see AUDIO-PORT-KB).
function LanguageSegment(lowerPath)
{
    const segments = lowerPath.split("/");
    if (segments.length === 4 && segments[2] !== "media" && segments[2] !== "essential_media")
    {
        return segments[2];
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
