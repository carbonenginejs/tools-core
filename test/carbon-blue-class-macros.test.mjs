import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { CjsFormatCarbon } from "../src/schema/index.js";

const require = createRequire(import.meta.url);
const { __test: scanner } = require("../scripts/carbon-blue/convert.cjs");

// Shaped on EveSocketParameter.h:49-76 and EveSocketParameter_Blue.cpp:16-41.
const HEADER = [
    "#define SOCKET_PARAM_DECLARE( _className, _valueType ) \\",
    "\tBLUE_CLASS( _className ) : \\",
    "\t\tpublic EveSocketParameterBindingBase \\",
    "\t{ \\",
    "\tpublic: \\",
    "\t\tEXPOSE_TO_BLUE(); \\",
    "\tprivate: \\",
    "\t\t_valueType m_value; \\",
    "\t}; \\",
    "\tTYPEDEF_BLUECLASS( _className );",
    "",
    "SOCKET_PARAM_DECLARE( EveSocketParameterFloat, float );",
    "SOCKET_PARAM_DECLARE( EveSocketParameterColor, Color );",
    "BLUE_CLASS( After )",
    "{",
    "\tint m_after;",
    "};"
].join("\n");

const BLUE = [
    "#define SOCKET_PARAM_EXPOSE_TO_BLUE( _className, _valueDescription ) \\",
    "\tBLUE_DEFINE( _className ); \\",
    "\tconst Be::ClassInfo* _className::ExposeToBlue() \\",
    "\t{ \\",
    "\t\tEXPOSURE_BEGIN( _className, \"\" ) \\",
    "\t\t\tMAP_ATTRIBUTE( \"value\", m_value, _valueDescription, Be::READWRITE | Be::PERSIST ) \\",
    "\t\tEXPOSURE_END() \\",
    "\t}",
    "",
    "SOCKET_PARAM_EXPOSE_TO_BLUE( EveSocketParameterFloat, \"Attribute value.\" );",
    "SOCKET_PARAM_EXPOSE_TO_BLUE( EveSocketParameterColor, \"Attribute value.\" );"
].join("\n");

test("class-declaring macros expand without moving any line", () =>
{
    for (const text of [ HEADER, BLUE ])
    {
        const expanded = scanner.expandLocalClassMacros(text);
        const before = text.split("\n");
        const after = expanded.split("\n");
        // Original lines keep their numbers; header classes are appended after.
        assert.ok(after.length >= before.length);
        assert.equal(after.indexOf("BLUE_CLASS( After )"), before.indexOf("BLUE_CLASS( After )"));
    }
});

test("macro-declared classes reach the header and Blue parsers", () =>
{
    const header = scanner.parseHeaderFile(scanner.expandLocalClassMacros(HEADER), "EveSocketParameter.h");
    const fields = Object.fromEntries(header.classes.map(item => [ item.name, item.fields.map(field => `${field.name}:${field.type}`) ]));
    assert.deepEqual(fields.EveSocketParameterFloat, [ "m_value:float" ]);
    assert.deepEqual(fields.EveSocketParameterColor, [ "m_value:Color" ]);
    assert.deepEqual(fields.After, [ "m_after:int" ]);

    const blue = scanner.parseBlueFile(scanner.expandLocalClassMacros(BLUE), "EveSocketParameter_Blue.cpp");
    const attributes = Object.fromEntries(blue.classes.map(item => [ item.name, item.attributes.map(attr => `${attr.name}@${attr.line}`) ]));
    assert.deepEqual(attributes.EveSocketParameterFloat, [ "value@10" ]);
    assert.deepEqual(attributes.EveSocketParameterColor, [ "value@11" ]);
});

test("Black definitions resolve unqualified class-scope structs and CcpMath::Sphere", () =>
{
    const blue = (name, attributes) => ({
        isExposed: true,
        files: [ `trinity/${name}_Blue.cpp` ],
        defines: [ { macro: "BLUE_DEFINE", name } ],
        exposures: [ { macro: "EXPOSURE_BEGIN", name } ],
        attributes: attributes.map(([ attrName, member ], line) => ({
            macro: "MAP_ATTRIBUTE",
            name: attrName,
            nameSource: "literal",
            member,
            flags: [ "READWRITE", "PERSIST" ],
            source: `trinity/${name}_Blue.cpp`,
            line: line + 1
        })),
        properties: [],
        methods: [],
        interfaces: []
    });
    const struct = (name, fields) => ({
        name,
        family: "wire",
        declarationKind: "struct",
        headerFiles: [ "trinity/Outer.h" ],
        cppFiles: [],
        bases: [],
        fields,
        methods: [],
        blue: { isExposed: false, files: [], defines: [], exposures: [], attributes: [], properties: [], methods: [], interfaces: [] },
        reviewNotes: []
    });
    const report = {
        carbonRoot: "E:/carbonengine",
        generatedAt: "2026-09-20T00:00:00.000Z",
        enums: [],
        families: [ {
            name: "wire",
            root: "trinity",
            classes: [
                struct("Tr2VolumetricsRenderer.FroxelFogSettings", [ { name: "intensity", type: "float" } ]),
                {
                    ...struct("EveChildFogVolume", [ { name: "m_settings", type: "FroxelFogSettings" } ]),
                    declarationKind: "class",
                    blue: blue("EveChildFogVolume", [ [ "intensity", "m_settings.intensity" ] ])
                },
                {
                    ...struct("EveSphereVolume", [ { name: "m_outerSphere", type: "CcpMath::Sphere" } ]),
                    declarationKind: "class",
                    blue: blue("EveSphereVolume", [ [ "position", "m_outerSphere.center" ], [ "radius", "m_outerSphere.radius" ] ])
                }
            ]
        } ]
    };

    const classes = CjsFormatCarbon.readBlackDefinitions(report).classes;

    assert.deepEqual(classes.EveChildFogVolume, { intensity: "float" });
    assert.deepEqual(classes.EveSphereVolume, { position: "vector3", radius: "float" });
});
