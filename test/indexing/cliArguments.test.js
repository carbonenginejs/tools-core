import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "../../src/indexing/cli/parseArguments.js";

test("accepts colon, equals, and separate CLI option values", () =>
{
    const args = parseArguments([
        "--profile-file:profiles.json",
        "--target:frontier",
        "--build=latest",
        "--all",
        "--audio-individual-media",
        "--res",
        "staticdata/types.bin",
        "--out:D:\\source-files",
    ]);

    assert.deepEqual(args, {
        _: [],
        target: "frontier",
        profileFile: "profiles.json",
        build: "latest",
        res: "staticdata/types.bin",
        out: "D:\\source-files",
        all: true,
        audioIndividualMedia: true,
    });
});
