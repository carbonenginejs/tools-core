import test from "node:test";
import assert from "node:assert/strict";

import { CjsFileIndex } from "@carbonenginejs/tools-browser/fileindex";
import {
    CjsToolCharacterCatalogGatherer,
    CjsToolCharacterDefinitionCompiler,
} from "../src/character/index.js";

const femaleType = "res:/graphics/character/female/paperdoll/hair/shared/types/style.type";
const maleType = "res:/graphics/character/male/paperdoll/hair/shared/types/style.type";
const femaleBlack = "res:/graphics/character/female/paperdoll/hair/shared/shared.black";
const femaleGr2 = "res:/graphics/character/female/paperdoll/hair/shared/shared.gr2";
const femaleTexture = "res:/graphics/character/female/paperdoll/hair/shared/shared_d.png";
const femaleV1Black = "res:/graphics/character/female/paperdoll/hair/shared/v1/shared.black";
const femaleV2Gr2 = "res:/graphics/character/female/paperdoll/hair/shared/v2/shared.gr2";
const maleBlack = "res:/graphics/character/male/paperdoll/hair/shared/shared.black";
const maleGr2 = "res:/graphics/character/male/paperdoll/hair/shared/shared.gr2";

test("compiles shared resource identities into exact sex-specific part sources", async () =>
{
    const definitions = {
        [femaleType]: [ "hair/shared", "v1", "dark", [ 1, "2" ] ],
        [maleType]: [ "hair/shared", "v1", "dark", [ 1, "2" ] ],
        "res:/graphics/character/female/paperdoll/hair/shared/dark.color": {
            colors: [],
        },
    };
    const characterResources = {
        10: { resPath: "Hair/Shared/Types/Style.type", resGender: 0 },
        11: { resPath: "Hair/Shared/Types/Style.type", resGender: 1 },
    };
    const beforeDefinitions = structuredClone(definitions);
    const beforeResources = structuredClone(characterResources);
    const index = CreateIndex([
        ...Object.keys(definitions),
        femaleBlack,
        femaleGr2,
        femaleTexture,
        femaleV1Black,
        femaleV2Gr2,
        maleBlack,
        maleGr2,
    ]);
    const compiled = CjsToolCharacterDefinitionCompiler.compile(index, {
        definitions,
        characterResources,
        sourceBuild: "3453885",
    });
    const partType = compiled.partTypes["Hair/Shared/Types/Style.type"];

    assert.deepEqual(definitions, beforeDefinitions);
    assert.deepEqual(characterResources, beforeResources);
    assert.equal(partType.sex, "");
    assert.equal(partType.partSource, null);
    assert.deepEqual(partType.partSources, [
        "female/hair/shared",
        "male/hair/shared",
    ]);
    assert.deepEqual(partType.bloodlineIDs, [ "1", "2" ]);
    assert.deepEqual(partType.sourcePaths, [ femaleType, maleType ]);
    assert.equal(Object.keys(compiled.characterDefinitions).length, 3);
    assert.deepEqual(compiled.characterDefinitions[femaleType], {
        sourcePath: femaleType,
        extension: ".type",
        values: definitions[femaleType],
    });
    assert.deepEqual(
        compiled.characterDefinitions[
            "res:/graphics/character/female/paperdoll/hair/shared/dark.color"
        ].values,
        { colors: [] }
    );

    const gathered = await CjsToolCharacterCatalogGatherer.gather(index, {
        definitions,
        characterResources,
        sourceBuild: "3453885",
    });
    const female = gathered.documents.characterPartSources["female/hair/shared"];
    const male = gathered.documents.characterPartSources["male/hair/shared"];

    assert.deepEqual(female.versions[0].configurationCandidates, [ femaleBlack ]);
    assert.deepEqual(female.versions[0].geometryCandidates, [ femaleGr2 ]);
    assert.deepEqual(female.versions[0].textureCandidates, [ femaleTexture ]);
    assert.deepEqual(female.versions[1], {
        resourceVersion: "v1",
        configurationCandidates: [ femaleV1Black ],
        geometryCandidates: [ femaleGr2 ],
        textureCandidates: [ femaleTexture ],
        metadata: null,
    });
    assert.deepEqual(female.versions[2], {
        resourceVersion: "v2",
        configurationCandidates: [ femaleBlack ],
        geometryCandidates: [ femaleV2Gr2 ],
        textureCandidates: [ femaleTexture ],
        metadata: null,
    });
    assert.deepEqual(male.versions[1].configurationCandidates, [ maleBlack ]);
    assert.deepEqual(male.versions[1].geometryCandidates, [ maleGr2 ]);
    assert.equal(Object.keys(gathered.documents.characterDefinitions).length, 3);
    assert.equal(gathered.report.definitionCompilation.retainedDefinitions, 3);
    assert.equal(gathered.report.definitionCompilation.projectedDefinitions, 2);
    assert.equal(gathered.report.definitionCompilation.unprojectedDefinitions, 1);
    assert.equal(gathered.report.definitionCompilation.droppedDefinitions, 0);
    assert.equal(gathered.report.definitionCompilation.multiSourcePartTypes, 1);
    assert.doesNotMatch(
        JSON.stringify(gathered.documents),
        /lodBundles|modelFamily|textureRole|recipeLinks/u
    );
});

test("retains multiple authored folders for one logical source without choosing one", () =>
{
    const canonicalType = "res:/graphics/character/female/paperdoll/accessories/piercings/stud02/types/stud02.type";
    const aliasType = "res:/graphics/character/female/paperdoll/accessories/piercings/earring01/types/stud02.type";
    const canonicalBlack = "res:/graphics/character/female/paperdoll/accessories/piercings/stud02/stud02.black";
    const aliasBlack = "res:/graphics/character/female/paperdoll/accessories/piercings/earring01/earring01.black";
    const definitions = {
        [canonicalType]: [ "accessories/earslow/stud02", "", "" ],
        [aliasType]: [ "accessories/earslow/stud02", "", "" ],
    };
    const index = CreateIndex([
        canonicalType,
        aliasType,
        canonicalBlack,
        aliasBlack,
    ]);
    const compiled = CjsToolCharacterDefinitionCompiler.compile(index, {
        definitions,
        characterResources: {
            1: { resPath: "Accessories/Piercings/Stud02/Types/Stud02.type" },
            2: { resPath: "Accessories/Piercings/Earring01/Types/Stud02.type" },
        },
    });
    const source = compiled.partSources["female/accessories/earslow/stud02"];

    assert.equal(Object.keys(compiled.partTypes).length, 2);
    assert.deepEqual(source.sourcePaths, [
        "res:/graphics/character/female/paperdoll/accessories/piercings/earring01",
        "res:/graphics/character/female/paperdoll/accessories/piercings/stud02",
    ]);
    assert.deepEqual(source.versions[0].configurationCandidates, [
        aliasBlack,
        canonicalBlack,
    ]);
    assert.equal(compiled.report.multiFolderPartSources, 1);
});

test("retains malformed type definitions while reporting the additive projection failure", () =>
{
    const index = CreateIndex([ femaleType ]);
    const values = [ "hair/shared", "", "", [ "bloodline" ] ];
    const compiled = CjsToolCharacterDefinitionCompiler.compile(index, {
        definitions: { [femaleType]: values },
    });

    assert.deepEqual(compiled.characterDefinitions[femaleType], {
        sourcePath: femaleType,
        extension: ".type",
        values,
    });
    assert.deepEqual(compiled.partTypes, {});
    assert.deepEqual(compiled.partSources, {});
    assert.equal(compiled.report.retainedDefinitions, 1);
    assert.equal(compiled.report.projectedDefinitions, 0);
    assert.equal(compiled.report.unprojectedDefinitions, 1);
    assert.equal(compiled.report.droppedDefinitions, 0);
    assert.deepEqual(compiled.report.errors, []);
    assert.equal(compiled.report.projectionErrors[0].path, femaleType);
    assert.match(compiled.report.projectionErrors[0].message, /integer identity/u);
});

test("projects exact baseline and version metadata without changing retained YAML values", async () =>
{
    const typePath = "res:/graphics/character/female/paperdoll/bottomouter/trousers/types/trousers.type";
    const metadataPath = "res:/graphics/character/female/paperdoll/bottomouter/trousers/metadata.yaml";
    const versionMetadataPath = "res:/graphics/character/female/paperdoll/bottomouter/trousers/v1/metadata.yaml";
    const supportMetadataPath = "res:/graphics/character/female/paperdoll/dependants/waisttucking/standard/metadata.yaml";
    const trousersBlack = "res:/graphics/character/female/paperdoll/bottomouter/trousers/trousers.black";
    const trousersGr2 = "res:/graphics/character/female/paperdoll/bottomouter/trousers/trousers.gr2";
    const supportBlack = "res:/graphics/character/female/paperdoll/dependants/waisttucking/standard/standard.black";
    const supportGr2 = "res:/graphics/character/female/paperdoll/dependants/waisttucking/standard/standard.gr2";
    const tuckBlack = "res:/graphics/character/female/paperdoll/dependants/tuck/basic/tuck.black";
    const tuckGr2 = "res:/graphics/character/female/paperdoll/dependants/tuck/basic/tuck.gr2";
    const definitions = {
        [typePath]: [ "bottomouter/trousers", "v1", "" ],
        [metadataPath]: {
            forcesLooseTop: false,
            dependantModifiers: [
                "dependants/waisttucking/standard",
                "dependants/tuck/basic",
                "utilityshapes/pushhemshape###0.7",
            ],
            occludesModifiers: [ "bottominner" ],
        },
        [versionMetadataPath]: {
            forcesLooseTop: true,
            dependantModifiers: [ "dependants/waisttucking/standard#1.0" ],
        },
        [supportMetadataPath]: {
            numColorAreas: 0,
            dependantModifiers: [],
        },
    };
    const before = structuredClone(definitions);
    const index = CreateIndex([
        ...Object.keys(definitions),
        trousersBlack,
        trousersGr2,
        supportBlack,
        supportGr2,
        tuckBlack,
        tuckGr2,
    ]);
    const compiled = CjsToolCharacterDefinitionCompiler.compile(index, {
        definitions,
        characterResources: {
            1: { resPath: "BottomOuter/Trousers/Types/Trousers.type" },
        },
        characterModifierLocations: {
            30: { modifierKey: "bottominner" },
        },
    });
    const source = compiled.partSources["female/bottomouter/trousers"];
    const version = source.versions.find(value => value.resourceVersion === "v1");
    const support = compiled.partSources[
        "female/dependants/waisttucking/standard"
    ];

    assert.deepEqual(definitions, before);
    assert.deepEqual(compiled.characterDefinitions[metadataPath].values, before[metadataPath]);
    assert.deepEqual(compiled.partMetadata[metadataPath], {
        sourcePath: metadataPath,
        forcesLooseTop: false,
        dependentModifiers: [
            "dependants/waisttucking/standard",
            "dependants/tuck/basic",
            "utilityshapes/pushhemshape###0.7",
        ],
        occludesModifiers: [ "bottominner" ],
        dependencies: [ {
            authoredValue: "dependants/waisttucking/standard",
            modifierPath: "dependants/waisttucking/standard",
            partSource: "female/dependants/waisttucking/standard",
        }, {
            authoredValue: "dependants/tuck/basic",
            modifierPath: "dependants/tuck/basic",
            partSource: "female/dependants/tuck/basic",
        }, {
            authoredValue: "utilityshapes/pushhemshape###0.7",
        } ],
        occlusions: [ {
            authoredValue: "bottominner",
            modifierPath: "bottominner",
            modifierLocation: "30",
        } ],
    });
    assert.equal(source.metadata, metadataPath);
    assert.equal(version.metadata, versionMetadataPath);
    assert.equal(support.metadata, supportMetadataPath);
    assert.deepEqual(support.versions[0].configurationCandidates, [ supportBlack ]);
    assert.deepEqual(support.versions[0].geometryCandidates, [ supportGr2 ]);
    assert.deepEqual(
        compiled.partSources["female/dependants/tuck/basic"]
            .versions[0].configurationCandidates,
        [ tuckBlack ]
    );
    assert.deepEqual(
        compiled.partSources["female/dependants/tuck/basic"]
            .versions[0].geometryCandidates,
        [ tuckGr2 ]
    );
    assert.equal(compiled.report.metadataDefinitions, 3);
    assert.equal(compiled.report.partMetadata, 3);
    assert.equal(compiled.report.droppedDefinitions, 0);

    const gathered = await CjsToolCharacterCatalogGatherer.gather(index, {
        definitions,
        characterResources: {
            1: { resPath: "BottomOuter/Trousers/Types/Trousers.type" },
        },
        characterModifierLocations: {
            30: { modifierKey: "bottominner" },
        },
    });

    assert.deepEqual(
        gathered.documents.characterPartMetadata[metadataPath],
        compiled.partMetadata[metadataPath]
    );
    assert.equal(
        gathered.documents.characterPartSources["female/bottomouter/trousers"]
            .versions.find(value => value.resourceVersion === "v1").metadata,
        versionMetadataPath
    );
});

test("retains malformed metadata definitions without leaving a typed source", () =>
{
    const metadataPath = "res:/graphics/character/female/paperdoll/dependants/example/metadata.yaml";
    const values = {
        dependantModifiers: [ "dependants/example" ],
        futureField: true,
    };
    const compiled = CjsToolCharacterDefinitionCompiler.compile(
        CreateIndex([ metadataPath ]),
        { definitions: { [metadataPath]: values } }
    );

    assert.deepEqual(compiled.characterDefinitions[metadataPath].values, values);
    assert.deepEqual(compiled.partMetadata, {});
    assert.deepEqual(compiled.partSources, {});
    assert.equal(compiled.report.retainedDefinitions, 1);
    assert.equal(compiled.report.projectedDefinitions, 0);
    assert.equal(compiled.report.unprojectedDefinitions, 1);
    assert.equal(compiled.report.droppedDefinitions, 0);
    assert.equal(compiled.report.projectionErrors[0].path, metadataPath);
    assert.match(compiled.report.projectionErrors[0].message, /unsupported field futureField/u);
});

test("does not leave a partial typed catalog when a retained projection conflicts", () =>
{
    const definitions = {
        [femaleType]: [ "hair/shared", "v1", "dark" ],
        [maleType]: [ "hair/conflict", "v1", "dark" ],
    };
    const compiled = CjsToolCharacterDefinitionCompiler.compile(
        CreateIndex(Object.keys(definitions)),
        {
            definitions,
            characterResources: {
                10: { resPath: "Hair/Shared/Types/Style.type" },
            },
        }
    );

    assert.equal(Object.keys(compiled.characterDefinitions).length, 2);
    assert.equal(compiled.report.retainedDefinitions, 2);
    assert.equal(compiled.report.projectedDefinitions, 1);
    assert.equal(compiled.report.unprojectedDefinitions, 1);
    assert.equal(compiled.report.droppedDefinitions, 0);
    assert.equal(compiled.report.projectionErrors.length, 1);
    assert.equal(compiled.report.projectionErrors[0].path, maleType);
    assert.deepEqual(Object.keys(compiled.partSources), [ "female/hair/shared" ]);
    assert.equal(Object.keys(compiled.partTypes).length, 1);
});

function CreateIndex(paths)
{
    return CjsFileIndex.parseResFileIndex(paths.map((logicalPath, index) =>
        `${logicalPath},a${index}/resource,,,,`
    ).join("\n"));
}
