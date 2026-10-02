import assert from "node:assert/strict";
import test from "node:test";
import { deriveExpectedFields, parseClassFile, renderClassFile } from "../src/schema/core/classTool.js";

test("resource semantics survive C++ and Black string storage without changing authored defaults", () =>
{
    for (const [cppType, wireType] of [["std::string", null], ["BlueSharedString", "stringRef"], ["std::wstring", "wstringRef"]])
    {
        const doc = { blueClass: "Tr2Mesh", cppClass: "Tr2Mesh", attributes: [{
            blueName: "geometryResPath", member: "m_geometryResPath", cppType,
            flags: ["READWRITE", "PERSIST", "NOTIFY"],
            default: { kind: "string", json: "Res:/Authored/Mixed.GR2" },
            ...(wireType ? { black: { wireType, cppType } } : {})
        }] };
        const before = structuredClone(doc);
        const expected = deriveExpectedFields(doc);
        const field = expected.fields[0];
        assert.equal(field.kind, "path");
        assert.equal(field.cppType, cppType);
        assert.equal(field.default.value, "Res:/Authored/Mixed.GR2");
        const emitted = renderClassFile(expected, { js: true, doc });
        assert.match(emitted, /@meta\.type\.path/);
        assert.match(emitted, /@meta\.blue\.notify/);
        assert.match(emitted, /@meta\.blue\.persist/);
        assert.equal(parseClassFile(emitted).fields[0].kind, "path");
        assert.deepEqual(doc, before, "projection cannot rewrite source wire/default evidence");
    }
});

test("resource classification uses declaration owner and exposed name, including inherited accessors", () =>
{
    const doc = { blueClass: "ChildMesh", cppClass: "ChildMesh", attributes: [{
        blueName: "geometryResPath", member: "m_nativeGeometryName", cppType: "std::string",
        declaredOn: "Tr2Mesh", flags: ["PERSIST"]
    }], properties: [{
        blueName: "resourcePath", getter: "GetResourcePath", cppType: "std::string",
        declaredOn: "TriTextureParameter", flags: ["READWRITE"]
    }] };
    const fields = deriveExpectedFields(doc, { includeInherited: true }).fields;
    assert.deepEqual(fields.map(({ name, kind }) => [name, kind]), [
        ["geometryResPath", "path"], ["resourcePath", "path"]
    ]);
    const unrelated = deriveExpectedFields({ blueClass: "Unrelated", attributes: [
        { blueName: "geometryResPath", cppType: "std::string" },
        { blueName: "texturePath", cppType: "std::string" }
    ] });
    assert.deepEqual(unrelated.fields.map(f => f.kind), ["string", "string"]);
});

test("logical paths, relative fragments, unknown members and non-string storage keep their types", () =>
{
    for (const [owner, member, cppType, kind] of [
        ["AudSettings", "essentialPath", "std::string", "string"],
        ["Tr2ActionAnimateValue", "path", "std::string", "string"],
        ["Tr2DynamicBinding", "sourceObjectPath", "std::string", "string"],
        ["CjsCharacterPartMetadata", "alternativeTextureSourcePath", "std::string", "string"],
        ["Tr2Mesh", "unknownPath", "std::string", "string"],
        ["Tr2Mesh", "geometryResPath", "uint32_t", "uint32"]
    ])
    {
        const expected = deriveExpectedFields({ blueClass: owner, attributes: [{ blueName: member, cppType }] });
        assert.equal(expected.fields[0].kind, kind, `${owner}.${member}`);
    }
});
