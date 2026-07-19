import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import CjsFormatCarbon, { CjsFormatCarbon as NamedCjsFormatCarbon } from "../src/schema/index.js";

class Schema {}
class Namespace {}
class Type {}

const REPO = path.resolve(".");

function nameForRole(field, role)
{
    for (const [ name, roles ] of Object.entries(field.names || {}))
    {
        const roleList = Array.isArray(roles) ? roles : String(roles).split(/\s+/);
        if (roleList.includes(role)) return name;
    }
    return null;
}

const sampleReport = {
    carbonRoot: "E:/carbonengine",
    generatedAt: "2026-07-02T06:41:19.041Z",
    enums: [
        {
            name: "ExampleMode",
            qualifiedName: "ExampleMode",
            family: "example",
            values: [
                { name: "MODE_A", value: 0 },
                { name: "MODE_B", value: 1 }
            ]
        }
    ],
    families: [
        {
            name: "example",
            root: "trinity/example",
            classes: [
                {
                    name: "ExampleThing",
                    family: "example",
                    headerFiles: [ "trinity/example/ExampleThing.h" ],
                    cppFiles: [ "trinity/example/ExampleThing.cpp" ],
                    bases: [],
                    fields: [
                        { name: "m_count", type: "int" },
                        { name: "m_child", type: "ExampleChildPtr" }
                    ],
                    methods: [],
                    defaults: {
                        m_count: { value: "7" }
                    },
                    hashes: {
                        sourceHash: "sha256:source",
                        shapeHash: "sha256:shape",
                        blueHash: "sha256:blue"
                    },
                    blue: {
                        isExposed: true,
                        files: [ "trinity/example/ExampleThing_Blue.cpp" ],
                        defines: [
                            { macro: "BLUE_DEFINE", name: "ExampleThing" }
                        ],
                        exposures: [
                            { macro: "EXPOSURE_BEGIN", name: "ExampleThing", description: "Example" }
                        ],
                        attributes: [
                            {
                                macro: "MAP_ATTRIBUTE",
                                name: "count",
                                nameSource: "literal",
                                member: "m_count",
                                flags: [ "READWRITE", "PERSIST" ],
                                source: "trinity/example/ExampleThing_Blue.cpp",
                                line: 12
                            },
                            {
                                macro: "MAP_ATTRIBUTE",
                                name: "child",
                                nameSource: "literal",
                                member: "m_child",
                                flags: [ "READ", "PERSIST" ],
                                source: "trinity/example/ExampleThing_Blue.cpp",
                                line: 13
                            }
                        ],
                        properties: [],
                        methods: [],
                        interfaces: []
                    },
                    reviewNotes: []
                },
                {
                    name: "std",
                    family: "example",
                    cppFiles: [ "trinity/example/StdNamespace.cpp" ],
                    bases: [],
                    fields: [],
                    methods: [
                        { name: "move", source: "trinity/example/StdNamespace.cpp", kind: "definition" }
                    ],
                    blue: {
                        isExposed: false,
                        defines: [],
                        exposures: [],
                        attributes: [],
                        properties: [],
                        methods: [],
                        interfaces: []
                    },
                    reviewNotes: []
                },
                {
                    name: "Entry",
                    family: "example",
                    cppFiles: [ "trinity/example/DisplayList.cpp" ],
                    bases: [],
                    fields: [],
                    methods: [],
                    blue: {
                        isExposed: false,
                        defines: [],
                        exposures: [],
                        attributes: [],
                        properties: [],
                        methods: [],
                        interfaces: []
                    },
                    reviewNotes: []
                },
                {
                    name: "CurrentValues",
                    family: "example",
                    cppFiles: [ "trinity/example/EffectState.cpp" ],
                    bases: [],
                    fields: [],
                    methods: [],
                    blue: {
                        isExposed: false,
                        defines: [],
                        exposures: [],
                        attributes: [],
                        properties: [],
                        methods: [],
                        interfaces: []
                    },
                    defaults: {
                        value: {
                            member: "value",
                            value: "0",
                            source: "trinity/example/EffectState.cpp",
                            line: 4
                        }
                    },
                    reviewNotes: []
                }
            ]
        }
    ]
};

function fieldResolutionReport(classInfo, family = "example")
{
    return {
        carbonRoot: "E:/carbonengine",
        generatedAt: "2026-07-15T00:00:00.000Z",
        enums: [],
        families: [{
            name: family,
            root: `trinity/${family}`,
            classes: [{
                family,
                headerFiles: [ `trinity/${family}/${classInfo.name}.h` ],
                cppFiles: [],
                bases: [],
                methods: [],
                defaults: {},
                reviewNotes: [],
                ...classInfo,
                blue: {
                    isExposed: true,
                    files: [ `trinity/${family}/${classInfo.name}_Blue.cpp` ],
                    defines: [{ macro: "BLUE_DEFINE", name: classInfo.name }],
                    exposures: [],
                    properties: [],
                    methods: [],
                    interfaces: [],
                    ...(classInfo.blue || {})
                }
            }]
        }]
    };
}

test("schema module root exports one public class", async () =>
{
    const mod = await import("../src/schema/index.js");

    assert.deepEqual(Object.keys(mod).sort(), [ "CjsFormatCarbon", "default" ]);
    assert.equal(mod.default, CjsFormatCarbon);
    assert.equal(mod.CjsFormatCarbon, CjsFormatCarbon);
    assert.equal(NamedCjsFormatCarbon, CjsFormatCarbon);
});

test("reader exposes the standard public profile API", () =>
{
    assert.deepEqual(Object.getOwnPropertyNames(CjsFormatCarbon.prototype).sort(), [
        "GetClass",
        "GetValues",
        "HasClass",
        "Inspect",
        "Read",
        "ReadBlackDefinitions",
        "SetClass",
        "SetClasses",
        "SetValues",
        "ToJSON",
        "Write",
        "WriteBlackDefinitions",
        "constructor"
    ].sort());

    assert.equal(typeof CjsFormatCarbon.read, "function");
    assert.equal(typeof CjsFormatCarbon.readBlackDefinitions, "function");
    assert.equal(typeof CjsFormatCarbon.inspect, "function");
    assert.equal(typeof CjsFormatCarbon.write, "function");
    assert.equal(typeof CjsFormatCarbon.writeBlackDefinitions, "function");
    assert.equal(CjsFormatCarbon.SCHEMA_VERSION, 1);
    assert.equal(CjsFormatCarbon.BLACK_DEFINITIONS_SCHEMA_VERSION, 1);
});

test("reader manages values and classes", () =>
{
    const reader = new CjsFormatCarbon({ classes: { Schema } }).SetClass("Type", Type);

    assert.equal(reader.HasClass("Schema"), true);
    assert.equal(reader.HasClass("Type"), true);
    assert.equal(reader.GetClass("Schema"), Schema);
    assert.equal(reader.GetValues().emit, CjsFormatCarbon.OUTPUT_JSON);
    assert.equal(reader.GetValues().version, CjsFormatCarbon.SCHEMA_VERSION);
    assert.deepEqual(CjsFormatCarbon.CLASS_KEYS.includes("Schema"), true);
});

test("read emits a current schema bundle from a Carbon Blue scan report", () =>
{
    const bundle = CjsFormatCarbon.read(sampleReport);
    const type = bundle.families[0].classes[0];

    assert.equal(bundle.schema, CjsFormatCarbon.SCHEMA_NAME);
    assert.equal(bundle.schemaVersion, 1);
    assert.deepEqual(bundle.families[0].classes.map(item => item.blueClass), [ "ExampleThing" ]);
    assert.equal(bundle.index.families[0].index, "example/index.json");
    assert.equal(bundle.index.families[0].classes, 1);
    assert.equal(bundle.enums.enums[0].name, "ExampleMode");
    assert.equal(type.blueClass, "ExampleThing");
    assert.equal(type.black.schemaVersion, 1);
    assert.deepEqual(type.black.fields.map(field => nameForRole(field, "name")), [ "count", "child" ]);
    assert.equal(type.black.fields[0].wireType, "int32");
    assert.equal(type.black.fields[1].wireType, "objectRef");
    assert.equal(type.attributes[0].default.json, 7);
    assert.deepEqual(type.black.fields[0].names, {
        count: "name fieldName",
        m_count: "cppName member memberPath memberRoot"
    });
    assert.equal(type.attributes[0].black.names.count, "name fieldName");
    const headerRef = type.source.header[0];
    const blueRef = type.source.blue[0];
    assert.equal(type.sourceRefs[headerRef], "trinity/example/ExampleThing.h");
    assert.equal(type.sourceRefs[blueRef], "trinity/example/ExampleThing_Blue.cpp");
    assert.equal(type.black.fields[0].source.file, blueRef);
});

test("field resolutions select the exposed Carbon declaration before scoring", () =>
{
    const report = fieldResolutionReport({
        name: "EveChildQuad",
        fields: [
            { name: "m_brightness", type: "Float_16", nested: true, struct: "GpuData" },
            { name: "m_brightness", type: "float" },
            { name: "m_color", type: "Float_16", nested: true, struct: "GpuData" },
            { name: "m_color", type: "Color" }
        ],
        blue: {
            attributes: [
                { macro: "MAP_ATTRIBUTE", name: "brightness", member: "m_brightness", flags: [ "READWRITE", "PERSIST" ] },
                { macro: "MAP_ATTRIBUTE", name: "color", member: "m_color", flags: [ "READWRITE", "PERSIST" ] }
            ]
        }
    }, "eve");

    const type = CjsFormatCarbon.read(report, { strictSchema: true }).families[0].classes[0];
    const attributes = new Map(type.attributes.map(attribute => [ attribute.blueName, attribute ]));

    assert.equal(attributes.get("brightness").cppType, "float");
    assert.equal(attributes.get("brightness").black.wireType, "float32");
    assert.equal(attributes.get("color").cppType, "Color");
    assert.equal(attributes.get("color").black.wireType, "floatArray");
    assert.equal(attributes.get("color").black.length, 4);
    assert.match(attributes.get("color").resolution.key, /EveChildQuad\.color$/);
});

test("field resolutions retain typedef provenance while defining the public wire type", () =>
{
    const report = fieldResolutionReport({
        name: "Tr2GpuStructuredBuffer",
        fields: [{ name: "m_creationFlags", type: "CreationFlags" }],
        blue: {
            attributes: [{
                macro: "MAP_ATTRIBUTE",
                name: "creationFlags",
                member: "m_creationFlags",
                flags: [ "READWRITE", "PERSIST" ]
            }]
        }
    }, "trinityCore");

    const attribute = CjsFormatCarbon.read(report, { strictSchema: true })
        .families[0].classes[0].attributes[0];

    assert.equal(attribute.cppType, "CreationFlags");
    assert.equal(attribute.black.cppType, "CreationFlags");
    assert.equal(attribute.black.beType, "ULONG");
    assert.equal(attribute.black.wireType, "uint32");
});

test("field resolutions define persisted components inherited from native math bases", () =>
{
    const cases = [
        [ "TriVector", [ "x", "y", "z" ], [] ],
        [ "TriColor", [ "r", "g", "b" ], [] ],
        [ "TriQuaternion", [ "x", "y", "z", "w" ], [] ],
        [ "TriMatrix", [
            "_11", "_12", "_13", "_14",
            "_21", "_22", "_23", "_24",
            "_31", "_32", "_33", "_34",
            "_41", "_42", "_43", "_44"
        ], [{ name: "_11", type: "float" }] ]
    ];

    for (const [ name, fields, nativeFields ] of cases)
    {
        const report = fieldResolutionReport({
            name,
            fields: nativeFields,
            blue: {
                attributes: fields.map(field => ({
                    macro: "MAP_ATTRIBUTE",
                    name: field,
                    member: field,
                    flags: [ "READWRITE", "PERSIST" ]
                }))
            }
        }, "trinityCore");
        const type = CjsFormatCarbon.read(report, { strictSchema: true }).families[0].classes[0];
        const nativeNames = new Set(nativeFields.map(field => field.name));

        assert.equal(type.attributes.length, fields.length, name);
        for (const attribute of type.attributes)
        {
            assert.equal(attribute.cppType, "float", `${name}.${attribute.blueName} cppType`);
            assert.equal(attribute.black.wireType, "float32", `${name}.${attribute.blueName} wire type`);
            if (nativeNames.has(attribute.blueName))
            {
                assert.equal(attribute.resolution, undefined, `${name}.${attribute.blueName} inferred natively`);
            }
            else
            {
                assert.match(attribute.resolution.key, new RegExp(`${name}\\.${attribute.blueName}$`));
            }
        }
    }
});

test("field resolutions define indexed bloom and nested tonemapping members", () =>
{
    const bloomFields = Array.from({ length: 6 }, (_, index) => [
        { name: `step${index + 1}Size`, member: `m_stepSizes[${index}]` },
        { name: `step${index + 1}Tint`, member: `m_stepTints[${index}]` }
    ]).flat();
    const tonemappingFields = [
        [ "toe", "m_aces.m_toe", "float", "float32" ],
        [ "useSweeteners", "m_aces.m_useSweeteners", "bool", "bool" ],
        [ "shoulderStrength", "m_uncharted2.m_shoulderStrength", "float", "float32" ],
        [ "method", "m_method", "int32_t", "int32" ]
    ];

    const bloomReport = fieldResolutionReport({
        name: "Tr2PPBloomEffect",
        fields: [],
        blue: {
            attributes: bloomFields.map(field => ({
                macro: "MAP_ATTRIBUTE",
                name: field.name,
                member: field.member,
                flags: [ "READWRITE", "PERSIST" ]
            }))
        }
    }, "trinityCore");
    const bloomAttributes = new Map(CjsFormatCarbon.read(bloomReport, { strictSchema: true })
        .families[0].classes[0].attributes.map(attribute => [ attribute.blueName, attribute ]));

    assert.equal(bloomAttributes.size, bloomFields.length);
    for (const field of bloomFields)
    {
        const attribute = bloomAttributes.get(field.name);
        const tint = field.name.endsWith("Tint");
        assert.equal(attribute.cppType, tint ? "Color" : "float", `${field.name} cppType`);
        assert.equal(attribute.black.wireType, tint ? "floatArray" : "float32", `${field.name} wire type`);
    }

    const report = fieldResolutionReport({
        name: "Tr2PPTonemappingEffect",
        fields: [],
        blue: {
            attributes: tonemappingFields.map(([ name, member ]) => ({
                macro: "MAP_ATTRIBUTE",
                name,
                member,
                flags: [ "READWRITE", "PERSIST" ]
            }))
        }
    }, "trinityCore");
    const attributes = new Map(CjsFormatCarbon.read(report, { strictSchema: true })
        .families[0].classes[0].attributes.map(attribute => [ attribute.blueName, attribute ]));

    for (const [ name, , cppType, wireType ] of tonemappingFields)
    {
        assert.equal(attributes.get(name).cppType, cppType, `${name} cppType`);
        assert.equal(attributes.get(name).black.wireType, wireType, `${name} wire type`);
    }
});

test("field resolutions define inherited curve and key template members", () =>
{
    const cases = [
        [ "Tr2BoneMatrixCurve", [
            [ "currentValue", "m_currentValue", "Matrix", "floatArray" ],
            [ "cycle", "m_cycle", "bool", "bool" ],
            [ "keys", "m_keys", "PTr2MatrixKeyVector", "container" ],
            [ "length", "m_length", "float", "float32" ],
            [ "name", "m_name", "std::string", "stringRef" ]
        ] ],
        [ "Tr2MatrixKey", [
            [ "time", "m_time", "float", "float32" ],
            [ "value", "m_value", "Matrix", "floatArray" ]
        ] ],
        [ "Tr2ScalarExprKey", [
            [ "time", "m_time", "float", "float32" ],
            [ "value", "m_value", "float", "float32" ]
        ] ]
    ];

    for (const [ name, fields ] of cases)
    {
        const report = fieldResolutionReport({
            name,
            fields: [],
            blue: {
                attributes: fields.map(([ fieldName, member ]) => ({
                    macro: "MAP_ATTRIBUTE",
                    name: fieldName,
                    member,
                    flags: [ "READWRITE", "PERSIST" ]
                }))
            }
        }, "trinityCore");
        const attributes = new Map(CjsFormatCarbon.read(report, { strictSchema: true })
            .families[0].classes[0].attributes.map(attribute => [ attribute.blueName, attribute ]));

        for (const [ fieldName, , cppType, wireType ] of fields)
        {
            const attribute = attributes.get(fieldName);
            assert.equal(attribute.cppType, cppType, `${name}.${fieldName} cppType`);
            assert.equal(attribute.black.wireType, wireType, `${name}.${fieldName} wire type`);
        }
        if (name === "Tr2BoneMatrixCurve")
        {
            assert.equal(attributes.get("keys").black.container, "list");
        }
    }
});

test("late field resolutions retain exact native members and public wire shapes", () =>
{
    const cases = [
        {
            name: "Tr2PresentParameters",
            family: "trinityCore",
            source: "trinity/trinityal/Tr2AdapterStructures.h",
            fields: [
                { name: "software", member: "software", cppType: "bool", persisted: false, macro: "MAP_ATTRIBUTE_WITH_CHOOSER", flags: [ "READWRITE", "ENUM" ] },
                { name: "backBufferWidth", member: "mode.width", cppType: "uint32_t", persisted: false, flags: [ "READWRITE" ] },
                { name: "backBufferHeight", member: "mode.height", cppType: "uint32_t", persisted: false, flags: [ "READWRITE" ] },
                { name: "windowed", member: "windowed", cppType: "bool", persisted: false, flags: [ "READWRITE" ] }
            ]
        },
        {
            name: "TriTextureParameter",
            family: "trinityCore",
            source: "trinity/trinity/Shader/Parameter/TriTextureParameter.h",
            fields: [
                { name: "positionScale", member: "m_uvDensityScale[0]", cppType: "float", persisted: false, flags: [ "READ" ] },
                { name: "uvDensityScale0", member: "m_uvDensityScale[1]", cppType: "float", persisted: false, flags: [ "READ" ] },
                { name: "uvDensityScale1", member: "m_uvDensityScale[2]", cppType: "float", persisted: false, flags: [ "READ" ] },
                { name: "uvDensityScale2", member: "m_uvDensityScale[3]", cppType: "float", persisted: false, flags: [ "READ" ] },
                { name: "uvDensityScale3", member: "m_uvDensityScale[4]", cppType: "float", persisted: false, flags: [ "READ" ] }
            ]
        },
        {
            name: "EveEllipseDefinition",
            family: "trinityCore",
            source: "trinity/trinity/Eve/UI/EveEllipseDefinition.h",
            fields: [
                { name: "center", member: "m_center", cppType: "Vector3", beType: "FLOATARRAY", wireType: "floatArray", length: 3, flags: [ "READWRITE", "NOTIFY", "PERSIST" ] },
                { name: "planeNormal", member: "m_planeNormal", cppType: "Vector3", beType: "FLOATARRAY", wireType: "floatArray", length: 3, flags: [ "READWRITE", "NOTIFY", "PERSIST" ] }
            ]
        },
        {
            name: "EveSpaceSceneRenderDriver",
            family: "trinityCore",
            source: "trinity/trinity/Eve/EveSpaceSceneRenderDriver.h",
            fields: [
                { name: "depthPassTechnique", member: "m_depthPassTechnique", cppType: "BlueSharedString", persisted: false, flags: [ "READWRITE" ] }
            ]
        },
        {
            name: "Tr2HostBitmap",
            family: "trinityCore",
            source: "imageio/include/BitmapDimensions.h",
            fields: [
                { name: "format", member: "m_format", cppType: "ImageIO::PixelFormat", persisted: false, macro: "MAP_ATTRIBUTE_WITH_CHOOSER", flags: [ "READ" ] },
                { name: "width", member: "m_width", cppType: "uint32_t", persisted: false, flags: [ "READ" ] },
                { name: "height", member: "m_height", cppType: "uint32_t", persisted: false, flags: [ "READ" ] },
                { name: "mipCount", member: "m_mipCount", cppType: "uint32_t", persisted: false, flags: [ "READ" ] },
                { name: "imageType", member: "m_type", cppType: "ImageIO::TextureType", persisted: false, flags: [ "READ" ] },
                { name: "name", member: "m_name", cppType: "std::string", beType: "STDSTRING", wireType: "stringRef", source: "imageio/include/HostBitmap.h", flags: [ "READWRITE", "PERSIST" ] }
            ]
        },
        {
            name: "TriTextureRes",
            family: "trinityCore",
            source: "imageio/include/BitmapDimensions.h",
            fields: [
                { name: "format", member: "m_format", cppType: "ImageIO::PixelFormat", persisted: false, macro: "MAP_ATTRIBUTE_WITH_CHOOSER", flags: [ "READ", "ENUM" ] },
                { name: "type", member: "m_type", cppType: "ImageIO::TextureType", beType: "LONG", wireType: "enum", signed: true, enumType: "TextureType", macro: "MAP_ATTRIBUTE_WITH_CHOOSER", flags: [ "READ", "PERSIST", "ENUM" ] },
                { name: "depth", member: "m_volumeDepth", cppType: "uint32_t", persisted: false, flags: [ "READ" ] },
                { name: "height", member: "m_height", cppType: "uint32_t", persisted: false, flags: [ "READ" ] },
                { name: "arraySize", member: "m_arraySize", cppType: "uint32_t", persisted: false, flags: [ "READ" ] },
                { name: "width", member: "m_width", cppType: "uint32_t", persisted: false, flags: [ "READ" ] }
            ]
        },
        {
            name: "EveChildLightingOverride",
            family: "trinityCore",
            source: "trinity/trinity/Eve/SpaceObject/Children/EveChildLightingOverride.h",
            fields: [
                { name: "priority", member: "m_overrides.priority", cppType: "PostProcessEnums::Priority", beType: "LONG", wireType: "enum", signed: true, enumType: "Priority", macro: "MAP_ATTRIBUTE_WITH_CHOOSER", flags: [ "READWRITE", "PERSIST", "ENUM" ] },
                { name: "backgroundIntensity", member: "m_overrides.value.backgroundIntensity", cppType: "float", beType: "FLOAT", wireType: "float32" },
                { name: "reflectionIntensity", member: "m_overrides.value.reflectionIntensity", cppType: "float", beType: "FLOAT", wireType: "float32" },
                { name: "sunIntensity", member: "m_overrides.value.sunIntensity", cppType: "float", beType: "FLOAT", wireType: "float32" },
                { name: "sunColor", member: "m_overrides.value.sunColor", cppType: "Color", beType: "FLOATARRAY", wireType: "floatArray", length: 4 }
            ]
        }
    ];

    for (const definition of cases)
    {
        const report = fieldResolutionReport({
            name: definition.name,
            fields: [],
            blue: {
                attributes: definition.fields.map(field => ({
                    macro: field.macro || "MAP_ATTRIBUTE",
                    name: field.name,
                    member: field.member,
                    flags: field.flags || (field.persisted === false ? [ "READWRITE" ] : [ "READWRITE", "PERSIST" ])
                }))
            }
        }, definition.family);
        const attributes = CjsFormatCarbon.read(report, { strictSchema: true }).families[0].classes[0].attributes;
        const byName = new Map(attributes.map(attribute => [ attribute.blueName, attribute ]));

        assert.equal(attributes.length, definition.fields.length, `${definition.name} attribute count`);
        assert.deepEqual(
            [...byName.keys()].sort(),
            definition.fields.map(field => field.name).sort(),
            `${definition.name} attribute names`
        );
        for (const field of definition.fields)
        {
            const attribute = byName.get(field.name);
            assert.equal(attribute.member, field.member, `${definition.name}.${field.name} member`);
            assert.equal(attribute.macro, field.macro || "MAP_ATTRIBUTE", `${definition.name}.${field.name} macro`);
            assert.deepEqual(attribute.flags,
                field.flags || (field.persisted === false ? [ "READWRITE" ] : [ "READWRITE", "PERSIST" ]),
                `${definition.name}.${field.name} flags`);
            assert.equal(attribute.cppType, field.cppType, `${definition.name}.${field.name} cppType`);
            assert.equal(attribute.resolution.key, `${definition.name}.${field.name}`, `${definition.name}.${field.name} resolution key`);
            assert.equal(attribute.resolution.reference, field.source || definition.source, `${definition.name}.${field.name} source`);
            if (field.persisted === false)
            {
                assert.equal(attribute.black, undefined, `${definition.name}.${field.name} is not persisted`);
                continue;
            }
            assert.equal(attribute.black.cppType, field.cppType, `${definition.name}.${field.name} Black cppType`);
            assert.equal(attribute.black.beType, field.beType, `${definition.name}.${field.name} Black beType`);
            assert.equal(attribute.black.wireType, field.wireType, `${definition.name}.${field.name} Black wire type`);
            if (Object.hasOwn(field, "signed")) assert.equal(attribute.black.signed, field.signed, `${definition.name}.${field.name} signed`);
            if (Object.hasOwn(field, "length")) assert.equal(attribute.black.length, field.length, `${definition.name}.${field.name} length`);
            if (Object.hasOwn(field, "enumType")) assert.equal(attribute.black.enumType, field.enumType, `${definition.name}.${field.name} enum type`);
        }
    }
});

test("strict schema resolution reports every ambiguous hydratable field together", () =>
{
    const report = fieldResolutionReport({
        name: "AmbiguousThing",
        fields: [
            { name: "m_value", type: "float" },
            { name: "m_value", type: "Color" },
            { name: "m_amount", type: "int" },
            { name: "m_amount", type: "double" }
        ],
        blue: {
            attributes: [
                { macro: "MAP_ATTRIBUTE", name: "value", member: "m_value", flags: [ "PERSIST" ] },
                { macro: "MAP_ATTRIBUTE", name: "amount", member: "m_amount", flags: [ "READ" ] }
            ]
        }
    });

    assert.throws(
        () => CjsFormatCarbon.read(report, { strictSchema: true }),
        error =>
        {
            assert.equal(error.code, "schema-resolution-failed");
            assert.equal(error.issues.length, 2);
            assert.deepEqual(error.issues.map(issue => issue.blueName), [ "amount", "value" ]);
            assert.equal(error.issues.every(issue => issue.type === "attribute-cpp-type-ambiguous"), true);
            return true;
        }
    );
});

test("caller field resolutions clear ambiguity and stale selectors remain blocking", () =>
{
    const report = fieldResolutionReport({
        name: "AmbiguousThing",
        fields: [
            { name: "m_value", type: "float" },
            { name: "m_value", type: "Color" }
        ],
        blue: {
            attributes: [{ macro: "MAP_ATTRIBUTE", name: "value", member: "m_value", flags: [ "PERSIST" ] }]
        }
    });
    const resolved = {
        AmbiguousThing: {
            value: {
                member: "m_value",
                select: { cppType: "float" },
                type: "float32",
                reason: "Fixture selects the scalar declaration."
            }
        }
    };

    const attribute = CjsFormatCarbon.read(report, {
        fieldResolutions: resolved,
        strictSchema: true
    }).families[0].classes[0].attributes[0];
    assert.equal(attribute.cppType, "float");
    assert.equal(attribute.black.wireType, "float32");

    const stale = structuredClone(resolved);
    stale.AmbiguousThing.value.select.cppType = "double";
    assert.throws(
        () => CjsFormatCarbon.read(report, { fieldResolutions: stale, strictSchema: true }),
        error => error.code === "schema-resolution-failed" &&
            error.issues.some(issue => issue.type === "field-resolution-stale")
    );
});

test("defined field resolutions override a scanned enclosing structure", () =>
{
    const report = fieldResolutionReport({
        name: "NestedThing",
        fields: [{ name: "m_container", type: "Container" }],
        blue: {
            attributes: [{
                macro: "MAP_ATTRIBUTE",
                name: "value",
                member: "m_container.value",
                flags: [ "READWRITE", "PERSIST" ]
            }]
        }
    });
    const attribute = CjsFormatCarbon.read(report, {
        strictSchema: true,
        fieldResolutions: {
            NestedThing: {
                value: {
                    member: "m_container.value",
                    define: { cppType: "float" },
                    type: "float32",
                    reason: "Fixture defines the nested leaf hidden by its scanned enclosing structure."
                }
            }
        }
    }).families[0].classes[0].attributes[0];

    assert.equal(attribute.cppType, "float");
    assert.equal(attribute.black.cppType, "float");
    assert.equal(attribute.black.wireType, "float32");
});

test("manually defined fields reject incompatible scanned expectations", () =>
{
    const report = fieldResolutionReport({
        name: "NestedThing",
        fields: [{ name: "m_container", type: "Container" }],
        blue: {
            attributes: [{
                macro: "MAP_ATTRIBUTE",
                name: "value",
                member: "m_container.value",
                flags: [ "READWRITE", "PERSIST" ]
            }]
        }
    });

    assert.throws(
        () => CjsFormatCarbon.read(report, {
            strictSchema: true,
            fieldResolutions: {
                NestedThing: {
                    value: {
                        member: "m_container.value",
                        define: { cppType: "float" },
                        expects: { cppType: "Container" },
                        type: "float32",
                        reason: "Fixture intentionally combines incompatible resolution modes."
                    }
                }
            }
        }),
        error => error.code === "schema-resolution-failed" &&
            error.issues.some(issue => issue.type === "field-resolution-invalid" &&
                issue.message === "A manually defined field cannot also expect a scanned declaration.")
    );
});

test("field resolutions define TriDevice nested multisample integers", () =>
{
    const fields = new Map([
        [ "multiSampleType", "mPresentParam.msaaType" ],
        [ "multiSampleQuality", "mPresentParam.msaaQuality" ]
    ]);
    const report = fieldResolutionReport({
        name: "TriDevice",
        fields: [{ name: "mPresentParam", type: "Tr2PresentParametersAL" }],
        blue: {
            attributes: [
                { macro: "MAP_ATTRIBUTE", name: "multiSampleType", member: "mPresentParam.msaaType", flags: [ "READWRITE", "NOTIFY", "PERSIST" ] },
                { macro: "MAP_ATTRIBUTE", name: "multiSampleQuality", member: "mPresentParam.msaaQuality", flags: [ "READWRITE", "NOTIFY", "PERSIST" ] }
            ]
        }
    }, "trinityCore");
    const attributes = CjsFormatCarbon.read(report, { strictSchema: true }).families[0].classes[0].attributes;

    assert.equal(attributes.length, fields.size);
    assert.deepEqual(attributes.map(attribute => attribute.blueName).sort(), [...fields.keys()].sort());
    for (const attribute of attributes)
    {
        assert.equal(attribute.member, fields.get(attribute.blueName), `${attribute.blueName} member`);
        assert.equal(attribute.macro, "MAP_ATTRIBUTE", `${attribute.blueName} macro`);
        assert.equal(attribute.cppType, "uint32_t", `${attribute.blueName} cppType`);
        assert.equal(attribute.black.cppType, "uint32_t", `${attribute.blueName} Black cppType`);
        assert.equal(attribute.black.beType, "ULONG", `${attribute.blueName} Black beType`);
        assert.equal(attribute.black.wireType, "uint32", `${attribute.blueName} Black wire type`);
        assert.equal(attribute.black.signed, false, `${attribute.blueName} unsigned`);
        assert.equal(attribute.black.enumType, undefined, `${attribute.blueName} is not an enum`);
        assert.equal(attribute.flags.includes("ENUM"), false, `${attribute.blueName} has no enum flag`);
        assert.equal(attribute.chooser, undefined, `${attribute.blueName} has no chooser`);
        assert.match(attribute.resolution.key, new RegExp(`TriDevice\\.${attribute.blueName}$`));
    }
});

test("field resolutions define nested FidelityFX CACAO float settings", () =>
{
    const fields = [ "shadowClamp", "shadowMultiplier", "shadowPower", "sharpness" ];
    const report = fieldResolutionReport({
        name: "Tr2SSAO",
        fields: [{ name: "m_detail", type: "Layer" }],
        blue: {
            attributes: fields.map(name => ({
                macro: "MAP_ATTRIBUTE",
                name,
                member: `m_detail.settings.${name}`,
                flags: [ "READWRITE", "PERSIST" ]
            }))
        }
    }, "trinityCore");
    const attributes = CjsFormatCarbon.read(report, { strictSchema: true }).families[0].classes[0].attributes;

    assert.equal(attributes.length, fields.length);
    assert.deepEqual(attributes.map(attribute => attribute.blueName).sort(), [...fields].sort());
    for (const attribute of attributes)
    {
        assert.equal(attribute.member, `m_detail.settings.${attribute.blueName}`, `${attribute.blueName} member`);
        assert.equal(attribute.cppType, "float", `${attribute.blueName} cppType`);
        assert.equal(attribute.black.cppType, "float", `${attribute.blueName} Black cppType`);
        assert.equal(attribute.black.beType, "FLOAT", `${attribute.blueName} Black beType`);
        assert.equal(attribute.black.wireType, "float32", `${attribute.blueName} Black wire type`);
        assert.equal(attribute.resolution.key, `Tr2SSAO.${attribute.blueName}`, `${attribute.blueName} resolution key`);
        assert.equal(attribute.resolution.reference,
            "https://gpuopen.com/manuals/fidelityfx_sdk/reference_documentation/structs/ffx_cacao_settings/",
            `${attribute.blueName} source`);
    }
});

test("read records the C++ declaration owner for inherited Blue methods", () =>
{
    const report = {
        carbonRoot: "E:/carbonengine",
        generatedAt: "2026-07-13T00:00:00.000Z",
        families: [
            {
                name: "fixtures",
                root: "fixtures",
                classes: [
                    {
                        name: "FixtureBase",
                        family: "fixtures",
                        headerFiles: [ "fixtures/FixtureBase.h" ],
                        bases: [],
                        fields: [],
                        methods: [
                            { name: "Rebuild", kind: "declaration" }
                        ],
                        blue: {
                            isExposed: true,
                            files: [],
                            defines: [],
                            exposures: [],
                            attributes: [],
                            properties: [],
                            methods: [],
                            interfaces: []
                        },
                        reviewNotes: []
                    },
                    {
                        name: "FixtureChild",
                        family: "fixtures",
                        headerFiles: [ "fixtures/FixtureChild.h" ],
                        bases: [ "FixtureBase" ],
                        fields: [],
                        methods: [],
                        blue: {
                            isExposed: true,
                            files: [ "fixtures/FixtureChild_Blue.cpp" ],
                            defines: [],
                            exposures: [],
                            attributes: [],
                            properties: [],
                            methods: [
                                {
                                    macro: "MAP_METHOD_AND_WRAP",
                                    name: "Rebuild",
                                    target: "Rebuild"
                                }
                            ],
                            interfaces: []
                        },
                        reviewNotes: []
                    }
                ]
            }
        ]
    };

    const bundle = CjsFormatCarbon.read(report);
    const child = bundle.families[0].classes.find(item => item.blueClass === "FixtureChild");
    assert.equal(child.methods[0].declaredOn, "FixtureBase");
});

test("read preserves source-backed defaults for indexed SOF applicable areas", () =>
{
    const members = [
        ["Primary", "TYPE_PRIMARY"],
        ["Glass", "TYPE_GLASS"]
    ];
    const report = {
        carbonRoot: "E:/carbonengine",
        generatedAt: "2026-07-13T00:00:00.000Z",
        families: [
            {
                name: "eve",
                root: "trinity/eve",
                classes: [
                    {
                        name: "EveSOFDataPatternLayerProperties",
                        family: "eve",
                        headerFiles: ["trinity/EveSOFData.h"],
                        bases: ["IRoot"],
                        fields: [
                            { name: "m_applicableAreas", type: "bool" }
                        ],
                        methods: [],
                        blue: {
                            isExposed: true,
                            files: ["trinity/EveSOFData_Blue.cpp"],
                            defines: [],
                            exposures: [],
                            attributes: members.map(([name, token]) => ({
                                macro: "MAP_ATTRIBUTE",
                                name,
                                nameSource: "literal",
                                member: `m_applicableAreas[EveSOFDataArea::AreaType::${token}]`,
                                flags: ["READWRITE", "PERSIST"]
                            })),
                            properties: [],
                            methods: [],
                            interfaces: []
                        },
                        reviewNotes: []
                    }
                ]
            }
        ]
    };

    const bundle = CjsFormatCarbon.read(report);
    const schema = bundle.families[0].classes[0];
    assert.deepEqual(schema.attributes.map(attribute => attribute.default), [
        { cpp: "true", json: true, kind: "boolean" },
        { cpp: "true", json: true, kind: "boolean" }
    ]);
});

test("read expands EveChildInheritProperties colors from the Carbon source contract", () =>
{
    const colors = [
        [ "Primary", "PRIMARY" ],
        [ "Secondary", "SECONDARY" ],
        [ "Tertiary", "TERTIARY" ],
        [ "Black", "BLACK" ],
        [ "White", "WHITE" ],
        [ "Yellow", "YELLOW" ],
        [ "Orange", "ORANGE" ],
        [ "Red", "RED" ],
        [ "Blue", "BLUE" ],
        [ "Green", "GREEN" ],
        [ "Cyan", "CYAN" ],
        [ "Fire", "FIRE" ],
        [ "Hull", "HULL" ],
        [ "Glass", "GLASS" ],
        [ "Reactor", "REACTOR" ],
        [ "Darkhull", "DARKHULL" ],
        [ "Booster", "BOOSTER" ],
        [ "Killmark", "KILLMARK" ],
        [ "PrimaryLight", "PRIMARY_LIGHT" ],
        [ "SecondaryLight", "SECONDARY_LIGHT" ],
        [ "TertiaryLight", "TERTIARY_LIGHT" ],
        [ "WhiteLight", "WHITE_LIGHT" ],
        [ "PrimaryHologram", "PRIMARY_HOLOGRAM" ],
        [ "SecondaryHologram", "SECONDARY_HOLOGRAM" ],
        [ "TertiaryHologram", "TERTIARY_HOLOGRAM" ],
        [ "State0", "STATE_0" ],
        [ "State1", "STATE_1" ],
        [ "State2", "STATE_2" ],
        [ "State3", "STATE_3" ],
        [ "StateVulnerable", "STATE_VULNERABLE" ],
        [ "StateInvulnerable", "STATE_INVULNERABLE" ],
        [ "PrimaryForcefield", "PRIMARY_FORCEFIELD" ],
        [ "SecondaryForcefield", "SECONDARY_FORCEFIELD" ],
        [ "PrimaryBanner", "PRIMARY_BANNER" ],
        [ "PrimaryFx", "PRIMARY_FX" ],
        [ "SecondaryFx", "SECONDARY_FX" ],
        [ "PrimarySpotlight", "PRIMARY_SPOTLIGHT" ],
        [ "SecondarySpotlight", "SECONDARY_SPOTLIGHT" ],
        [ "TertiarySpotlight", "TERTIARY_SPOTLIGHT" ],
        [ "PrimaryBillboard", "PRIMARY_BILLBOARD" ],
        [ "PrimaryWarpFx", "PRIMARY_WARP_FX" ],
        [ "PrimaryAttackFx", "PRIMARY_ATTACK_FX" ],
        [ "PrimarySiegeFx", "PRIMARY_SIEGE_FX" ],
        [ "PrimaryDockedFx", "PRIMARY_DOCKED_FX" ]
    ];
    const report = {
        carbonRoot: "E:/carbonengine",
        generatedAt: "2026-07-14T00:00:00.000Z",
        families: [
            {
                name: "eve",
                root: "trinity/trinity/Eve",
                classes: [
                    {
                        name: "EveChildInheritProperties",
                        family: "eve",
                        headerFiles: [ "trinity/trinity/Eve/SpaceObject/Children/EveChildInheritProperties.h" ],
                        cppFiles: [ "trinity/trinity/Eve/SpaceObject/Children/EveChildInheritProperties.cpp" ],
                        bases: [ "IRoot" ],
                        fields: [
                            { name: "m_colorSet", type: "Color" }
                        ],
                        methods: [],
                        blue: {
                            isExposed: true,
                            files: [ "trinity/trinity/Eve/SpaceObject/Children/EveChildInheritProperties_Blue.cpp" ],
                            defines: [],
                            exposures: [],
                            attributes: [
                                {
                                    macro: "MAP_ATTRIBUTE",
                                    nameExpression: "#_Color",
                                    nameSource: "expression",
                                    member: "m_colorSet[TYPE_##_COLOR]",
                                    flags: [ "READ" ],
                                    description: ":jessica-group:SOF Faction Glow Colors",
                                    source: "trinity/trinity/Eve/SpaceObject/Children/EveChildInheritProperties_Blue.cpp",
                                    line: 17
                                }
                            ],
                            properties: [],
                            methods: [],
                            interfaces: []
                        },
                        reviewNotes: []
                    }
                ]
            }
        ]
    };

    const schema = CjsFormatCarbon.read(report).families[0].classes[0];
    const actual = schema.attributes.map(attribute => [
        attribute.blueName,
        attribute.member
    ]);
    const expected = colors.map(([ name, token ]) => [
        name,
        `m_colorSet[TYPE_${token}]`
    ]);

    assert.equal(schema.attributes.length, 44);
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual[22], [ "PrimaryHologram", "m_colorSet[TYPE_PRIMARY_HOLOGRAM]" ]);
    assert.deepEqual(actual[36], [ "PrimarySpotlight", "m_colorSet[TYPE_PRIMARY_SPOTLIGHT]" ]);
    assert.deepEqual(schema.attributes.slice(-4).map(attribute => attribute.blueName), [
        "PrimaryWarpFx",
        "PrimaryAttackFx",
        "PrimarySiegeFx",
        "PrimaryDockedFx"
    ]);
    assert.ok(schema.attributes.every(attribute => attribute.cppType === "Color"));
    assert.ok(schema.attributes.every(attribute => (
        attribute.flags.length === 1 && attribute.flags[0] === "READ"
    )));
    assert.ok(schema.attributes.every(attribute => !("blueNameExpression" in attribute)));
    assert.equal(schema.attributes.some(attribute => attribute.blueName === "colorSet"), false);
    assert.equal(schema.attributes.some(attribute => attribute.member.includes("##")), false);
    assert.deepEqual(schema.black.fields, []);
});

test("read accepts JSON text, UTF-8 bytes, and JSON file paths", () =>
{
    const text = JSON.stringify(sampleReport);
    const bytes = new TextEncoder().encode(text);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-"));
    const file = path.join(dir, "report.json");

    fs.writeFileSync(file, text, "utf8");

    assert.equal(CjsFormatCarbon.read(text).families[0].classes[0].blueClass, "ExampleThing");
    assert.equal(CjsFormatCarbon.read(bytes).families[0].classes[0].blueClass, "ExampleThing");
    assert.equal(CjsFormatCarbon.read(file).families[0].classes[0].blueClass, "ExampleThing");

    fs.rmSync(dir, { recursive: true, force: true });
});

test("inspect summarizes emitted schemas", () =>
{
    assert.deepEqual(CjsFormatCarbon.inspect(sampleReport), {
        schema: CjsFormatCarbon.SCHEMA_NAME,
        schemaVersion: 1,
        kind: "bundle",
        generatedAt: "2026-07-02T06:41:19.041Z",
        carbonRoot: "E:/carbonengine",
        families: 1,
        classes: 1,
        enums: 1
    });

    const type = CjsFormatCarbon.read(sampleReport).families[0].classes[0];
    assert.deepEqual(CjsFormatCarbon.inspect(type), {
        schema: CjsFormatCarbon.SCHEMA_NAME,
        schemaVersion: 1,
        kind: "class",
        family: "example",
        blueClass: "ExampleThing",
        cppClass: "ExampleThing",
        fields: 2,
        attributes: 2,
        blackFields: 2,
        reviewNotes: 0
    });
});

test("write emits importable schema JSON files", () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-write-"));
    const manifest = CjsFormatCarbon.write(sampleReport, dir);

    assert.deepEqual(manifest.files.map(file => file.path).sort(), [
        "enums.json",
        "example/ExampleThing.json",
        "example/index.json",
        "index.json"
    ]);

    const type = JSON.parse(fs.readFileSync(path.join(dir, "example", "ExampleThing.json"), "utf8"));
    assert.equal(type.schemaVersion, 1);
    assert.equal(nameForRole(type.black.fields[0], "name"), "count");
    assert.equal(CjsFormatCarbon.read(dir).families[0].classes[0].blueClass, "ExampleThing");

    fs.rmSync(dir, { recursive: true, force: true });
});

test("writeBlackDefinitions emits public Black schema files", () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-black-"));
    const schemaDir = path.join(dir, "schema");
    const blackDir = path.join(dir, "black");
    const manifest = CjsFormatCarbon.writeBlackDefinitions(sampleReport, blackDir);

    assert.deepEqual(manifest.files.map(file => file.path).sort(), [
        "black-schema-v1-2026-07-02.json"
    ]);

    const schema = JSON.parse(fs.readFileSync(path.join(blackDir, "black-schema-v1-2026-07-02.json"), "utf8"));

    assert.equal(schema.schema, CjsFormatCarbon.BLACK_DEFINITIONS_SCHEMA_NAME);
    assert.equal(schema.version, CjsFormatCarbon.BLACK_DEFINITIONS_SCHEMA_VERSION);
    assert.equal(schema.generatedAt, "2026-07-02T06:41:19.041Z");
    assert.deepEqual(schema.classes, {
        ExampleThing: {
            count: "int",
            child: "object"
        }
    });
    assert.deepEqual(schema.enums.ExampleMode, { MODE_A: 0, MODE_B: 1 });
    assert.equal(CjsFormatCarbon.readBlackDefinitions(CjsFormatCarbon.write(sampleReport, schemaDir).outputRoot).classes.ExampleThing.count, "int");

    fs.rmSync(dir, { recursive: true, force: true });
});

test("Black definitions flatten Carbon bases and retain empty concrete classes", () =>
{
    const makeClass = (name, options = {}) => ({
        name,
        family: "inheritance",
        headerFiles: [ `trinity/${name}.h` ],
        cppFiles: [],
        bases: options.bases || [],
        fields: options.fields || [],
        methods: [],
        blue: {
            isExposed: options.exposed !== false,
            files: [ `trinity/${name}_Blue.cpp` ],
            defines: options.concrete === false ? [] : [ { macro: "BLUE_DEFINE", name } ],
            exposures: options.exposed === false ? [] : [ { macro: "EXPOSURE_BEGIN", name } ],
            attributes: options.attributes || [],
            properties: [],
            methods: [],
            interfaces: []
        },
        reviewNotes: []
    });
    const persisted = (name, member, line) => ({
        macro: "MAP_ATTRIBUTE",
        name,
        nameSource: "literal",
        member,
        flags: [ "READWRITE", "PERSIST" ],
        source: `trinity/${name}_Blue.cpp`,
        line
    });
    const report = {
        carbonRoot: "E:/carbonengine",
        generatedAt: "2026-07-12T00:00:00.000Z",
        enums: [],
        families: [ {
            name: "inheritance",
            root: "trinity",
            classes: [
                makeClass("BaseModel", {
                    fields: [ { name: "m_name", type: "std::string" } ],
                    attributes: [ persisted("name", "m_name", 10) ]
                }),
                makeClass("DerivedModel", {
                    bases: [ "BaseModel" ],
                    fields: [ { name: "m_geometryResPath", type: "std::string" } ],
                    attributes: [ persisted("geometryResPath", "m_geometryResPath", 11) ]
                }),
                makeClass("EmptyConcrete"),
                makeClass("ScannerStruct", { concrete: false, exposed: false })
            ]
        } ]
    };

    const classes = CjsFormatCarbon.readBlackDefinitions(report).classes;

    assert.deepEqual(classes.BaseModel, { name: "string" });
    assert.deepEqual(classes.DerivedModel, { name: "string", geometryResPath: "path" });
    assert.deepEqual(classes.EmptyConcrete, {});
    assert.equal(Object.hasOwn(classes, "ScannerStruct"), false);
});

test("read resolves nested members, enum catalog values, and bannerShader overrides from scan reports", () =>
{
    const report = {
        carbonRoot: "E:/carbonengine",
        generatedAt: "2026-07-11T00:00:00.000Z",
        enums: [
            {
                name: "Tr2Lod",
                qualifiedName: "Tr2Lod",
                family: "fixtures",
                values: [
                    { name: "TR2_LOD_HIGH", value: 0 },
                    { name: "TR2_LOD_LOW", value: 1 }
                ]
            }
        ],
        families: [
            {
                name: "fixtures",
                root: "fixtures",
                classes: [
                    {
                        name: "LightData",
                        family: "fixtures",
                        headerFiles: [ "fixtures/LightData.h" ],
                        cppFiles: [ "fixtures/LightData.cpp" ],
                        bases: [],
                        fields: [
                            { name: "position", type: "Vector3" },
                            { name: "rotation", type: "Quaternion" },
                            { name: "texturePath", type: "std::wstring" },
                            { name: "lowestLodVisible", type: "Tr2Lod" }
                        ],
                        methods: [],
                        blue: {
                            isExposed: false,
                            files: [],
                            defines: [],
                            exposures: [],
                            attributes: [],
                            properties: [],
                            methods: [],
                            interfaces: []
                        },
                        reviewNotes: []
                    },
                    {
                        name: "EveSOFDataGenericShader",
                        family: "fixtures",
                        headerFiles: [ "fixtures/EveSOFDataGenericShader.h" ],
                        cppFiles: [ "fixtures/EveSOFDataGenericShader.cpp" ],
                        bases: [],
                        fields: [
                            { name: "m_shader", type: "std::string" }
                        ],
                        methods: [],
                        blue: {
                            isExposed: false,
                            files: [],
                            defines: [],
                            exposures: [],
                            attributes: [],
                            properties: [],
                            methods: [],
                            interfaces: []
                        },
                        reviewNotes: []
                    },
                    {
                        name: "FixtureLight",
                        family: "fixtures",
                        headerFiles: [ "fixtures/FixtureLight.h" ],
                        cppFiles: [ "fixtures/FixtureLight.cpp" ],
                        bases: [],
                        fields: [
                            { name: "m_lightData", type: "LightData" }
                        ],
                        methods: [],
                        blue: {
                            isExposed: true,
                            files: [ "fixtures/FixtureLight_Blue.cpp" ],
                            defines: [
                                { macro: "BLUE_DEFINE", name: "FixtureLight" }
                            ],
                            exposures: [
                                { macro: "EXPOSURE_BEGIN", name: "FixtureLight" }
                            ],
                            attributes: [
                                {
                                    macro: "MAP_ATTRIBUTE",
                                    name: "position",
                                    nameSource: "literal",
                                    member: "m_lightData.position",
                                    flags: [ "READWRITE", "PERSIST" ],
                                    source: "fixtures/FixtureLight_Blue.cpp",
                                    line: 10
                                },
                                {
                                    macro: "MAP_ATTRIBUTE",
                                    name: "rotation",
                                    nameSource: "literal",
                                    member: "m_lightData.rotation",
                                    flags: [ "READWRITE", "PERSIST" ],
                                    source: "fixtures/FixtureLight_Blue.cpp",
                                    line: 11
                                },
                                {
                                    macro: "MAP_ATTRIBUTE",
                                    name: "texturePath",
                                    nameSource: "literal",
                                    member: "m_lightData.texturePath",
                                    flags: [ "READWRITE", "PERSIST" ],
                                    source: "fixtures/FixtureLight_Blue.cpp",
                                    line: 12
                                },
                                {
                                    macro: "MAP_ATTRIBUTE",
                                    name: "lowestLodVisible",
                                    nameSource: "literal",
                                    member: "m_lightData.lowestLodVisible",
                                    flags: [ "READWRITE", "PERSIST" ],
                                    source: "fixtures/FixtureLight_Blue.cpp",
                                    line: 13
                                }
                            ],
                            properties: [],
                            methods: [],
                            interfaces: []
                        },
                        reviewNotes: []
                    },
                    {
                        name: "EveSOFDataGeneric",
                        family: "fixtures",
                        headerFiles: [ "fixtures/EveSOFDataGeneric.h" ],
                        cppFiles: [ "fixtures/EveSOFDataGeneric.cpp" ],
                        bases: [],
                        fields: [
                            { name: "m_bannerShader", type: "PEveSOFDataGenericShader" }
                        ],
                        methods: [],
                        blue: {
                            isExposed: true,
                            files: [ "fixtures/EveSOFDataGeneric_Blue.cpp" ],
                            defines: [
                                { macro: "BLUE_DEFINE", name: "EveSOFDataGeneric" }
                            ],
                            exposures: [
                                { macro: "EXPOSURE_BEGIN", name: "EveSOFDataGeneric" }
                            ],
                            attributes: [
                                {
                                    macro: "MAP_ATTRIBUTE",
                                    name: "bannerShader",
                                    nameSource: "literal",
                                    member: "m_bannerShader",
                                    flags: [ "READ", "PERSIST" ],
                                    source: "fixtures/EveSOFDataGeneric_Blue.cpp",
                                    line: 20
                                }
                            ],
                            properties: [],
                            methods: [],
                            interfaces: []
                        },
                        reviewNotes: []
                    },
                    {
                        name: "Tr2RuntimeInstanceData",
                        family: "fixtures",
                        headerFiles: [ "fixtures/Tr2RuntimeInstanceData.h" ],
                        cppFiles: [],
                        bases: [],
                        fields: [
                            { name: "m_aabb", type: "CcpMath::AxisAlignedBox" }
                        ],
                        methods: [],
                        defaults: {
                            m_aabb: { value: "Vector3( 0, 0, 0 ), Vector3( 0, 0, 0 )" }
                        },
                        blue: {
                            isExposed: true,
                            files: [ "fixtures/Tr2RuntimeInstanceData_Blue.cpp" ],
                            defines: [],
                            exposures: [],
                            attributes: [
                                {
                                    macro: "MAP_ATTRIBUTE",
                                    name: "aabbMin",
                                    nameSource: "literal",
                                    member: "m_aabb.m_min",
                                    flags: [ "READ" ],
                                    source: "fixtures/Tr2RuntimeInstanceData_Blue.cpp",
                                    line: 10
                                },
                                {
                                    macro: "MAP_ATTRIBUTE",
                                    name: "aabbMax",
                                    nameSource: "literal",
                                    member: "m_aabb.m_max",
                                    flags: [ "READ" ],
                                    source: "fixtures/Tr2RuntimeInstanceData_Blue.cpp",
                                    line: 11
                                }
                            ],
                            properties: [],
                            methods: [],
                            interfaces: []
                        },
                        reviewNotes: []
                    }
                ]
            }
        ]
    };

    const bundle = CjsFormatCarbon.read(report);
    const fixtureLight = bundle.families[0].classes.find(item => item.blueClass === "FixtureLight");
    const generic = bundle.families[0].classes.find(item => item.blueClass === "EveSOFDataGeneric");
    const lightByName = new Map(fixtureLight.black.fields.map(field => [ nameForRole(field, "name"), field ]));
    const lightAttrByName = new Map(fixtureLight.attributes.map(field => [ field.blueName, field ]));
    const genericByName = new Map(generic.black.fields.map(field => [ nameForRole(field, "name"), field ]));

    assert.equal(lightAttrByName.get("position").cppType, "Vector3");
    assert.equal(lightByName.get("position").beType, "FLOATARRAY");
    assert.equal(lightByName.get("position").length, 3);
    assert.equal(lightAttrByName.get("rotation").cppType, "Quaternion");
    assert.equal(lightByName.get("rotation").beType, "FLOATARRAY");
    assert.equal(lightByName.get("rotation").length, 4);
    assert.equal(lightAttrByName.get("texturePath").cppType, "std::wstring");
    assert.equal(lightByName.get("texturePath").beType, "STDWSTRING");
    assert.equal(lightByName.get("texturePath").wireType, "wstringRef");
    assert.equal(lightAttrByName.get("lowestLodVisible").cppType, "Tr2Lod");
    assert.equal(lightByName.get("lowestLodVisible").beType, "LONG");
    assert.equal(lightByName.get("lowestLodVisible").enumType, "Tr2Lod");
    assert.equal(genericByName.get("bannerShader").beType, "IROOT");
    assert.equal(genericByName.get("bannerShader").wireType, "inlineObject");

    const instanceData = bundle.families[0].classes.find(item => item.cppClass === "Tr2RuntimeInstanceData");
    const instanceByName = new Map(instanceData.attributes.map(field => [ field.blueName, field ]));
    for (const name of ["aabbMin", "aabbMax"])
    {
        assert.equal(instanceByName.get(name).cppType, "Vector3");
        assert.equal(instanceByName.get(name).default.cpp, "Vector3( 0, 0, 0 )");
    }
});

test("read resolves flattened inline struct leaf fields from scan reports", () =>
{
    const report = {
        carbonRoot: "E:/carbonengine",
        generatedAt: "2026-07-12T00:00:00.000Z",
        enums: [
            {
                name: "State",
                qualifiedName: "State",
                family: "fixtures",
                values: [
                    { name: "STATE_A", value: 0 }
                ]
            }
        ],
        families: [
            {
                name: "fixtures",
                root: "fixtures",
                classes: [
                    {
                        name: "WindowStateHolder",
                        family: "fixtures",
                        headerFiles: [ "fixtures/WindowStateHolder.h" ],
                        cppFiles: [ "fixtures/WindowStateHolder.cpp" ],
                        bases: [],
                        fields: [
                            { name: "windowMode", type: "Tr2WindowMode::Type" },
                            { name: "adapter", type: "uint32_t" },
                            { name: "m_state", type: "State" }
                        ],
                        methods: [],
                        blue: {
                            isExposed: true,
                            files: [ "fixtures/WindowStateHolder_Blue.cpp" ],
                            defines: [
                                { macro: "BLUE_DEFINE", name: "WindowStateHolder" }
                            ],
                            exposures: [
                                { macro: "EXPOSURE_BEGIN", name: "WindowStateHolder" }
                            ],
                            attributes: [
                                {
                                    macro: "MAP_ATTRIBUTE",
                                    name: "windowMode",
                                    nameSource: "literal",
                                    member: "m_state.windowMode",
                                    flags: [ "READWRITE", "PERSIST" ],
                                    source: "fixtures/WindowStateHolder_Blue.cpp",
                                    line: 10
                                },
                                {
                                    macro: "MAP_ATTRIBUTE",
                                    name: "adapter",
                                    nameSource: "literal",
                                    member: "m_state.adapter",
                                    flags: [ "READWRITE", "PERSIST" ],
                                    source: "fixtures/WindowStateHolder_Blue.cpp",
                                    line: 11
                                }
                            ],
                            properties: [],
                            methods: [],
                            interfaces: []
                        },
                        reviewNotes: []
                    }
                ]
            }
        ]
    };

    const bundle = CjsFormatCarbon.read(report);
    const type = bundle.families[0].classes[0];
    const attrByName = new Map(type.attributes.map(field => [ field.blueName, field ]));
    const blackByName = new Map(type.black.fields.map(field => [ nameForRole(field, "name"), field ]));

    assert.equal(attrByName.get("windowMode").cppType, "Tr2WindowMode::Type");
    assert.equal(blackByName.get("windowMode").wireType, "enum");
    assert.equal(attrByName.get("adapter").cppType, "uint32_t");
    assert.equal(blackByName.get("adapter").beType, "ULONG");
    assert.equal(blackByName.get("adapter").wireType, "uint32");

});

test("read ignores commented-out Blue attributes from scan reports", () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-commented-"));
    try
    {
        const sourceDir = path.join(dir, "fixtures");
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(path.join(sourceDir, "CommentedHolder_Blue.cpp"), [
            'MAP_ATTRIBUTE( "count", m_count, "", Be::READWRITE | Be::PERSIST )',
            '//MAP_ATTRIBUTE( "oldCount", m_oldCount, "", Be::READWRITE | Be::PERSIST )'
        ].join("\n"), "utf8");

        const report = {
            carbonRoot: dir,
            generatedAt: "2026-07-12T00:00:00.000Z",
            families: [
                {
                    name: "fixtures",
                    root: "fixtures",
                    classes: [
                        {
                            name: "CommentedHolder",
                            family: "fixtures",
                            headerFiles: [ "fixtures/CommentedHolder.h" ],
                            cppFiles: [ "fixtures/CommentedHolder.cpp" ],
                            bases: [],
                            fields: [
                                { name: "m_count", type: "int" },
                                { name: "m_oldCount", type: "int" }
                            ],
                            methods: [],
                            blue: {
                                isExposed: true,
                                files: [ "fixtures/CommentedHolder_Blue.cpp" ],
                                defines: [
                                    { macro: "BLUE_DEFINE", name: "CommentedHolder" }
                                ],
                                exposures: [
                                    { macro: "EXPOSURE_BEGIN", name: "CommentedHolder" }
                                ],
                                attributes: [
                                    {
                                        macro: "MAP_ATTRIBUTE",
                                        name: "count",
                                        nameSource: "literal",
                                        member: "m_count",
                                        flags: [ "READWRITE", "PERSIST" ],
                                        source: "fixtures/CommentedHolder_Blue.cpp",
                                        line: 1
                                    },
                                    {
                                        macro: "MAP_ATTRIBUTE",
                                        name: "oldCount",
                                        nameSource: "literal",
                                        member: "m_oldCount",
                                        flags: [ "READWRITE", "PERSIST" ],
                                        source: "fixtures/CommentedHolder_Blue.cpp",
                                        line: 2
                                    }
                                ],
                                properties: [],
                                methods: [],
                                interfaces: []
                            },
                            reviewNotes: []
                        }
                    ]
                }
            ]
        };

        const bundle = CjsFormatCarbon.read(report);
        const type = bundle.families[0].classes[0];

        assert.deepEqual(type.attributes.map(field => field.blueName), [ "count" ]);
        assert.deepEqual(type.black.fields.map(field => nameForRole(field, "name")), [ "count" ]);
        assert.equal(type.reviewNotes.some(note => note.type === "blue-attribute-commented-out"), true);
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("read ignores unexpanded attributes captured from macro definition bodies", () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-macro-template-"));
    try
    {
        const sourceDir = path.join(dir, "fixtures");
        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(path.join(sourceDir, "MacroHolder_Blue.cpp"), [
            'MAP_ATTRIBUTE("real", m_real, "", Be::READWRITE | Be::PERSIST)',
            '#define DEFINE_ATTR(NAME) \\',
            '  MAP_ATTRIBUTE(#NAME "Enabled", NAME.enabled, "", Be::READWRITE | Be::PERSIST) \\',
            '  MAP_ATTRIBUTE(#NAME, NAME.value, "", Be::READWRITE | Be::PERSIST)',
            'MAP_ATTRIBUTE("foo", m_foo, "", Be::READWRITE | Be::PERSIST)'
        ].join("\n"), "utf8");

        const report = fieldResolutionReport({
            name: "MacroHolder",
            fields: [
                { name: "m_real", type: "float" },
                { name: "m_foo", type: "float" }
            ],
            blue: {
                files: [ "fixtures/MacroHolder_Blue.cpp" ],
                attributes: [
                    { macro: "MAP_ATTRIBUTE", name: "real", member: "m_real", flags: [ "PERSIST" ], source: "fixtures/MacroHolder_Blue.cpp", line: 1 },
                    { macro: "MAP_ATTRIBUTE", name: "Enabled", member: "NAME.enabled", flags: [ "PERSIST" ], source: "fixtures/MacroHolder_Blue.cpp", line: 3 },
                    { macro: "MAP_ATTRIBUTE", name: "", nameExpression: "#NAME", nameSource: "expression", member: "NAME.value", flags: [ "PERSIST" ], source: "fixtures/MacroHolder_Blue.cpp", line: 4 },
                    { macro: "MAP_ATTRIBUTE", name: "foo", member: "m_foo", flags: [ "PERSIST" ], source: "fixtures/MacroHolder_Blue.cpp", line: 5 }
                ]
            }
        });
        report.carbonRoot = dir;

        const type = CjsFormatCarbon.read(report, { strictSchema: true }).families[0].classes[0];
        assert.deepEqual(type.attributes.map(attribute => attribute.blueName), [ "real", "foo" ]);
        assert.equal(type.reviewNotes.filter(note => note.type === "blue-attribute-macro-template").length, 2);
    }
    finally
    {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("read excludes unexpanded macro placeholder classes but preserves concrete expansions", () =>
{
    const report = fieldResolutionReport({
        name: "_className",
        fields: [],
        blue: {
            defines: [{ macro: "BLUE_DEFINE", name: "_className" }],
            exposures: [{ macro: "EXPOSURE_BEGIN", name: "_className" }],
            attributes: [
                { macro: "MAP_ATTRIBUTE", name: "name", member: "m_name", flags: [ "PERSIST" ] },
                { macro: "MAP_ATTRIBUTE", name: "value", member: "m_value", flags: [ "PERSIST" ] }
            ]
        }
    }, "trinityCore");
    report.families[0].classes.push({
        ...structuredClone(report.families[0].classes[0]),
        name: "EveSocketParameterFloat",
        fields: [
            { name: "m_name", type: "std::string" },
            { name: "m_value", type: "float" }
        ],
        blue: {
            ...structuredClone(report.families[0].classes[0].blue),
            defines: [{ macro: "BLUE_DEFINE", name: "EveSocketParameterFloat" }],
            exposures: [{ macro: "EXPOSURE_BEGIN", name: "EveSocketParameterFloat" }]
        }
    });

    const classes = CjsFormatCarbon.read(report, { strictSchema: true }).families[0].classes;
    assert.deepEqual(classes.map(type => type.blueClass), [ "EveSocketParameterFloat" ]);
    assert.deepEqual(classes[0].attributes.map(attribute => [ attribute.blueName, attribute.cppType ]), [
        [ "name", "std::string" ],
        [ "value", "float" ]
    ]);
});

// "readBlackDefinitions repairs nested leaf types in packaged schema docs"
// (format-carbon test/public-api.test.mjs) is not ported here: it asserts
// against format-carbon's committed real-corpus `src/schema` tree (~1278
// files), which tools-core deliberately does not carry a copy of — schema
// output here is always built on demand into `.scratch`. That real-corpus
// regression coverage stays in format-carbon until/unless a decision is made
// to generate a small fixture corpus for it here.

test("CLI writes and cleans schema output", () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-cli-"));
    const reportPath = path.join(dir, "report.json");
    const outputPath = path.join(dir, "schema");
    const blackOutputPath = path.join(dir, "black");
    const stalePath = path.join(outputPath, "stale.json");
    const cliPath = path.resolve("bin", "cjs-carbon-schema.js");

    fs.mkdirSync(outputPath);
    fs.writeFileSync(reportPath, JSON.stringify(sampleReport), "utf8");
    fs.writeFileSync(stalePath, "{}", "utf8");

    const output = execFileSync(process.execPath, [
        cliPath,
        reportPath,
        "--out",
        outputPath,
        "--black-out",
        blackOutputPath,
        "--clean",
        "--quiet"
    ], { encoding: "utf8" });

    assert.match(output, /Wrote 4 schema files/);
    assert.match(output, /Wrote 1 black definition files/);
    assert.equal(fs.existsSync(stalePath), false);
    assert.equal(fs.existsSync(path.join(outputPath, "index.json")), true);
    assert.equal(fs.existsSync(path.join(blackOutputPath, "black-schema-v1-2026-07-02.json")), true);

    fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI strict schema validation fails before clean removes existing output", () =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "format-carbon-strict-cli-"));
    const reportPath = path.join(dir, "report.json");
    const resolutionPath = path.join(dir, "resolutions.json");
    const outputPath = path.join(dir, "schema");
    const markerPath = path.join(outputPath, "keep.txt");
    const cliPath = path.resolve("bin", "cjs-carbon-schema.js");
    const report = fieldResolutionReport({
        name: "AmbiguousThing",
        fields: [
            { name: "m_value", type: "float" },
            { name: "m_value", type: "Color" }
        ],
        blue: {
            attributes: [{ macro: "MAP_ATTRIBUTE", name: "value", member: "m_value", flags: [ "PERSIST" ] }]
        }
    });

    fs.mkdirSync(outputPath);
    fs.writeFileSync(reportPath, JSON.stringify(report), "utf8");
    fs.writeFileSync(markerPath, "keep", "utf8");

    assert.throws(() => execFileSync(process.execPath, [
        cliPath,
        reportPath,
        "--out",
        outputPath,
        "--clean",
        "--strict-schema"
    ], { encoding: "utf8", stdio: "pipe" }), /schema resolution failed/);
    assert.equal(fs.readFileSync(markerPath, "utf8"), "keep");

    fs.writeFileSync(resolutionPath, JSON.stringify({
        AmbiguousThing: {
            value: {
                member: "m_value",
                select: { cppType: "float" },
                type: "float32",
                reason: "CLI fixture selects the scalar declaration."
            }
        }
    }), "utf8");
    const output = execFileSync(process.execPath, [
        cliPath,
        reportPath,
        "--out",
        outputPath,
        "--clean",
        "--strict-schema",
        "--field-resolutions",
        resolutionPath,
        "--quiet"
    ], { encoding: "utf8" });
    assert.match(output, /Wrote 4 schema files/);
    assert.equal(fs.existsSync(markerPath), false);

    fs.rmSync(dir, { recursive: true, force: true });
});

// "published schema subpaths import generated JSON" (format-carbon
// test/public-api.test.mjs) is not ported: it imports
// `@carbonenginejs/format-carbon/schema`, the published committed real-corpus
// schema tree tools-core deliberately does not carry a copy of. See the
// `readBlackDefinitions` note above.

test("Black definitions expose the generated shared reader schema", async () =>
{
    const definitions = await import("../src/schema/core/blackDefinitions.js");
    const raw = await import("../definitions/black-schema-v1-2026-07-11.json", { with: { type: "json" } });

    assert.equal(definitions.generatedAt, "2026-07-11T14:52:36.015Z");
    assert.equal(raw.default.schema, CjsFormatCarbon.BLACK_DEFINITIONS_SCHEMA_NAME);
    assert.equal(definitions.default, raw.default.classes);
    assert.deepEqual(definitions.default.Tr2SkinnedModel, {
        name: "string",
        meshes: "array",
        geometryResPath: "path",
        skeletonName: "string",
        skinScale: "vector3"
    });
    assert.deepEqual(definitions.default.EveSOF, {});
});

test("schema versioning is forward-only", () =>
{
    assert.throws(
        () => CjsFormatCarbon.read({ schemaVersion: 0, blueClass: "Old", fields: [] }),
        /unsupported schema version 0/
    );

    assert.throws(
        () => CjsFormatCarbon.read({ schemaVersion: 2, blueClass: "Future", fields: [] }),
        /unsupported schema version 2/
    );
});

test("classes hydrate emitted schema nodes", () =>
{
    const reader = new CjsFormatCarbon({ classes: { Schema, Namespace, Type } });
    const bundle = reader.Read(sampleReport);

    assert.equal(bundle instanceof Schema, true);
    assert.equal(bundle.families[0] instanceof Namespace, true);
    assert.equal(bundle.families[0].classes[0] instanceof Type, true);
});

test("toJSON converts class instances to plain values", () =>
{
    const value = new Schema();
    value.name = "schema";

    assert.deepEqual(CjsFormatCarbon.toJSON(value), { name: "schema" });
});
