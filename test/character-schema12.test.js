import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CjsCharacterLibrary, CjsCharacterLibraryManager, CjsCharacterAppearanceResolver } from "@carbonenginejs/runtime/character";
import { CjsSchema } from "@carbonenginejs/runtime/schema";
import { CjsToolCharacterBuilder, CjsToolCharacterRepository } from "../src/character/index.js";
import { CjsToolCache } from "../src/cache/CjsToolCache.js";
import { CjsToolHttpProxy } from "../src/proxy/CjsToolHttpProxy.js";
import { CreateCharacterDocuments } from "./character-library-fixture.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("v12 publication is isolated, missing stays unprepared, and refresh replaces cached values", async t =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "character-schema12-"));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const cache = new CjsToolCache(directory);
    const repository = new CjsToolCharacterRepository({cache, indexes: {
        ResolveTargetBuild() { throw new Error("Exact build must not resolve"); },
        OpenTarget() { throw new Error("v12 must not auto-prepare FSD"); }
    }});
    const identity = {sourceTarget: "eve", sourceBuild: "3450001"};
    const legacy = CjsToolCharacterBuilder.build(CreateCharacterDocuments(), identity);
    const root = "res:/test/female/pants";
    const texture = `${root}/colorize_body_l.png`;
    const documents = {
        characterDefinitions: {black: {sourcePath: `${root}/black.color`, extension: ".color", values: {colors: [[0, 0, 0, 1]]}}},
        characterPartTypes: {black: {partSource: "pants", colorVariant: "black"}},
        characterPartSources: {pants: {sourcePath: root, versions: [{resourceVersion: "", textureCandidates: [texture],
            textureCandidateInput: {mode: "complete", paths: [texture], origin: {kind: "authored", resourcePath: root, rule: "input-field-presence"}}
        }]}}
    };
    const modern = CjsToolCharacterBuilder.build(documents, {...identity, schemaVersion: 12,
        preparation: {indexedPaths: [texture, `${root}/black.color`]}});
    const publish = (version, data) => cache.WriteCustomLibrary({target: "eve", build: "3450001", name: "character", version}, data);
    await publish("v10", legacy);
    await assert.rejects(repository.OpenTarget("eve", "3450001", {schemaVersion: 12}), /not prepared/);
    await publish("v12", modern);
    const v11 = await repository.OpenTarget("eve", "3450001");
    const v12 = await repository.OpenTarget("eve", "3450001", {schemaVersion: 12});
    assert.equal(v11.schemaVersion, 11);
    assert.equal(v12.schemaVersion, 12);
    modern.generatedAt = "replacement";
    await publish("v12", modern);
    assert.equal((await repository.OpenTarget("eve", "3450001", {schemaVersion: 12})).generatedAt, "");
    assert.equal((await repository.OpenTarget("eve", "3450001", {schemaVersion: 12, refresh: true})).generatedAt, "replacement");
    assert.equal(await repository.OpenTarget("eve", "3450001"), v11);

    const server = new CjsToolHttpProxy({characters: repository}).CreateServer();
    await new Promise((resolve, reject) => {server.once("error", reject); server.listen(0, "127.0.0.1", resolve);});
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/eve/3450001/character`;
    const defaultValues = await (await fetch(url)).json();
    assert.equal(defaultValues.schemaVersion, 11);
    assert.equal(Object.hasOwn(defaultValues, "rawDocuments"), false);
    assert.deepEqual(await (await fetch(`${url}/library.json`)).json(), defaultValues);
    assert.doesNotThrow(() => CjsCharacterLibrary.from(defaultValues));
    const response = await fetch(`${url}/library-v12.json`);
    assert.equal(response.status, 200);
    const installed = new CjsCharacterLibraryManager().InstallLibrary(await response.json());
    assert.equal(installed.schemaVersion, 12);
    assert.deepEqual(CjsSchema.getValues(installed).rawDocuments, documents);
    const selected = CjsCharacterAppearanceResolver.resolveCatalog(installed, {
        partSource: installed.Get("characterPartSources", "pants"), partType: installed.Get("characterPartTypes", "black")
    });
    assert.equal(selected.materialProfile.sourcePath, `${root}/black.color`);
    assert.equal(selected.textureBindings[0].path, texture);
    modern.generatedAt = "http-refresh";
    await publish("v12", modern);
    assert.equal((await (await fetch(`${url}/library-v12.json`)).json()).generatedAt, "replacement");
    assert.equal((await (await fetch(`${url}/library-v12.json?refresh=1`)).json()).generatedAt, "http-refresh");
    assert.equal((await (await fetch(url)).json()).schemaVersion, 11);
});

test("files-only CLI replaces producer projections deterministically on same-build rebuild", async t =>
{
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "character-rebuild12-"));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const root = "res:/graphics/character/female/paperdoll/bottomouter/sample";
    const texts = {
        [`${root}/types/black.type`]: "[bottomouter/sample, '', black]\n",
        [`${root}/black.color`]: "colors: [[0, 0, 0, 1]]\n",
        [`${root}/metadata.yaml`]: "!!python/object:paperDoll.AvatarPartMetaData\nforcesLooseTop: false\n"
    };
    const input = path.join(directory, "input.json"), catalog = path.join(directory, "catalog.json");
    const index = path.join(directory, "index.txt"), output = path.join(directory, "library.json");
    await fs.writeFile(input, "{}");
    await fs.writeFile(index, Object.keys(texts).map((value, i) => `${value},a${i}/file,,,,`).join("\n"));
    const run = documents => spawnSync(process.execPath, ["scripts/build_character_library.js",
        "--documents", documents, "--catalog-inputs", catalog, "--index", index, "--cache", directory,
        "--build", "3450001", "--target", "eve", "--schema-version", "12", "--out", output], {
        cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8"
    });
    await fs.writeFile(catalog, JSON.stringify({sourceTexts: texts}));
    let result = run(input);
    assert.equal(result.status, 0, result.stderr);
    const first = JSON.parse(await fs.readFile(output, "utf8"));
    assert.equal(first.schemaVersion, 12);
    texts[`${root}/black.color`] = "colors: [[1, 0, 0, 1]]\n";
    await fs.writeFile(catalog, JSON.stringify({sourceTexts: texts}));
    result = run(output);
    assert.equal(result.status, 0, result.stderr);
    const second = await fs.readFile(output, "utf8");
    const library = CjsCharacterLibrary.from(JSON.parse(second));
    assert.deepEqual(Array.from(library.GetDocument("characterMaterialProfiles")[0].colors[0].value), [1, 0, 0, 1]);
    result = run(output);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await fs.readFile(output, "utf8"), second);
});
