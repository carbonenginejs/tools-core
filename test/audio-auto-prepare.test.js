import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CjsToolAudioRepository } from "../src/audio/index.js";
import { CjsToolCache } from "../src/cache/index.js";
import { CjsSdeRepository } from "../src/sde/index.js";

const TRACK_ID = 4101;
const SEGMENT_ID = 4001;
const PLAYLIST_ID = 4201;
const MEDIA_ID = 900001;

// Synthetic-bank byte builders mirror test/audio-music.test.js: each test
// file stays self-contained per the offline-fixture convention.
function Writer()
{
    const bytes = [];
    const scratch = new DataView(new ArrayBuffer(8));

    return {
        U8(value)
        {
            bytes.push(value & 0xff);
            return this;
        },
        U16(value)
        {
            bytes.push(value & 0xff, (value >>> 8) & 0xff);
            return this;
        },
        U32(value)
        {
            bytes.push(
                value & 0xff,
                (value >>> 8) & 0xff,
                (value >>> 16) & 0xff,
                (value >>> 24) & 0xff,
            );
            return this;
        },
        S32(value)
        {
            return this.U32(value >>> 0);
        },
        F32(value)
        {
            scratch.setFloat32(0, value, true);
            for (let index = 0; index < 4; index++)
            {
                bytes.push(scratch.getUint8(index));
            }
            return this;
        },
        F64(value)
        {
            scratch.setFloat64(0, value, true);
            for (let index = 0; index < 8; index++)
            {
                bytes.push(scratch.getUint8(index));
            }
            return this;
        },
        Fill(count)
        {
            for (let index = 0; index < count; index++)
            {
                bytes.push(0xaa);
            }
            return this;
        },
        Bytes()
        {
            return new Uint8Array(bytes);
        },
    };
}

function WriteNodeTail(writer, children, { stinger = false } = {})
{
    writer.U32(children.length);
    for (const child of children)
    {
        writer.U32(child);
    }
    writer.F64(1000).F64(0).F32(120).U8(4).U8(4);
    writer.U8(1);
    writer.U32(stinger ? 1 : 0);
    if (stinger)
    {
        writer
            .U32(77)
            .U32(SEGMENT_ID)
            .U32(2)
            .U32(0)
            .S32(1000)
            .U32(1);
    }
}

function CreateTrackPayload(sourceID = MEDIA_ID)
{
    return Writer()
        .U8(0)
        .U32(1)
        .U32(0x00040001)
        .U8(1)
        .U32(sourceID)
        .U32(4171)
        .U8(1)
        .U32(0)
        .U32(0)
        .Fill(9)
        .U8(0)
        .F32(0.1)
        .Bytes();
}

function CreateSegmentPayload(childID = TRACK_ID)
{
    const writer = Writer().Fill(7);

    WriteNodeTail(writer, [ childID ], { stinger: true });

    return writer.F64(270000).U32(0).Bytes();
}

function WriteTransitionRule(writer)
{
    writer
        .U32(1)
        .U32(1)
        .S32(-1)
        .U32(1)
        .S32(-1)
        .S32(500)
        .U32(4)
        .S32(0)
        .U32(2)
        .U32(0)
        .U8(1)
        .S32(0)
        .U32(4)
        .S32(0)
        .U32(0)
        .U32(0)
        .U16(0)
        .U16(0)
        .U8(0)
        .U8(0)
        .U8(1)
        .U32(SEGMENT_ID)
        .S32(100)
        .U32(4)
        .S32(0)
        .S32(200)
        .U32(4)
        .S32(0)
        .U8(1)
        .U8(0);
}

function CreatePlaylistPayload()
{
    const writer = Writer().Fill(5);

    WriteNodeTail(writer, [ SEGMENT_ID ]);
    WriteTransitionRule(writer);

    return writer
        .U32(1)
        .U32(SEGMENT_ID)
        .U32(101)
        .U32(0)
        .S32(-1)
        .U16(1)
        .U16(0)
        .U16(0)
        .U32(50000)
        .U16(0)
        .U8(0)
        .U8(0)
        .Bytes();
}

function Concat(...parts)
{
    const values = parts.map(part =>
        part instanceof Uint8Array ? part : Uint8Array.from(part));
    const bytes = new Uint8Array(
        values.reduce((total, value) => total + value.byteLength, 0),
    );
    let offset = 0;

    for (const value of values)
    {
        bytes.set(value, offset);
        offset += value.byteLength;
    }

    return bytes;
}

function Chunk(fourCC, payload)
{
    return Concat(
        [ ...fourCC ].map(value => value.charCodeAt(0)),
        Writer().U32(payload.byteLength).Bytes(),
        payload,
    );
}

function HircObject(type, id, payload)
{
    return Concat(
        [ type ],
        Writer().U32(4 + payload.byteLength).U32(id).Bytes(),
        payload,
    );
}

function CreateBank(bankID, objects, embedded = null)
{
    const chunks = [
        Chunk(
            "BKHD",
            Writer().U32(150).U32(bankID).U32(0).U32(16).Bytes(),
        ),
    ];

    if (embedded)
    {
        chunks.push(Chunk(
            "DIDX",
            Writer()
                .U32(embedded.id)
                .U32(0)
                .U32(embedded.bytes.byteLength)
                .Bytes(),
        ));
        chunks.push(Chunk("DATA", embedded.bytes));
    }

    chunks.push(Chunk(
        "HIRC",
        Concat(Writer().U32(objects.length).Bytes(), ...objects),
    ));

    return Concat(...chunks);
}

function CreateSyntheticBanks()
{
    const music = CreateBank(200, [
        HircObject(11, TRACK_ID, CreateTrackPayload()),
        HircObject(10, SEGMENT_ID, CreateSegmentPayload()),
        HircObject(13, PLAYLIST_ID, CreatePlaylistPayload()),
    ], {
        id: MEDIA_ID,
        bytes: new TextEncoder().encode("RIFFsynthetic-wem"),
    });
    const essential = CreateBank(201, []);
    const common = CreateBank(202, [
        HircObject(
            4,
            101,
            Writer().U8(4).U32(1).U32(2).U32(3).U32(4).Bytes(),
        ),
        HircObject(
            3,
            1,
            Writer().U16(0x0403).U32(PLAYLIST_ID).Bytes(),
        ),
        HircObject(
            3,
            2,
            Writer().U16(0x0103).U32(PLAYLIST_ID).Bytes(),
        ),
    ]);

    return new Map([
        [ "music.bnk", music ],
        [ "music_essential.bnk", essential ],
        [ "common.bnk", common ],
    ]);
}

function SyntheticSoundbanksInfo()
{
    return {
        SoundBanksInfo: {
            SoundBanks: [
                {
                    Id: "200",
                    ShortName: "music",
                    Path: "SoundBanks\\music.bnk",
                    Media: [ { Id: String(MEDIA_ID), ShortName: `${MEDIA_ID}.wem` } ],
                },
                {
                    Id: "201",
                    ShortName: "music_essential",
                    Path: "SoundBanks\\music_essential.bnk",
                },
                {
                    Id: "202",
                    ShortName: "common",
                    Path: "SoundBanks\\common.bnk",
                    Events: [ { Id: "101", Name: "music_play" } ],
                },
            ],
        },
    };
}

function CreateFakeIndexSource(banks)
{
    const files = new Map();
    const records = [];
    const shards = [ "aa", "bb", "cc", "dd" ];
    let shard = 0;

    const AddFile = (name, bytes) =>
    {
        const logicalPath = `res:/audio/${name}`;
        const checksum = crypto.createHash("md5").update(bytes).digest("hex");

        files.set(logicalPath, bytes);
        records.push({
            logicalPath,
            storagePath: `${shards[shard++]}/${name}`,
            checksum,
            uncompressedSize: bytes.byteLength,
        });
    };

    for (const [ name, bytes ] of banks)
    {
        AddFile(name, bytes);
    }
    AddFile(
        "soundbanksinfo.json",
        new TextEncoder().encode(JSON.stringify(SyntheticSoundbanksInfo())),
    );

    const fetched = [];

    return {
        fetched,
        Match(pattern, options = {})
        {
            assert.equal(options.root, "res");
            return records.map(record => ({
                logicalPath: record.logicalPath,
                record,
            }));
        },
        async Fetch(logicalPath)
        {
            fetched.push(logicalPath);

            const bytes = files.get(logicalPath.toLowerCase());

            if (!bytes)
            {
                throw new Error(`Unexpected fetch: ${logicalPath}`);
            }

            return { bytes };
        },
    };
}

function CreateTempDirectory(context, name)
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), name));

    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    return directory;
}

test("audio repository auto-prepares a missing library from indexed inputs", async context =>
{
    const cacheDirectory = CreateTempDirectory(context, "cjs-audio-auto-");
    const source = CreateFakeIndexSource(CreateSyntheticBanks());
    const indexes = {
        async OpenTarget()
        {
            return source;
        },
        async ResolveTargetBuild()
        {
            throw new Error("exact builds must not resolve remotely");
        },
    };
    const repository = new CjsToolAudioRepository({
        cache: new CjsToolCache(cacheDirectory),
        indexes,
    });

    assert.equal(repository.autoPrepare, true, "auto-preparation is the default");

    const audio = await repository.OpenTarget("eve", "123");

    assert.equal(audio.library.schema, "carbonenginejs.audioLibrary");
    assert.equal(audio.library.schemaVersion, 2);
    assert.equal(audio.library.sourceBuild, "123");
    assert.ok(audio.library.metadata.Events.music_play, "SoundbanksInfo events survive");
    assert.ok(audio.library.embeddedMedia[String(MEDIA_ID)], "embedded windows extracted");
    assert.ok(audio.library.music, "music graph built when the music banks are indexed");

    const installedPath = path.join(
        cacheDirectory,
        "custom",
        "games",
        "Eve",
        "providers",
        "ccp",
        "builds",
        "123",
        "audio_v2.json",
    );

    assert.ok(fs.existsSync(installedPath), "library installs into the custom cache");
    assert.ok(fs.existsSync(`${installedPath}.gz`), "gzip sibling installs beside it");

    // A fresh repository answers from the installed artifact without
    // re-acquiring any inputs.
    source.fetched.length = 0;

    const reopened = await new CjsToolAudioRepository({
        cache: new CjsToolCache(cacheDirectory),
        indexes,
    }).OpenTarget("eve", "123");

    assert.equal(reopened.library.sourceBuild, "123");
    assert.deepEqual(source.fetched, [], "prepared builds never rebuild");
});

test("audio repository reports unprepared builds when auto-preparation is disabled", async context =>
{
    const cacheDirectory = CreateTempDirectory(context, "cjs-audio-manual-");
    const repository = new CjsToolAudioRepository({
        cache: new CjsToolCache(cacheDirectory),
        indexes: {
            async OpenTarget()
            {
                throw new Error("must not open the index source");
            },
            async ResolveTargetBuild()
            {
                throw new Error("must not resolve remotely");
            },
        },
        autoPrepare: false,
    });

    await assert.rejects(
        () => repository.OpenTarget("eve", "123"),
        /not prepared/u,
    );
});

test("sde repository defaults to auto-prepare and falls back to the newest prepared database", async context =>
{
    const cacheDirectory = CreateTempDirectory(context, "cjs-sde-fallback-");
    const buildsDirectory = path.join(
        cacheDirectory,
        "custom",
        "games",
        "Eve",
        "providers",
        "ccp",
        "builds",
    );

    for (const build of [ "2999", "3000" ])
    {
        const directory = path.join(buildsDirectory, build);

        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, "sde_v1.sqlite"), "");
    }

    const repository = new CjsSdeRepository({
        cache: new CjsToolCache(cacheDirectory),
        archive: {
            async ResolveLatest()
            {
                throw new Error("official SDE channel unreachable");
            },
            async PrepareDatabase()
            {
                throw new Error("must not prepare in this test");
            },
        },
    });

    assert.equal(repository.autoPrepare, true, "auto-preparation is the default");

    // The SDE is never guaranteed to match the live build: an unreachable
    // official channel resolves `latest` to the newest prepared database.
    const resolution = await repository.ResolveTargetBuild("eve", "latest");

    assert.equal(resolution.build, "3000");
    assert.equal(resolution.source, "newest-prepared-fallback");
});
