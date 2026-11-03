import assert from "node:assert/strict";
import { test } from "node:test";
import { findBareFields } from "../scripts/lint-field-initializers.js";

test("a class field with no initializer is reported, public, private or static", () =>
{
    const hits = findBareFields("class A { #cache; name; static all; ok = null; count = 0; }", "src/A.js");
    assert.deepEqual(hits.map(hit => hit.split(" ")[1]), [ "#cache", "name", "all" ]);
});

test("fields with defaults, methods and accessors pass", () =>
{
    assert.deepEqual(findBareFields("class A { #cache = null; label = ''; get x() { return 1; } Run() {} }", "src/A.js"), []);
});
