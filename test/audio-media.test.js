import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
    CjsToolAudioRepository,
    CjsToolAudioSource,
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

function CreateLibrary({ schemaVersion = 1, music = undefined } = {})
{
    const bankKey = schemaVersion === 2 ? "524:0" : "524.bnk";

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
                ...(schemaVersion === 2 ? {
                    sourceID: bankKey,
                    bankID: "524",
                    languageID: "0",
                    shortName: "ships",
                    language: "",
                } : {}),
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
                mediaType: schemaVersion === 2 ? "wem" : "audio/x-wem",
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

function CreateAudioSource()
{
    return new CjsToolAudioSource({
        library: CreateLibrary(),
        source: CreateIndexedSource(),
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
        game: "Eve",
        provider: "ccp",
        build: "123",
        name: "audio",
        version: "v1",
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

test("audio repository prefers v2 and falls back to v1", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-audio-v2-"));
    const cache = new CjsToolCache(directory);

    context.after(() => fs.rm(directory, { force: true, recursive: true }));
    await cache.WriteCustomLibrary({
        game: "Eve",
        provider: "ccp",
        build: "123",
        name: "audio",
        version: "v1",
    }, CreateLibrary());
    await cache.WriteCustomLibrary({
        game: "Eve",
        provider: "ccp",
        build: "123",
        name: "audio",
        version: "v2",
    }, CreateLibrary({ schemaVersion: 2 }));

    const repository = new CjsToolAudioRepository({
        cache,
        indexes: {
            async ResolveTargetBuild()
            {
                return { build: "123", client: null };
            },
            async OpenTarget()
            {
                return CreateIndexedSource();
            },
        },
    });
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
