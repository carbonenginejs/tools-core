import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolSdeLocalizationTable } from "../src/sde/build/CjsToolSdeLocalizationTable.js";

test("indexes the client localization pickle without treating it as FSD", () =>
{
    const table = CjsToolSdeLocalizationTable.fromBytes(new TextEncoder().encode(
        "(S'en-us'\np1\n(dp2\n"
        + "I105320\n(VRifter\nNNtp3\ns"
        + "I93841\n(VThe Rifter is a very powerful combat frigate\nNNtp4\ns"
        + "I999999\n(VCaldari \\u2013 Navy\nNNtp5\ns"
    ));

    assert.equal(table.size, 3);
    assert.equal(table.Get(105320), "Rifter");
    assert.equal(table.Get(999999), "Caldari \u2013 Navy");
    assert.equal(table.Get(1), null);
    assert.deepEqual(table.Missing([ 105320, 1, 2 ]), [ 1, 2 ]);
});

test("normalizes export text and rejects unrelated pickle shapes", () =>
{
    assert.equal(CjsToolSdeLocalizationTable.normalize("line one\r\nline two  "), "line one\nline two");
    assert.equal(CjsToolSdeLocalizationTable.normalize("  "), null);
    assert.throws(
        () => CjsToolSdeLocalizationTable.fromBytes(new TextEncoder().encode("not a pickle at all")),
        error => error.code === "CJS_SDE_LOCALIZATION_EMPTY",
    );
});
