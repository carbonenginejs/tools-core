import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { CjsCharacterLibrary } from "@carbonenginejs/runtime-character";
import { CjsFileIndex } from "@carbonenginejs/tools-browser/fileindex";
import { CjsToolCache } from "../src/cache/index.js";
import {
    CjsToolCharacterBuilder,
    CjsToolCharacterCatalogGatherer,
} from "../src/character/index.js";
import { CreateCharacterDocuments } from "./character-library-fixture.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildScript = path.join(root, "scripts", "build_character_library.js");
const typePath = "res:/example/definitions/sample-type.json";
const metadataPath = "res:/example/definitions/sample-metadata.json";
const supportMetadataPath = "res:/example/definitions/support-metadata.json";
const materialPath = "res:/example/definitions/sample-material.json";
const projectionPath = "res:/example/definitions/sample-projection.json";
const recipePath = "res:/example/definitions/sample-recipe.json";
const rawDefinitionPath = "res:/example/definitions/sample.color";
const sampleConfiguration = "res:/example/assets/sample-primary.configuration";
const sampleFallbackConfiguration = "res:/example/assets/sample-fallback.configuration";
const sampleGeometry = "res:/example/assets/sample.geometry";
const sampleTexture = "res:/example/assets/sample.texture";
const supportConfiguration = "res:/example/assets/support.configuration";
const supportGeometry = "res:/example/assets/support.geometry";
const placementTexture = "res:/example/assets/placement.png";
const uncachedPlacementTexture = "res:/example/assets/uncached-placement.dds";
const uncachedPlacementPng = "res:/example/assets/uncached-placement.png";
const unavailablePlacementTexture = "res:/example/assets/unavailable-placement.dds";

test("character gathering retains decoded configuration geometry relationships", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-character-model-bundle-"));
    const cache = new CjsToolCache(directory);
    const configurationPath = "res:/example/hair/hair_lod0.black";
    const geometryPath = "res:/example/hair/hair_lod0.gr2";
    const otherGeometryPath = "res:/example/hair/hair.gr2";
    const bytes = Buffer.from("decoded configuration fixture");
    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));

    const index = CjsFileIndex.parseResFileIndex([
        `${configurationPath},aa/model/configuration.black,,,,`,
        `${geometryPath},bb/model/hair_lod0.gr2,,,,`,
        `${otherGeometryPath},cc/model/hair.gr2,,,,`,
    ].join("\n"));
    const { documents, report } = await new CjsToolCharacterCatalogGatherer({
        blackReader: {
            readJson(value)
            {
                assert.deepEqual(Buffer.from(value), bytes);
                return { object: { meshes: [ { geometryResPath: geometryPath } ] } };
            },
        },
        cache,
        source: {
            async Fetch(logicalPath)
            {
                assert.equal(logicalPath, configurationPath);
                return { bytes };
            },
        },
    }).Gather(index, {
        partSources: {
            "female/hair/example": {
                sourcePath: "res:/example/hair",
                sex: "female",
                partPath: "hair/example",
                versions: [ {
                    resourceVersion: null,
                    configurationCandidates: [ configurationPath ],
                    geometryCandidates: [ otherGeometryPath, geometryPath ],
                    textureCandidates: [],
                } ],
                metadata: null,
            },
        },
    });

    const version = documents.characterPartSources["female/hair/example"].versions[0];
    assert.deepEqual(version.modelBundles, [ {
        configurationPath,
        geometryPath,
        lod: 0,
        lodOrigin: "matching-terminal-lod",
        modelFamily: "hair",
        modelFamilyOrigin: "matching-paired-resource-stem"
    } ]);
    assert.deepEqual(version.geometryCandidates, [ otherGeometryPath, geometryPath ]);
    assert.equal(report.modelBundles.verified, 1);
    assert.equal(report.modelBundles.acquired, 1);
});

test("character gathering does not label a model bundle when paired LOD identities disagree", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-character-model-lod-"));
    const cache = new CjsToolCache(directory);
    const configurationPath = "res:/example/hair/hair_lod0.black";
    const geometryPath = "res:/example/hair/hair_lod1.gr2";
    const bytes = Buffer.from("decoded mismatched LOD fixture");
    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));

    const index = CjsFileIndex.parseResFileIndex([
        `${configurationPath},aa/model/configuration.black,,,,`,
        `${geometryPath},bb/model/hair_lod1.gr2,,,,`,
    ].join("\n"));
    const { documents } = await new CjsToolCharacterCatalogGatherer({
        blackReader: {
            readJson()
            {
                return { object: { meshes: [ { geometryResPath: geometryPath } ] } };
            },
        },
        cache,
        source: {
            async Fetch()
            {
                return { bytes };
            },
        },
    }).Gather(index, {
        partSources: {
            "female/hair/example": {
                sourcePath: "res:/example/hair",
                sex: "female",
                partPath: "hair/example",
                versions: [ {
                    resourceVersion: null,
                    configurationCandidates: [ configurationPath ],
                    geometryCandidates: [ geometryPath ],
                    textureCandidates: [],
                } ],
                metadata: null,
            },
        },
    });

    assert.deepEqual(
        documents.characterPartSources["female/hair/example"].versions[0].modelBundles,
        [ {
            configurationPath,
            geometryPath,
            modelFamily: "hair",
            modelFamilyOrigin: "matching-paired-resource-stem"
        } ]
    );
});

test("character gathering caches and stores normalized PNG placement metadata", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-character-png-"));
    const cache = new CjsToolCache(directory);
    const rows = [];
    const bytes = Buffer.from("png inspection fixture");
    const acquiredBytes = Buffer.from("acquired png inspection fixture");
    const requested = [];

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));

    AddBytes(rows, cache, {
        logicalPath: placementTexture,
        location: "d1/placement.png",
        bytes,
    });
    rows.push(`${uncachedPlacementTexture},d2/uncached-placement.dds,,,,`);
    rows.push(`${uncachedPlacementPng},d4/uncached-placement.png,,,,`);
    rows.push(`${unavailablePlacementTexture},d3/unavailable-placement.dds,,,,`);

    const index = CjsFileIndex.parseResFileIndex(`${rows.join("\n")}\n`);
    const pngFormat = {
        inspect(value)
        {
            assert.ok(Buffer.from(value).equals(bytes)
                || Buffer.from(value).equals(acquiredBytes));
            return {
                sourceFormat: "png",
                width: 1024,
                height: 2048,
                offset: { x: 250000, y: -125000, unit: 0 },
                physicalPixelDimensions: { x: 500000, y: 1000000, unit: 0 },
            };
        },
    };
    const { documents, report } = await new CjsToolCharacterCatalogGatherer({
        cache,
        pngFormat,
        source: {
            async Fetch(logicalPath)
            {
                requested.push(logicalPath);
                return { bytes: acquiredBytes, cacheHit: false };
            },
        },
    }).Gather(index, {
        partSources: {
            "female/example": {
                sourcePath: "res:/example/assets/example",
                sex: "female",
                partPath: "example",
                versions: [ {
                    resourceVersion: null,
                    configurationCandidates: [],
                    geometryCandidates: [],
                    textureCandidates: [
                        placementTexture,
                        placementTexture.toUpperCase(),
                        uncachedPlacementTexture,
                        unavailablePlacementTexture,
                    ],
                } ],
                metadata: null,
            },
        },
    });

    assert.deepEqual(documents.characterTextureMetadata[
        "res:/example/assets/placement"
    ], {
        sourcePath: placementTexture,
        sourceFormat: "png",
        width: 1024,
        height: 2048,
        offsetXRaw: 250000,
        offsetYRaw: -125000,
        offsetUnit: 0,
        physicalPixelDimensionsXRaw: 500000,
        physicalPixelDimensionsYRaw: 1000000,
        physicalPixelDimensionsUnit: 0,
        offsetX: 0.25,
        offsetY: -0.125,
        extentX: 0.5,
        extentY: 1,
        hasOffsetMetadata: true,
        hasPhysicalPixelDimensionsMetadata: true,
        hasPlacementMetadata: true,
        placementEncoding: "png-oFFs-pHYs-millionths",
        placementPolicy: "ccp-character-atlas-millionths-v1",
        placementStatus: "experimental-policy",
    });
    assert.equal(
        documents.characterTextureMetadata[
            "res:/example/assets/uncached-placement"
        ].sourcePath,
        uncachedPlacementPng
    );
    assert.equal(Object.hasOwn(
        documents.characterTextureMetadata,
        uncachedPlacementTexture
    ), false);
    assert.equal(report.schemaVersion, 4);
    assert.equal(report.textureMetadata.inspected, 2);
    assert.equal(report.textureMetadata.cacheHits, 1);
    assert.equal(report.textureMetadata.acquired, 1);
    assert.equal(report.textureMetadata.withPlacement, 2);
    assert.deepEqual(report.textureMetadata.withoutPlacement, []);
    assert.deepEqual(report.textureMetadata.cacheMisses, []);
    assert.deepEqual(report.textureMetadata.missingIndexEntries, [
        "res:/example/assets/unavailable-placement.png"
    ]);
    assert.deepEqual(requested, [ uncachedPlacementPng ]);
    assert.ok(await cache.ReadRemote("d4/uncached-placement.png"));
});

test("character gathering keeps declared candidates and metadata-only sources", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-character-gatherer-"));
    const cache = new CjsToolCache(directory);
    const rows = [];
    const catalogInputs = CreateCatalogInputs();

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));

    AddProfile(rows, cache, {
        logicalPath: typePath,
        location: "a1/sample-type.json",
        value: {
            sourcePath: typePath,
            sex: "female",
            partPath: "hair/logical-sample",
            resourceVersion: "v1",
            colorVariant: "dark",
            partSource: "female/hair/sample",
        },
    });
    AddProfile(rows, cache, {
        logicalPath: metadataPath,
        location: "a2/sample-metadata.json",
        value: {
            sourcePath: metadataPath,
            forcesLooseTop: true,
            dependentModifiers: [ "accessories/support/base#1.0" ],
        },
    });
    AddProfile(rows, cache, {
        logicalPath: supportMetadataPath,
        location: "a3/support-metadata.json",
        value: {
            sourcePath: supportMetadataPath,
            dependentModifiers: [ "accessories/support/base" ],
        },
    });
    AddProfile(rows, cache, {
        logicalPath: materialPath,
        location: "a4/sample-material.json",
        value: {
            sourcePath: materialPath,
            colors: [ { value: [ 0.1, 0.2, 0.3, 1 ] } ],
            specularColors: [ { value: [ 0.4, 0.5, 0.6, 1 ] } ],
        },
    });
    AddProfile(rows, cache, {
        logicalPath: projectionPath,
        location: "a5/sample-projection.json",
        value: {
            sourcePath: projectionPath,
            bodyEnabled: true,
            texturePath: "res:/example/assets/projected.texture",
        },
    });
    AddProfile(rows, cache, {
        logicalPath: recipePath,
        location: "a6/sample-recipe.json",
        value: {
            sourcePath: recipePath,
            sex: "female",
            entries: [ {
                category: "hair",
                path: "hair/logical-sample",
                colors: [ { value: [ 0.2, 0.3, 0.4, 1 ] } ],
            } ],
        },
    });

    AddIndexedPaths(rows, [
        sampleConfiguration,
        sampleFallbackConfiguration,
        sampleGeometry,
        sampleTexture,
        supportConfiguration,
        supportGeometry,
        rawDefinitionPath,
    ]);

    const index = CjsFileIndex.parseResFileIndex(`${rows.join("\n")}\n`);
    const gathered = await new CjsToolCharacterCatalogGatherer({ cache }).Gather(
        index,
        { sourceBuild: "3450001", ...catalogInputs }
    );
    const documents = gathered.documents;
    const partType = documents.characterPartTypes[typePath];
    const partSource = documents.characterPartSources["female/hair/sample"];
    const support = documents.characterPartSources["female/accessories/support/base"];

    assert.equal(partType.partPath, "hair/logical-sample");
    assert.equal(partType.partSource, "female/hair/sample");
    assert.equal(partSource.metadata, metadataPath);
    assert.deepEqual(partSource.versions[0].configurationCandidates, [
        sampleConfiguration,
        sampleFallbackConfiguration,
    ]);
    assert.equal(partSource.versions[0].metadata, metadataPath);
    assert.deepEqual(partSource.versions[1], {
        resourceVersion: "v1",
        metadata: metadataPath,
        configurationCandidates: [
            sampleConfiguration,
            sampleFallbackConfiguration,
        ],
        geometryCandidates: [ sampleGeometry ],
        textureCandidates: [ sampleTexture ],
    });
    assert.deepEqual(support.versions[0].configurationCandidates, [
        supportConfiguration,
    ]);
    assert.deepEqual(support.versions[0].geometryCandidates, [ supportGeometry ]);
    assert.deepEqual(
        documents.characterMaterialProfiles[materialPath].colors,
        [ { value: [ 0.1, 0.2, 0.3, 1 ] } ]
    );
    assert.equal(gathered.report.catalogs.characterPartSources, 2);
    assert.deepEqual(documents.characterDefinitions[rawDefinitionPath].values, {
        colors: [ [ 0.1, 0.2, 0.3, 1 ] ],
        pattern: "example",
    });
    assert.equal(gathered.report.definitionCompilation.retainedDefinitions, 1);
    assert.equal(gathered.report.definitionCompilation.droppedDefinitions, 0);
    assert.equal(gathered.report.candidateResources.partSources, 2);
    assert.doesNotMatch(JSON.stringify(documents), /lodBundles|modelFamily|recipeLinks/u);

    const combined = CjsToolCharacterBuilder.build({
        ...CreateCharacterDocuments(),
        ...documents,
    });
    const library = CjsCharacterLibrary.from(combined);

    library.Reindex();
    const hydratedSource = library.Get("characterPartSources", "female/hair/sample");

    assert.strictEqual(
        library.Get("characterResources", 21).partType,
        library.Get("characterPartTypes", typePath)
    );
    assert.strictEqual(
        hydratedSource.versions[1].metadata,
        library.Get("characterPartMetadata", metadataPath)
    );
    assert.deepEqual(hydratedSource.versions[1].configurationCandidates, [
        sampleConfiguration,
        sampleFallbackConfiguration,
    ]);

    const documentsPath = path.join(directory, "documents.json");
    const catalogInputsPath = path.join(directory, "catalog-inputs.json");
    const indexPath = path.join(directory, "resfileindex.txt");
    const outputPath = path.join(directory, "character-library.json");

    fs.writeFileSync(documentsPath, JSON.stringify(combined));
    fs.writeFileSync(catalogInputsPath, "{}");
    fs.writeFileSync(indexPath, `${rows.join("\n")}\n`);

    const result = spawnSync(process.execPath, [
        buildScript,
        "--documents",
        documentsPath,
        "--catalog-inputs",
        catalogInputsPath,
        "--index",
        indexPath,
        "--cache",
        directory,
        "--out",
        outputPath,
        "--build",
        "3450001",
        "--target",
        "eve",
    ], {
        cwd: root,
        encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    const jsonBytes = fs.readFileSync(outputPath);
    const built = JSON.parse(jsonBytes.toString("utf8"));

    assert.deepEqual(gunzipSync(fs.readFileSync(`${outputPath}.gz`)), jsonBytes);
    assert.equal(built.schemaVersion, 9);
    assert.equal(built.documents.characterTextureMetadata.length, 0);
    assert.equal(built.documents.characterDefinitions.length, 1);
    assert.equal(built.documents.characterPartSources.length, 2);
    assert.equal(JSON.parse(fs.readFileSync(
        path.join(directory, "character-library.report.json"),
        "utf8"
    )).sourceBuild, "3450001");
});

test("character gathering reports missing and invalid declared inputs", async context =>
{
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cjs-character-gatherer-"));
    const cache = new CjsToolCache(directory);
    const missingCachePath = "res:/example/definitions/missing-cache.json";
    const corruptPath = "res:/example/definitions/corrupt.json";
    const corruptBytes = Buffer.from("{}");
    const corruptLocation = "bb/corrupt.json";
    const corruptCachePath = cache.GetRemoteFilePath(corruptLocation);
    const rows = [
        `${missingCachePath},aa/missing-cache.json,,,,`,
        [
            corruptPath,
            corruptLocation,
            "00000000000000000000000000000000",
            corruptBytes.byteLength,
            corruptBytes.byteLength,
            "",
        ].join(","),
    ];

    context.after(() => fs.rmSync(directory, { force: true, recursive: true }));
    fs.mkdirSync(path.dirname(corruptCachePath), { recursive: true });
    fs.writeFileSync(corruptCachePath, corruptBytes);

    const index = CjsFileIndex.parseResFileIndex(`${rows.join("\n")}\n`);

    await assert.rejects(
        () => new CjsToolCharacterCatalogGatherer({ cache }).Gather(index, {
            profiles: [
                {
                    documentName: "characterPartTypes",
                    logicalPath: "res:/example/definitions/missing-index.json",
                },
                {
                    documentName: "characterPartMetadata",
                    logicalPath: missingCachePath,
                },
                {
                    documentName: "characterMaterialProfiles",
                    logicalPath: corruptPath,
                },
            ],
            partSources: {
                "female/example": {
                    sourcePath: "res:/example/assets/example",
                    sex: "female",
                    partPath: "example",
                    versions: [ {
                        resourceVersion: null,
                        configurationCandidates: [
                            "res:/example/assets/missing.configuration",
                        ],
                        geometryCandidates: [],
                        textureCandidates: [],
                    } ],
                    metadata: null,
                },
            },
        }),
        error =>
        {
            assert.equal(error.report.missingIndexEntries.length, 2);
            assert.deepEqual(error.report.missingCacheFiles, [ missingCachePath ]);
            assert.equal(error.report.errors.length, 1);
            assert.match(error.report.errors[0].message, /MD5 mismatch/u);
            return true;
        }
    );
});

function CreateCatalogInputs()
{
    return {
        definitions: {
            [rawDefinitionPath]: {
                colors: [ [ 0.1, 0.2, 0.3, 1 ] ],
                pattern: "example",
            },
        },
        profiles: [
            {
                documentName: "characterPartTypes",
                logicalPath: typePath,
            },
            {
                documentName: "characterPartMetadata",
                logicalPath: metadataPath,
            },
            {
                documentName: "characterPartMetadata",
                logicalPath: supportMetadataPath,
            },
            {
                documentName: "characterMaterialProfiles",
                logicalPath: materialPath,
            },
            {
                documentName: "characterProjectionProfiles",
                logicalPath: projectionPath,
            },
            {
                documentName: "characterRecipeProfiles",
                logicalPath: recipePath,
            },
        ],
        partSources: {
            "female/hair/sample": {
                sourcePath: "res:/example/assets/sample",
                sex: "female",
                partPath: "hair/sample",
                versions: [
                    {
                        resourceVersion: null,
                        configurationCandidates: [
                            sampleConfiguration,
                            sampleFallbackConfiguration,
                        ],
                        geometryCandidates: [],
                        textureCandidates: [],
                    },
                    {
                        resourceVersion: "v1",
                        geometryCandidates: [ sampleGeometry ],
                        textureCandidates: [ sampleTexture ],
                    },
                ],
                metadata: metadataPath,
            },
            "female/accessories/support/base": {
                sourcePath: "res:/example/assets/support",
                sex: "female",
                partPath: "accessories/support/base",
                versions: [ {
                    resourceVersion: null,
                    configurationCandidates: [ supportConfiguration ],
                    geometryCandidates: [ supportGeometry ],
                    textureCandidates: [],
                } ],
                metadata: supportMetadataPath,
            },
        },
    };
}

function AddProfile(rows, cache, { logicalPath, location, value })
{
    const bytes = Buffer.from(JSON.stringify(value));
    const checksum = crypto.createHash("md5").update(bytes).digest("hex");
    const cachePath = cache.GetRemoteFilePath(location);

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, bytes);
    rows.push([
        logicalPath,
        location,
        checksum,
        bytes.byteLength,
        bytes.byteLength,
        "",
    ].join(","));
}

function AddBytes(rows, cache, { logicalPath, location, bytes })
{
    const checksum = crypto.createHash("md5").update(bytes).digest("hex");
    const cachePath = cache.GetRemoteFilePath(location);

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, bytes);
    rows.push([
        logicalPath,
        location,
        checksum,
        bytes.byteLength,
        bytes.byteLength,
        "",
    ].join(","));
}

function AddIndexedPaths(rows, paths)
{
    for (let index = 0; index < paths.length; index++)
    {
        rows.push(`${paths[index]},z${index}/asset,,,,`);
    }
}
