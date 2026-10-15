import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import {
    compareClass,
    compareLineage,
    compareOverloads,
    deriveCarbonLineage,
    deriveExpectedFields,
    deriveOverloadSets,
    parseClassFile,
    renderClassFile
} from "../src/schema/core/classTool.js";

const require = createRequire(import.meta.url);
const { __test: scanner } = require("../scripts/carbon-blue/convert.cjs");

// Real Carbon headers when the checkout is present (CARBONENGINE_ROOT, else a `carbonengine` checkout beside the
// organization folder); the snippet tests below run everywhere.
const CARBON = process.env.CARBONENGINE_ROOT || path.resolve(import.meta.dirname, "..", "..", "..", "carbonengine");
const hasCarbon = fs.existsSync(path.join(CARBON, "trinity"));
const carbonFile = rel => path.join(CARBON, rel);

/** A schema-document shape from the scanner's own parsers, for one class. */
function scannedDoc(name, header, blue)
{
    const parsed = scanner.parseHeaderFile(scanner.expandLocalClassMacros(fs.readFileSync(carbonFile(header), "utf8")), header);
    const decl = parsed.classes.find(item => item.name === name);
    const exposure = blue ? scanner.parseBlueFile(fs.readFileSync(carbonFile(blue), "utf8"), blue).classes.find(item => item.name === name) : null;
    return {
        cppClass: name, blueClass: name, declarationKind: decl.declarationKind, bases: decl.bases,
        declarations: [ { source: header, line: decl.line } ],
        fields: decl.fields,
        nativeMethods: decl.methods.map(method => ({ cppName: method.name, declaredOn: name, parameters: method.parameters, isConst: method.isConst })),
        blue: exposure ? { exposures: exposure.exposures, interfaces: exposure.interfaces, chainTo: exposure.chainTo ?? null } : { exposures: [], interfaces: [] }
    };
}

const resolverOf = docs => name => docs[name] || null;

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

test("base lists keep Carbon's order, template arguments and both #if branches", () =>
{
    const header = [
        "BLUE_CLASS( Curve ) :",
        "\tpublic Tr2Curve<Tr2MatrixKey, PTr2MatrixKeyVector, Matrix>",
        "{ int m_a; };",
        "BLUE_CLASS( Vec ) : public ITriVector,",
        "#if BLUE_WITH_PYTHON",
        "\tpublic IPythonMethods,",
        "#endif",
        "\tpublic Vector3",
        "{ int m_b; };",
        "BLUE_INTERFACE_EXPORT( IExported ) : public IRoot { virtual void F() = 0; };"
    ].join("\n");
    const classes = scanner.parseHeaderFile(header, "x.h").classes;
    assert.deepEqual(classes.find(item => item.name === "Curve").bases, [ "Tr2Curve" ]);
    assert.deepEqual(classes.find(item => item.name === "Vec").bases, [ "ITriVector", "IPythonMethods", "Vector3" ]);
    const exported = classes.find(item => item.name === "IExported");
    assert.equal(exported.declarationKind, "interface");
    assert.deepEqual(exported.bases, [ "IRoot" ]);
});

test("declaration lines survive block comments, and overloads stay separate declarations", () =>
{
    const header = [ "/*", " * licence", " */", "BLUE_CLASS( Fx ) : public IRoot", "{",
        "\tvoid Set( const char* name, float v );", "\tvoid Set( const char* name, uint32_t v );", "};" ].join("\n");
    const fx = scanner.parseHeaderFile(header, "fx.h").classes.find(item => item.name === "Fx");
    assert.equal(fx.line, 4);
    assert.deepEqual(fx.methods.filter(method => method.name === "Set").map(method => method.args), [ "const char* name, float v", "const char* name, uint32_t v" ]);
});

test("real headers: AudEmitter keeps Carbon's base order; Tr2Effect keeps all ten SetParameter overloads", { skip: !hasCarbon }, () =>
{
    const audEmitter = scannedDoc("AudEmitter", "audio/src/AudEmitter.h");
    assert.deepEqual(audEmitter.bases, [ "IBlueEventListener", "IBluePlacementObserver", "AudGameObjResource", "ITr2DebugRenderable", "ITr2AudEmitter" ]);
    assert.equal(audEmitter.declarations[0].line, 23);
    const effect = scannedDoc("Tr2Effect", "trinity/trinity/Shader/Tr2Effect.h");
    assert.equal(deriveOverloadSets(effect).get("SetParameter").length, 10);
});

// ---------------------------------------------------------------------------
// Lineage: extends carries state, the rest inherit, own tables, chains
// ---------------------------------------------------------------------------

const audioDocs = {
    AudGameObjResource: { cppClass: "AudGameObjResource", declarationKind: "class", bases: [ "IInitialize" ], fields: [ { cppName: "m_position", cppType: "Vector3" } ] },
    ITr2DebugRenderable: { cppClass: "ITr2DebugRenderable", declarationKind: "interface", bases: [ "IRoot" ] },
    ITr2AudEmitter: { cppClass: "ITr2AudEmitter", declarationKind: "interface", bases: [ "IRoot" ] },
    IRootReaderBase: { cppClass: "IRootReaderBase", declarationKind: "class", bases: [], fields: [ { cppName: "m_stack", cppType: "int" } ] },
    Tr2DeviceResourceAL: { cppClass: "Tr2DeviceResourceAL", declarationKind: "class", bases: [], fields: [ { cppName: "m_device", cppType: "void*" } ] }
};
const audEmitterDoc = {
    cppClass: "AudEmitter", blueClass: "AudEmitter", family: "audio", declarationKind: "class",
    bases: [ "IBlueEventListener", "IBluePlacementObserver", "AudGameObjResource", "ITr2DebugRenderable", "ITr2AudEmitter" ],
    declarations: [ { source: "audio/src/AudEmitter.h", line: 23 } ],
    blue: { isExposed: true, exposures: [ { name: "AudEmitter", source: "audio/src/AudEmitter_Blue.cpp", line: 12 } ],
        interfaces: [ { name: "IBlueEventListener" }, { name: "IBluePlacementObserver" }, { name: "ITr2AudEmitter" }, { name: "ITr2DebugRenderable" } ],
        chainTo: { name: "AudGameObjResource", source: "audio/src/AudEmitter_Blue.cpp", line: 40 } },
    attributes: []
};

test("extends is the base that carries state even when Carbon lists interfaces first", () =>
{
    const lineage = deriveCarbonLineage(audEmitterDoc, { resolveDoc: resolverOf(audioDocs) });
    assert.equal(lineage.extends, "AudGameObjResource");
    assert.deepEqual(lineage.inherit, [ "IBlueEventListener", "IBluePlacementObserver", "ITr2DebugRenderable", "ITr2AudEmitter" ]);
    assert.deepEqual(lineage.interfaces, [ "IBlueEventListener", "IBluePlacementObserver", "ITr2AudEmitter", "ITr2DebugRenderable" ]);
    assert.equal(lineage.chainTo, "AudGameObjResource");
    assert.equal(lineage.isIRoot, true);
});

test("IRoot listed beside a stateful plain base comes through inherit (DictReader : IRoot, IRootReaderBase)", () =>
{
    const doc = { cppClass: "DictReader", declarationKind: "class", bases: [ "IRoot", "IRootReaderBase" ], blue: { exposures: [ { name: "DictReader" } ], interfaces: [] } };
    const lineage = deriveCarbonLineage(doc, { resolveDoc: resolverOf(audioDocs) });
    assert.equal(lineage.extends, "IRootReaderBase");
    assert.deepEqual(lineage.inherit, [ "IRoot" ]);
});

test("a plain AL class stays plain: its AL base, no IRoot, no exposure table", () =>
{
    const doc = { cppClass: "Tr2TextureAL", declarationKind: "class", bases: [ "Tr2DeviceResourceAL" ], blue: { exposures: [], interfaces: [] }, attributes: [], fields: [ { cppName: "m_desc", cppType: "int" } ] };
    const lineage = deriveCarbonLineage(doc, { resolveDoc: resolverOf(audioDocs) });
    assert.equal(lineage.extends, "Tr2DeviceResourceAL");
    assert.equal(lineage.isIRoot, false);
    assert.equal(lineage.exposed, false);
    const source = renderClassFile(deriveExpectedFields(doc), { js: true, doc, resolveDoc: resolverOf(audioDocs) });
    assert.match(source, /export class Tr2TextureAL extends Tr2DeviceResourceAL/);
    assert.doesNotMatch(source, /@blue\.(interface|inherit|chainTo)|IRoot/);
});

test("the emitter writes extends, inherit, an own interface table and the chain from Carbon", () =>
{
    const resolveDoc = resolverOf(audioDocs);
    const source = renderClassFile(deriveExpectedFields(audEmitterDoc), { js: true, doc: audEmitterDoc, resolveDoc });
    assert.match(source, /@blue\.inherit\(IBlueEventListener, IBluePlacementObserver, ITr2DebugRenderable, ITr2AudEmitter\)\n@blue\.interface\(IBlueEventListener, IBluePlacementObserver, ITr2AudEmitter, ITr2DebugRenderable\)\n@blue\.chainTo\(AudGameObjResource\)\nexport class AudEmitter extends AudGameObjResource/);
    assert.match(source, /import \{ IBlueEventListener, IBluePlacementObserver \} from "@carbonenginejs\/runtime\/blue";/);
    // An exposed class that maps only itself still gets its own (empty) table.
    const self = { ...audEmitterDoc, cppClass: "Lone", blueClass: "Lone", bases: [ "IRoot" ], blue: { exposures: [ { name: "Lone" } ], interfaces: [ { name: "Lone" } ] } };
    assert.match(renderClassFile(deriveExpectedFields(self), { js: true, doc: self }), /@blue\.interface\(\)\nexport class Lone extends IRoot/);
    // The emitted file passes its own check.
    const lineage = deriveCarbonLineage(audEmitterDoc, { resolveDoc });
    assert.deepEqual(compareClass(deriveExpectedFields(audEmitterDoc), parseClassFile(source), { lineage, resolveDoc }).fields.filter(item => item.verdict === "lineage"), []);
});

const stretchSource = `
import { meta } from "#schema";
@meta.define({ className: "StretchAudio", family: "audio" })
@meta.blue.inherit(IInitialize)
@meta.blue.interface(IInitialize)
@meta.blue.chainTo(IStretchAudio)
export class StretchAudio extends IStretchAudio
{
}
`;
const stretchDoc = {
    cppClass: "StretchAudio", declarationKind: "class", bases: [ "IStretchAudio", "IInitialize", "ITr2DebugRenderable" ],
    declarations: [ { source: "audio/src/Components/StretchAudio.h", line: 19 } ],
    blue: { exposures: [ { name: "StretchAudio", source: "audio/src/Components/StretchAudio_Blue.cpp", line: 12 } ],
        interfaces: [ { name: "IInitialize", source: "audio/src/Components/StretchAudio_Blue.cpp", line: 13 },
            { name: "ITr2DebugRenderable", source: "audio/src/Components/StretchAudio_Blue.cpp", line: 14 },
            { name: "IStretchAudio", source: "audio/src/Components/StretchAudio_Blue.cpp", line: 15 } ],
        chainTo: null }
};

test("StretchAudio: a chain to an interface Carbon maps instead is reported with Carbon's lines", () =>
{
    const lineage = deriveCarbonLineage(stretchDoc);
    const parsed = parseClassFile(stretchSource);
    const results = compareLineage(lineage, parsed, { reportOnly: true });
    const kinds = results.map(item => `${item.kind} ${item.name}`).sort();
    assert.deepEqual(kinds, [ "chain-extra <chainTo>", "missing-inherit <inherit:ITr2DebugRenderable>",
        "missing-mapped <interface:IStretchAudio>", "missing-mapped <interface:ITr2DebugRenderable>" ]);
    assert.ok(results.every(item => item.severity === "warning"));
    assert.match(results.find(item => item.name === "<interface:IStretchAudio>").notes[0], /StretchAudio_Blue\.cpp:15/);
    // A generated file reports the same findings as drift.
    assert.ok(compareLineage(lineage, parsed, { reportOnly: false }).every(item => item.severity === "error"));
});

test("a maintained class with no own table, or a later stateful base, is reported precisely", () =>
{
    const lineage = deriveCarbonLineage(audEmitterDoc, { resolveDoc: resolverOf(audioDocs) });
    const noTable = parseClassFile(`@meta.define({ className: "AudEmitter" })\n@meta.blue.inherit(IBlueEventListener, IBluePlacementObserver, ITr2DebugRenderable, ITr2AudEmitter)\nexport class AudEmitter extends ITr2AudEmitter {}\n`);
    const kinds = compareLineage(lineage, noTable, { reportOnly: true, resolveDoc: resolverOf(audioDocs) }).map(item => item.kind).sort();
    assert.deepEqual(kinds, [ "chain-missing", "extends-differs", "no-own-table" ]);
    // Imperative exposure (files that stay plain JavaScript) counts as the class's table.
    const imperative = parseClassFile(`export class AudEmitter extends AudGameObjResource {}\nmeta.blue.inherit(IBlueEventListener, IBluePlacementObserver, ITr2DebugRenderable, ITr2AudEmitter)(AudEmitter);\nmeta.blue.interface(IBlueEventListener, IBluePlacementObserver, ITr2AudEmitter, ITr2DebugRenderable)(AudEmitter);\nmeta.blue.chainTo(AudGameObjResource)(AudEmitter);\n`);
    assert.deepEqual(compareLineage(lineage, imperative, { resolveDoc: resolverOf(audioDocs) }), []);
});

test("real Carbon: EveChildCloud2 maps nine interfaces and ends its table; StretchAudio maps IStretchAudio", { skip: !hasCarbon }, () =>
{
    const cloud = scannedDoc("EveChildCloud2", "trinity/trinity/Eve/SpaceObject/Children/EveChildCloud2.h", "trinity/trinity/Eve/SpaceObject/Children/EveChildCloud2_Blue.cpp");
    const lineage = deriveCarbonLineage(cloud);
    assert.deepEqual(lineage.interfaces, [ "ITr2VolumetricRenderable", "IInitialize", "INotify", "IListNotify", "EveSpaceObjectChild", "IEveSpaceObjectChild", "ITr2Renderable", "ITr2LightOwner", "EveEntity" ]);
    assert.equal(lineage.chainTo, null);
    const stretch = deriveCarbonLineage(scannedDoc("StretchAudio", "audio/src/Components/StretchAudio.h", "audio/src/Components/StretchAudio_Blue.cpp"));
    assert.deepEqual(stretch.interfaces, [ "IInitialize", "ITr2DebugRenderable", "IStretchAudio" ]);
    assert.equal(stretch.chainTo, null);
});

// ---------------------------------------------------------------------------
// Overloads (agent-rules rule 9)
// ---------------------------------------------------------------------------

const param = (type, name) => ({ type, name });
const name = param("const BlueSharedString&", "name");
const effectDoc = {
    cppClass: "Tr2Effect",
    nativeMethods: [
        [ name, param("float", "value") ], [ name, param("uint32_t", "value") ], [ name, param("const Vector2&", "value") ],
        [ name, param("const Vector3&", "value") ], [ name, param("const Vector4&", "value") ], [ name, param("const Matrix&", "value") ],
        [ name, param("ITr2GpuBuffer*", "buffer") ], [ name, param("ITr2TextureProvider*", "texture"), param("uint32_t", "uavMipLevel") ],
        [ name, param("const Tr2TextureAL&", "texture"), param("uint32_t", "uavMipLevel") ], [ name, param("const Tr2BufferAL&", "buffer") ]
    ].map(parameters => ({ cppName: "SetParameter", declaredOn: "Tr2Effect", parameters })).concat([
        // A const / non-const pair is one overload, not two.
        { cppName: "GetValue", declaredOn: "Tr2Effect", parameters: [], isConst: true },
        { cppName: "GetValue", declaredOn: "Tr2Effect", parameters: [], isConst: false }
    ])
};
const method = (methodName, parameters, status = "implemented") => ({ name: methodName, parameters, implStatusNames: [ status ], hasCarbon: true, carbonNames: [ "method" ], carbonOriginalNames: [] });
const effectMethods = () => [
    method("SetParameter", [ "name", "value" ]),
    method("SetParameter__UInt32", [ "name", "value" ]), method("SetParameter__Vector2", [ "name", "value" ]),
    method("SetParameter__Vector3", [ "name", "value" ]), method("SetParameter__Vector4", [ "name", "value" ]),
    method("SetParameter__Matrix", [ "name", "value" ]), method("SetParameter__GpuBuffer", [ "name", "buffer" ]),
    method("SetParameter__TextureProvider", [ "name", "texture", "uavMipLevel" ]), method("SetParameter__TextureAL", [ "name", "texture", "uavMipLevel" ]),
    method("SetParameter__BufferAL", [ "name", "buffer" ])
];

test("Tr2Effect's ten SetParameter overloads are covered once each by nine variants and the bare name", () =>
{
    const sets = deriveOverloadSets(effectDoc);
    assert.deepEqual([ ...sets.keys() ], [ "SetParameter" ]);
    const { results, credited } = compareOverloads(sets, effectMethods());
    assert.deepEqual(results, []);
    assert.equal(credited.size, 10);
});

test("uncovered, unmatched and duplicate overload methods are each reported", () =>
{
    const sets = deriveOverloadSets(effectDoc);
    const methods = effectMethods().filter(item => item.name !== "SetParameter__Matrix" && item.name !== "SetParameter__Vector4");
    methods.push(method("SetParameter__Quaternion", [ "name", "value" ]), method("SetParameter__Vector3Copy", [ "name", "value" ]));
    const kinds = compareOverloads(sets, methods).results.map(item => `${item.kind} ${item.name}`).sort();
    assert.deepEqual(kinds, [
        "overload-duplicate SetParameter__Vector3|SetParameter__Vector3Copy",
        "overload-uncovered SetParameter(BlueSharedString,Matrix)",
        "overload-uncovered SetParameter(BlueSharedString,Vector4)",
        "overload-unmatched SetParameter__Quaternion"
    ]);
});

test("a bare router marked adapted or notSupported keeps no overload; a type-tagged funnel covers its set", () =>
{
    const castDoc = { cppClass: "EveTurretSet", nativeMethods: [
        { cppName: "IsCastingShadow", declaredOn: "EveTurretSet", parameters: [ param("const Frustum&", "cameraFrustum"), param("const Frustum&", "shadowFrustum") ] },
        { cppName: "IsCastingShadow", declaredOn: "EveTurretSet", parameters: [ param("const Vector3&", "position"), param("float", "radius") ] } ] };
    const routed = [ method("IsCastingShadow", [ "...args" ], "notSupported"),
        method("IsCastingShadow__ShadowFrustum", [ "cameraFrustum", "shadowFrustum" ]), method("IsCastingShadow__PositionRadius", [ "position", "radius" ]) ];
    assert.deepEqual(compareOverloads(deriveOverloadSets(castDoc), routed).results, []);

    const storeDoc = { cppClass: "Tr2VariableStore", nativeMethods: [
        { cppName: "RegisterVariable", declaredOn: "Tr2VariableStore", parameters: [ param("const char*", "name"), param("float", "value") ] },
        { cppName: "RegisterVariable", declaredOn: "Tr2VariableStore", parameters: [ param("const char*", "name"), param("const Vector4&", "value") ] },
        { cppName: "RegisterVariable", declaredOn: "Tr2VariableStore", parameters: [ param("const char*", "name"), param("const Tr2TextureAL&", "texture") ] },
        { cppName: "RegisterVariableInternal", declaredOn: "Tr2VariableStore", parameters: [ param("const char*", "name"), param("U", "value") ] } ] };
    const funnel = [ method("RegisterVariableInternal", [ "name", "contentType", "value" ]), method("RegisterVariable__TextureAL", [ "name", "texture" ]) ];
    const result = compareOverloads(deriveOverloadSets(storeDoc), funnel, { nativeNames: storeDoc.nativeMethods.map(item => item.cppName) });
    assert.deepEqual(result.results, []);
    assert.ok(result.credited.has("RegisterVariableInternal") && result.credited.has("RegisterVariable__TextureAL"));
});

test("matching follows Carbon's parameter names, type meaning and native-type rule (cases from real classes)", () =>
{
    // Tr2Blitter.h:33-36: Draw__Texture is the (renderContext, texture, ...) overload, not (renderContext, effect, texture).
    const ctx = param("Tr2RenderContext&", "renderContext"), tex = param("const Tr2TextureAL&", "texture"), v2 = name => param("const Vector2&", name);
    const blitter = { cppClass: "Tr2Blitter", nativeMethods: [
        [ ctx, tex, v2("tlTexCoord"), v2("brTexCoord"), param("Filtering", "filter") ],
        [ ctx, param("Tr2Material*", "effect"), tex ] ].map(parameters => ({ cppName: "Draw", declaredOn: "Tr2Blitter", parameters })) };
    assert.deepEqual(compareOverloads(deriveOverloadSets(blitter), [
        method("Draw__Texture", [ "renderContext", "texture", "tlTexCoord", "brTexCoord", "filter" ]),
        method("Draw__EffectTexture", [ "renderContext", "effect", "texture" ]) ]).results, []);

    // Tr2Curve*::Update (Vector3*, Be::Time) / (Vector3*, double): __Ticks names Be::Time even though
    // both parameters are called `time`; the adapted bare Update keeps the double overload.
    const out = param("Vector3*", "value");
    const curve = { cppClass: "Tr2TranslationAdapter", nativeMethods: [
        [ out, param("Be::Time", "time") ], [ out, param("double", "time") ] ].map(parameters => ({ cppName: "Update", declaredOn: "Tr2TranslationAdapter", parameters })) };
    assert.deepEqual(compareOverloads(deriveOverloadSets(curve), [
        method("Update", [ "time", "out" ], "adapted"), method("Update__Ticks", [ "time", "out" ]) ]).results, []);
    // Without the variant, the bare name keeps the native (double) overload and Be::Time is uncovered.
    const missing = compareOverloads(deriveOverloadSets(curve), [ method("Update", [ "time", "out" ], "adapted") ]).results;
    assert.deepEqual(missing.map(item => item.name), [ "Update(Vector3,Be::Time)" ]);
});

test("method coverage credits variants to their Carbon name instead of listing them as unknown", () =>
{
    const doc = { cppClass: "Tr2Effect", blueClass: "Tr2Effect", family: "shader", attributes: [], nativeMethods: effectDoc.nativeMethods };
    const source = `@meta.define({ className: "Tr2Effect", family: "shader" })\nexport class Tr2Effect\n{\n` + effectMethods().map(item =>
        `  @meta.blue.method\n  @meta.implemented\n  ${item.name}(${item.parameters.join(", ")}) {}\n`).join("") + "}\n";
    const result = compareClass(deriveExpectedFields(doc), parseClassFile(source), { overloadSets: deriveOverloadSets(doc) });
    assert.equal(result.methods.filter(item => item.verdict === "additional-carbon-method").length, 0);
    assert.equal(result.methods.filter(item => item.verdict === "overload").length, 0);
});

test("real Carbon: Tr2Effect.h overloads match the runtime's SetParameter split", { skip: !hasCarbon }, () =>
{
    const effect = scannedDoc("Tr2Effect", "trinity/trinity/Shader/Tr2Effect.h");
    const sets = deriveOverloadSets(effect);
    assert.deepEqual(compareOverloads(new Map([ [ "SetParameter", sets.get("SetParameter") ] ]), effectMethods()).results, []);
});
