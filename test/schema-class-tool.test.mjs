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

test("emitted math fields import the combined runtime math subpath", () =>
{
    const doc = {
        family: "trinityCore",
        blueClass: "CjsGeneratedVectorHolder",
        cppClass: "CjsGeneratedVectorHolder",
        blue: { isExposed: true },
        attributes: [{
            name: "position",
            member: "m_position",
            cppType: "Vector3",
            beType: "FLOATARRAY",
            wireType: "floatArray",
            length: 3,
            flags: [ "READWRITE" ],
        }],
        fields: [],
        methods: [],
    };
    const source = renderClassFile(deriveExpectedFields(doc), { doc, js: true });

    assert.match(source, /from "@carbonenginejs\/runtime\/math\/vec3";/);
    assert.doesNotMatch(source, /from "@carbonenginejs\/runtime\/vec3";/);
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

test("the define metadata is read from the decorator and from the call form alike", () =>
{
    // Both spellings exist in the runtime. The abstraction layer is imported
    // straight from source by its own tests, and raw Node cannot parse decorator
    // syntax, so those files declare through CjsSchema.define instead. A parser
    // that reads only the decorator sees the whole layer as undeclared.
    const decorated = parseClassFile([
        "import { type } from \"#schema\";",
        "@type.define({ className: \"Tr2Thing\", family: \"trinity\" })",
        "export class Tr2Thing {}"
    ].join("\n"));

    assert.equal(decorated.define.className, "Tr2Thing");
    assert.equal(decorated.define.family, "trinity");

    const called = parseClassFile([
        "export class Tr2TextureALStub {}",
        "CjsSchema.define(Tr2TextureALStub, { className: \"Tr2TextureALStub\", family: \"trinityal\" });"
    ].join("\n"));

    assert.equal(called.define.className, "Tr2TextureALStub");
    assert.equal(called.define.family, "trinityal");
});

test("a declared donor is read, and a qualified one keeps only its class", () =>
{
    // Carbon compiles ONE backend, so its stub and metal classes are both
    // TrinityALImpl::Tr2TextureAL. We ship every backend together, so the
    // suffix moves onto the JS class name and `carbon:` names the donor the
    // schema lookup should follow.
    const suffixed = parseClassFile([
        "export class Tr2TextureALStub {}",
        "CjsSchema.define(Tr2TextureALStub, { className: \"Tr2TextureALStub\", carbon: \"Tr2TextureAL\" });"
    ].join("\n"));

    assert.equal(suffixed.define.className, "Tr2TextureALStub");
    assert.equal(suffixed.define.carbon, "Tr2TextureAL");
    assert.equal(suffixed.define.modelledOn, null);

    const qualified = parseClassFile([
        "@type.define({ className: \"CjsBitmapDimensions\", carbon: \"ImageIO::BitmapDimensions\" })",
        "export class CjsBitmapDimensions {}"
    ].join("\n"));

    assert.equal(qualified.define.carbon, "BitmapDimensions");
});

test("modelledOn is read separately, because it is the opposite claim", () =>
{
    // `carbon:` says this class IS that donor under another name. `modelledOn:`
    // says it deliberately does NOT replicate it, so nothing should compare the
    // two surfaces. Collapsing them would make a declined port look like a
    // failed one.
    const parsed = parseClassFile([
        "@type.define({ className: \"CjsWebgpuWorkQueue\", modelledOn: \"MetalWorkQueue\" })",
        "export class CjsWebgpuWorkQueue {}"
    ].join("\n"));

    assert.equal(parsed.define.modelledOn, "MetalWorkQueue");
    assert.equal(parsed.define.carbon, null);
});

test("a class with no define reports null metadata rather than throwing", () =>
{
    const parsed = parseClassFile("export class Plain {}");

    assert.equal(parsed.define.className, null);
    assert.equal(parsed.define.carbon, null);
    assert.equal(parsed.define.modelledOn, null);
});

function MakeEditFlagDoc()
{
    return {
        family: "audio",
        blueClass: "AudEmitter",
        cppClass: "AudEmitter",
        attributes: [
            { blueName: "persisted", member: "m_persisted", cppType: "float", flags: ["PERSIST"], default: { json: 0 } },
            { blueName: "edited", member: "m_edited", cppType: "float", flags: ["READWRITE", "PERSIST", "NOTIFY"], default: { json: 0 } },
            { blueName: "stored", member: "m_stored", cppType: "float", flags: ["PERSISTONLY"], default: { json: 0 } }
        ]
    };
}

test("expected edit flags are Carbon's exact set: PERSIST implies no access", () =>
{
    const expected = deriveExpectedFields(MakeEditFlagDoc());
    const byName = Object.fromEntries(expected.fields.map(field => [ field.name, field ]));

    assert.deepEqual(byName.persisted.editFlags, [ "PERSIST" ]);
    assert.deepEqual(byName.persisted.ioDecorators, [ "persist" ]);
    assert.deepEqual(byName.edited.editFlags, [ "READ", "WRITE", "NOTIFY", "PERSIST" ]);
    assert.deepEqual(byName.edited.ioDecorators, [ "readwrite", "persist" ]);
    assert.equal(byName.edited.notify, true);
    assert.deepEqual(byName.stored.editFlags, [ "HIDDEN", "PERSIST" ]);
    assert.deepEqual(byName.stored.ioDecorators, [ "persistOnly" ]);
});

test("edit flags are compared as a set, reporting missing and extra flags", () =>
{
    const expected = deriveExpectedFields(MakeEditFlagDoc());
    const result = compareClass(expected, parseClassFile(`
        @type.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @edit.readwrite
            @edit.persist
            @type.float32
            persisted = 0;

            @edit.notify
            @edit.persist
            @type.float32
            edited = 0;

            @edit.persistOnly
            @type.float32
            stored = 0;
        }
    `));
    const notes = Object.fromEntries(result.fields.map(field => [ field.name, (field.notes || []).join("; ") ]));

    assert.match(notes.persisted, /edit-flags differ \(extra READ, WRITE\)/u);
    assert.match(notes.edited, /edit-flags differ \(missing READ, WRITE\)/u);
    assert.doesNotMatch(notes.stored, /edit-flags differ/u);
    assert.equal(result.summary.missingIoFlag, 2);
});

test("emitted classes carry the decorators for the exact flag set", () =>
{
    const doc = MakeEditFlagDoc();
    const source = renderClassFile(deriveExpectedFields(doc), { doc, js: true });

    assert.match(source, /@edit\.persist\n  @type\.float32\n  persisted/u);
    assert.match(source, /@edit\.notify\n  @edit\.readwrite\n  @edit\.persist\n  @type\.float32\n  edited/u);
    assert.match(source, /@edit\.persistOnly\n  @type\.float32\n  stored/u);
});
