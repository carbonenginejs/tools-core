import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CjsCharacterLibrary } from "@carbonenginejs/runtime-character";
import { CjsToolCache } from "../src/cache/index.js";
import {
    CjsToolCharacter,
    CjsToolCharacterBuilder,
    CjsToolCharacterRepository,
} from "../src/character/index.js";
import { CreateCharacterDocuments } from "./character-library-fixture.js";

test("opens exact and friendly schema-v9 libraries from the shared cache", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-character-repository-"));
    const cache = new CjsToolCache(directory);
    const values = CjsToolCharacter.build(CreateCharacterDocuments(), {
        sourceTarget: "eve",
        sourceBuild: "3450001",
    });

    context.after(() => fs.rm(directory, { force: true, recursive: true }));
    await cache.WriteCustomLibrary({
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3450001",
        name: "character",
        version: "v9",
    }, values);

    const repository = new CjsToolCharacterRepository({
        cache,
        indexes: {
            async ResolveTargetBuild(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "latest");
                return { build: "3450001" };
            },
        },
    });
    const exact = await repository.OpenTarget("eve", "3450001");
    const friendly = await repository.OpenTarget("eve", "latest");

    assert.ok(exact instanceof CjsCharacterLibrary);
    assert.strictEqual(friendly, exact);
    assert.equal(exact.Get("races", 3).nameID, "1003");
    assert.equal(exact.ListDocuments().length, 20);
});

test("reports a missing prepared character library as not found", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-character-repository-"));
    const repository = new CjsToolCharacterRepository({
        cache: new CjsToolCache(directory),
    });

    context.after(() => fs.rm(directory, { force: true, recursive: true }));

    await assert.rejects(
        () => repository.OpenTarget("eve", "3450001"),
        error => error.statusCode === 404 && /not prepared/u.test(error.message)
    );
});

test("rejects the retired character-library envelope", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-character-repository-"));
    const cache = new CjsToolCache(directory);
    const values = CjsToolCharacter.build(CreateCharacterDocuments(), {
        sourceTarget: "eve",
        sourceBuild: "3450001",
    });

    context.after(() => fs.rm(directory, { force: true, recursive: true }));
    await cache.WriteCustom({
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3450001",
        name: "character",
        version: "v7",
    }, {
        sourceTarget: values.sourceTarget,
        sourceGame: values.sourceGame,
        sourceProvider: values.sourceProvider,
        sourceBuild: values.sourceBuild,
        character: values,
    });

    await assert.rejects(
        () => new CjsToolCharacterRepository({ cache }).OpenTarget("eve", "3450001"),
        /schema/u
    );
});

test("requires matching prepared character-library source identity", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-character-repository-"));
    const cache = new CjsToolCache(directory);
    const identity = {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3450001",
        name: "character",
        version: "v7",
    };
    const repository = new CjsToolCharacterRepository({ cache });

    context.after(() => fs.rm(directory, { force: true, recursive: true }));
    await cache.WriteCustom(identity, CjsToolCharacterBuilder.build(
        CreateCharacterDocuments()
    ));
    await assert.rejects(
        () => repository.OpenTarget("eve", "3450001"),
        /missing source target identity/u
    );

    const mismatched = CjsToolCharacter.build(CreateCharacterDocuments(), {
        sourceTarget: "eve",
        sourceBuild: "3450001",
    });

    mismatched.sourceProvider = "example";
    await cache.WriteCustom(identity, mismatched);
    await assert.rejects(
        () => repository.OpenTarget("eve", "3450001"),
        /provider mismatch/u
    );
});

test("rejected artifacts do not poison repository retry", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-character-repository-"));
    const cache = new CjsToolCache(directory);
    const identity = {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3450001",
        name: "character",
        version: "v7",
    };
    const repository = new CjsToolCharacterRepository({ cache });
    const invalid = CjsToolCharacter.build(CreateCharacterDocuments(), {
        sourceTarget: "eve",
        sourceBuild: "3450002",
    });

    context.after(() => fs.rm(directory, { force: true, recursive: true }));
    await cache.WriteCustom(identity, invalid);
    await assert.rejects(
        () => repository.OpenTarget("eve", "3450001"),
        /build mismatch/u
    );

    const valid = CjsToolCharacter.build(CreateCharacterDocuments(), {
        sourceTarget: "eve",
        sourceBuild: "3450001",
    });

    await cache.WriteCustom(identity, valid);
    const library = await repository.OpenTarget("eve", "3450001");

    assert.ok(library instanceof CjsCharacterLibrary);
    assert.equal(library.sourceBuild, "3450001");
});

test("rejects malformed prepared character-library payloads explicitly", async context =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cjs-character-repository-"));
    const cache = new CjsToolCache(directory);

    context.after(() => fs.rm(directory, { force: true, recursive: true }));
    await cache.WriteCustom({
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3450001",
        name: "character",
        version: "v7",
    }, {
        schema: "carbonenginejs.characterLibrary",
        schemaVersion: 7,
        sourceTarget: "eve",
        sourceGame: "Eve",
        sourceProvider: "ccp",
        sourceBuild: "3450001",
    });

    await assert.rejects(
        () => new CjsToolCharacterRepository({ cache }).OpenTarget("eve", "3450001"),
        /documents/u
    );
});
