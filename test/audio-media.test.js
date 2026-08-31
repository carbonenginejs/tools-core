import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
    installMusicLibrary,
} from "@carbonenginejs/runtime/audio/library";
import {
    CjsToolAudioRepository,
    CjsToolAudioSource,
    CjsToolMusicSource,
} from "../src/audio/index.js";
import { CjsToolCache } from "../src/cache/index.js";
import { CjsToolHttpProxy } from "../src/proxy/index.js";

const PreparedPath = "generated:/audio/777.ogg";
const LoosePath = "res:/audio/media/777.wem";
const BankPath = "res:/audio/524.bnk";
const Files = new Map([
    [ PreparedPath, Uint8Array.from([ 10, 11, 12, 13 ]) ],
    [ LoosePath, Uint8Array.from([ 20, 21, 22, 23 ]) ],
    [ BankPath, Uint8Array.from([ 30, 31, 32, 33, 34, 35, 36 ]) ],
]);

function CreateLibrary({ schemaVersion = 2, music = undefined } = {})
{
    const bankKey = "524:0";

    return {
        schema: "carbonenginejs.audioLibrary",
        schemaVersion,
        sourceTarget: "eve",
        sourceGame: "Eve",
        sourceProvider: "ccp",
        sourceBuild: "123",
        metadata: {
            Events: {},
            SoundBanks: {},
            WemFileIDs: {},
        },
        media: {
            777: {
                sources: [
                    {
                        sourceID: "loose-wem",
                        resPath: LoosePath,
                        byteLength: 4,
                    },
                    {
                        sourceID: "prepared-ogg",
                        sourceKind: "prepared",
                        path: PreparedPath,
                        mediaType: "audio/ogg",
                        language: "en-us",
                        byteLength: 4,
                        checksum: "prepared-checksum",
                    },
                ],
            },
        },
        banks: {
            [bankKey]: {
                sourceID: bankKey,
                bankID: "524",
                languageID: "0",
                shortName: "ships",
                language: "",
                resPath: BankPath,
                byteLength: 7,
                checksum: "bank-checksum",
            },
        },
        embeddedMedia: {
            900001: {
                bank: bankKey,
                offset: 2,
                byteLength: 3,
                mediaType: "wem",
            },
        },
        ...(music === undefined ? {} : { music }),
    };
}

function CreateIndexedSource()
{
    return {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "123",
        async Fetch(audioPath)
        {
            const bytes = Files.get(audioPath);

            if (!bytes)
            {
                throw new Error(`Unexpected audio path: ${audioPath}`);
            }

            return { bytes };
        },
    };
}

function CreateAudioSource(music = null)
{
    return new CjsToolAudioSource({
        library: CreateLibrary(),
        source: CreateIndexedSource(),
        music,
    });
}

async function StartProxy(context, audio)
{
    const proxy = new CjsToolHttpProxy({ audio });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    return `http://127.0.0.1:${server.address().port}`;
}

async function RequestJson(url, headers = {})
{
    return new Promise((resolve, reject) =>
    {
        const request = http.request(url, { headers }, response =>
        {
            const chunks = [];

            response.on("data", chunk => chunks.push(chunk));
            response.once("error", reject);
            response.once("end", () =>
            {
                try
                {
                    resolve({
                        status: response.statusCode,
                        value: JSON.parse(Buffer.concat(chunks).toString()),
                    });
                }
                catch (error)
                {
                    reject(error);
                }
            });
        });

        request.once("error", reject);
        request.end();
    });
}

test("audio source resolves prepared, loose, embedded, and exact-path bytes", async () =>
{
    const audio = CreateAudioSource();
    const prepared = audio.ResolveMediaByID("777");

    assert.deepEqual(
        audio.ListSourcePaths(),
        [ PreparedPath, LoosePath, BankPath ].sort(
            (left, right) => left.localeCompare(right, "en"),
        ),
    );
    assert.equal(prepared.sourceID, "prepared-ogg");
    assert.equal(prepared.mediaType, "audio/ogg");
    assert.equal(prepared.path, null);
    assert.deepEqual(
        new Uint8Array((await audio.Read(prepared)).bytes),
        Files.get(PreparedPath),
    );

    const loose = audio.ResolveMediaByID("777", {
        mediaTypes: [ "application/octet-stream" ],
    });

    assert.equal(loose.sourceID, "loose-wem");
    assert.deepEqual(
        new Uint8Array((await audio.Read(loose)).bytes),
        Files.get(LoosePath),
    );

    const embedded = audio.ResolveMediaByID("900001");
    const embeddedRange = await audio.Read(embedded, {
        offset: 1,
        byteLength: 2,
    });

    assert.equal(embedded.totalByteLength, 3);
    assert.equal(embeddedRange.complete, false);
    assert.deepEqual(
        new Uint8Array(embeddedRange.bytes),
        Uint8Array.from([ 33, 34 ]),
    );

    const bank = audio.ResolveMediaByPath("RES:/AUDIO/524.BNK");

    assert.equal(bank.path, BankPath);
    assert.deepEqual(
        new Uint8Array((await audio.Read(bank)).bytes),
        Files.get(BankPath),
    );
    assert.throws(
        () => audio.ResolveMediaByPath("res:/audio/../private.bin"),
        /traversal/u,
    );
    assert.throws(
        () => audio.ResolveMediaByPath("res:/audio/private.bin"),
        /not found/u,
    );
});

test("audio source also reads exact document records and cached ranges", async () =>
{
    const library = CreateLibrary({ schemaVersion: 2 });
    const audio = new CjsToolAudioSource({
        library,
        source: CreateIndexedSource(),
    });
    const bank = library.banks["524:0"];
    const complete = await audio.Read(bank);
    const ranged = await audio.ReadRange(bank, {
        offset: 2,
        byteLength: 3,
    });

    assert.deepEqual(
        new Uint8Array(complete.bytes),
        Files.get(BankPath),
    );
    assert.deepEqual(
        [ ...new Uint8Array(ranged.bytes) ],
        [ 32, 33, 34 ],
    );
});

test("audio source selects retained embedded variants by language", () =>
{
    const library = {
        schema: "carbonenginejs.audioLibrary",
        schemaVersion: 2,
        eventMediaLanguage: "de",
        metadata: {
            Events: {},
            SoundBanks: {},
            WemFileIDs: {},
        },
        media: {},
        banks: {
            "700:1": {
                sourceID: "700:1",
                bankID: "700",
                languageID: "1",
                language: "en-us",
                authoredLanguage: "English(US)",
                resPath: "res:/audio/English(US)/voice.bnk",
                byteLength: 10,
            },
            "700:2": {
                sourceID: "700:2",
                bankID: "700",
                languageID: "2",
                language: "de",
                authoredLanguage: "German",
                resPath: "res:/audio/German/voice.bnk",
                byteLength: 10,
            },
        },
        embeddedMedia: {
            900001: [
                {
                    sourceID: "embedded:900001:700:1",
                    bank: "700:1",
                    language: "en-us",
                    offset: 1,
                    byteLength: 4,
                    mediaType: "wem",
                },
                {
                    sourceID: "embedded:900001:700:2",
                    bank: "700:2",
                    language: "de",
                    offset: 1,
                    byteLength: 4,
                    mediaType: "wem",
                },
            ],
        },
    };
    const audio = new CjsToolAudioSource({
        library,
        source: {
            async Fetch()
            {
                throw new Error("Selection test must not fetch");
            },
        },
    });

    assert.equal(
        audio.ResolveMediaByID("900001").sourceID,
        "embedded:900001:700:2",
    );
    assert.equal(
        audio.ResolveMediaByID("900001", {
            languages: [ "en-US" ],
        }).sourceID,
        "embedded:900001:700:1",
    );
    assert.throws(
        () => audio.ResolveMediaByID("900001", {
            languages: [ "fr-FR" ],
        }),
        /No acceptable representation/u,
    );
});

test("audio repository opens the prepared exact-build library and index source", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-audio-repository-"));
    const cache = new CjsToolCache(directory);

    context.after(() => fs.rm(directory, { force: true, recursive: true }));
    await cache.WriteCustomLibrary({
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "123",
        name: "audio",
        version: "v2",
    }, CreateLibrary());

    const repository = new CjsToolAudioRepository({
        cache,
        indexes: {
            async ResolveTargetBuild(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "latest");

                return { build: "123", client: null };
            },
            async OpenTarget(target, build, options)
            {
                assert.equal(target, "eve");
                assert.equal(build, "123");
                assert.deepEqual(options, { client: "tranquility" });

                return CreateIndexedSource();
            },
        },
    });
    const audio = await repository.OpenTarget("eve", "latest");
    const result = await audio.Read(audio.ResolveMediaByID("900001"));

    assert.deepEqual(
        new Uint8Array(result.bytes),
        Uint8Array.from([ 32, 33, 34 ]),
    );
});

test("audio source accepts v2 music and rejects broken graph references", () =>
{
    const music = {
        schemaVersion: 1,
        generator: "@carbonenginejs/tools-core/audio",
        banks: [ "music.bnk" ],
        nodes: {
            4101: {
                type: "music-track",
                bank: "music.bnk",
                children: [],
                sources: [ { sourceId: 900001 } ],
            },
        },
        eventTargets: { music_play: [ 4101 ] },
        eventStops: {},
        switchSetters: {
            music_state: [ { kind: "state", groupId: 7, targetId: 8 } ],
        },
    };
    const library = CreateLibrary({ schemaVersion: 2, music });
    const audio = new CjsToolAudioSource({
        library,
        source: CreateIndexedSource(),
    });

    assert.equal(CjsToolAudioSource.validateLibrary(library), true);
    assert.equal(audio.ResolveMediaByID("900001").mediaType, "audio/x-wem");

    assert.throws(
        () => CjsToolAudioSource.validateLibrary({
            ...library,
            music: {
                ...music,
                nodes: {
                    ...music.nodes,
                    4102: {
                        type: "music-track",
                        bank: "music.bnk",
                        children: [],
                        sources: [ { sourceId: 123456 } ],
                    },
                },
            },
        }),
        /missing source 123456/u,
    );
    assert.throws(
        () => CjsToolAudioSource.validateLibrary({
            ...library,
            banks: {
                "524:0": {
                    ...library.banks["524:0"],
                    languageID: "1",
                },
            },
        }),
        /identity must be 524:1/u,
    );
});

test("audio repository reads only the v2 artifact", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-audio-v2-"));
    const cache = new CjsToolCache(directory);

    context.after(() => fs.rm(directory, { force: true, recursive: true }));
    await cache.WriteCustomLibrary({
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "123",
        name: "audio",
        version: "v1",
    }, CreateLibrary());
    const indexes = {
        async ResolveTargetBuild()
        {
            return { build: "123", client: null };
        },
        async OpenTarget()
        {
            return CreateIndexedSource();
        },
    };
    const legacyOnly = new CjsToolAudioRepository({
        cache,
        indexes,
        autoPrepare: false,
    });

    await assert.rejects(
        () => legacyOnly.OpenTarget("eve", "123"),
        /Audio library is not prepared/u,
    );

    await cache.WriteCustomLibrary({
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "123",
        name: "audio",
        version: "v2",
    }, CreateLibrary({ schemaVersion: 2 }));

    const repository = new CjsToolAudioRepository({ cache, indexes });
    const audio = await repository.OpenTarget("eve", "123");

    assert.equal(audio.library.schemaVersion, 2);
});

test("audio endpoints serve GET, HEAD, exact paths, and logical ranges", async context =>
{
    const audio = CreateAudioSource();
    const root = await StartProxy(context, {
        async OpenTarget(target, build)
        {
            assert.equal(target, "eve");
            assert.equal(build, "123");

            return audio;
        },
    });
    const idUrl = `${root}/eve/123/audio/id/777`;
    const complete = await fetch(idUrl);
    const etag = complete.headers.get("etag");

    assert.equal(complete.status, 200);
    assert.equal(complete.headers.get("content-type"), "audio/ogg");
    assert.equal(complete.headers.get("content-language"), "en-us");
    assert.equal(complete.headers.get("content-length"), "4");
    assert.equal(complete.headers.get("accept-ranges"), "bytes");
    assert.equal(complete.headers.get("vary"), "Accept, Accept-Language");
    assert.equal(complete.headers.get("x-carbon-audio-media-id"), "777");
    assert.match(
        complete.headers.get("access-control-expose-headers"),
        /Content-Language/u,
    );
    assert.deepEqual(
        new Uint8Array(await complete.arrayBuffer()),
        Files.get(PreparedPath),
    );

    const head = await fetch(idUrl, { method: "HEAD" });

    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "4");
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const range = await fetch(idUrl, {
        headers: { range: "bytes=1-2" },
    });

    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), "bytes 1-2/4");
    assert.equal(range.headers.get("content-length"), "2");
    assert.deepEqual(
        new Uint8Array(await range.arrayBuffer()),
        Uint8Array.from([ 11, 12 ]),
    );

    const suffix = await fetch(idUrl, {
        headers: { range: "bytes=-2" },
    });

    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get("content-range"), "bytes 2-3/4");
    assert.deepEqual(
        new Uint8Array(await suffix.arrayBuffer()),
        Uint8Array.from([ 12, 13 ]),
    );

    const pathUrl = `${root}/eve/123/audio/path/${encodeURIComponent(LoosePath)}`;
    const exactPath = await fetch(pathUrl);

    assert.equal(exactPath.status, 200);
    assert.equal(exactPath.headers.get("content-type"), "application/octet-stream");
    assert.equal(exactPath.headers.get("vary"), "Accept");
    assert.equal(exactPath.headers.get("x-carbon-audio-path"), LoosePath);
    assert.deepEqual(
        new Uint8Array(await exactPath.arrayBuffer()),
        Files.get(LoosePath),
    );

    const notModified = await fetch(idUrl, {
        headers: { "if-none-match": etag },
    });

    assert.equal(notModified.status, 304);
});

test("audio library endpoint serves the installed document", async context =>
{
    const library = { ...CreateLibrary(), generatedAt: "2026-01-01T00:00:00Z" };
    const audio = new CjsToolAudioSource({
        library,
        source: CreateIndexedSource(),
    });
    const root = await StartProxy(context, {
        async OpenTarget()
        {
            return audio;
        },
    });

    for (const spelling of [ "library", "library.json" ])
    {
        const complete = await fetch(`${root}/eve/123/audio/${spelling}`);

        assert.equal(complete.status, 200);
        assert.match(complete.headers.get("content-type"), /application\/json/u);
        assert.equal(
            complete.headers.get("cache-control"),
            "public, max-age=31536000, immutable",
            "the library document is cacheable, never no-store",
        );

        const document = await complete.json();

        assert.equal(document.schema, "carbonenginejs.audioLibrary");
        assert.equal(document.sourceBuild, "123");
        assert.equal(document.generatedAt, library.generatedAt);
    }

    const etag = (await fetch(`${root}/eve/123/audio/library`)).headers.get("etag");

    assert.match(etag, /audio-library-123/u);

    const head = await fetch(`${root}/eve/123/audio/library`, { method: "HEAD" });

    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const notModified = await fetch(`${root}/eve/123/audio/library`, {
        headers: { "if-none-match": etag },
    });

    assert.equal(notModified.status, 304);

    const invalid = await fetch(`${root}/eve/123/audio/library/extra`);

    assert.equal(invalid.status, 404);
});

test("audio music endpoints list playlists and expose only available songs", async context =>
{
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "cjs-music-source-"),
    );

    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.mkdir(path.join(directory, "main"), { recursive: true });
    await fs.writeFile(
        path.join(directory, "main", "001.m4a"),
        Uint8Array.from([ 1, 2, 3, 4 ]),
    );
    await fs.writeFile(
        path.join(directory, "main", "001.jpg"),
        Uint8Array.from([ 9, 10, 11, 12 ]),
    );
    await fs.writeFile(
        path.join(directory, "main", "002.jpg"),
        Uint8Array.from([ 5, 6, 7, 8 ]),
    );

    const music = new CjsToolMusicSource({
        directory,
        library: {
            schema: "carbonenginejs.musicLibrary",
            schemaVersion: 1,
            name: "Test soundtrack",
            author: "Test author",
            version: "1",
            playlists: [
                {
                    id: "main",
                    name: "Main",
                    author: "Test curator",
                    version: "1",
                    songs: [
                        {
                            id: "001",
                            name: "Available",
                            url: "https://example.invalid/one.m4a",
                        },
                        {
                            id: "002",
                            name: "Unavailable",
                            path: "missing.m4a",
                        },
                    ],
                },
            ],
        },
    });
    const root = await StartProxy(context, {
        async OpenMusicTarget()
        {
            return CreateAudioSource(music);
        },
        async OpenTarget()
        {
            throw new Error(
                "neutral music routes must not open the Wwise library",
            );
        },
    });
    const requestedBase = `${root}/eve/latest/audio/music`;
    const base = `${root}/eve/123/audio/music`;
    const catalogResponse = await fetch(requestedBase);
    const catalog = await catalogResponse.json();

    assert.equal(catalogResponse.status, 200);
    assert.equal(catalog.name, "Test soundtrack");
    assert.deepEqual(catalog.playlists[0], {
        id: "main",
        name: "Main",
        author: "Test curator",
        version: "1",
        songCount: 2,
        availableSongCount: 1,
        url: `${base}/playlists/main`,
    });

    const hostile = await RequestJson(requestedBase, {
        host: "evil.invalid",
        forwarded: "host=evil.invalid;proto=https",
        "x-forwarded-host": "evil.invalid",
        "x-forwarded-proto": "https",
    });

    assert.equal(hostile.status, 200);
    assert.equal(
        hostile.value.playlists[0].url,
        `${base}/playlists/main`,
        "service URLs must ignore caller-controlled forwarding headers",
    );

    const playlistResponse = await fetch(
        `${requestedBase}/playlists/main`,
    );
    const playlist = await playlistResponse.json();

    assert.equal(playlistResponse.status, 200);
    assert.equal(playlist.songs[0].available, true);
    assert.equal(
        playlist.songs[0].url,
        `${base}/playlists/main/songs/001`,
    );
    assert.equal(playlist.songs[1].available, false);

    const installable = await (
        await fetch(`${requestedBase}/library`)
    ).json();

    assert.equal(installable.schema, "carbonenginejs.musicLibrary");
    assert.deepEqual(installMusicLibrary(installable), installable);
    assert.deepEqual(
        installable.playlists[0].songs.map(song => song.id),
        [ "001" ],
        "the installable catalog omits currently unavailable songs",
    );
    assert.equal(
        installable.playlists[0].songs[0].url,
        `${base}/playlists/main/songs/001`,
    );

    const songUrl = installable.playlists[0].songs[0].url;
    const head = await fetch(songUrl, { method: "HEAD" });

    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-type"), "audio/mp4");
    assert.equal(head.headers.get("content-length"), "4");
    assert.equal(head.headers.get("x-carbon-music-playlist"), "main");
    assert.equal(head.headers.get("x-carbon-music-song"), "001");

    const range = await fetch(songUrl, {
        headers: { range: "bytes=1-2" },
    });

    assert.equal(range.status, 206);
    assert.deepEqual(
        new Uint8Array(await range.arrayBuffer()),
        Uint8Array.from([ 2, 3 ]),
    );

    const missing = await fetch(`${base}/playlists/main/songs/002`, {
        method: "HEAD",
    });

    assert.equal(missing.status, 404);
});

test("audio music routes round-trip reserved and escaped catalog IDs", async context =>
{
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "cjs-music-route-"),
    );

    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.writeFile(
        path.join(directory, "track.m4a"),
        Uint8Array.from([ 1, 2, 3 ]),
    );

    const music = new CjsToolMusicSource({
        directory,
        library: {
            schema: "carbonenginejs.musicLibrary",
            schemaVersion: 1,
            name: "Route soundtrack",
            version: "1",
            playlists: [
                {
                    id: "library",
                    name: "Reserved word",
                    songs: [
                        {
                            id: "track/01",
                            name: "Escaped song",
                            path: "track.m4a",
                        },
                    ],
                },
            ],
        },
    });
    const root = await StartProxy(context, {
        async OpenMusicTarget()
        {
            return CreateAudioSource(music);
        },
        async OpenTarget()
        {
            return CreateAudioSource(music);
        },
    });
    const base = `${root}/eve/123/audio/music`;
    const playlist = await (
        await fetch(`${base}/playlists/library`)
    ).json();

    assert.equal(playlist.id, "library");
    assert.equal(
        playlist.songs[0].url,
        `${base}/playlists/library/songs/track%2F01`,
    );

    const response = await fetch(playlist.songs[0].url);

    assert.equal(response.status, 200);
    assert.deepEqual(
        new Uint8Array(await response.arrayBuffer()),
        Uint8Array.from([ 1, 2, 3 ]),
    );
});

test("audio music library HEAD matches GET when every song is unavailable", async context =>
{
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "cjs-music-empty-"),
    );

    context.after(() => fs.rm(directory, { recursive: true, force: true }));

    const music = new CjsToolMusicSource({
        directory,
        library: {
            schema: "carbonenginejs.musicLibrary",
            schemaVersion: 1,
            name: "Unavailable soundtrack",
            version: "1",
            playlists: [
                {
                    id: "main",
                    name: "Main",
                    songs: [
                        {
                            id: "missing",
                            name: "Missing",
                            path: "missing.m4a",
                        },
                    ],
                },
            ],
        },
    });
    const root = await StartProxy(context, {
        async OpenMusicTarget()
        {
            return CreateAudioSource(music);
        },
        async OpenTarget()
        {
            return CreateAudioSource(music);
        },
    });
    const libraryUrl = `${root}/eve/123/audio/music/library`;
    const get = await fetch(libraryUrl);
    const head = await fetch(libraryUrl, { method: "HEAD" });

    assert.equal(get.status, 404);
    assert.equal(head.status, get.status);
});

test("audio music source rejects playlist-directory link escapes", async context =>
{
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "cjs-music-root-"),
    );
    const outside = await fs.mkdtemp(
        path.join(os.tmpdir(), "cjs-music-outside-"),
    );

    context.after(async () =>
    {
        await fs.rm(directory, { recursive: true, force: true });
        await fs.rm(outside, { recursive: true, force: true });
    });
    await fs.writeFile(
        path.join(outside, "001.m4a"),
        Uint8Array.from([ 1, 2, 3 ]),
    );

    try
    {
        await fs.symlink(
            outside,
            path.join(directory, "main"),
            process.platform === "win32" ? "junction" : "dir",
        );
    }
    catch (error)
    {
        if (error?.code === "EPERM" || error?.code === "EACCES")
        {
            context.skip("Creating a test directory link is not permitted");
            return;
        }
        throw error;
    }

    const music = new CjsToolMusicSource({
        directory,
        library: {
            schema: "carbonenginejs.musicLibrary",
            schemaVersion: 1,
            name: "Contained soundtrack",
            version: "1",
            playlists: [
                {
                    id: "main",
                    name: "Main",
                    songs: [
                        {
                            id: "001",
                            name: "Outside",
                            url: "https://example.invalid/001.m4a",
                        },
                    ],
                },
            ],
        },
    });
    const playlist = await music.GetPlaylist("main", {
        urlForSong: () => "http://127.0.0.1/unreachable",
    });

    assert.equal(playlist.songs[0].available, false);
    await assert.rejects(
        music.ResolveSong("main", "001"),
        error => error?.statusCode === 404,
    );
});

test("audio endpoints reject unacceptable, unknown, and invalid ranges", async context =>
{
    const root = await StartProxy(context, {
        async OpenTarget()
        {
            return CreateAudioSource();
        },
    });
    const idUrl = `${root}/eve/123/audio/id/777`;
    const unacceptable = await fetch(idUrl, {
        headers: { accept: "audio/mpeg" },
    });

    assert.equal(unacceptable.status, 406);

    const unknown = await fetch(`${root}/eve/123/audio/id/12345`);

    assert.equal(unknown.status, 404);

    const invalidRange = await fetch(idUrl, {
        headers: { range: "bytes=0-1,2-3" },
    });

    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers.get("content-range"), "bytes */4");

    const arbitraryPath = await fetch(
        `${root}/eve/123/audio/path/${encodeURIComponent("C:\\private\\audio.wem")}`,
    );

    assert.equal(arbitraryPath.status, 404);

    const weakPath = `${root}/eve/123/audio/path/${encodeURIComponent(LoosePath)}`;
    const weakEtag = (await fetch(weakPath)).headers.get("etag");
    const weakNotModified = await fetch(weakPath, {
        headers: { "if-none-match": weakEtag },
    });

    assert.match(weakEtag, /^W\//u);
    assert.equal(weakNotModified.status, 304);

    const options = await fetch(idUrl, { method: "OPTIONS" });

    assert.equal(options.status, 204);
    assert.match(options.headers.get("access-control-allow-methods"), /HEAD/u);
    assert.match(options.headers.get("access-control-allow-headers"), /Range/u);
});
