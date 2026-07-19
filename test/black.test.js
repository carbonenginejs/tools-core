import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CjsToolBlack } from "../src/index.js";
import * as utils from "../src/utils.js";

const FixtureDirectory = path.dirname(fileURLToPath(import.meta.url));
const HullFixturePath = path.join(FixtureDirectory, "fixtures", "ab1_t1.black");

test("IsBlackPath recognizes .black resources case-insensitively", () =>
{
    assert.equal(CjsToolBlack.isBlackPath("res:/dx9/model/spaceobjectfactory/hulls/ab1_t1.black"), true);
    assert.equal(CjsToolBlack.isBlackPath("res:/dx9/model/spaceobjectfactory/hulls/AB1_T1.BLACK"), true);
    assert.equal(CjsToolBlack.isBlackPath("res:/dx9/model/spaceobjectfactory/hulls/ab1_t1.red"), false);
    assert.equal(CjsToolBlack.isBlackPath(""), false);
});

test("ReadJson parses a real SOF hull Black file into public payload JSON", async () =>
{
    const bytes = utils.toArrayBuffer(await fs.readFile(HullFixturePath));
    const payload = CjsToolBlack.readJson(bytes);
    const hull = payload.object;

    assert.equal(hull._type, "EveSOFDataHull");
    assert.equal(typeof hull.name, "string");
    assert.ok(Array.isArray(hull.locatorSets));

    const damageLocators = hull.locatorSets.find(set => set.name === "damage");

    assert.ok(damageLocators, "expected a \"damage\" locator set on the hull");
    assert.ok(damageLocators.locators.length > 0);
    assert.equal(damageLocators.locators[0]._type, "EveSOFDataTransform");
    assert.equal(damageLocators.locators[0].position.length, 3);
});

test("FetchJson fetches through an opened index source and parses the result", async () =>
{
    const bytes = utils.toArrayBuffer(await fs.readFile(HullFixturePath));
    const calls = [];
    const source = {
        async Fetch(logicalPath, options)
        {
            calls.push({ logicalPath, options });

            return { bytes };
        },
    };

    const payload = await CjsToolBlack.fetchJson(
        source,
        "res:/dx9/model/spaceobjectfactory/hulls/ab1_t1.black",
        { fetch: { refresh: true } },
    );

    assert.equal(payload.object._type, "EveSOFDataHull");
    assert.deepEqual(calls, [ {
        logicalPath: "res:/dx9/model/spaceobjectfactory/hulls/ab1_t1.black",
        options: { refresh: true },
    } ]);
});

test("FetchJson rejects a source without Fetch", async () =>
{
    await assert.rejects(
        () => CjsToolBlack.fetchJson({}, "res:/dx9/model/spaceobjectfactory/hulls/ab1_t1.black"),
        TypeError,
    );
});
