import fs from "node:fs/promises";

import { CjsToolCache } from "../cache/CjsToolCache.js";
import { CjsToolTargetRegistry } from "../target/CjsToolTargetRegistry.js";
import * as utils from "../utils.js";
import { CjsToolAudioBuilder } from "./CjsToolAudioBuilder.js";
import { CjsToolAudioMediaBuilder } from "./CjsToolAudioMediaBuilder.js";
import { CjsToolAudioSource } from "./CjsToolAudioSource.js";
import { CjsToolMusicSource } from "./CjsToolMusicSource.js";

const MUSIC_BANK_NAMES = Object.freeze([ "common.bnk", "music.bnk", "music_essential.bnk" ]);

/** Opens exact-build prepared audio libraries and their indexed byte sources. */
export class CjsToolAudioRepository
{

    #cache;

    #defaultLanguage;

    #indexes;

    #libraries = new Map();

    #music = null;

    #materializeMedia;

    #targets;

    /** Creates an exact-build audio repository over shared cache and indexes. */
    constructor({
        cache = new CjsToolCache(),
        indexes,
        targets = new CjsToolTargetRegistry(),
        defaultLanguage = null,
        autoPrepare = true,
        materializeMedia = false,
        musicLibrary = null,
        musicDirectory = null,
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
        if ((musicLibrary === null) !== (musicDirectory === null))
        {
            throw new TypeError(
                "CjsToolAudioRepository musicLibrary and musicDirectory must be supplied together",
            );
        }
        this.#music = musicLibrary === null
            ? null
            : new CjsToolMusicSource({
                library: musicLibrary,
                directory: musicDirectory,
            });
        this.#materializeMedia = materializeMedia === true;
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

    /**
     * Opens only the configured neutral music source and exact target identity.
     *
     * This deliberately avoids loading or auto-preparing the Wwise audio
     * library; playlist browsing must remain a lightweight service operation.
     */
    async OpenMusicTarget(target, build)
    {
        if (!this.#music)
        {
            const missing = new Error("Music library is not configured");

            missing.statusCode = 404;
            throw missing;
        }

        const resolvedTarget = this.#targets.RequireLibrary(
            this.#targets.Resolve({ target }),
            "audio",
        );
        const sourceIdentity = await this.#ResolveBuild(
            resolvedTarget,
            build,
        );

        return Object.freeze({
            music: this.#music,
            sourceTarget: resolvedTarget.id,
            sourceGame: resolvedTarget.game,
            sourceProvider: resolvedTarget.provider,
            sourceBuild: sourceIdentity.build,
        });
    }

    /** Resolves one requested build reference to an exact indexed identity. */
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

    /** Loads and validates one prepared audio library and indexed source. */
    async #Load(target, sourceIdentity)
    {
        let data = null;
        const filePath = this.#cache.GetCustomPath({
            target: target.id,
            game: target.game,
            provider: target.provider,
            build: sourceIdentity.build,
            name: "audio",
            version: "v2",
        });

        try
        {
            data = JSON.parse(await fs.readFile(filePath, "utf8"));
        }
        catch (error)
        {
            if (error?.code !== "ENOENT")
            {
                throw error;
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

        let library = data
            && typeof data === "object"
            && !Array.isArray(data)
            && data.audio
            && typeof data.audio === "object"
            && !Array.isArray(data.audio)
            && data.audio.schema === "carbonenginejs.audioLibrary"
                ? data.audio
                : data;
        let source = await this.#indexes.OpenTarget(
            target.id,
            sourceIdentity.build,
            { client: sourceIdentity.client ?? undefined },
        );

        if (this.#materializeMedia
            && HasMaterializableMedia(library)
            && !CjsToolAudioMediaBuilder.isCurrent(library, source))
        {
            library = await this.#MaterializeLibrary(
                target,
                sourceIdentity,
                library,
                source,
            );
            source = await this.#indexes.OpenTarget(
                target.id,
                sourceIdentity.build,
                { client: sourceIdentity.client ?? undefined },
            );
        }

        return new CjsToolAudioSource({
            library,
            source,
            defaultLanguage: this.#defaultLanguage,
            music: this.#music,
        });
    }

    /**
     * Builds and installs the audio library for one exact build from that
     * build's own inputs (index rows, SoundbanksInfo, bank bytes), mirroring
     * the deliberate build:audio pipeline with authored SFX, event media and,
     * when the music banks are indexed, the dynamic-music graph. The first
     * request per build carries the acquisition and parse cost; the installed
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
            .filter(match => match.storageKind !== "generated-cache")
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
        const availableBankNames = new Set(indexEntries
            .map(entry => BankSourceName(entry.logicalPath))
            .filter(name => name.endsWith(".bnk")));
        const includeMusic = MUSIC_BANK_NAMES.every(name =>
            availableBankNames.has(name));
        const loadedBanks = new Map();
        let library = await CjsToolAudioBuilder.buildFromBanks({
            indexEntries,
            soundbanksInfo,
            enrichment: null,
            language: eventMediaLanguage,
            includeSfx: true,
            ...(includeMusic ? { music: true } : {}),
            sourceTarget: target.id,
            sourceGame: target.game,
            sourceProvider: target.provider,
            sourceBuild: sourceIdentity.build,
            generatedAt: new Date().toISOString(),
            async loadBank(bank, { sourceID })
            {
                const bytes = ToUint8Array(
                    (await source.Fetch(bank.resPath)).bytes,
                );

                loadedBanks.set(sourceID, bytes);
                return bytes;
            },
        }, { targets: this.#targets });

        if (this.#materializeMedia)
        {
            library = (await new CjsToolAudioMediaBuilder({
                cache: this.#cache,
                indexes: this.#indexes,
            }).Build({
                target: target.id,
                game: target.game,
                provider: target.provider,
                build: sourceIdentity.build,
                library,
                bankBytes: loadedBanks,
            })).library;
        }

        await this.#cache.WriteCustomLibrary({
            target: target.id,
            game: target.game,
            provider: target.provider,
            build: sourceIdentity.build,
            name: "audio",
            version: "v2",
        }, library);

        return library;
    }

    /** Materializes an already prepared library without rebuilding its graph. */
    async #MaterializeLibrary(target, sourceIdentity, library, source)
    {
        const loadedBanks = new Map();

        for (const [ sourceID, bank ] of Object.entries(library.banks))
        {
            loadedBanks.set(
                sourceID,
                ToUint8Array((await source.Fetch(bank.resPath)).bytes),
            );
        }

        const materialized = await new CjsToolAudioMediaBuilder({
            cache: this.#cache,
            indexes: this.#indexes,
        }).Build({
            target: target.id,
            game: target.game,
            provider: target.provider,
            build: sourceIdentity.build,
            library,
            bankBytes: loadedBanks,
        });

        await this.#cache.WriteCustomLibrary({
            target: target.id,
            game: target.game,
            provider: target.provider,
            build: sourceIdentity.build,
            name: "audio",
            version: "v2",
        }, materialized.library);

        return materialized.library;
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

function HasMaterializableMedia(library)
{
    return Object.values(library?.embeddedMedia ?? {}).some(value =>
        (Array.isArray(value) ? value : [ value ]).some(record =>
            [ "wem", "audio/x-wem", "application/x-wem" ].includes(
                String(record?.mediaType ?? "").trim().toLowerCase(),
            )));
}
