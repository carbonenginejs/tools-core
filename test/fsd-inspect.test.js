import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolFsdInspectReader } from "../src/fsd/index.js";

test("inspects synthetic modern FSD64 bytes without claiming a record schema", () =>
{
    const schemaID = "0123456789abcdef0123456789abcdef0123456789abcdef";
    const bytes = CreateContainer(192, schemaID);
    const view = new DataView(bytes.buffer);
    const root = 32;
    const stringOffset = 128;

    SetUint64(view, root, stringOffset - root);
    SetString(bytes, view, stringOffset, "character/example");

    const reader = new CjsToolFsdInspectReader({
        path: "res:/staticdata/example.fsdbinary",
    });
    const result = reader.Read(bytes);

    assert.equal(reader.path, "res:/staticdata/example.fsdbinary");
    assert.equal(result.schemaID, schemaID);
    assert.deepEqual(result.rootFields[0], {
        asAbsoluteOffset: stringOffset,
        asString: "character/example",
        offset: root,
        relativeOffset: 0,
        uint64: stringOffset - root,
    });
    assert.equal(result.strings[0].value, "character/example");
});

function CreateContainer(size, schemaID)
{
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);

    for (let index = 0; index < schemaID.length / 2; index++)
    {
        bytes[index] = Number.parseInt(schemaID.slice(index * 2, index * 2 + 2), 16);
    }

    SetUint64(view, 24, size - 32);
    return bytes;
}

function SetString(bytes, view, dataOffset, value)
{
    const encoded = new TextEncoder().encode(value);

    SetUint64(view, dataOffset - 8, encoded.byteLength);
    bytes.set(encoded, dataOffset);
}

function SetUint64(view, offset, value)
{
    view.setBigUint64(offset, BigInt(value), true);
}
