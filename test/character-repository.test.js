import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    CjsToolCache,
    CjsToolCharacterLibrary,
    CjsToolCharacterRepository,
} from "../src/index.js";

test("opens exact and friendly-build character libraries from the shared cache", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-character-repository-"));
    const cache = new CjsToolCache(directory);
    const data = {
        schema: "carbonenginejs.characterLibrary",
        schemaVersion: 1,
        sourceTarget: "eve",
        sourceGame: "Eve",
        sourceProvider: "ccp",
        sourceBuild: "3435006",
        parts: [ {
            id: "female/hair/types/long_hair",
            typeID: "9001",
            name: "Long Hair",
            sex: "female",
            category: "hair",
            path: "hair/long_hair",
        } ],
    };

    context.after(() => fs.rm(directory, { force: true, recursive: true }));

    await cache.WriteCustom({
        game: "Eve",
        provider: "ccp",
        build: "3435006",
        name: "character",
        version: "v1",
    }, { character: data });

    const repository = new CjsToolCharacterRepository({
        cache,
        indexes: {
            async ResolveTargetBuild(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "latest");

                return { build: "3435006" };
            },
        },
    });
    const exact = await repository.OpenTarget("eve", "3435006");
    const friendly = await repository.OpenTarget("eve", "latest");

    assert.ok(exact instanceof CjsToolCharacterLibrary);
    assert.equal(friendly, exact);
    assert.equal(exact.GetPartByTypeID(9001).name, "Long Hair");
});

test("reports a missing prepared character library as not found", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-character-repository-"));
    const repository = new CjsToolCharacterRepository({
        cache: new CjsToolCache(directory),
    });

    context.after(() => fs.rm(directory, { force: true, recursive: true }));

    await assert.rejects(
        () => repository.OpenTarget("eve", "3435006"),
        error => error.statusCode === 404 && /not prepared/u.test(error.message),
    );
});

test("rejects malformed prepared character-library payloads explicitly", async () =>
{
    const cases = [
        [ "empty object", {} ],
        [ "null wrapper", { character: null } ],
        [ "null payload", null ],
        [ "missing compact sources", {
            schema: "carbonenginejs.characterLibrary",
            schemaVersion: 2
        } ]
    ];

    for (const [ label, payload ] of cases)
    {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-character-repository-"));
        const cache = new CjsToolCache(directory);
        const repository = new CjsToolCharacterRepository({ cache });

        try
        {
            await cache.WriteCustom({
                game: "Eve",
                provider: "ccp",
                build: "3435006",
                name: "character",
                version: "v1",
            }, payload);

            await assert.rejects(
                () => repository.OpenTarget("eve", "3435006"),
                error => error instanceof TypeError && /character library|character-library|partSources/u.test(error.message),
                label
            );
        }
        finally
        {
            await fs.rm(directory, { force: true, recursive: true });
        }
    }
});

test("preserves the prepared character document alongside expanded query values", () =>
{
    const document = {
        schema: "carbonenginejs.characterLibrary",
        schemaVersion: 2,
        sourceBuild: "3435006",
        partSources: {
            "female/hair/long_hair": {
                versions: {
                    default: {
                        types: {
                            "female/hair/types/long_hair": {
                                typeID: "9001",
                                name: "Long Hair",
                            },
                        },
                    },
                },
            },
        },
    };
    const library = new CjsToolCharacterLibrary(document);

    assert.equal(library.GetDocument().schemaVersion, 2);
    assert.equal(library.GetValues().schemaVersion, 1);
    assert.equal(library.GetPartByTypeID(9001).name, "Long Hair");

    const copy = library.GetDocument();
    copy.schemaVersion = 99;
    assert.equal(library.GetDocument().schemaVersion, 2);
});
