import test from "node:test";
import assert from "node:assert/strict";

import {
    isExactBuild,
    normalizeExactBuild,
    normalizeExactBuildNumber,
    optionalString,
    requireObject,
} from "../src/utils.js";
import * as publicTools from "../src/index.js";

test("exports shared tools-core utilities without a utility class", () =>
{
    assert.equal(publicTools.normalizeExactBuild, normalizeExactBuild);
    assert.equal(publicTools.CjsToolUtils, undefined);
});

test("normalizes exact string and numeric build identities", () =>
{
    assert.equal(isExactBuild(" 3435006 "), true);
    assert.equal(isExactBuild("latest"), false);
    assert.equal(normalizeExactBuild(" 3435006 "), "3435006");
    assert.equal(normalizeExactBuildNumber("3435006"), 3435006);
    assert.throws(() => normalizeExactBuild("latest"), /Invalid exact build/u);
    assert.throws(() => normalizeExactBuildNumber(-1), /Invalid exact build/u);
});

test("shares object and optional-string normalization contracts", () =>
{
    const value = { id: 1 };

    assert.equal(requireObject(value, "Value"), value);
    assert.throws(() => requireObject([], "Value"), /Value must be an object/u);
    assert.equal(optionalString(undefined), null);
    assert.equal(optionalString(""), null);
    assert.equal(optionalString(12), "12");
});
