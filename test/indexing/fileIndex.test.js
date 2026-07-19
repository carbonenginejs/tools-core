import assert from "node:assert/strict";
import test from "node:test";
import {
    CjsIndexEntry,
    CjsIndexGroup,
    createPathMatcher,
    parseFileIndex,
    parseFileIndexLine,
} from "../../src/index.js";

test("parses CCP columns into an immutable index entry", () =>
{
    const line = "res:/Graphics/Foo.red,AA/source,0123456789abcdef0123456789abcdef,42,21,1";
    const resource = parseFileIndexLine(line, 7);

    assert.equal(resource instanceof CjsIndexEntry, true);
    assert.equal(resource.logicalPath, "res:/graphics/foo.red");
    assert.equal(resource.sourceLogicalPath, "res:/Graphics/Foo.red");
    assert.equal(resource.prefix, "res");
    assert.equal(resource.relativePath, "graphics/foo.red");
    assert.equal(resource.location, "AA/source");
    assert.equal(resource.checksum, "0123456789abcdef0123456789abcdef");
    assert.equal(resource.uncompressedSize, 42);
    assert.equal(resource.compressedSize, 21);
    assert.equal(resource.binaryOperation, 1);
    assert.equal(resource.storagePath, resource.location);
    assert.equal(resource.md5, resource.checksum);
    assert.equal(resource.size, resource.uncompressedSize);
    assert.equal(resource.appFile, resource.binaryOperation);
    assert.equal(Object.isFrozen(resource), true);
    assert.equal(Object.isFrozen(resource.columns), true);
});

test("retains one complete index group without reordering its entries", () =>
{
    const text = [
        "res:/z.red,aa/z",
        "res:/a.red,bb/a",
    ].join("\n");
    const group = parseFileIndex(text, {
        kind: "resfileindex",
        name: "main",
        root: "res",
        sourceUrl: "https://indexes.test/main",
    });

    assert.equal(group instanceof CjsIndexGroup, true);
    assert.equal(group.rawText, text);
    assert.deepEqual(group.entries.map((resource) => resource.logicalPath), [
        "res:/z.red",
        "res:/a.red",
    ]);
    assert.equal(group.Find("A.RED").location, "bb/a");
    assert.equal(Object.isFrozen(group), true);
    assert.equal(Object.isFrozen(group.entries), true);
});

test("matches exact, wildcard, and regular-expression logical paths", () =>
{
    const exact = createPathMatcher("graphics/foo.red", { type: "exact" });
    const wildcard = createPathMatcher("graphics/*.red");
    const regex = createPathMatcher("^res:/graphics/.+\\.dds$", { type: "regex" });

    assert.equal(exact("res:/graphics/foo.red"), true);
    assert.equal(wildcard("res:/graphics/sub/foo.red"), true);
    assert.equal(wildcard("res:/graphics/sub/foo.dds"), false);
    assert.equal(regex("res:/graphics/foo.dds"), true);
    assert.equal(regex("res:/graphics/foo.red"), false);
});
