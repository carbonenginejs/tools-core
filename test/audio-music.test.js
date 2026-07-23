import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

import { CjsToolAudioBuilder } from "../src/audio/index.js";

const TRACK_ID = 4101;
const SEGMENT_ID = 4001;
const PLAYLIST_ID = 4201;
const MEDIA_ID = 900001;
const ESSENTIAL_MEDIA_ID = 900002;

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

function SetterPayload(groupID, targetID)
{
    return Writer().U32(groupID).U32(targetID).Bytes();
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
        HircObject(
            3,
            3,
            Writer().U16(0x1900).U32(0).U32(700).U32(701).Bytes(),
        ),
        HircObject(
            3,
            4,
            Writer().U16(0x1200).U32(0).U32(800).U32(801).Bytes(),
        ),
    ]);

    return new Map([
        [ "music.bnk", music ],
        [ "music_essential.bnk", essential ],
        [ "common.bnk", common ],
    ]);
}

function WriteSyntheticCache(directory, banks)
{
    const cache = path.join(directory, "cache");
    const indexLines = [];
    const shards = [ "aa", "bb", "cc" ];
    let index = 0;

    for (const [ name, bytes ] of banks)
    {
        const storagePath = `${shards[index++]}/${name}`;
        const filePath = path.join(cache, "ResFiles", storagePath);
        const checksum = crypto.createHash("md5").update(bytes).digest("hex");

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, bytes);
        indexLines.push(
            `res:/audio/${name},${storagePath},${checksum},${bytes.byteLength}`,
        );
    }

    const indexPath = path.join(directory, "resfileindex.txt");

    fs.writeFileSync(indexPath, `${indexLines.join("\n")}\n`);

    return { cache, indexLines, indexPath };
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

function CreateInspections(options = {})
{
    const {
        trackPayload = CreateTrackPayload(),
        segmentPayload = CreateSegmentPayload(),
        essentialTrackPayload = null,
        knownChildID = null,
    } = options;
    const musicHirc = [
        { type: 11, id: TRACK_ID, payload: trackPayload },
        { type: 10, id: SEGMENT_ID, payload: segmentPayload },
        { type: 13, id: PLAYLIST_ID, payload: CreatePlaylistPayload() },
    ];

    if (knownChildID !== null)
    {
        musicHirc.push({ type: 2, id: knownChildID, payload: null });
    }

    return [
        {
            source: "music.bnk",
            hirc: musicHirc,
        },
        {
            source: "music_essential.bnk",
            hirc: essentialTrackPayload
                ? [ { type: 11, id: TRACK_ID, payload: essentialTrackPayload } ]
                : [],
        },
        {
            source: "common.bnk",
            hirc: [
                {
                    type: 4,
                    typeName: "event",
                    id: 101,
                    actionIds: [ 1, 1, 2, 3, 4 ],
                },
                {
                    type: 3,
                    typeName: "event-action",
                    id: 1,
                    actionType: 0x0403,
                    targetId: PLAYLIST_ID,
                },
                {
                    type: 3,
                    typeName: "event-action",
                    id: 2,
                    actionType: 0x0103,
                    targetId: PLAYLIST_ID,
                },
                {
                    type: 3,
                    typeName: "event-action",
                    id: 3,
                    actionType: 0x1900,
                    targetId: 0,
                    payload: SetterPayload(700, 701),
                },
                {
                    type: 3,
                    typeName: "event-action",
                    id: 4,
                    actionType: 0x1200,
                    targetId: 0,
                    payload: SetterPayload(800, 801),
                },
            ],
        },
    ];
}

function CreateGraph(options = {})
{
    return CjsToolAudioBuilder.createMusicGraph({
        inspections: CreateInspections(options),
        metadata: {
            Events: {
                music_play: { eventID: 101 },
            },
        },
        media: {
            [MEDIA_ID]: {},
            [ESSENTIAL_MEDIA_ID]: {},
        },
        embeddedMedia: {},
    });
}

test("music construction preserves authored node data and projects actions", () =>
{
    const graph = CreateGraph();

    assert.deepEqual(graph.banks, [ "music.bnk", "music_essential.bnk" ]);
    assert.equal(graph.nodes[TRACK_ID].bank, "music.bnk");
    assert.equal(graph.nodes[TRACK_ID].sources[0].sourceId, MEDIA_ID);
    assert.equal(graph.nodes[TRACK_ID].sources[0].pluginId, 0x00040001);
    assert.equal(graph.nodes[SEGMENT_ID].stingers[0].triggerId, 77);
    assert.equal(
        graph.nodes[PLAYLIST_ID].rules[0].transitionSegment.segmentId,
        SEGMENT_ID,
    );
    assert.deepEqual(graph.eventTargets, { music_play: [ PLAYLIST_ID ] });
    assert.deepEqual(graph.eventStops, { music_play: [ PLAYLIST_ID ] });
    assert.deepEqual(graph.switchSetters, {
        music_play: [
            { kind: "state", groupId: 800, targetId: 801 },
            { kind: "switch", groupId: 700, targetId: 701 },
        ],
    });
    assert.equal(JSON.stringify(graph), JSON.stringify(CreateGraph()));

    const overridden = CreateGraph({
        essentialTrackPayload: CreateTrackPayload(ESSENTIAL_MEDIA_ID),
    });

    assert.equal(overridden.nodes[TRACK_ID].bank, "music_essential.bnk");
    assert.equal(
        overridden.nodes[TRACK_ID].sources[0].sourceId,
        ESSENTIAL_MEDIA_ID,
    );
});

test("music construction rejects incomplete parsing and unresolved references", () =>
{
    assert.throws(
        () => CreateGraph({
            trackPayload: CreateTrackPayload().subarray(0, 8),
        }),
        /Music-node parsing failed/u,
    );
    assert.throws(
        () => CreateGraph({
            segmentPayload: CreateSegmentPayload(999999),
            knownChildID: 999999,
        }),
        /references missing child 999999/u,
    );
    assert.throws(
        () => CjsToolAudioBuilder.createMusicGraph({
            inspections: CreateInspections(),
            metadata: { Events: { music_play: { eventID: 101 } } },
            media: {},
            embeddedMedia: {},
        }),
        /missing source 900001/u,
    );
    assert.throws(
        () => CjsToolAudioBuilder.createMusicGraph({
            inspections: CreateInspections().slice(0, 2),
            metadata: { Events: {} },
            media: { [MEDIA_ID]: {} },
        }),
        /requires inspected bank: common\.bnk/u,
    );
});

test("event media uses authored bank precedence and selects one language", () =>
{
    const musicEventID = 101;
    const voiceEventID = 102;
    const musicTargetID = 500;
    const voiceTargetID = 600;
    const inspections = [
        {
            source: "voice.bnk",
            resPath: "res:/audio/German/voice.bnk",
            bankId: 300,
            languageId: 2,
            language: "de",
            hirc: [
                {
                    type: 2,
                    id: voiceTargetID,
                    sourceId: 920002,
                    payload: Writer().U32(920002).Bytes(),
                },
            ],
            media: [ { id: 920002 } ],
        },
        {
            source: "music_essential.bnk",
            resPath: "res:/audio/music_essential.bnk",
            bankId: 201,
            languageId: 0,
            hirc: [
                {
                    type: 2,
                    id: musicTargetID,
                    sourceId: 910002,
                    payload: Writer().U32(910002).Bytes(),
                },
            ],
            media: [ { id: 910002 } ],
        },
        {
            source: "common.bnk",
            resPath: "res:/audio/common.bnk",
            bankId: 202,
            languageId: 0,
            hirc: [
                {
                    type: 4,
                    id: musicEventID,
                    actionIds: [ 1 ],
                    payload: null,
                },
                {
                    type: 3,
                    id: 1,
                    actionType: 0x0403,
                    targetId: musicTargetID,
                    payload: null,
                },
                {
                    type: 4,
                    id: voiceEventID,
                    actionIds: [ 2 ],
                    payload: null,
                },
                {
                    type: 3,
                    id: 2,
                    actionType: 0x0403,
                    targetId: voiceTargetID,
                    payload: null,
                },
            ],
            media: [],
        },
        {
            source: "music.bnk",
            resPath: "res:/audio/music.bnk",
            bankId: 200,
            languageId: 0,
            hirc: [
                {
                    type: 2,
                    id: musicTargetID,
                    sourceId: 910001,
                    payload: Writer().U32(910001).Bytes(),
                },
            ],
            media: [ { id: 910001 } ],
        },
        {
            source: "voice.bnk",
            resPath: "res:/audio/English(US)/voice.bnk",
            bankId: 300,
            languageId: 1,
            language: "en-us",
            hirc: [
                {
                    type: 2,
                    id: voiceTargetID,
                    sourceId: 920001,
                    payload: Writer().U32(920001).Bytes(),
                },
            ],
            media: [ { id: 920001 } ],
        },
    ];
    const graphs = CjsToolAudioBuilder.createEventMediaGraphs(inspections, {
        language: "en-us",
    });
    const table = CjsToolAudioBuilder.createEventMediaTable({
        Events: {
            music_play: { eventID: musicEventID },
            voice_play: { eventID: voiceEventID },
        },
    }, graphs);

    assert.deepEqual(table, {
        music_play: [ "910002" ],
        voice_play: [ "920001" ],
    });

    const germanTable = CjsToolAudioBuilder.createEventMediaTable({
        Events: {
            music_play: { eventID: musicEventID },
            voice_play: { eventID: voiceEventID },
        },
    }, CjsToolAudioBuilder.createEventMediaGraphs(inspections, {
        language: "de",
    }));

    assert.deepEqual(germanTable, {
        music_play: [ "910002" ],
        voice_play: [ "920002" ],
    });
    assert.throws(
        () => CjsToolAudioBuilder.createEventMediaGraphs(inspections, {
            language: "fr-fr",
        }),
        /language is unavailable/u,
    );
    assert.throws(
        () => CjsToolAudioBuilder.createEventMediaGraphs(
            inspections.filter(inspection =>
                inspection.resPath
                    !== "res:/audio/English(US)/voice.bnk"),
            { language: "en-us" },
        ),
        /language is unavailable/u,
    );
});

test("embedded media magic classification is stable", () =>
{
    const bytes = new TextEncoder().encode("xxxxRIFFMIDIxxxxxxxxPLUG");

    assert.equal(CjsToolAudioBuilder.mediaTypeFromMagic(bytes, 4), "wem");
    assert.equal(CjsToolAudioBuilder.mediaTypeFromMagic(bytes, 8), "midi");
    assert.equal(CjsToolAudioBuilder.mediaTypeFromMagic(bytes, 20), "plugin");
    assert.equal(CjsToolAudioBuilder.mediaTypeFromMagic(bytes, 1), "unknown");
    assert.equal(CjsToolAudioBuilder.mediaTypeFromMagic(bytes, 99), "unknown");
});

test("audio CLI writes one deterministic music artifact and preserves it on failure", context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-audio-music-"));
    const banks = CreateSyntheticBanks();
    const {
        cache,
        indexLines,
        indexPath,
    } = WriteSyntheticCache(directory, banks);
    const soundbanksInfoPath = path.join(directory, "SoundbanksInfo.json");
    const outputPath = path.join(directory, "audio_v2.json");
    const secondOutputPath = path.join(directory, "audio_v2-second.json");
    const args = [
        "scripts/build_audio_library.js",
        "--index", indexPath,
        "--cache", cache,
        "--soundbanksinfo", soundbanksInfoPath,
        "--build", "123456",
        "--generated-at", "2026-07-24T00:00:00.000Z",
        "--music",
        "--compact",
    ];

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));
    fs.writeFileSync(
        soundbanksInfoPath,
        JSON.stringify(SyntheticSoundbanksInfo()),
    );

    const first = spawnSync(
        process.execPath,
        [ ...args, "--out", outputPath ],
        { encoding: "utf8" },
    );

    assert.equal(first.status, 0, first.stderr);

    const library = JSON.parse(fs.readFileSync(outputPath, "utf8"));

    assert.equal(library.schemaVersion, 2);
    assert.equal(library.music.nodes[TRACK_ID].bank, "music.bnk");
    assert.deepEqual(library.music.eventTargets, {
        music_play: [ PLAYLIST_ID ],
    });
    assert.deepEqual(library.music.eventStops, {
        music_play: [ PLAYLIST_ID ],
    });
    assert.equal(library.embeddedMedia[MEDIA_ID].mediaType, "wem");
    assert.deepEqual(
        gunzipSync(fs.readFileSync(`${outputPath}.gz`)),
        fs.readFileSync(outputPath),
    );

    const second = spawnSync(
        process.execPath,
        [ ...args, "--out", secondOutputPath ],
        { encoding: "utf8" },
    );

    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(
        fs.readFileSync(secondOutputPath),
        fs.readFileSync(outputPath),
    );
    assert.deepEqual(
        fs.readFileSync(`${secondOutputPath}.gz`),
        fs.readFileSync(`${outputPath}.gz`),
    );

    const originalJSON = fs.readFileSync(outputPath);
    const originalGzip = fs.readFileSync(`${outputPath}.gz`);
    const incompleteIndexPath = path.join(directory, "incomplete-index.txt");

    fs.writeFileSync(
        incompleteIndexPath,
        `${indexLines
            .filter(line => !line.includes("music_essential.bnk"))
            .join("\n")}\n`,
    );

    const rejected = spawnSync(
        process.execPath,
        [
            ...args.map(value => value === indexPath ? incompleteIndexPath : value),
            "--out", outputPath,
        ],
        { encoding: "utf8" },
    );

    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /music_essential\.bnk/u);
    assert.deepEqual(fs.readFileSync(outputPath), originalJSON);
    assert.deepEqual(fs.readFileSync(`${outputPath}.gz`), originalGzip);
});
