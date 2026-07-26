import fs from "node:fs/promises";

import { CjsBnkFormat } from "@carbonenginejs/runtime-resource/formats/bnk";

import { CjsToolCache } from "../cache/CjsToolCache.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";
import { CjsToolAudioBuilder } from "./CjsToolAudioBuilder.js";
import { CjsToolAudioSource } from "./CjsToolAudioSource.js";

const MUSIC_BANK_NAMES = Object.freeze([ "common.bnk", "music.bnk", "music_essential.bnk" ]);

/** Opens exact-build prepared audio libraries and their indexed byte sources. */
export class CjsToolAudioRepository
{

    #cache;

    #defaultLanguage;

    #indexes;

    #libraries = new Map();

    #targets;

    constructor({
        cache = new CjsToolCache(),
        indexes,
        targets = new CjsToolTargetRegistry(),
        defaultLanguage = null,
        autoPrepare = true,
    } = {})
    {
        if (!(cache instanceof CjsToolCache))
        {
            throw new TypeError("CjsToolAudioRepository cache must be a CjsToolCache");
        }

        if (!indexes
            || typeof indexes.OpenTarget !== "function"
            || typeof indexes.ResolveTargetBuild !== "function")
        {
            throw new TypeError(
                "CjsToolAudioRepository indexes must open and resolve target builds",
            );
        }

        if (!(targets instanceof CjsToolTargetRegistry))
        {
            throw new TypeError(
                "CjsToolAudioRepository targets must be a CjsToolTargetRegistry",
            );
        }

        this.#cache = cache;
        this.#indexes = indexes;
        this.#targets = targets;
        this.#defaultLanguage = defaultLanguage === null
            || defaultLanguage === undefined
            ? null
            : String(defaultLanguage).trim().toLowerCase();
        // Auto-preparation is the default: generated artifacts are
        // forward-looking, so a missing library is built from the exact
        // build's own inputs on first request unless explicitly disabled.
        this.autoPrepare = autoPrepare !== false;
        Object.freeze(this);
    }

    /** Opens one prepared library together with its immutable indexed source. */
    async OpenTarget(target, build)
    {
        const resolvedTarget = this.#targets.RequireLibrary(
            this.#targets.Resolve({ target }),
            "audio",
        );
        const sourceIdentity = await this.#ResolveBuild(resolvedTarget, build);
        const key = `${resolvedTarget.id}\0${sourceIdentity.build}`;

        if (!this.#libraries.has(key))
        {
            const loading = this.#Load(resolvedTarget, sourceIdentity).catch(error =>
            {
                this.#libraries.delete(key);
                throw error;
            });

            this.#libraries.set(key, loading);
        }

        return this.#libraries.get(key);
    }

    async #ResolveBuild(target, build)
    {
        try
        {
            return Object.freeze({
                build: utils.normalizeExactBuild(build),
                client: target.client,
            });
        }
        catch
        {
            const resolved = await this.#indexes.ResolveTargetBuild(target.id, build);

            return Object.freeze({
                build: utils.normalizeExactBuild(resolved.build),
                client: resolved.client ?? target.client,
            });
        }
    }

    async #Load(target, sourceIdentity)
    {
        let data = null;

        for (const version of [ "v2", "v1" ])
        {
            const filePath = this.#cache.GetCustomPath({
                game: target.game,
                provider: target.provider,
                build: sourceIdentity.build,
                name: "audio",
                version,
            });

            try
            {
                data = JSON.parse(await fs.readFile(filePath, "utf8"));
                break;
            }
            catch (error)
            {
                if (error?.code !== "ENOENT")
                {
                    throw error;
                }
            }
        }

        if (data === null && this.autoPrepare)
        {
            data = await this.#AutoPrepareLibrary(target, sourceIdentity);
        }

        if (data === null)
        {
            const missing = new Error(
                `Audio library is not prepared for ${target.id} build `
                + sourceIdentity.build,
            );

            missing.statusCode = 404;
            throw missing;
        }

        const library = data
            && typeof data === "object"
            && !Array.isArray(data)
            && data.audio
            && typeof data.audio === "object"
            && !Array.isArray(data.audio)
            && data.audio.schema === "carbonenginejs.audioLibrary"
                ? data.audio
                : data;
        const source = await this.#indexes.OpenTarget(
            target.id,
            sourceIdentity.build,
            { client: sourceIdentity.client ?? undefined },
        );

        return new CjsToolAudioSource({
            library,
            source,
            defaultLanguage: this.#defaultLanguage,
        });
    }

    /**
     * Builds and installs the audio library for one exact build from that
     * build's own inputs (index rows, SoundbanksInfo, bank bytes), mirroring
     * the deliberate build:audio pipeline with event media and, when the
     * music banks are indexed, the dynamic-music graph. The first request
     * per build carries the acquisition and parse cost; the installed
     * artifact answers every later request.
     * @returns {Promise<Object>} the installed library document
     */
    async #AutoPrepareLibrary(target, sourceIdentity)
    {
        const source = await this.#indexes.OpenTarget(
            target.id,
            sourceIdentity.build,
            { client: sourceIdentity.client ?? undefined },
        );
        const indexEntries = source.Match("res:/audio/**", { root: "res" })
            .map(match => ({
                logicalPath: match.record.logicalPath,
                storagePath: match.record.storagePath,
                checksum: match.record.checksum ?? "",
                byteLength: match.record.uncompressedSize ?? 0,
            }));
        const soundbanksEntry = indexEntries.find(entry =>
            entry.logicalPath.endsWith("/soundbanksinfo.json"));

        if (!soundbanksEntry)
        {
            throw new Error(
                `Audio auto-preparation requires an indexed SoundbanksInfo for ${target.id} build ${sourceIdentity.build}`,
            );
        }

        const soundbanksInfo = JSON.parse(Buffer.from(
            ToUint8Array((await source.Fetch(soundbanksEntry.logicalPath)).bytes),
        ).toString("utf8"));
        const eventMediaLanguage = this.#defaultLanguage ?? "en-us";
        const buildOptions = {
            indexEntries,
            soundbanksInfo,
            enrichment: null,
            sourceTarget: target.id,
            sourceGame: target.game,
            sourceProvider: target.provider,
            sourceBuild: sourceIdentity.build,
            generatedAt: new Date().toISOString(),
        };
        let library = CjsToolAudioBuilder.build(buildOptions, { targets: this.#targets });

        // Event media and embedded windows come from the banks themselves:
        // every bank is read exactly once and its payload views compacted.
        const inspections = [];
        const bankIdentities = {};
        const embeddedMedia = {};

        for (const [ , bank ] of Object.entries(library.banks))
        {
            const bytes = ToUint8Array((await source.Fetch(bank.resPath)).bytes);
            const bankSource = BankSourceName(bank.resPath);
            const inspection = CjsBnkFormat.inspect(bytes, { source: bankSource });
            const inspectedSourceID = `${inspection.bankId >>> 0}:${inspection.languageId >>> 0}`;

            bankIdentities[bank.resPath.toLowerCase()] = {
                bankID: inspection.bankId,
                languageID: inspection.languageId,
            };
            inspections.push({
                source: bankSource,
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

        const merged = CjsToolAudioBuilder.createEventMediaGraphs(inspections, {
            knownWemIds: Object.keys(library.media),
            language: eventMediaLanguage,
        });
        const eventMedia = CjsToolAudioBuilder.createEventMediaTable(
            library.metadata,
            merged,
        );
        const withEdges = {
            ...buildOptions,
            bankIdentities,
            eventMedia,
            eventMediaLanguage,
            embeddedMedia,
        };

        library = CjsToolAudioBuilder.build(withEdges, { targets: this.#targets });

        const availableBankNames = new Set(
            Object.values(library.banks).map(bank => BankSourceName(bank.resPath)),
        );

        if (MUSIC_BANK_NAMES.every(name => availableBankNames.has(name)))
        {
            const music = CjsToolAudioBuilder.createMusicGraph({
                inspections: inspections.filter(inspection =>
                    MUSIC_BANK_NAMES.includes(inspection.source)),
                metadata: library.metadata,
                media: library.media,
                embeddedMedia: library.embeddedMedia,
            });

            library = CjsToolAudioBuilder.build(
                { ...withEdges, music },
                { targets: this.#targets },
            );
        }

        await this.#cache.WriteCustomLibrary({
            game: target.game,
            provider: target.provider,
            build: sourceIdentity.build,
            name: "audio",
            version: "v2",
        }, library);

        return library;
    }

}

function BankSourceName(resPath)
{
    return String(resPath ?? "").toLowerCase().split("/").pop();
}

function ToUint8Array(value)
{
    if (value instanceof Uint8Array)
    {
        return value;
    }

    return new Uint8Array(value);
}
