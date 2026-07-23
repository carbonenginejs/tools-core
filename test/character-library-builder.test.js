import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("character builder reads and validates profiles from the shared ResFiles cache", context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-character-tool-"));
    const cacheDirectory = path.join(directory, "cache");
    const inputPath = path.join(directory, "resfileindex.txt");
    const outputPath = path.join(directory, "character-library.json");
    const identitiesPath = path.join(directory, "character-identities.json");
    const logicalPath = "res:/graphics/character/global/paperdolllibrary/"
        + "backgrounds/air_station.yaml";
    const storagePath = "aa/air_station.yaml";
    const bytes = Buffer.from(JSON.stringify({
        scale: 1,
        path: "res:/ui/texture/classes/air_station.png",
        offset: [ 0, 0 ],
        aspect_ratio: 0.61275,
    }));
    const checksum = crypto.createHash("md5").update(bytes).digest("hex");
    const cachePath = path.join(cacheDirectory, "ResFiles", "aa", "air_station.yaml");
    const typeLogicalPath = "res:/graphics/character/female/paperdoll/"
        + "hair/hair_long_01/types/hair_long_01.type";
    const typeStoragePath = "bb/hair_long_01.type";
    const typeBytes = Buffer.from(JSON.stringify([ "hair/hair_long_01", "", "" ]));
    const typeChecksum = crypto.createHash("md5").update(typeBytes).digest("hex");
    const typeCachePath = path.join(cacheDirectory, "ResFiles", "bb", "hair_long_01.type");
    const metadataLogicalPath = "res:/graphics/character/female/paperdoll/"
        + "hair/hair_long_01/metadata.yaml";
    const metadataStoragePath = "cc/hair_long_01_metadata.yaml";
    const metadataBytes = Buffer.from(JSON.stringify({
        dependantModifiers: [
            "dependants/tuck/basic",
            "dependants/masktuck/tuckmaskmid",
        ],
    }));
    const metadataChecksum = crypto.createHash("md5").update(metadataBytes).digest("hex");
    const metadataCachePath = path.join(cacheDirectory, "ResFiles", "cc", "hair_long_01_metadata.yaml");
    const tuckConfigPath = "res:/graphics/character/female/paperdoll/dependants/tuck/basic/tuck.black";
    const tuckGeometryPath = "res:/graphics/character/female/paperdoll/dependants/tuck/basic/tuck.gr2";
    const tuckMaskPath = "res:/graphics/character/female/paperdoll/dependants/"
        + "masktuck/tuckmaskmid/comp_body_m.png";
    const partID = "female/hair/hair_long_01/types/hair_long_01";

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.mkdirSync(path.dirname(typeCachePath), { recursive: true });
    fs.mkdirSync(path.dirname(metadataCachePath), { recursive: true });
    fs.writeFileSync(cachePath, bytes);
    fs.writeFileSync(typeCachePath, typeBytes);
    fs.writeFileSync(metadataCachePath, metadataBytes);
    fs.writeFileSync(
        inputPath,
        [
            `${logicalPath},${storagePath},${checksum},${bytes.byteLength},${bytes.byteLength}`,
            `${typeLogicalPath},${typeStoragePath},${typeChecksum},${typeBytes.byteLength},${typeBytes.byteLength}`,
            `${metadataLogicalPath},${metadataStoragePath},${metadataChecksum},${metadataBytes.byteLength},${metadataBytes.byteLength}`,
            `${tuckConfigPath},dd/tuck.black,,,`,
            `${tuckGeometryPath},ee/tuck.gr2,,,`,
            `${tuckMaskPath},ff/comp_body_m.png,,,`,
            "",
        ].join("\n"),
    );
    fs.writeFileSync(identitiesPath, JSON.stringify({
        schema: "carbonenginejs.characterPartIdentities",
        schemaVersion: 1,
        sourceTarget: "eve",
        sourceBuild: "3435006",
        parts: {
            [partID]: { typeID: "9001", name: "Long Hair" },
        },
    }));

    const args = [
        "scripts/build_character_library.js",
        "--index", inputPath,
        "--cache", cacheDirectory,
        "--out", outputPath,
        "--target", "eve",
        "--build", "3435006",
        "--generated-at", "2026-07-19T00:00:00.000Z",
        "--identities", identitiesPath,
    ];
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    const library = JSON.parse(fs.readFileSync(outputPath, "utf8"));

    assert.equal(library.sourceTarget, "eve");
    assert.equal(library.sourceBuild, "3435006");
    assert.equal(library.presentation.backgrounds.air_station.scale, 1);
    assert.deepEqual(
        library.partSources["female/hair/hair_long_01"].versions.default.types[partID],
        { typeID: "9001", name: "Long Hair" },
    );
    assert.deepEqual(
        library.partSources["female/dependants/tuck/basic"].resources.configPaths,
        [ tuckConfigPath ],
    );
    assert.deepEqual(
        library.partSources["female/dependants/tuck/basic"].resources.geometryPaths,
        [ tuckGeometryPath ],
    );
    assert.deepEqual(
        library.partSources["female/dependants/masktuck/tuckmaskmid"].resources.texturePaths,
        [ tuckMaskPath ],
    );

    fs.writeFileSync(cachePath, "{}");

    const invalid = spawnSync(process.execPath, args, { encoding: "utf8" });

    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /size mismatch/);
});
