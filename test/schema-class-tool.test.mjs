import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    compareClass,
    deriveExpectedFields,
    parseClassFile,
    renderClassFile
} from "../src/schema/core/classTool.js";

function WriteSchema(root, family, name, doc)
{
    const directory = path.join(root, family);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(doc), "utf8");
}

function MakeAttributeDoc()
{
    return {
        family: "audio",
        blueClass: "AudEmitter",
        cppClass: "AudEmitter",
        attributes: [
            {
                blueName: "rotation",
                member: "m_authoredRotation",
                cppType: "Quaternion",
                declaredOn: "AudGameObjResource",
                flags: ["READWRITE", "PERSIST", "NOTIFY"],
                default: { json: [0, 0, 0, 1] }
            }
        ]
    };
}

function MakeExpectedMethods()
{
    return {
        fields: [],
        methods: [
            {
                name: "SetPlacement",
                blueName: "SetPlacement",
                target: "SetPosition",
                declaredOn: null,
                macro: "MAP_METHOD_AND_WRAP"
            }
        ],
        fallback: null,
        meta: {
            className: "AudEmitter",
            cppClass: "AudEmitter",
            family: "audio"
        }
    };
}

test("cross-owner attributes stay required when the storage owner does not expose them", (t) =>
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "carbon-class-owner-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    WriteSchema(root, "audio", "AudGameObjResource", {
        family: "audio",
        blueClass: "AudGameObjResource",
        cppClass: "AudGameObjResource",
        attributes: []
    });

    const expected = deriveExpectedFields(MakeAttributeDoc(), {
        schemaRoot: root,
        family: "audio"
    });

    assert.deepEqual(expected.fields.map(field => field.name), ["rotation"]);
    assert.equal(expected.meta.inheritedSkipped, 0);
});

test("inherited attributes stay on their exposed runtime base by default", (t) =>
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "carbon-class-owner-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    WriteSchema(root, "audio", "AudGameObjResource", {
        family: "audio",
        blueClass: "AudGameObjResource",
        cppClass: "AudGameObjResource",
        attributes: [
            {
                blueName: "rotation",
                member: "m_authoredRotation",
                cppType: "Quaternion"
            }
        ]
    });

    const expected = deriveExpectedFields(MakeAttributeDoc(), {
        schemaRoot: root,
        family: "audio"
    });

    assert.deepEqual(expected.fields, []);
    assert.equal(expected.meta.inheritedSkipped, 1);
});

test("embedded-struct leaves resolve through docs declared in another family", (t) =>
{
    // The eve smart lights persist m_lightGroupData.* while LightData's schema
    // doc lives in the lights family: leaf type and constructor default must
    // come from the sibling family dir, not fall back to zero.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "carbon-class-cross-family-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    WriteSchema(root, "structs", "LightData", {
        family: "structs",
        blueClass: "LightData",
        cppClass: "LightData",
        blue: { isExposed: false },
        bases: [],
        fields: [
            { cppName: "brightness", cppType: "float", default: { cpp: "1.0f", json: 1, kind: "number" } },
            { cppName: "flags", cppType: "uint16_t", default: { cpp: "1", json: 1, kind: "number" } }
        ]
    });

    const expected = deriveExpectedFields({
        family: "smartLights",
        blueClass: "FixtureSmartLight",
        cppClass: "FixtureSmartLight",
        attributes: [
            {
                blueName: "brightness",
                member: "m_lightGroupData.brightness",
                flags: ["READWRITE", "PERSIST"],
                black: { cppType: "LightData", wireType: "inlineObject" }
            },
            {
                blueName: "flags",
                member: "m_lightGroupData.flags",
                flags: ["READWRITE", "PERSIST"],
                black: { cppType: "LightData", wireType: "inlineObject" }
            }
        ]
    }, {
        schemaRoot: root,
        family: "smartLights"
    });

    assert.deepEqual(expected.fields.map(field => field.name), ["brightness", "flags"]);
    const brightness = expected.fields[0];
    assert.equal(brightness.kind, "float32");
    assert.equal(brightness.cppType, "float");
    assert.equal(brightness.default?.value, 1);
    const flags = expected.fields[1];
    assert.equal(flags.kind, "uint16");
    assert.equal(flags.cppType, "uint16_t");
    assert.equal(flags.default?.value, 1);
});

test("readonly Blue properties are projected into readonly runtime fields", () =>
{
    const expected = deriveExpectedFields({
        family: "audio",
        blueClass: "AudEmitter",
        cppClass: "AudEmitter",
        properties: [
            {
                blueName: "front",
                getter: "GetFront",
                readOnly: true,
                cppType: "Vector3"
            }
        ]
    });

    assert.equal(expected.fields.length, 1);
    assert.equal(expected.fields[0].name, "front");
    assert.equal(expected.fields[0].kind, "vec3");
    assert.equal(expected.fields[0].io, "read");
});

test("reviewed native decal fields are merged with Blue attributes without exposing other native state", () =>
{
    const expected = deriveExpectedFields({
        family: "eve",
        blueClass: "EveSpaceObjectDecal",
        cppClass: "EveSpaceObjectDecal",
        blue: { isExposed: true },
        attributes: [
            {
                blueName: "name",
                member: "m_name",
                cppType: "std::string",
                flags: ["READWRITE", "PERSIST"]
            }
        ],
        fields: [
            { cppName: "m_name", cppType: "std::string" },
            { cppName: "m_parentData", cppType: "IEveSpaceObject2::ParentData" },
            { cppName: "m_parentBoneMatrix", cppType: "Matrix" },
            { cppName: "m_invParentBoneMatrix", cppType: "Matrix" },
            { cppName: "m_vertexDeclarationOverride", cppType: "unsigned int" }
        ],
        methods: []
    });

    assert.deepEqual(expected.fields.map(field => field.name), [
        "name",
        "parentData",
        "parentBoneMatrix",
        "invParentBoneMatrix"
    ]);
    assert.equal(expected.fields.find(field => field.name === "parentData").kind, "rawStruct");
    assert.equal(
        expected.fields.find(field => field.name === "parentData").typeArg,
        "IEveSpaceObject2::ParentData"
    );
    assert.equal(expected.fields.find(field => field.name === "parentBoneMatrix").kind, "mat4");
    assert.equal(expected.fields.some(field => field.member === "m_vertexDeclarationOverride"), false);
    assert.deepEqual(expected.meta.reviewedNativeFields, {
        included: ["m_parentData", "m_parentBoneMatrix", "m_invParentBoneMatrix"],
        missing: []
    });
});

test("emitted decal stubs include all renderable and pickable pure contracts", () =>
{
    const methods = [
        ["GetID", "ITr2Pickable"],
        ["GetPickingBatches", "ITr2Pickable"],
        ["GetBatches", "ITr2Renderable"],
        ["HasTransparentBatches", "ITr2Renderable"],
        ["GetSortValue", "ITr2Renderable"],
        ["GetPerObjectData", "ITr2Renderable"]
    ].map(([target, interfaceName]) => ({
        target,
        declaredOn: interfaceName,
        interface: interfaceName,
        virtual: true,
        pureVirtual: true
    }));
    const doc = {
        family: "eve",
        blueClass: "EveSpaceObjectDecal",
        cppClass: "EveSpaceObjectDecal",
        blue: { isExposed: true },
        attributes: [],
        fields: [],
        methods
    };
    const expected = deriveExpectedFields(doc);
    const source = renderClassFile(expected, { doc, js: true });

    assert.deepEqual(expected.methods.map(method => method.name), methods.map(method => method.target));
    for (const method of methods)
    {
        assert.match(source, new RegExp(`\\n  ${method.target}\\(\\.\\.\\.args\\)`));
        assert.match(source, new RegExp(`${method.interface} contract`));
    }
});

test("emitted classes use schema purposes and retain the deterministic fallback", () =>
{
    const expected = {
        fields: [],
        methods: [],
        meta: {
            className: "Tr2AtlasTexture",
            family: "trinityCore",
            shapeHash: "sha256:1234567890abcdef"
        }
    };
    const purpose = "Describes one named subtexture's resource path, pixel rectangle, and owning atlas dimensions.";
    const source = renderClassFile(expected, {
        doc: { family: "trinityCore", purpose: `  ${purpose}\n` },
        js: true
    });

    assert.ok(source.includes(`/** ${purpose} */`));
    assert.ok(source.includes(`family: "trinityCore", purpose: ${JSON.stringify(purpose)}`));

    const fallback = renderClassFile(expected, { doc: { family: "trinityCore" }, js: true });
    assert.ok(fallback.includes("generated from schema shapeHash 12345678"));
    assert.equal(fallback.includes("purpose:"), false);
    assert.throws(
        () => renderClassFile(expected, { doc: { purpose: "Invalid */ purpose." }, js: true }),
        /cannot close a JSDoc comment/
    );
});

test("renamed Blue methods require Carbon provenance and one implementation status", () =>
{
    const parsed = parseClassFile(`
        @type.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @carbon.renamed("SetPlacement")
            @impl.adapted
            @impl.reason("Web Audio placement seam.")
            SetPlacement()
            {
                return true;
            }
        }
    `);

    const result = compareClass(MakeExpectedMethods(), parsed);
    assert.equal(result.summary.methodMatch, 1);
    assert.equal(result.summary.drift, false);
});

test("method checking distinguishes missing, unexposed, and incomplete methods", () =>
{
    const missing = compareClass(MakeExpectedMethods(), parseClassFile(`
        @type.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
        }
    `));
    assert.equal(missing.summary.missingMethod, 1);
    assert.equal(missing.summary.drift, true);

    const unexposed = compareClass(MakeExpectedMethods(), parseClassFile(`
        @type.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            SetPlacement()
            {
                return true;
            }
        }
    `));
    assert.equal(unexposed.summary.existingUnexposedMethod, 1);

    const incomplete = compareClass(MakeExpectedMethods(), parseClassFile(`
        @type.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @carbon.renamed("SetPlacement")
            @impl.adapted
            SetPlacement()
            {
                return true;
            }
        }
    `));
    assert.equal(incomplete.summary.methodMetadata, 1);
    assert.match(incomplete.methods[0].notes.join(" "), /requires @impl\.reason/);

    const missingStatus = compareClass(MakeExpectedMethods(), parseClassFile(`
        @type.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @carbon.renamed("SetPlacement")
            SetPlacement()
            {
                return true;
            }
        }
    `));
    assert.equal(missingStatus.summary.methodMetadata, 1);
    assert.match(missingStatus.methods[0].notes.join(" "), /exactly one implementation-status/);

    const multipleStatuses = compareClass(MakeExpectedMethods(), parseClassFile(`
        @type.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @carbon.renamed("SetPlacement")
            @impl.implemented
            @impl.notSupported
            SetPlacement()
            {
                return true;
            }
        }
    `));
    assert.equal(multipleStatuses.summary.methodMetadata, 1);
    assert.match(multipleStatuses.methods[0].notes.join(" "), /multiple implementation-status/);
});

test("additional Carbon methods are informative rather than Blue schema drift", () =>
{
    const parsed = parseClassFile(`
        @type.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @carbon.renamed("SetPlacement")
            @impl.implemented
            SetPlacement()
            {
                return true;
            }

            @carbon.method
            @impl.implemented
            GetFront()
            {
                return null;
            }
        }
    `);

    const result = compareClass(MakeExpectedMethods(), parsed);
    assert.equal(result.summary.methodMatch, 1);
    assert.equal(result.summary.additionalCarbonMethod, 1);
    assert.equal(result.summary.drift, false);
});
