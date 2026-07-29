import fs from "node:fs/promises";

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
        const filePath = this.#cache.GetCustomPath({
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
        const library = await CjsToolAudioBuilder.buildFromBanks({
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
            async loadBank(bank)
            {
                return ToUint8Array((await source.Fetch(bank.resPath)).bytes);
            },
        }, { targets: this.#targets });

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
