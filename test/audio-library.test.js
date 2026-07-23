import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync as GunzipSync } from "node:zlib";
import {
  CjsToolAudio,
  CjsToolAudioBuilder,
} from "../src/audio/index.js";
import * as publicAudioLibraryTools from "../src/audio/index.js";

const INDEX_TEXT = [
  "res:/audio/524.bnk,aa/524_hash.bnk,md5a,1000,900",
  "res:/audio/media/777.wem,bb/777_hash.wem,md5b,2000,1800",
  "res:/audio/essential_media/888.wem,cc/888_hash.wem,md5c,300,280",
  "res:/audio/en/999.wem,dd/999_hash.wem,md5d,400,380",
  "res:/graphics/character/female/head.gr2,ee/head_hash.gr2,md5e,5,5",
  ""
].join("\n");

const SOUNDBANKS_INFO = {
  SoundBanksInfo: {
    SoundBanks: [
      {
        Id: "524", ShortName: "ships", Path: "SoundBanks\\ships.bnk",
        Events: [{ Id: "11", Name: "engine_loop" }],
        Media: [{ Id: "777", ShortName: "engine.wem" }]
      }
    ]
  }
};


test("exports the audio tool class family without standalone builder helpers", () =>
{
  assert.equal(publicAudioLibraryTools.CjsToolAudio, CjsToolAudio);
  assert.equal(publicAudioLibraryTools.CjsToolAudioBuilder, CjsToolAudioBuilder);
  assert.equal(publicAudioLibraryTools.buildAudioLibrary, undefined);
  assert.equal(publicAudioLibraryTools.parseAudioIndexEntries, undefined);
});


test("CjsToolAudioBuilder.parseIndexEntries filters to res:/audio", () =>
{
  const entries = CjsToolAudioBuilder.parseIndexEntries(INDEX_TEXT);
  assert.equal(entries.length, 4);
  assert.ok(entries.every(entry => entry.logicalPath.startsWith("res:/audio/")));
});


test("CjsToolAudio is the target-aware front-facing audio builder", () =>
{
  const tool = new CjsToolAudio();
  const library = tool.Build({
    indexEntries: CjsToolAudioBuilder.parseIndexEntries(INDEX_TEXT),
    soundbanksInfo: SOUNDBANKS_INFO,
    sourceTarget: "frontier",
    sourceBuild: "3438337"
  });

  assert.equal(library.sourceTarget, "frontier");
  assert.equal(library.sourceGame, "Frontier");
  assert.equal(CjsToolAudioBuilder.parseIndexEntries(INDEX_TEXT).length, 4);
  assert.throws(() => CjsToolAudio.build({
    indexEntries: [],
    soundbanksInfo: SOUNDBANKS_INFO,
    sourceTarget: "netease"
  }), /does not support target netease/);
});


test("audio CLI reads and validates logical inputs from the shared ResFiles cache", context =>
{
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-audio-tool-"));
  const cacheDirectory = path.join(directory, "cache");
  const inputPath = path.join(directory, "resfileindex.txt");
  const outputPath = path.join(directory, "audio-library.json");
  const logicalPath = "res:/audio/soundbanksinfo.json";
  const storagePath = "aa/soundbanksinfo.json";
  const bytes = Buffer.from(JSON.stringify(SOUNDBANKS_INFO));
  const checksum = crypto.createHash("md5").update(bytes).digest("hex");
  const cachePath = path.join(cacheDirectory, "ResFiles", "aa", "soundbanksinfo.json");

  context.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, bytes);
  fs.writeFileSync(
    inputPath,
    `${logicalPath},${storagePath},${checksum},${bytes.byteLength},${bytes.byteLength}\n`,
  );

  const args = [
    "scripts/build_audio_library.js",
    "--index", inputPath,
    "--cache", cacheDirectory,
    "--soundbanksinfo", logicalPath,
    "--out", outputPath,
    "--build", "3435006",
    "--generated-at", "2026-07-19T00:00:00.000Z",
  ];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, "utf8")).sourceTarget, "eve");
  assert.deepEqual(
    GunzipSync(fs.readFileSync(`${outputPath}.gz`)),
    fs.readFileSync(outputPath),
  );

  const installedArgs = [ ...args ];
  const outIndex = installedArgs.indexOf("--out");

  installedArgs.splice(outIndex, 2);

  const installed = spawnSync(process.execPath, installedArgs, { encoding: "utf8" });
  const installedPath = path.join(
    cacheDirectory,
    "custom", "games", "eve", "providers", "ccp", "builds", "3435006",
    "audio_v2.json",
  );

  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(fs.readFileSync(installedPath, "utf8")).sourceBuild, "3435006");
  assert.deepEqual(
    GunzipSync(fs.readFileSync(`${installedPath}.gz`)),
    fs.readFileSync(installedPath),
  );

  fs.writeFileSync(cachePath, "{}");

  const invalid = spawnSync(process.execPath, args, { encoding: "utf8" });

  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /size mismatch/);
});


test("CjsToolAudioBuilder joins index + SoundbanksInfo + optional enrichment deterministically", () =>
{
  const library = CjsToolAudioBuilder.build({
    indexEntries: CjsToolAudioBuilder.parseIndexEntries(INDEX_TEXT),
    soundbanksInfo: SOUNDBANKS_INFO,
    enrichment: { Events: { engine_loop: { maxRadiusAttenuation: 250, isLoop: 1 } } },
    sourceTarget: "eve",
    sourceGame: "Eve",
    sourceProvider: "ccp",
    sourceBuild: "3435006",
    generatedAt: "2026-07-18T00:00:00.000Z"
  });

  assert.equal(library.schema, CjsToolAudioBuilder.schema);
  assert.equal(library.schemaVersion, 2);
  assert.equal(library.sourceTarget, "eve");
  assert.equal(library.sourceGame, "Eve");
  assert.equal(library.sourceProvider, "ccp");
  assert.equal(library.sourceBuild, "3435006");

  // Repository-ready metadata: publishable base + enrichment layered in.
  assert.deepEqual(library.metadata.Events.engine_loop.soundbanks, ["ships.bnk"]);
  assert.equal(library.metadata.Events.engine_loop.isLoop, 1);
  assert.equal(library.metadata.Events.engine_loop.maxRadiusAttenuation, 250);
  assert.equal(library.metadata.WemFileIDs["777"].SoundBank, "ships.bnk");

  // Media/bank resolution tables from the index.
  assert.equal(library.media["777"].resPath, "res:/audio/media/777.wem");
  assert.equal(library.media["888"].essential, true);
  assert.equal(library.media["999"].language, "en");
  assert.deepEqual(
    {
      sourceID: library.banks["524:0"].sourceID,
      bankID: library.banks["524:0"].bankID,
      languageID: library.banks["524:0"].languageID,
      storagePath: library.banks["524:0"].storagePath,
    },
    {
      sourceID: "524:0",
      bankID: "524",
      languageID: "0",
      storagePath: "aa/524_hash.bnk",
    },
  );

  // Determinism: identical inputs -> identical serialization.
  const again = CjsToolAudioBuilder.build({
    indexEntries: CjsToolAudioBuilder.parseIndexEntries(INDEX_TEXT),
    soundbanksInfo: SOUNDBANKS_INFO,
    enrichment: { Events: { engine_loop: { maxRadiusAttenuation: 250, isLoop: 1 } } },
    sourceTarget: "eve",
    sourceGame: "Eve",
    sourceProvider: "ccp",
    sourceBuild: "3435006",
    generatedAt: "2026-07-18T00:00:00.000Z"
  });
  assert.equal(JSON.stringify(library), JSON.stringify(again));
});

test("CjsToolAudioBuilder creates named, sorted, unioned event-media edges", () =>
{
  const metadata = { Events: { engine_loop: { eventID: 11 } } };
  const bankResults = [
    { eventMedia: new Map([[11, new Set([900002, 900001])]]) },
    { eventMedia: new Map([[11, new Set([900003])], [999999, new Set([1])]]) }
  ];
  // Unioned across banks, numerically sorted, stringified; unknown event ids dropped.
  assert.deepEqual(CjsToolAudioBuilder.createEventMediaTable(metadata, bankResults), {
    engine_loop: ["900001", "900002", "900003"]
  });
});

test("audio v2 keeps language variants as distinct bank identities", () =>
{
  const soundbanksInfo = {
    SoundBanksInfo: {
      SoundBanks: [
        {
          Id: "700",
          ShortName: "voices",
          Language: "English(US)",
          Path: "SoundBanks\\English(US)\\voices.bnk",
        },
        {
          Id: "700",
          ShortName: "voices",
          Language: "German",
          Path: "SoundBanks\\German\\voices.bnk",
        },
        {
          Id: "700",
          ShortName: "voices",
          Language: "Chinese",
          Path: "SoundBanks\\Chinese\\voices.bnk",
        },
        {
          Id: "701",
          ShortName: "common",
          Language: "SFX",
          Path: "SoundBanks\\common.bnk",
        },
      ],
    },
  };
  const entries = CjsToolAudioBuilder.parseIndexEntries([
    "res:/audio/English(US)/700.bnk,en/700.bnk,en-md5,10",
    "res:/audio/German/700.bnk,de/700.bnk,de-md5,10",
    "res:/audio/Chinese/700.bnk,zh/700.bnk,zh-md5,10",
    "res:/audio/common.bnk,sfx/common.bnk,sfx-md5,10",
  ].join("\n"));
  const library = CjsToolAudioBuilder.build({
    indexEntries: entries,
    soundbanksInfo,
  });
  const banks = Object.values(library.banks);

  assert.equal(banks.length, 4);
  assert.deepEqual(
    new Set(banks.map(bank => bank.bankID)),
    new Set([ "700", "701" ]),
  );
  assert.equal(
    new Set(
      banks
        .filter(bank => bank.bankID === "700")
        .map(bank => bank.languageID),
    ).size,
    3,
  );
  assert.deepEqual(
    banks.map(bank => bank.language).sort(),
    [ "", "de", "en-us", "zh-cn" ],
  );
  assert.deepEqual(
    banks.map(bank => bank.authoredLanguage).sort(),
    [ "Chinese", "English(US)", "German", "SFX" ],
  );
});

test("CjsToolAudioBuilder attaches optional eventMedia + embeddedMedia additively", () =>
{
  const base = {
    indexEntries: CjsToolAudioBuilder.parseIndexEntries(INDEX_TEXT),
    soundbanksInfo: SOUNDBANKS_INFO,
    sourceTarget: "eve",
    sourceBuild: "3435006",
    generatedAt: "2026-07-18T00:00:00.000Z"
  };
  const plain = CjsToolAudioBuilder.build(base);
  assert.equal(plain.eventMedia, undefined);
  assert.equal(plain.embeddedMedia, undefined);

  const withTables = CjsToolAudioBuilder.build({
    ...base,
    eventMedia: { engine_loop: ["900001"] },
    embeddedMedia: { 900001: { bank: "524:0", offset: 96, byteLength: 64 } }
  });
  assert.equal(withTables.schemaVersion, 2, "tables are additive, schema unchanged");
  assert.deepEqual(withTables.eventMedia, { engine_loop: ["900001"] });
  assert.deepEqual(withTables.embeddedMedia["900001"], { bank: "524:0", offset: 96, byteLength: 64 });
});

test("audio builder supports audited Frontier inputs and rejects unaudited targets", () =>
{
  const frontier = CjsToolAudioBuilder.build({
    indexEntries: CjsToolAudioBuilder.parseIndexEntries(INDEX_TEXT),
    soundbanksInfo: SOUNDBANKS_INFO,
    sourceTarget: "frontier",
    sourceBuild: "3438337"
  });

  assert.equal(frontier.sourceTarget, "frontier");
  assert.equal(frontier.sourceGame, "Frontier");
  assert.throws(() => CjsToolAudioBuilder.build({
    indexEntries: CjsToolAudioBuilder.parseIndexEntries(INDEX_TEXT),
    soundbanksInfo: SOUNDBANKS_INFO,
    sourceTarget: "netease",
    sourceBuild: "3438337"
  }), /does not support target netease/);
});
