import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    buildJsonReport,
    compareClass,
    deriveExpectedFields,
    KNOWN_TYPE_KINDS,
    parseClassFile,
    renderClassFile
} from "../src/schema/core/classTool.js";
import { DEFAULT_FIELD_RESOLUTIONS } from "../src/schema/core/schemaFieldResolutions.js";

test("resource syntax normalizes to an object reference descriptor through type aliases and accessors", () =>
{
    const descriptor = { kind: "objectRef", className: "TriGeometryRes", runtimeOnly: true };
    assert.equal(KNOWN_TYPE_KINDS.has("resource"), false);
    for (const spelling of ["@meta.type.resource(TriGeometryRes)", "@meta.type.resource('TriGeometryRes')",
        '@CjsSchema.type.resource("TriGeometryRes")'])
    {
        const parsed = parseClassFile(`export class Fixture {\n${spelling}\n_geometryRes = null;\n}`);
        const field = parsed.fields[0];
        assert.equal(field.kind, "objectRef");
        assert.deepEqual(field.kinds, ["objectRef"]);
        assert.equal(field.typeArg, "TriGeometryRes");
        assert.deepEqual(field.type, descriptor);
        assert.deepEqual(field.default, { determinate: true, value: null });
    }
    for (const accessor of ["get", "set"])
    {
        const parsed = parseClassFile(`export class Fixture {
            ${accessor === "get" ? "@meta.type.resource(TriGeometryRes)" : ""}
            get geometry() { return this._geometryRes; }
            ${accessor === "set" ? "@meta.type.resource(TriGeometryRes)" : ""}
            set geometry(value) { this._geometryRes = value; }
        }`);
        assert.equal(parsed.fields.length, 1);
        assert.deepEqual(parsed.fields[0].type, descriptor);
        assert.equal(parsed.fields[0].role, "property");
    }
});

test("explicit resource descriptors survive emission and reports without native resource inference", () =>
{
    const native = deriveExpectedFields({ blueClass: "Fixture", cppClass: "Fixture", attributes: [
        { blueName: "geometry", member: "m_geometry", cppType: "TriGeometryResPtr", flags: ["READWRITE", "PERSIST"] }
    ] });
    assert.equal(native.fields[0].kind, "objectRef");
    assert.equal(native.fields[0].type, undefined);
    assert.doesNotMatch(renderClassFile(native, { js: true }), /@meta\.type\.resource/);

    const descriptor = { kind: "objectRef", className: "TriGeometryRes", runtimeOnly: true };
    const expected = { ...native, fields: [{ ...native.fields[0], type: descriptor }] };
    const snapshot = structuredClone(expected);
    const source = renderClassFile(expected, { js: true });
    assert.match(source, /@meta\.type\.resource\("TriGeometryRes"\)/);
    assert.deepEqual(expected, snapshot, "canonical projection does not mutate an explicit input record");
    const parsed = parseClassFile(source);
    const result = compareClass(expected, parsed, { strict: true });
    assert.equal(result.summary.drift, false);
    const report = JSON.parse(JSON.stringify(buildJsonReport(result)));
    assert.deepEqual(report.fields[0].expected.type, descriptor);
    assert.deepEqual(report.fields[0].actual.type, descriptor);
    assert.equal(report.fields[0].expected.typeArg, "TriGeometryRes");

    const ordinary = { ...native, fields: [{ ...native.fields[0], type: { ...descriptor, runtimeOnly: false } }] };
    const ordinarySource = renderClassFile(ordinary, { js: true });
    assert.match(ordinarySource, /@meta\.type\.objectRef\("TriGeometryRes"\)/);
    assert.equal(compareClass(ordinary, parseClassFile(ordinarySource), { strict: true }).summary.drift, false);
});

test("resource comparisons reject marker loss, accidental runtime-only references and missing class identity", () =>
{
    const native = deriveExpectedFields({ blueClass: "Fixture", cppClass: "Fixture", attributes: [
        { blueName: "geometry", cppType: "TriGeometryResPtr", flags: ["HIDDEN", "PERSIST"] }
    ] });
    const expected = { ...native, fields: [{ ...native.fields[0],
        type: { kind: "objectRef", className: "TriGeometryRes", runtimeOnly: true } }] };
    const source = renderClassFile(expected, { js: true });
    for (const strict of [false, true])
    {
        const lost = compareClass(expected, parseClassFile(source.replace("@meta.type.resource", "@meta.type.objectRef")), { strict });
        assert.equal(lost.summary.typeMismatch, 1);
        assert.equal(lost.summary.drift, true);
        assert.match(lost.fields[0].notes.join(" "), /runtime-only reference differs/);
        const added = compareClass(native, parseClassFile(source), { strict });
        assert.equal(added.summary.typeMismatch, 1);
        assert.equal(added.summary.drift, true);
        const missing = compareClass(expected, parseClassFile(source.replace('resource("TriGeometryRes")', "resource(null)")), { strict });
        assert.equal(missing.summary.typeMismatch, 1);
        assert.match(missing.fields[0].notes.join(" "), /reference class missing/);
        const wrong = compareClass(expected, parseClassFile(source.replace('resource("TriGeometryRes")', 'resource("TriTextureRes")')), { strict });
        assert.equal(wrong.summary.typeMismatch, 1);
    }
});

test("verified structure collections require an item descriptor while ordinary collections retain their policy", () =>
{
    const structure = DEFAULT_FIELD_RESOLUTIONS.Tr2Effect.constParameters.wire.structure;
    for (const kind of ["list", "array"])
    {
        const expected = deriveExpectedFields({ blueClass: "Fixture", cppClass: "Fixture",
            attributes: [{ blueName: "items", black: { wireType: "container", container: kind, structure } }] });
        const source = renderClassFile(expected, { js: true });
        const broken = source.replace(JSON.stringify(expected.fields[0].typeArg), "null");
        const parsed = parseClassFile(broken);
        assert.equal(parsed.fields[0].typeArg, null);
        assert.deepEqual(parsed.fields[0].structure, structure);
        for (const strict of [false, true])
        {
            const result = compareClass(expected, parsed, { strict });
            assert.equal(result.summary.typeMismatch, 1);
            assert.equal(result.summary.drift, true);
            assert.match(result.fields[0].notes.join(" "), /structure collection item type missing/);
        }
        const ordinary = deriveExpectedFields({ blueClass: "Fixture", cppClass: "Fixture",
            attributes: [{ blueName: "items", cppType: "std::vector<ChildPtr>" }] });
        ordinary.fields[0].kind = kind;
        const unspecified = renderClassFile(ordinary, { js: true }).replace(`${kind}("Child")`, `${kind}(null)`);
        assert.equal(compareClass(ordinary, parseClassFile(unspecified), { strict: true }).summary.drift, false);
    }
});

test("verified raw layouts survive both schema inputs and list/array decorator round trips", () =>
{
    for (const [className, name] of [["Tr2Effect", "options"], ["Tr2Effect", "constParameters"],
        ["Tr2CurveScalar", "keys"], ["Tr2CurveQuaternion", "keys"]])
    {
        const structure = DEFAULT_FIELD_RESOLUTIONS[className][name].wire.structure;
        for (const attributes of [false, true])
        {
            const black = { names: { [name]: ["name"], [`m_${name}`]: ["member"] },
                cppType: `${structure.name}StructureList`, wireType: "container", container: "list",
                structure, flags: ["READWRITE", "PERSIST"] };
            const doc = { blueClass: className, cppClass: className,
                ...(attributes ? { attributes: [{ blueName: name, member: `m_${name}`, black }] }
                    : { black: { fields: [black] } }) };
            const expected = deriveExpectedFields(doc);
            assert.equal(expected.fields[0].kind, "list");
            assert.deepEqual(expected.fields[0].typeArg, { kind: "rawStruct", className: structure.name });
            assert.deepEqual(expected.fields[0].structure, structure);
            for (const kind of ["list", "array"])
            {
                expected.fields[0].kind = kind;
                const source = renderClassFile(expected, { js: true });
                const parsed = parseClassFile(source);
                assert.deepEqual(parsed.fields[0].structure, structure);
                assert.equal(compareClass(expected, parsed, { strict: true }).summary.drift, false);
                assert.deepEqual(compareClass(expected, parsed).fields[0].expected.structure, structure);
                assert.deepEqual(compareClass(expected, parsed).fields[0].actual.structure, structure);
                assert.equal(compareClass(expected, parseClassFile(source.replaceAll("@meta.type.", "@meta.type.")), { strict: true }).summary.drift, false);

                const options = `, ${JSON.stringify({ structure })}`;
                assert.equal(compareClass(expected, parseClassFile(source.replace(options, `, { structure: ${JSON.stringify(structure)} }`)), { strict: true }).summary.drift, false);
                const missing = compareClass(expected, parseClassFile(source.replace(options, "")), { strict: true });
                assert.equal(missing.summary.typeMismatch, 1);
                assert.match(missing.fields[0].notes.join(" "), /layout missing/);
                for (const mutate of [
                    value => { value.size += 8; },
                    value => { value.members[0].offset += 1; },
                    value => { value.members[0].type = "uint8"; },
                    value => { value.members.reverse(); },
                    value => { value.name += "Other"; }
                ])
                {
                    const changed = structuredClone(structure);
                    mutate(changed);
                    const result = compareClass(expected, parseClassFile(source.replace(options, `, ${JSON.stringify({ structure: changed })}`)));
                    assert.equal(result.summary.typeMismatch, 1);
                    assert.match(result.fields[0].notes.join(" "), /layout differs/);
                }
                const reordered = { members: structure.members.map(member => ({ type: member.type, offset: member.offset, name: member.name })),
                    size: structure.size, name: structure.name };
                assert.equal(compareClass(expected, parseClassFile(source.replace(options, `, ${JSON.stringify({ structure: reordered })}`)), { strict: true }).summary.drift, false);
            }
        }
    }
});

test("ordinary reference collections retain one argument without an inferred native layout", () =>
{
    const expected = deriveExpectedFields({ blueClass: "Fixture", cppClass: "Fixture",
        attributes: [{ blueName: "children", cppType: "std::vector<ChildPtr>", black: { wireType: "container", container: "list" } }] });
    assert.equal(expected.fields[0].structure, undefined);
    const source = renderClassFile(expected, { js: true });
    assert.match(source, /@meta\.type\.list\("Child"\)/);
    assert.doesNotMatch(source, /rawStruct|structure/);
    assert.equal(compareClass(expected, parseClassFile(source), { strict: true }).summary.drift, false);
    const layout = DEFAULT_FIELD_RESOLUTIONS.Tr2Effect.options.wire.structure;
    const explicitArray = deriveExpectedFields({ blueClass: "Fixture", cppClass: "Fixture",
        attributes: [{ blueName: "items", black: { wireType: "container", container: "array", structure: layout } }] });
    assert.equal(explicitArray.fields[0].kind, "array");
    assert.deepEqual(explicitArray.fields[0].structure, layout);
    const extra = source.replace('list("Child")', `list("Child", ${JSON.stringify({ structure: layout })})`);
    const result = compareClass(expected, parseClassFile(extra));
    assert.equal(result.summary.typeMismatch, 1);
    assert.match(result.fields[0].notes.join(" "), /not declared by schema/);
});

test("embedded color curves retain their allocated destinations in both schema forms", () =>
{
    // Tr2CurveColor.h:40-43, Tr2CurveColor.cpp:10-18 and its Blue IROOT entries.
    const fields = ["r", "g", "b", "a"].map(name => ({
        names: { [name]: ["name"], [`m_${name}`]: ["member"] },
        cppType: "PTr2CurveScalar", beType: "IROOT", wireType: "inlineObject",
        flags: ["READWRITE", "PERSIST"]
    }));
    for (const attributes of [false, true])
    {
        const doc = {
            family: "curves", blueClass: "Tr2CurveColor", cppClass: "Tr2CurveColor",
            ...(attributes ? { attributes: fields.map((black, index) => ({
                blueName: ["r", "g", "b", "a"][index], member: `m_${["r", "g", "b", "a"][index]}`,
                cppType: black.cppType, black
            })) } : { black: { fields } })
        };
        const expected = deriveExpectedFields(doc);
        assert.equal(expected.fields.length, 4);
        for (const field of expected.fields)
        {
            assert.equal(field.kind, "struct");
            assert.equal(field.typeArg, "Tr2CurveScalar");
            assert.deepEqual(field.default.value, { __factory: "Tr2CurveScalar" });
        }
        const source = renderClassFile(expected, { doc, js: true });
        assert.match(source, /import \{ Tr2CurveScalar \} from "\.\/Tr2CurveScalar\.js"/);
        assert.equal((source.match(/= new Tr2CurveScalar\(\);/g) || []).length, 4);
        assert.equal(compareClass(expected, parseClassFile(source), { strict: true }).summary.drift, false);
        const missingStorage = source.replaceAll("new Tr2CurveScalar()", "null");
        assert.equal(compareClass(expected, parseClassFile(missingStorage), { strict: true }).summary.drift, true);
    }
});

test("source-proven parameter dictionary and effect resource alias retain reference descriptors", () =>
{
    // Tr2MaterialParameterStore.h:55 and Tr2Effect.h:178-179.
    const cases = [
        ["Tr2MaterialParameterStore", "parameters", "PITriEffectParameterDict", "dict", "map", "ITriEffectParameter"],
        ["Tr2Effect", "resources", "EffectResourceList", "list", "list", "ITriEffectResourceParameter"]
    ];
    for (const [className, name, cppType, container, kind, itemClass] of cases)
    {
        for (const attributes of [false, true])
        {
            const black = { names: { [name]: ["name"], [`m_${name}`]: ["member"] },
                cppType, container, beType: "IROOT", wireType: "container", flags: ["READWRITE", "PERSIST"] };
            const doc = { family: "shader", blueClass: className, cppClass: className,
                ...(attributes ? { attributes: [{ blueName: name, member: `m_${name}`, cppType, black }] }
                    : { black: { fields: [black] } }) };
            const expected = deriveExpectedFields(doc);
            const descriptor = { kind: "objectRef", className: itemClass };
            assert.equal(expected.fields[0].kind, kind);
            assert.deepEqual(expected.fields[0].typeArg, descriptor);
            const source = renderClassFile(expected, { doc, js: true });
            const parsed = parseClassFile(source);
            assert.deepEqual(parsed.fields[0].typeArg, descriptor);
            assert.equal(compareClass(expected, parsed, { strict: true }).summary.drift, false);
            const wrongKind = source.replace('"kind":"objectRef"', '"kind":"struct"');
            assert.equal(compareClass(expected, parseClassFile(wrongKind)).summary.typeMismatch, 1);
            const shorthand = source.replace(JSON.stringify(descriptor), JSON.stringify(itemClass));
            assert.equal(compareClass(expected, parseClassFile(shorthand), { strict: true }).summary.drift, false);
        }
    }
    const unrelated = deriveExpectedFields({ blueClass: "Other", cppClass: "Other",
        attributes: [{ blueName: "resources", cppType: "EffectResourceList" }] });
    assert.notDeepEqual(unrelated.fields[0].typeArg, { kind: "objectRef", className: "ITriEffectResourceParameter" });
    const unresolved = deriveExpectedFields({ blueClass: "Other", cppClass: "Other",
        attributes: [{ blueName: "entries", cppType: "PUnreviewedDict",
            black: { wireType: "container", container: "dict" } }] });
    assert.equal(unresolved.fields[0].kind, "map");
    assert.equal(unresolved.fields[0].typeArg, null);
});

test("descriptor parsing and comparison preserve nested data and ignore key order", () =>
{
    const expected = deriveExpectedFields({ blueClass: "Fixture", cppClass: "Fixture",
        attributes: [{ blueName: "items", cppType: "std::vector<ThingPtr>" }] });
    expected.fields[0].typeArg = { kind: "list", itemType: { kind: "weakRef", className: "Thing" } };
    const source = renderClassFile(expected, { js: true });
    const literal = JSON.stringify(expected.fields[0].typeArg);
    const reordered = source.replace(literal, "{ itemType: { className: Thing, kind: 'weakRef' }, kind: 'list' }");
    assert.deepEqual(parseClassFile(reordered).fields[0].typeArg, expected.fields[0].typeArg);
    assert.equal(compareClass(expected, parseClassFile(reordered), { strict: true }).summary.drift, false);
    assert.equal(compareClass(expected, parseClassFile(reordered.replace("'weakRef'", "'objectRef'"))).summary.typeMismatch, 1);
    assert.equal(compareClass(expected, parseClassFile(reordered.replace("className: Thing", "className: Other"))).summary.typeMismatch, 1);
    const metadata = { kind: "objectRef", className: "Thing", metadata: { label: "a,b{c}", enabled: true, ranks: [1, 2] } };
    expected.fields[0].typeArg = metadata;
    assert.deepEqual(parseClassFile(renderClassFile(expected, { js: true })).fields[0].typeArg, metadata);
    expected.fields[0].typeArg = { kind: "string" };
    const scalar = renderClassFile(expected, { js: true });
    assert.equal(compareClass(expected, parseClassFile(scalar.replace('{"kind":"string"}', '"string"'))).summary.typeMismatch, 0);
    assert.equal(compareClass(expected, parseClassFile(scalar.replace('{"kind":"string"}', '{"kind":"objectRef","className":"string"}'))).summary.typeMismatch, 1);
});

test("collection value shorthand matches value descriptors without becoming class references", () =>
{
    // Existing source-backed EveSpaceObjectVSData overrides retain uint32[4]
    // bone offsets and Matrix4[2] custom mask storage.
    const expected = deriveExpectedFields({ blueClass: "EveSpaceObjectVSData", cppClass: "EveSpaceObjectVSData",
        attributes: [
            { blueName: "boneOffsets", member: "boneOffsets", cppType: "uint32_t[4]" },
            { blueName: "customMaskMatrix", member: "customMaskMatrix", cppType: "Matrix4[2]" }
        ] });
    const source = renderClassFile(expected, { js: true });
    assert.deepEqual(expected.fields.map(field => field.typeArg), ["uint32", "mat4"]);
    for (const [shorthand, kind] of [["uint32", "uint32"], ["mat4", "mat4"], ["mat4", "matrix4"]])
    {
        const correct = source.replace(`array("${shorthand}")`, `array({ kind: "${kind}" })`);
        assert.equal(compareClass(expected, parseClassFile(correct), { strict: true }).summary.drift, false);
        const wrong = source.replace(`array("${shorthand}")`, `array({ kind: "objectRef", className: "${shorthand}" })`);
        assert.equal(compareClass(expected, parseClassFile(wrong), { strict: true }).summary.typeMismatch, 1);
    }
    const fixture = deriveExpectedFields({ blueClass: "Fixture", cppClass: "Fixture",
        attributes: [{ blueName: "items", cppType: "std::vector<ThingPtr>" }] });
    for (const shorthand of ["string", "unknown", "uint32", "mat4"])
    {
        fixture.fields[0].typeArg = shorthand;
        const text = renderClassFile(fixture, { js: true });
        const correct = text.replace(`list("${shorthand}")`, `list({ kind: "${shorthand}" })`);
        assert.equal(compareClass(fixture, parseClassFile(correct), { strict: true }).summary.drift, false);
        const wrong = text.replace(`list("${shorthand}")`, `list({ kind: "objectRef", className: "${shorthand}" })`);
        assert.equal(compareClass(fixture, parseClassFile(wrong), { strict: true }).summary.typeMismatch, 1);
    }
});

test("inline wire declarations defeat pointer spelling without changing reference or math declarations", () =>
{
    const expected = deriveExpectedFields({ blueClass: "Fixture", cppClass: "Fixture", attributes: [
        { blueName: "embedded", cppType: "PChild", black: { beType: "IROOT", wireType: "inlineObject" } },
        { blueName: "reference", cppType: "ChildPtr", black: { beType: "IROOTPTR", wireType: "objectRef" } },
        { blueName: "rotation", cppType: "Quaternion", black: { wireType: "inlineObject" } }
    ] });
    assert.deepEqual(expected.fields.map(field => field.kind), ["struct", "model", "quat"]);
    // Unknown embedded classes do not acquire an invented allocation policy.
    assert.equal(expected.fields[0].default.value, null);
});

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

test("readonly Blue properties retain their live declaration role", () =>
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
    assert.equal(expected.fields[0].role, "property");
    assert.equal(expected.fields[0].default.determinate, false);
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
        @meta.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @meta.blue.renamed("SetPlacement")
            @meta.adapted
            @meta.reason("Web Audio placement seam.")
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
        @meta.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
        }
    `));
    assert.equal(missing.summary.missingMethod, 1);
    assert.equal(missing.summary.drift, true);

    const unexposed = compareClass(MakeExpectedMethods(), parseClassFile(`
        @meta.define({ className: "AudEmitter", family: "audio" })
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
        @meta.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @meta.blue.renamed("SetPlacement")
            @meta.adapted
            SetPlacement()
            {
                return true;
            }
        }
    `));
    assert.equal(incomplete.summary.methodMetadata, 1);
    assert.match(incomplete.methods[0].notes.join(" "), /requires an explanation in the method JSDoc/);

    const missingStatus = compareClass(MakeExpectedMethods(), parseClassFile(`
        @meta.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @meta.blue.renamed("SetPlacement")
            SetPlacement()
            {
                return true;
            }
        }
    `));
    assert.equal(missingStatus.summary.methodMetadata, 1);
    assert.match(missingStatus.methods[0].notes.join(" "), /exactly one implementation-status/);

    const multipleStatuses = compareClass(MakeExpectedMethods(), parseClassFile(`
        @meta.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @meta.blue.renamed("SetPlacement")
            @meta.implemented
            @meta.notSupported
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
        @meta.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @meta.blue.renamed("SetPlacement")
            @meta.implemented
            SetPlacement()
            {
                return true;
            }

            @meta.blue.method
            @meta.implemented
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
        "@meta.define({ className: \"Tr2Thing\", family: \"trinity\" })",
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
        "@meta.define({ className: \"CjsBitmapDimensions\", carbon: \"ImageIO::BitmapDimensions\" })",
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
        "@meta.define({ className: \"CjsWebgpuWorkQueue\", modelledOn: \"MetalWorkQueue\" })",
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

test("Blue property flags follow the exposure macro", () =>
{
    const property = (blueName, macro, extra = {}) => ({ blueName, macro, getter: `Get${blueName}`, setter: `Set${blueName}`, cppType: "float", ...extra });
    const expected = deriveExpectedFields({
        family: "eve",
        blueClass: "EveFixture",
        cppClass: "EveFixture",
        properties: [
            property("plain", "MAP_PROPERTY"),
            property("readonly", "MAP_PROPERTY_READONLY", { setter: null, readOnly: true }),
            property("persisted", "MAP_PROPERTY_PERSISTED")
        ]
    });
    const byName = Object.fromEntries(expected.fields.map(field => [ field.name, field ]));

    assert.deepEqual(byName.plain.editFlags, [ "READ", "WRITE" ]);
    assert.deepEqual(byName.readonly.editFlags, [ "READ" ]);
    assert.deepEqual(byName.persisted.editFlags, [ "READ", "WRITE", "PERSIST" ]);
    assert.deepEqual(byName.persisted.ioDecorators, [ "readwrite", "persist" ]);
});

test("a name exposed as both attribute and property preserves separate roles and flags", () =>
{
    const expected = deriveExpectedFields({
        family: "trinity",
        blueClass: "FixtureParameter",
        cppClass: "FixtureParameter",
        attributes: [
            { blueName: "value", member: "m_value", cppType: "float", flags: [ "PERSISTONLY" ] }
        ],
        properties: [
            { blueName: "value", macro: "MAP_PROPERTY", getter: "GetValue", setter: "SetValue", cppType: "float" }
        ]
    });

    assert.equal(expected.fields.length, 2);
    assert.deepEqual(expected.fields.map(field => [field.role, field.name, field.key]), [
        [ "member", "value", "_value" ],
        [ "property", "value", "value" ]
    ]);
    assert.deepEqual(expected.fields[0].editFlags, [ "HIDDEN", "PERSIST" ]);
    assert.deepEqual(expected.fields[0].ioDecorators, [ "persistOnly" ]);
    assert.deepEqual(expected.fields[1].editFlags, [ "READ", "WRITE" ]);
    assert.deepEqual(expected.fields[1].ioDecorators, [ "readwrite" ]);
    assert.equal(expected.fields[1].getter, "GetValue");
    assert.equal(expected.fields[1].setter, "SetValue");
});

test("a base Carbon never exposes takes its flags from the subclasses that do", (t) =>
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "carbon-class-base-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const base = {
        family: "lights", blueClass: "FixtureLight", cppClass: "FixtureLight",
        fields: [
            { cppName: "m_radius", cppType: "float" },
            { cppName: "m_profile", cppType: "float" },
            { cppName: "m_hidden", cppType: "float" }
        ]
    };
    const sub = (name, profileFlags) => ({
        family: "lights", blueClass: name, cppClass: name,
        attributes: [
            { blueName: "radius", member: "m_radius", cppType: "float", declaredOn: "FixtureLight", flags: [ "READWRITE", "PERSIST" ] },
            { blueName: "profile", member: "m_profile", cppType: "float", declaredOn: "FixtureLight", flags: profileFlags }
        ]
    });
    WriteSchema(root, "lights", "FixtureLight", base);
    WriteSchema(root, "lights", "FixturePointLight", sub("FixturePointLight", [ "READ" ]));
    WriteSchema(root, "lights", "FixtureSpotLight", sub("FixtureSpotLight", [ "READWRITE" ]));

    const expected = deriveExpectedFields(base, { schemaRoot: root, family: "lights" });
    const byName = Object.fromEntries(expected.fields.map(field => [ field.name, field ]));

    assert.deepEqual(byName.radius.editFlags, [ "READ", "WRITE", "PERSIST" ]);
    assert.equal(byName.radius.editFlagConflict, undefined);
    assert.deepEqual(byName.hidden.editFlags, []);
    assert.deepEqual(byName.profile.editFlagConflict.map(item => item.exposers), [ [ "FixturePointLight" ], [ "FixtureSpotLight" ] ]);

    const result = compareClass(expected, parseClassFile(`
@meta.define({ className: "FixtureLight" })
export class FixtureLight
{
    @meta.blue.readwrite
    @meta.blue.persist
    @meta.type.float32
    radius = 0;

    @meta.blue.readwrite
    @meta.type.float32
    profile = 0;

    @meta.type.float32
    hidden = 0;
}
`));
    const notes = Object.fromEntries(result.fields.map(field => [ field.name, field.notes.join(" | ") ]));
    assert.doesNotMatch(notes.radius, /edit-flags differ/u);
    assert.doesNotMatch(notes.profile, /edit-flags differ/u);
    assert.match(notes.profile, /subclass exposures disagree on edit flags: FixturePointLight \[READ\]; FixtureSpotLight \[READ, WRITE\]/u);
});

test("edit flags are compared as a set, reporting missing and extra flags", () =>
{
    const expected = deriveExpectedFields(MakeEditFlagDoc());
    const result = compareClass(expected, parseClassFile(`
        @meta.define({ className: "AudEmitter", family: "audio" })
        export class AudEmitter extends CjsModel
        {
            @meta.blue.readwrite
            @meta.blue.persist
            @meta.type.float32
            persisted = 0;

            @meta.blue.notify
            @meta.blue.persist
            @meta.type.float32
            edited = 0;

            @meta.blue.persistOnly
            @meta.type.float32
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

    assert.match(source, /@meta\.blue\.persist\n  @meta\.type\.float32\n  persisted/u);
    assert.match(source, /@meta\.blue\.notify\n  @meta\.blue\.readwrite\n  @meta\.blue\.persist\n  @meta\.type\.float32\n  edited/u);
    assert.match(source, /@meta\.blue\.persistOnly\n  @meta\.type\.float32\n  stored/u);
});

test("method reasons accept attached JSDoc and retain legacy decorators", () =>
{
    const sources = [
        `/** Adapted: Uses injected audio services. */
        @meta.blue.renamed("SetPlacement")
        @meta.adapted
        SetPlacement() { return true; }`,
        `/**
         * Applies placement.
         *
         * Adapted: Uses injected
         * audio services.
         *
         * @returns {boolean} Completion.
         */
        @meta.blue.renamed(
            "SetPlacement"
        )
        @meta.adapted
        SetPlacement() { return true; }`,
        `/** Custom: Supplies a JavaScript-only entry point. */
        @meta.blue.renamed("SetPlacement") @meta.ours
        SetPlacement() { return true; }`,
        `@meta.blue.renamed("SetPlacement")
        @meta.adapted
        @meta.reason("Legacy reason")
        SetPlacement() { return true; }`
    ];
    for (const member of sources)
    {
        for (const newline of ["\n", "\r\n"])
        {
            const source = `export class AudEmitter { ${member}\n}`.replaceAll("\n", newline);
            const parsed = parseClassFile(source);
            assert.equal(parsed.methods[0].hasReason, true, source);
            assert.equal(compareClass(MakeExpectedMethods(), parsed).summary.methodMetadata, 0);
        }
    }
});

test("method reasons reject unrelated comments, wrong statuses and examples", () =>
{
    const prefixes = [
        "/** Adapted: */",
        "/** Custom: Wrong status. */",
        "// Adapted: Ordinary comment.",
        "/* Adapted: Ordinary comment. */",
        "/** @example\n * Adapted: Only an example.\n */",
        "/** Adapted: Old member. */\n Previous() {}",
        "/** Adapted: Old field. */\n value = 1;",
        "/** Adapted: Interrupted. */\n // not attached",
        "value = '/** Adapted: Quoted text. */';",
        "value = `/** Adapted: Template text. */`;"
    ];
    for (const prefix of prefixes)
    {
        const parsed = parseClassFile(`export class AudEmitter
        {
            ${prefix}
            @meta.blue.renamed("SetPlacement")
            @meta.adapted
            SetPlacement() { return true; }
        }`);
        const method = parsed.methods.find(item => item.name === "SetPlacement");
        assert.equal(method.hasReason, false, prefix);
    }
    const classDoc = parseClassFile(`/** Adapted: Class explanation. */
        export class AudEmitter {
            @meta.blue.renamed("SetPlacement")
            @meta.adapted
            SetPlacement() { return true; }
        }`);
    assert.equal(classDoc.methods[0].hasReason, false);
});


function MakeShipPropertyDoc()
{
    // EveShip2_Blue.cpp:21-22 persists m_boosters separately from the live
    // GetBoosters/SetBoosters property. These flags must never be unioned.
    return {
        family: "eve",
        blueClass: "FixtureShip",
        cppClass: "FixtureShip",
        attributes: [{
            blueName: "boosters", member: "m_boosters", cppType: "EveBoosterSet2Ptr",
            flags: ["PERSISTONLY"],
            black: { beType: "IROOTPTR", wireType: "objectRef", cppType: "EveBoosterSet2Ptr" }
        }],
        properties: [{
            blueName: "boosters", macro: "MAP_PROPERTY", getter: "GetBoosters", setter: "SetBoosters",
            cppType: "EveBoosterSet2*", getterReturnType: "EveBoosterSet2*", setterParameterType: "EveBoosterSet2 *"
        }]
    };
}

test("stored and live ship declarations survive emission, parsing and comparison", () =>
{
    const doc = MakeShipPropertyDoc();
    const expected = deriveExpectedFields(doc);
    const source = renderClassFile(expected, { doc, js: true });
    const parsed = parseClassFile(source);
    const result = compareClass(expected, parsed, { strict: true });

    assert.match(source, /@meta\.member\("boosters"\)/);
    assert.match(source, /_boosters = null;/);
    assert.match(source, /@meta\.property\("boosters"\)/);
    assert.match(source, /get boosters\(\)/);
    assert.match(source, /set boosters\(value\)/);
    assert.match(source, /@meta\.notImplemented\s+get boosters/);
    assert.match(source, /FixtureShip\.SetBoosters is not implemented/);
    assert.deepEqual(parsed.fields.map(field => [field.role, field.name, field.key]), [
        ["member", "boosters", "_boosters"], ["property", "boosters", "boosters"]
    ]);
    assert.equal(parsed.fields[1].get, true);
    assert.equal(parsed.fields[1].set, true);
    assert.equal(result.summary.match, 2);
    assert.equal(result.summary.drift, false);
    assert.equal(result.fields[1].expected.getterReturnType, "EveBoosterSet2*");
    assert.equal(result.fields[1].expected.setterParameterType, "EveBoosterSet2 *");

    // Counterexample: the old emitter passed a field with merged flags and
    // silently omitted the setter. The role-aware checker must reject it.
    const merged = parseClassFile(`
        @meta.define({ className: "FixtureShip", family: "eve" })
        export class FixtureShip extends CjsModel
        {
            @meta.blue.readwrite
            @meta.blue.persistOnly
            @meta.type.model("EveBoosterSet2")
            boosters = null;
        }
    `);
    const rejected = compareClass(expected, merged, { strict: true });
    assert.equal(rejected.summary.missingInFile, 1);
    assert.equal(rejected.summary.missingIoFlag, 1);
    assert.equal(rejected.summary.drift, true);
    assert.equal(rejected.fields.find(field => field.verdict === "missing-in-file").expected.role, "property");
});

test("new namespace aliases retain stored member names, indices and live accessor types", () =>
{
    const parsed = parseClassFile(`
        @meta.define({ className: "FixtureShip", family: "eve" })
        export class FixtureShip extends CjsModel
        {
            @meta.member("boosters", { index: 3 })
            @meta.edit.persistOnly
            @meta.type.model(EveBoosterSet2)
            _boosters = null;

            @meta.property("boosters")
            @meta.edit.readwrite
            @meta.type.objectRef("EveBoosterSet2")
            get boosters() { return this._boosters; }

            @meta.property("boosters")
            set boosters(value) { this.SetBoosters(value); }
        }
    `);
    assert.equal(parsed.define.className, "FixtureShip");
    assert.equal(parsed.fields[0].index, 3);
    assert.equal(parsed.fields[0].typeArg, "EveBoosterSet2");
    assert.equal(parsed.fields.length, 2);
    assert.equal(compareClass(deriveExpectedFields(MakeShipPropertyDoc()), parsed, { strict: true }).summary.drift, false);

    const expected = deriveExpectedFields(MakeShipPropertyDoc());
    expected.fields[0].index = 3;
    assert.match(renderClassFile(expected, { js: true }), /@meta\.member\("boosters", \{ index: 3 \}\)/);
    assert.equal(parseClassFile(`@meta.define("Fixture") export class Fixture {}`).define.className, "Fixture");
});

test("a base's stored member does not hide a separately inherited live property", (t) =>
{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "carbon-class-role-owner-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    WriteSchema(root, "eve", "FixtureBase", {
        family: "eve", blueClass: "FixtureBase", cppClass: "FixtureBase",
        attributes: [{ blueName: "boosters", member: "m_boosters", cppType: "EveBoosterSet2Ptr" }]
    });
    const doc = MakeShipPropertyDoc();
    doc.attributes[0].declaredOn = "FixtureBase";
    doc.properties[0].declaredOn = "FixtureBase";
    const expected = deriveExpectedFields(doc, { schemaRoot: root, family: "eve" });
    assert.deepEqual(expected.fields.map(field => [field.role, field.name]), [["property", "boosters"]]);
    assert.equal(expected.meta.inheritedSkipped, 1);
});

test("narrow and wide strings remain distinct through the generator pipeline", () =>
{
    // EveSOFData.h:1516-1517 and EveSOFData_Blue.cpp:920-921.
    const doc = {
        family: "eve", blueClass: "FixtureSoundEmitter", cppClass: "FixtureSoundEmitter",
        attributes: [
            { blueName: "name", member: "m_name", cppType: "std::string", flags: ["READWRITE", "PERSIST"], black: { wireType: "stringRef" } },
            { blueName: "prefix", member: "m_prefix", cppType: "std::wstring", flags: ["READWRITE", "PERSIST"], black: { wireType: "wstringRef" } },
            { blueName: "wide", member: "m_wide", cppType: "std::basic_string<wchar_t, std::char_traits<wchar_t>, std::allocator<wchar_t>>", flags: [] },
            { blueName: "shared", member: "m_shared", cppType: "BlueSharedStringW", flags: [] }
        ]
    };
    const expected = deriveExpectedFields(doc);
    assert.deepEqual(expected.fields.map(field => field.kind), ["string", "wstring", "wstring", "wstring"]);
    const source = renderClassFile(expected, { doc, js: true });
    assert.match(source, /@meta\.type\.wstring\s+prefix = "";/);
    assert.equal(compareClass(expected, parseClassFile(source), { strict: true }).summary.drift, false);
    const oldSource = source.replaceAll("@meta.type.wstring", "@meta.type.string");
    assert.equal(compareClass(expected, parseClassFile(oldSource), { strict: true }).summary.typeMismatch, 3);
});

test("weak references retain their distinct type rather than becoming strong references", () =>
{
    const doc = {
        family: "eve", blueClass: "FixtureWeakRef", cppClass: "FixtureWeakRef",
        attributes: [{
            blueName: "owner", member: "m_owner", cppType: "BlueWeakRef<FixtureShip>", flags: [],
            black: { beType: "IROOTWEAKREF", wireType: "objectRef", cppType: "BlueWeakRef<FixtureShip>" }
        }]
    };
    const expected = deriveExpectedFields(doc);
    assert.equal(expected.fields[0].kind, "weakRef");
    assert.equal(expected.fields[0].typeArg, "FixtureShip");
    const source = renderClassFile(expected, { doc, js: true });
    assert.match(source, /@meta\.type\.weakRef\("FixtureShip"\)/);
    assert.equal(compareClass(expected, parseClassFile(source), { strict: true }).summary.drift, false);
    assert.equal(compareClass(expected, parseClassFile(source.replace("@meta.type.weakRef", "@meta.type.objectRef"))).summary.typeMismatch, 1);
});

test("known method signatures survive derivation, comparison reports and emitted comments", () =>
{
    const parameters = [{ type: "float", name: "scale", default: "1.0f" }];
    const doc = {
        family: "eve", blueClass: "FixtureMethod", cppClass: "FixtureMethod",
        methods: [{
            blueName: "Scale", target: "SetScale", macro: "MAP_METHOD_AND_WRAP",
            returnType: "void", parameters
        }]
    };
    const expected = deriveExpectedFields(doc);
    const source = renderClassFile(expected, { doc, js: true });
    const result = compareClass(expected, parseClassFile(source));
    assert.equal(expected.methods[0].returnType, "void");
    assert.deepEqual(expected.methods[0].parameters, parameters);
    assert.equal(result.methods[0].expected.returnType, "void");
    assert.deepEqual(result.methods[0].expected.parameters, parameters);
    assert.match(source, /Native signature: void SetScale\(float scale\)/);
    assert.match(source, /Scale\(\.\.\.args\)/);
    assert.equal(result.summary.drift, false);
});


test("property metadata on a setter names the whole getter/setter declaration", () =>
{
    const parsed = parseClassFile(`
        export class Fixture
        {
            get current() { return this._current; }

            @meta.property("boosters", { index: 2 })
            @meta.type.objectRef("FixtureChild")
            @meta.edit.readwrite
            set current(value) { this._current = value; }
        }
    `);
    assert.equal(parsed.fields.length, 1);
    assert.equal(parsed.fields[0].name, "boosters");
    assert.equal(parsed.fields[0].key, "current");
    assert.equal(parsed.fields[0].role, "property");
    assert.equal(parsed.fields[0].index, 2);
    assert.equal(parsed.fields[0].typeArg, "FixtureChild");
    assert.deepEqual(parsed.fields[0].editFlags, ["READ", "WRITE"]);
});

test("generated classes default to no base and retain explicit base overrides", () =>
{
    const expected = deriveExpectedFields({ blueClass: "Fixture", cppClass: "Fixture", family: "eve", attributes: [] });
    const source = renderClassFile(expected, { js: true });
    assert.match(source, /export class Fixture\s*\{/);
    assert.doesNotMatch(source, /CjsModel|runtime\/model/);
    assert.equal(compareClass(expected, parseClassFile(source), { strict: true }).summary.drift, false);
    const legacy = source.replace("export class Fixture", "export class Fixture extends CjsModel");
    assert.equal(compareClass(expected, parseClassFile(legacy), { strict: true }).summary.drift, true);
    for (const base of ["CjsModel", "NativeBase"])
    {
        const options = { js: true, extendsClass: base };
        const explicit = renderClassFile(expected, options);
        assert.ok(explicit.includes("export class Fixture extends " + base));
        assert.equal(compareClass(expected, parseClassFile(explicit), { ...options, strict: true }).summary.drift, false);
    }
    const unresolved = renderClassFile(expected, { js: true, extendsClass: "NativeBase", extendsImportFor: () => null });
    assert.match(unresolved, /export class Fixture\s*\{/);
    assert.doesNotMatch(unresolved, /CjsModel|runtime\/model/);
});


test("compact namespaces preserve legacy parsed records and separate UI hints", () =>
{
    const legacy = `
@type.define({ className: "CompactFixture", family: "trinity" })
export class CompactFixture {
  @meta.member("exposed") @type.float32 @edit.readwrite @edit.persist @edit.notify
  _value = 1;
  @meta.property("exposed") @type.float32 @edit.read @impl.implemented
  get value() { return this._value; }
  @type.resource("Texture") @edit.hidden
  texture = null;
  @type.int32 @type.enum("Options") @edit.flags
  options = 0;
  @type.list("Part") @edit.rpersist
  parts = [];
  /** Adapted: callback receives its context explicitly. */
  @carbon.renamed("Apply") @carbon.contextual(["render"]) @impl.adapted
  apply(context) {}
  /** Custom: JavaScript host helper. */
  @impl.custom
  helper() {}
}`;
    const compact = legacy.replaceAll("@type.define", "@meta.define")
        .replaceAll("@type.", "@meta.type.").replaceAll("@edit.", "@meta.blue.")
        .replaceAll("@carbon.", "@meta.blue.").replaceAll("@impl.custom", "@meta.ours")
        .replaceAll("@impl.", "@meta.");
    assert.deepEqual(parseClassFile(compact), parseClassFile(legacy));
    const hints = parseClassFile(`export class Hints {
      @meta.type.float32 @meta.ui.hidden @meta.ui.readOnly
      value = 0;
    }`).fields[0];
    assert.equal(hints.hasIo, false);
    assert.deepEqual(hints.editFlags, []);
    const adapted = parseClassFile(compact).methods.find(method => method.name === "apply");
    assert.deepEqual(adapted.carbonOriginalNames, ["Apply"]);
    assert.equal(adapted.hasReason, true);
    assert.equal(parseClassFile(compact.replace("@meta.adapted", "")).methods.find(method => method.name === "apply").hasImpl, false);
    assert.equal(parseClassFile(compact.replace('@meta.blue.renamed("Apply")', "")).methods.find(method => method.name === "apply").hasCarbon, false);
    assert.deepEqual(parseClassFile(compact).methods.find(method => method.name === "helper").implStatusNames, ["custom"]);
});
