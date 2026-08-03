import assert from "node:assert/strict";
import test from "node:test";

import { CjsCharacterLibrary } from "@carbonenginejs/runtime-character";
import * as rootApi from "../src/index.js";
import {
    CjsToolCharacter,
    CjsToolCharacterBuilder,
    CjsToolCharacterCatalogGatherer,
    CjsToolCharacterRepository,
} from "../src/character/index.js";
import { CreateCharacterDocuments } from "./character-library-fixture.js";

test("character subpath exposes the schema-v6 producer surface", () =>
{
    assert.equal(typeof CjsToolCharacter, "function");
    assert.equal(typeof CjsToolCharacterBuilder, "function");
    assert.equal(typeof CjsToolCharacterCatalogGatherer, "function");
    assert.equal(typeof CjsToolCharacterRepository, "function");
    assert.equal(rootApi.CjsToolCharacter, undefined);
    assert.equal(rootApi.CjsToolCharacterAssembler, undefined);
    assert.equal(rootApi.CjsToolCharacterCompiler, undefined);
    assert.equal(rootApi.CjsToolCharacterLibrary, undefined);
    assert.equal(rootApi.CjsToolCharacterNormalizer, undefined);
    assert.equal(rootApi.CjsToolCharacterSerializer, undefined);
});

test("target-aware character builds delegate to the runtime-owned schema", () =>
{
    const documents = CreateCharacterDocuments();
    const typePath = documents.characterResources[21].resPath;

    documents.characterPartTypes = {
        [typePath]: {
            sourcePath: typePath,
            sex: "female",
            partPath: "hair/logical-sample",
            resourceVersion: "v1",
            colorVariant: "dark",
            partSource: "female/hair/sample",
        },
    };
    documents.characterPartSources = {
        "female/hair/sample": {
            sourcePath: "res:/example/assets/sample",
            sex: "female",
            partPath: "hair/sample",
            versions: [ {
                resourceVersion: "v1",
                configurationCandidates: [
                    "res:/example/assets/sample.configuration",
                ],
                geometryCandidates: [],
                textureCandidates: [],
            } ],
            metadata: null,
        },
    };

    const values = CjsToolCharacter.build(documents, {
        sourceTarget: "eve",
        sourceBuild: "3450001",
        generatedAt: "2026-08-02T00:00:00.000Z",
    });
    const library = CjsCharacterLibrary.from(values);

    library.Reindex();
    assert.equal(values.schemaVersion, 6);
    assert.equal(values.sourceTarget, "eve");
    assert.equal(values.sourceGame, "Eve");
    assert.equal(values.sourceProvider, "ccp");
    assert.equal(values.sourceBuild, "3450001");
    assert.equal(library.ListDocuments().length, 18);
    assert.strictEqual(
        library.Get("characterResources", 21).partType,
        library.Get("characterPartTypes", typePath)
    );
    assert.strictEqual(
        library.Get("characterPartTypes", typePath).partSource,
        library.Get("characterPartSources", "female/hair/sample")
    );
    assert.deepEqual(
        CjsCharacterLibrary.from(JSON.parse(JSON.stringify(
            library.GetValues({ refs: true })
        ))).GetValues({ refs: true }),
        library.GetValues({ refs: true })
    );
});

test("unscoped builder remains usable with caller-owned synthetic documents", () =>
{
    const values = CjsToolCharacterBuilder.build(CreateCharacterDocuments());
    const fromInputs = CjsToolCharacterBuilder.buildFromInputs({
        documents: CreateCharacterDocuments(),
        sourceTarget: "eve",
        sourceBuild: "3450001",
    });

    assert.equal(values.schemaVersion, 6);
    assert.equal(Object.hasOwn(values, "sourceTarget"), false);
    assert.equal(fromInputs.sourceTarget, "eve");
    assert.equal(fromInputs.sourceBuild, "3450001");
});

test("target-aware builds reject unaudited character targets and friendly builds", () =>
{
    assert.throws(
        () => CjsToolCharacter.build(CreateCharacterDocuments(), {
            sourceTarget: "frontier",
            sourceBuild: "3450001",
        }),
        /does not support target frontier/u
    );
    assert.throws(
        () => CjsToolCharacter.build(CreateCharacterDocuments(), {
            sourceTarget: "eve",
            sourceBuild: "latest",
        }),
        /exact source build/u
    );
    assert.throws(
        () => CjsToolCharacterBuilder.build(CreateCharacterDocuments(), {
            sourceTarget: "eve",
        }),
        /exact source build/u
    );
    assert.throws(
        () => CjsToolCharacterBuilder.build(CreateCharacterDocuments(), {
            sourceTarget: "eve",
            sourceBuild: "latest",
        }),
        /exact source build/u
    );
});
