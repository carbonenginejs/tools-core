import test from "node:test";
import assert from "node:assert/strict";

import {
    CjsCharacterBlendshapeLimits,
    CjsCharacterFaceSetup,
    CjsCharacterLibrary,
    CjsCharacterLibraryData,
    CjsCharacterMaterial,
    CjsCharacterModifierNames,
    CjsCharacterPartDefinition,
    CjsCharacterPartMetadata,
    CjsCharacterPresentation,
    CjsCharacterPose,
    CjsCharacterProjection,
    CjsCharacterRecipe,
    CjsCharacterSculptField,
    CjsCharacterUniqueCharacter,
} from "../../runtime-character/npm/dist/index.js";
import {
    CjsToolCharacterAssembler,
    CjsToolCharacter,
    CjsToolCharacterCompiler,
    CjsToolCharacterNormalizer,
    CjsToolCharacterSerializer,
} from "../src/index.js";
import * as publicCharacterLibraryTools from "../src/index.js";

test("exports the character tool class family through tools-core/character", () =>
{
    assert.equal(publicCharacterLibraryTools.CjsToolCharacter, CjsToolCharacter);
    assert.equal(publicCharacterLibraryTools.CjsToolCharacterAssembler, CjsToolCharacterAssembler);
    assert.equal(publicCharacterLibraryTools.CjsToolCharacterCompiler, CjsToolCharacterCompiler);
    assert.equal(publicCharacterLibraryTools.CjsToolCharacterNormalizer, CjsToolCharacterNormalizer);
    assert.equal(publicCharacterLibraryTools.CjsToolCharacterSerializer, CjsToolCharacterSerializer);
    assert.equal(Object.isFrozen(CjsToolCharacterAssembler.dataCatalogs), true);
    assert.deepEqual(Object.values(CjsToolCharacterAssembler.dataCatalogs), [
        "partMetadata",
        "parts",
        "materials",
        "projections",
        "poses",
        "presets",
        "sculptFields",
        "blendshapeLimits",
        "uniqueCharacters",
    ]);
    assert.equal(publicCharacterLibraryTools.compileCharacterLibraryData, undefined);
    assert.equal(publicCharacterLibraryTools.normalizeTypeProfile, undefined);
});

test("CjsToolCharacter is the target-aware front-facing character builder", () =>
{
    const data = CjsToolCharacter.build({}, {
        sourceBuild: "3435006",
    });
    const expanded = CjsToolCharacter.assemble({}, {
        sourceTarget: "eve",
        sourceBuild: "3435006",
    });

    assert.equal(data.schemaVersion, 2);
    assert.equal(data.sourceTarget, "eve");
    assert.equal(data.sourceGame, "Eve");
    assert.equal(data.sourceProvider, "ccp");
    assert.equal(expanded.schemaVersion, 1);
    assert.throws(
        () => CjsToolCharacter.build({}, { sourceTarget: "frontier" }),
        /does not support target frontier/,
    );
});

test("preserves portrait and presentation profiles in a dedicated deterministic tree", () =>
{
    const background = CjsToolCharacterNormalizer.normalizePresentationProfile({
        scale: 1,
        path: "res:/graphics/character/global/paperdolllibrary/backgrounds/air_station.png",
        offset: [ 0, 0 ],
        aspect_ratio: 0.61275
    }, { group: "backgrounds", id: "air_station" });
    const camera = CjsToolCharacterNormalizer.normalizePresentationProfile([
        [ -0.28, 1.66, 1.46 ],
        [ 0, 1.62, 0 ],
        0.3,
        0.1,
        200,
        [ "", "", "", "", "" ]
    ], { group: "cameras", id: "close-up (cu)" });
    const expanded = CjsToolCharacterAssembler.assemble({
        presentation: {
            backgrounds: {
                z_last: background,
                air_station: background
            },
            cameras: { "close-up (cu)": camera }
        }
    });

    assert.deepEqual(Object.keys(expanded.presentation), [
        "backgrounds", "cameras", "characters", "lights", "positions", "posts"
    ]);
    assert.deepEqual(Object.keys(expanded.presentation.backgrounds), [ "air_station", "z_last" ]);
    assert.deepEqual(Object.keys(expanded.presentation.backgrounds.air_station), [
        "aspect_ratio", "offset", "path", "scale"
    ]);

    const compiled = CjsToolCharacterCompiler.compile(expanded);
    assert.deepEqual(compiled.presentation.cameras["close-up (cu)"], camera);
    const hydrated = CjsCharacterLibraryData.from(CjsToolCharacterCompiler.expand(compiled));
    assert.ok(hydrated.presentation instanceof CjsCharacterPresentation);
    assert.deepEqual(hydrated.presentation.backgrounds.get("air_station"), background);
    const library = new CjsCharacterLibrary(hydrated);
    assert.equal(library.GetPresentationProfile("backgrounds", "air_station").scale, 1);
    assert.equal(library.GetPresentationProfile("backgrounds", "missing"), null);

    assert.throws(
        () => CjsToolCharacterNormalizer.normalizePresentationProfile({}, { group: "unknown", id: "profile" }),
        /Unsupported character presentation group/
    );
    assert.throws(
        () => CjsToolCharacterNormalizer.normalizePresentationProfile({ value: Number.NaN }, { group: "posts", id: "invalid" }),
        /non-finite number/
    );
});

test("preserves unique characters, modifier inventories, face setup, and authoring info", () =>
{
    const uniqueCharacter = {
        id: "amarrfemaleclothing",
        sex: "female",
        resources: {
            configPaths: [ "res:/unique/unique.black" ],
            texturePaths: [ "res:/unique/normalmap.dds", "res:/unique/diffusemap.dds" ]
        },
        blendshapeWeights: CjsToolCharacterNormalizer.normalizeUniqueBlendshapeWeightsProfile({ WideShape: 1.2, ThinShape: -2 }),
        animationOffsets: CjsToolCharacterNormalizer.normalizeUniqueAnimationOffsetsProfile({ Head: [ -0.001, 0, 0.002 ] })
    };
    const faceControls = CjsToolCharacterNormalizer.normalizeFaceControlsProfile({
        single: [ "fj_single", 4, "y", -0.5 ],
        pair: [ "fj_left", "fj_right", 3, 1, 0, 8.884, 9.297 ]
    });
    const materialInfo = CjsToolCharacterNormalizer.normalizeMaterialInfoProfile({
        Materials: {
            lambert1: {
                Attributes: { color: [ [ 0.1, 0.2, 0.3 ] ] },
                Textures: {}
            }
        }
    });
    const expanded = CjsToolCharacterAssembler.assemble({
        uniqueCharacters: [ uniqueCharacter ],
        modifierNames: {
            female: { body: CjsToolCharacterNormalizer.normalizeModifierNamesProfile("BodyShape BodyShape") },
            male: {}
        },
        faceSetup: {
            bindPoses: {
                female: {
                    id: "global/facesetup/basefemale",
                    name: "basefemale",
                    bones: [ { name: "Head", orientation: [ 0, 0, 0 ], rotation: [ 0, 0, 0 ], translation: [ 0, 0, 0 ] } ]
                }
            },
            animation: CjsToolCharacterNormalizer.normalizeFaceAnimationProfile({
                amarr_amarr: { female: { BlinkMult: 1.1 }, male: { BlinkMult: 0.9 } }
            }),
            controls: { female: faceControls },
            tweakSettings: CjsToolCharacterNormalizer.normalizeFaceTweakSettingsProfile({
                gammaCurves: { default: 1 }, wrinkleMultiplier: 1, correctionMultiplier: 2
            })
        },
        partAuthoring: {
            "female/outer/augmentationsuitf01": { materialInfo }
        }
    });

    assert.deepEqual(expanded.modifierNames.female.body, [ "BodyShape", "BodyShape" ]);
    assert.equal(expanded.uniqueCharacters[0].blendshapeWeights.ThinShape, -2);
    assert.equal(expanded.uniqueCharacters[0].blendshapeWeights.WideShape, 1.2);
    assert.deepEqual(expanded.faceSetup.controls.female.pair, [ "fj_left", "fj_right", 3, 1, 0, 8.884, 9.297 ]);
    assert.deepEqual(expanded.partAuthoring["female/outer/augmentationsuitf01"].materialInfo.materials.lambert1.attributes.color, [ 0.1, 0.2, 0.3 ]);

    const compiled = CjsToolCharacterCompiler.compile(expanded);
    assert.deepEqual(Object.keys(compiled.uniqueCharacters), [ "amarrfemaleclothing" ]);
    assert.deepEqual(compiled.uniqueCharacters.amarrfemaleclothing.animationOffsets.Head, [ -0.001, 0, 0.002 ]);
    assert.ok(compiled.partSources["female/outer/augmentationsuitf01"].authoring.materialInfo);

    const roundTrip = CjsToolCharacterCompiler.expand(compiled);
    const hydrated = CjsCharacterLibraryData.from(roundTrip);
    assert.ok(hydrated.uniqueCharacters[0] instanceof CjsCharacterUniqueCharacter);
    assert.ok(hydrated.modifierNames instanceof CjsCharacterModifierNames);
    assert.ok(hydrated.faceSetup instanceof CjsCharacterFaceSetup);
    assert.deepEqual(hydrated.modifierNames.female.body, [ "BodyShape", "BodyShape" ]);
    assert.ok(hydrated.partAuthoring.has("female/outer/augmentationsuitf01"));

    const library = new CjsCharacterLibrary(hydrated);
    assert.equal(library.GetUniqueCharacter("amarrfemaleclothing").sex, "female");
    assert.equal(library.GetUniqueCharacter("missing"), null);

    assert.throws(() => CjsToolCharacterNormalizer.normalizeFaceControlsProfile({ invalid: [ "bone", 1 ] }), /4 or 7 values/);
    assert.throws(() => CjsToolCharacterNormalizer.normalizeUniqueAnimationOffsetsProfile({ Head: [ 0, 1 ] }), /must contain 3 numeric values/);
});

test("assembles normalized catalogs in stable order and validates source references", () =>
{
    const data = CjsToolCharacterAssembler.assemble({
        sources: [
            { id: "source-b", path: "b.color" },
            { id: "source-a", path: "a.color", profile: "color" },
            { id: "source-a-alias", path: "a.color", profile: "color" }
        ],
        materials: [
            { id: "material-b", sourceId: "source-b" },
            { id: "material-a", sourceId: "source-a" }
        ]
    }, {
        sourceTarget: "eve",
        sourceGame: "Eve",
        sourceProvider: "ccp",
        sourceBuild: "3430261",
    });

    assert.equal(data.schema, "carbonenginejs.characterLibrary");
    assert.equal(data.sourceTarget, "eve");
    assert.equal(data.sourceGame, "Eve");
    assert.equal(data.sourceProvider, "ccp");
    assert.deepEqual(data.sourceRefs, { "#ref1": "a.color", "#ref2": "b.color" });
    assert.deepEqual(data.sources.map(value => value.ref), [ "#ref1", "#ref2" ]);
    assert.equal(data.generatedAt, null);
    assert.equal(data.sources[1].profile, null);
    assert.equal(data.sources[1].checksum, null);
    assert.equal(data.sources[1].byteLength, null);
    assert.deepEqual(data.materials.map(value => value.id), [ "material-a", "material-b" ]);
    assert.equal(Object.hasOwn(data.materials[0], "sourceId"), false);
    const hydrated = CjsCharacterLibraryData.from(data);
    assert.ok(hydrated instanceof CjsCharacterLibraryData);
    assert.equal(hydrated.sourceRefs.get("#ref1"), "a.color");
    assert.throws(
        () => CjsToolCharacterAssembler.assemble({ materials: [ { id: "same" }, { id: "same" } ] }),
        /duplicate materials id "same"/
    );
    assert.throws(
        () => CjsToolCharacterAssembler.assemble({
            sources: [ { id: "known", path: "known.yaml" } ],
            materials: [ { id: "material", sourceId: "missing" } ]
        }),
        /references unknown source "missing"/
    );
    assert.throws(
        () => CjsToolCharacterAssembler.assemble({}, { sourceTarget: "frontier" }),
        /does not support target frontier/
    );
});

test("compiles shared part sources and expands selectable types losslessly", () =>
{
    const expanded = CjsToolCharacterAssembler.assemble({
        partMetadata: [ {
            id: "female/outer/jacket01",
            forcesLooseTop: false,
            hidesBootShin: true,
            lod1Replacement: "",
            numColorAreas: 3,
            occludesModifiers: [ "topmiddle" ],
            soundTag: 0,
            swapTops: false
        } ],
        parts: [
            {
                id: "female/outer/jacket01/types/jacket01_black",
                name: "jacket01_black",
                sex: "female",
                category: "outer/jacket01",
                path: "outer/jacket01",
                resourceVersion: "v1",
                colorVariant: "black",
                metadataId: "female/outer/jacket01",
                resourcePaths: [ "res:/jacket01.black", "res:/jacket01.gr2", "res:/jacket01_d.dds" ],
                colorIds: [ "female/outer/jacket01/black" ],
                projectionId: null
            },
            {
                id: "female/outer/jacket01/types/jacket01_red",
                name: "jacket01_red",
                sex: "female",
                category: "outer/jacket01",
                path: "outer/jacket01",
                resourceVersion: "v1",
                colorVariant: "red",
                metadataId: "female/outer/jacket01",
                resourcePaths: [ "res:/jacket01.black", "res:/jacket01.gr2", "res:/jacket01_d.dds" ],
                colorIds: [ "female/outer/jacket01/red" ],
                projectionId: null
            }
        ],
        materials: [
            { id: "female/outer/jacket01/black", slot: "outer/jacket01" },
            { id: "female/outer/jacket01/red", slot: "outer/jacket01" }
        ]
    }, { sourceBuild: "test" });

    const compiled = CjsToolCharacterCompiler.compile(expanded);
    const source = compiled.partSources["female/outer/jacket01"];
    assert.equal(compiled.schemaVersion, 2);
    assert.equal(source.classification.type, "clothing");
    assert.equal(source.classification.layer, "outer");
    assert.equal(source.metadata.numColorAreas, 3);
    assert.equal(source.metadata.hidesBootShin, true);
    assert.equal(source.metadata.soundTag, 0);
    assert.equal(Object.hasOwn(source.metadata, "forcesLooseTop"), false);
    assert.equal(Object.hasOwn(source.metadata, "lod1Replacement"), false);
    assert.equal(Object.hasOwn(source.metadata, "swapTops"), false);
    assert.deepEqual(source.versions.v1.resources.configPaths, [ "res:/jacket01.black" ]);
    assert.deepEqual(source.versions.v1.resources.geometryPaths, [ "res:/jacket01.gr2" ]);
    assert.deepEqual(source.versions.v1.resources.texturePaths, [ "res:/jacket01_d.dds" ]);
    assert.deepEqual(Object.keys(source.versions.v1.types), [
        "female/outer/jacket01/types/jacket01_black",
        "female/outer/jacket01/types/jacket01_red"
    ]);

    const library = new CjsCharacterLibrary(CjsToolCharacterCompiler.expand(compiled));
    assert.equal(library.data.parts.length, 2);
    assert.equal(library.GetPart("female/outer/jacket01/types/jacket01_black").metadataId, "female/outer/jacket01");
    assert.deepEqual(library.GetPart("female/outer/jacket01/types/jacket01_red").colorIds, [ "female/outer/jacket01/red" ]);
    assert.deepEqual(library.GetPartMetadata("female/outer/jacket01").occludesModifiers, [ "topmiddle" ]);
});

test("resolves implicit, physical-folder, and shared-palette materials", () =>
{
    const materialIds = new Set([
        "female/makeup/eyebrows/eyebrows_01/default",
        "female/accessories/piercings/ring01/black",
        "female/hair/colors/28_bc",
        "female/hair/colors/basecolor"
    ]);
    const eyebrow = {
        id: "female/makeup/eyebrows/eyebrows_01/types/eyebrows_01",
        sex: "female",
        path: "makeup/eyebrows/eyebrows_01",
        colorVariant: null
    };

    assert.deepEqual(CjsToolCharacterCompiler.resolvePartMaterialLink(eyebrow, materialIds), {
        id: "female/makeup/eyebrows/eyebrows_01/default",
        mode: "logical",
        implicit: true
    });
    assert.equal(CjsToolCharacterCompiler.resolvePartMaterialLink({
        sex: "female",
        path: "accessories/earslow/ring01",
        colorVariant: "black"
    }, materialIds, { sourceFolder: "accessories/piercings/ring01" }).mode, "sourceFolder");
    assert.equal(CjsToolCharacterCompiler.resolvePartMaterialLink({
        sex: "female",
        path: "hair/hair_headwear_01",
        colorVariant: "28_bc"
    }, materialIds).mode, "sharedPalette");
    assert.deepEqual(CjsToolCharacterCompiler.resolvePartMaterialLink({
        sex: "female",
        path: "hair/hair_short_01",
        colorVariant: null
    }, materialIds), {
        id: "female/hair/colors/basecolor",
        mode: "sharedBase",
        implicit: true
    });

    const compiled = CjsToolCharacterCompiler.compile({
        schema: "carbonenginejs.characterLibrary",
        schemaVersion: 1,
        parts: [ { ...eyebrow, name: "eyebrows_01", category: "makeup", resourcePaths: [], colorIds: [
            "female/makeup/eyebrows/eyebrows_01/default"
        ] } ],
        materials: [ { id: "female/makeup/eyebrows/eyebrows_01/default" } ]
    });
    const compactType = compiled.partSources["female/makeup/eyebrows/eyebrows_01"].versions.default.types[eyebrow.id];
    assert.equal(compactType.materialId, "female/makeup/eyebrows/eyebrows_01/default");
    assert.deepEqual(CjsToolCharacterCompiler.expand(compiled).parts[0].colorIds, [
        "female/makeup/eyebrows/eyebrows_01/default"
    ]);
});

test("normalizes recipe tuple strings without evaluating source code", () =>
{
    const recipe = CjsToolCharacterNormalizer.normalizeRecipeProfile([ "female", {
        category: "makeup",
        path: "makeup/eyes/eyes_01",
        colors: "[(0.6, 0.7, 0.2, 1), (0.5, 0.5, 0.5, 1)]",
        specularcolors: [ [ 0.4, 0.4, 0.4, 1 ] ],
        weight: 0.75
    } ], { id: "eve", name: "Eve" });

    const hydrated = CjsCharacterRecipe.from(recipe);
    assert.ok(hydrated instanceof CjsCharacterRecipe);
    assert.equal(hydrated.entries[0].weight, 0.75);
    assert.equal(hydrated.entries[0].colorVariation, null);
    assert.equal(hydrated.entries[0].pattern, null);
    assert.deepEqual(hydrated.GetValues().entries[0].colors[0], [ 0.6, 0.7, 0.2, 1 ]);
    assert.throws(
        () => CjsToolCharacterNormalizer.normalizeRecipeProfile([ "female", {
            category: "makeup",
            path: "makeup/eyes/eyes_01",
            colors: "process.exit()"
        } ], { id: "unsafe" }),
        /unsupported non-numeric tuple syntax/
    );
});

test("normalizes flattened patterned recipe colors", () =>
{
    const recipe = CjsToolCharacterNormalizer.normalizeRecipeProfile([ "female", {
        category: "bottomouter",
        path: "bottomouter/pantsmf01",
        pattern: "Camo_Minmatar",
        colors: "[(0.4, 0.27, 0.2, 1), (0.29, 0.17, 0.1, 1), (0.35, 0.23, 0.15, 1), (0.21, 0.13, 0.06, 1), (0.13, 0.13, 0.13, 1), (0, 0, 8, 8), 0.0]"
    } ], { id: "brutorfemaleclothing" });

    const entry = CjsCharacterRecipe.from(recipe).GetValues().entries[0];
    assert.deepEqual(entry.colors, []);
    assert.equal(entry.patternColors.length, 5);
    assert.deepEqual(entry.patternTransform, [ 0, 0, 8, 8 ]);
    assert.equal(entry.patternRotation, 0);
});

test("normalizes pose, projection, and color authoring profiles", () =>
{
    const pose = CjsToolCharacterNormalizer.normalizePoseProfile({
        Trajectory: {
            orientation: [ 0, 0, 0 ],
            rotation: [ 0, 0, 0 ],
            translation: [ 0, 0, -0.0168 ]
        }
    }, { id: "female/head/head_generic" });
    const projection = CjsToolCharacterNormalizer.normalizeProjectionProfile({
        label: "arml",
        bodyEnabled: true,
        flipx: true,
        maskPathEnabled: true,
        offsetx: -0.25,
        offsety: 0,
        posx: 0.325,
        posy: 1.43,
        posz: -0.076,
        texturePath: "res:/graphics/character/decals/sleeve01.dds"
    }, { id: "female/tattoo/armleft/sleeve01" });
    const color = CjsToolCharacterNormalizer.normalizeColorProfile({
        colors: [ [ 0.2, 0.3, 0.4, 1 ], [ 0.5, 0.5, 0.5, 1 ], [ 0.5, 0.5, 0.5, 1 ] ],
        pattern: "",
        patternColors: [
            [ 0.2, 0.2, 0.2, 1 ], [ 0.6, 0.6, 0.6, 1 ],
            [ 0.5, 0.5, 0.5, 1 ], [ 0.5, 0.5, 0.5, 1 ],
            [ 0.5, 0.5, 0.5, 1 ], [ 0, 0, 8, 8 ], 0
        ],
        specularColors: [ [ 0.5, 0.5, 0.5, 1 ] ]
    }, { id: "female/glasses/eyeimp01/dark" });

    assert.ok(CjsCharacterPose.from(pose) instanceof CjsCharacterPose);
    assert.ok(CjsCharacterProjection.from(projection) instanceof CjsCharacterProjection);
    const material = CjsCharacterMaterial.from(color);
    assert.ok(material instanceof CjsCharacterMaterial);
    assert.equal(material.pattern, null);
    assert.deepEqual(material.GetValues().patternTransform, [ 0, 0, 8, 8 ]);
    assert.equal(projection.flipX, true);
    assert.equal(projection.maskPath, null);
    assert.deepEqual(projection.offset, [ -0.25, 0 ]);
});

test("normalizes part path, resource version, color variant, and metadata", () =>
{
    const part = CjsToolCharacterNormalizer.normalizeTypeProfile([ "accessories/glasses/eyeimp01", "v1", "dark" ], {
        sourcePath: "res:/graphics/character/female/paperdoll/accessories/glasses/eyeimp01/types/eyeimpf01_leftdark.type"
    });
    const metadata = CjsToolCharacterNormalizer.normalizePartMetadataProfile({
        alternativeTextureSourcePath: "Accessories/Piercings/Ring01",
        lod2Replacement: "Hair/GMOD_HairF_01",
        numColorAreas: 3,
        dependantModifiers: [ "utilityshapes/hidebrowrightShape" ],
        occludesModifiers: [ "hair" ],
        soundTag: 10020
    }, { id: "female/accessories/glasses/eyeimp01/v1" });
    part.metadataId = metadata.id;

    const hydrated = CjsCharacterPartDefinition.from(part);
    const hydratedMetadata = CjsCharacterPartMetadata.from(metadata);
    assert.ok(hydrated instanceof CjsCharacterPartDefinition);
    assert.equal(hydrated.sex, "female");
    assert.equal(hydrated.category, "accessories");
    assert.equal(hydrated.resourceVersion, "v1");
    assert.equal(hydrated.colorVariant, "dark");
    assert.equal(hydrated.metadataId, "female/accessories/glasses/eyeimp01/v1");
    assert.equal(hydratedMetadata.numColorAreas, 3);
    assert.deepEqual(hydratedMetadata.dependentModifiers, [ "utilityshapes/hidebrowrightShape" ]);
    assert.deepEqual(hydratedMetadata.occludesModifiers, [ "hair" ]);
    assert.equal(hydratedMetadata.alternativeTextureSourcePath, "Accessories/Piercings/Ring01");
    assert.equal(hydratedMetadata.lod2Replacement, "Hair/GMOD_HairF_01");
    assert.equal(hydratedMetadata.soundTag, 10020);
    assert.equal(hydratedMetadata.forcesLooseTop, null);

    const unversioned = CjsCharacterPartDefinition.from(CjsToolCharacterNormalizer.normalizeTypeProfile([ "hair/hair_short_01", "", "" ], {
        sourcePath: "res:/graphics/character/female/paperdoll/hair/hair_short_01/types/hair_short_01.type"
    }));
    assert.equal(unversioned.resourceVersion, null);
    assert.equal(unversioned.colorVariant, null);
    assert.equal(unversioned.projectionId, null);
});

test("normalizes sculpt fields and rejects inconsistent vertex coordinates", () =>
{
    const source = {
        Fields: {
            Default_Front: {
                Attributes: [ "XXX_up", "XXX_down" ],
                MarkerPosition: [ 0, 0, 0 ],
                Triangles: { 0: [ 0, 1, 2 ] },
                Tris: [ [ [ 0, [ 0, 0 ] ], [ 1, [ 1, 0 ] ], [ 2, [ 0, 1 ] ] ] ],
                VertData: {
                    0: [ [ "XXX_up", 1 ] ],
                    1: [ [ "XXX_down", 1 ] ],
                    2: [ [ "XXX_up", 0.5 ], [ "XXX_down", 0.5 ] ],
                    28: [ [ "XXX_up", 1 ] ]
                },
                VertPositions: { 0: [ 0, 0, 0 ], 1: [ 1, 0, 0 ], 2: [ 0, 1, 0 ] }
            }
        }
    };

    const fields = CjsToolCharacterNormalizer.normalizeSculptFieldsProfile(source);
    const hydrated = CjsCharacterSculptField.from(fields[0]);
    assert.ok(hydrated instanceof CjsCharacterSculptField);
    assert.equal(hydrated.vertices.length, 3);
    assert.deepEqual(hydrated.GetValues().vertices[2].weights, { XXX_up: 0.5, XXX_down: 0.5 });
    assert.deepEqual(hydrated.GetValues().triangles[0].indices, [ 0, 1, 2 ]);

    source.Fields.Default_Front.Tris.push([ [ 0, [ 1, 1 ] ] ]);
    assert.throws(() => CjsToolCharacterNormalizer.normalizeSculptFieldsProfile(source), /conflicting coordinates/);
});

test("hydrates every normalized catalog into the canonical library root", () =>
{
    const limits = CjsToolCharacterNormalizer.normalizeBlendshapeLimitsProfile({
        gender: "female",
        head: "amarr_amarr",
        limits: { CheeksMiddle_backShape: [ 0, 0.33 ] }
    });
    const data = CjsCharacterLibraryData.from({
        sourceBuild: "3430261",
        blendshapeLimits: [ limits ]
    });

    assert.ok(data instanceof CjsCharacterLibraryData);
    assert.ok(data.blendshapeLimits[0] instanceof CjsCharacterBlendshapeLimits);
    assert.equal(data.blendshapeLimits[0].id, "amarr_amarr_female");
    assert.deepEqual(data.GetValues().blendshapeLimits[0].limits.CheeksMiddle_backShape, [ 0, 0.33 ]);
});
