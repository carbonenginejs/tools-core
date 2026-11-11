import assert from "node:assert/strict";
import test from "node:test";

import { CjsCharacterLibraryBuilder } from "@carbonenginejs/runtime/character";
import * as rootApi from "../src/index.js";
import * as characterApi from "../src/character/index.js";

test("the character subpath is the runtime builder's wrapper, the target policy and the repository", () =>
{
    assert.deepEqual(Object.keys(characterApi).sort(), [ "CjsToolCharacter", "CjsToolCharacterBuilder", "CjsToolCharacterRepository" ]);
    assert.ok(characterApi.CjsToolCharacterBuilder.prototype instanceof CjsCharacterLibraryBuilder, "it wraps the runtime builder, as audio does");
    assert.equal(rootApi.CjsToolCharacter, undefined);
    assert.equal(rootApi.CjsToolCharacterBuilder, undefined);
});

test("builds reject a target without a character library", async () =>
{
    const character = new characterApi.CjsToolCharacter();
    assert.equal(character.ResolveTarget({ target: "eve" }).id, "eve");
    await assert.rejects(character.Build({ target: "frontier" }), /does not support target frontier/u);
});
