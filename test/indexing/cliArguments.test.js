import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "../../src/indexing/cli/parseArguments.js";

test("accepts colon, equals, and separate CLI option values", () =>
{
    const args = parseArguments([
        "--provider:ccp",
        "--game:Frontier",
        "--target:frontier",
        "--build=latest",
        "--all",
        "--res",
        "staticdata/types.bin",
        "--out:D:\\source-files",
    ]);

    assert.deepEqual(args, {
        _: [],
        target: "frontier",
        game: "Frontier",
        provider: "ccp",
        build: "latest",
        res: "staticdata/types.bin",
        out: "D:\\source-files",
        all: true,
    });
});
