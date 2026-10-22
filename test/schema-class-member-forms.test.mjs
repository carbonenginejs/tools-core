import assert from "node:assert/strict";
import test from "node:test";
import { compareClass, deriveExpectedFields, parseClassFile, renderClassFile } from "../src/schema/core/classTool.js";

// decorator-upgrade.md § 00: the emitter writes Carbon's rows as be.map* decorators, flags as written, and the parser reads them back.

const field = (overrides) => ({
    name: "value", key: "value", role: "member", member: "m_value", cppType: "float", flags: [ "READWRITE", "PERSIST" ], macro: "MAP_ATTRIBUTE",
    chooser: null, kind: "float32", typeArg: null, enumType: null, enumQualifiedName: null, rotationLike: false, io: null, ioDecorators: [], editFlags: [],
    notify: false, default: { determinate: true, source: "schema", value: 0 }, notes: [], ...overrides
});
const render = (fields, methods = [], meta = {}) => renderClassFile({ fields, methods, meta: { className: "Probe", family: "probe", ...meta } }, { js: true });

test("an attribute row carries Carbon's flags as written and the exposed name only when it differs from the key", () =>
{
    const source = render([ field({}), field({ name: "damping", key: "_damping", flags: [ "READ", "NOTIFY" ] }) ]);
    assert.match(source, /@be\.mapAttribute\(be\.READWRITE \| be\.PERSIST\)\n  @type\.float32\n  value = /);
    assert.match(source, /@be\.mapAttribute\(be\.READ \| be\.NOTIFY, "damping"\)\n  @type\.float32\n  _damping = /);
    assert.doesNotMatch(source, /@blue\.(?:read|readwrite|persist|notify|attribute)/);
});

test("a chooser row names the registered enum, and an indexed row names the element", () =>
{
    const source = render([
        field({ name: "font", key: "font", macro: "MAP_ATTRIBUTE_WITH_CHOOSER", flags: [ "READWRITE", "PERSIST", "ENUM" ], enumQualifiedName: "trinity.TriDebugFont" }),
        field({ name: "Primary", key: "materials", index: 0 })
    ]);
    assert.match(source, /@be\.mapAttributeWithChooser\(be\.READWRITE \| be\.PERSIST \| be\.ENUM, "trinity\.TriDebugFont"\)/);
    assert.match(source, /@be\.mapAttribute__Index\(be\.READWRITE \| be\.PERSIST, "Primary", 0\)/);
});

test("property rows follow the macro", () =>
{
    const source = render([
        field({ name: "level", key: "level", role: "property", macro: "MAP_PROPERTY_READONLY", flags: [ "READ" ] }),
        field({ name: "saved", key: "saved", role: "property", macro: "MAP_PROPERTY_PERSISTED", flags: [ "READWRITE", "PERSIST" ] }),
        field({ name: "free", key: "free", role: "property", macro: "MAP_PROPERTY", flags: [ "READWRITE" ] })
    ]);
    assert.match(source, /@be\.mapPropertyReadOnly\(\)\n  @type\.float32\n  @meta\.notImplemented\n  get level/);
    assert.match(source, /@be\.mapPropertyPersisted\(\)[\s\S]*get saved/);
    assert.match(source, /@be\.mapProperty\(\)[\s\S]*get free/);
});

test("method rows follow the macro; an interface method carries no Carbon row", () =>
{
    const source = render([], [
        { name: "Reset", target: "Reset", macro: "MAP_METHOD_AND_WRAP", parameters: [] },
        { name: "Seek", target: "Seek", macro: "MAP_METHOD", parameters: [] },
        { name: "Run", target: "Run", macro: "MAP_METHOD_AND_WRAP_OPTIONAL_ARGS", parameters: [] },
        { name: "Pure", target: "Pure", interface: "IProbe", parameters: [] }
    ]);
    assert.match(source, /@be\.mapMethodAndWrap\(\)\n  @meta\.notImplemented\n  Reset\(/);
    assert.match(source, /@be\.mapMethod\(\)\n  @meta\.notImplemented\n  Seek\(/);
    assert.match(source, /@be\.mapMethodAndWrapOptionalArgs\(\)\n  @meta\.notImplemented\n  Run\(/);
    assert.match(source, /\n  @meta\.notImplemented\n  Pure\(/);
    assert.doesNotMatch(source, /@blue\.method/);
});

test("rows a block maps for members a base exposes sit above the class", () =>
{
    const source = render([], [], { inheritedRows: [
        { kind: "method", macro: "MAP_METHOD_AND_WRAP", name: "RebuildLocalTransform" },
        { kind: "property", macro: "MAP_PROPERTY_READONLY", name: "partTag" },
        { kind: "attribute", macro: "MAP_ATTRIBUTE", name: "animationOwner", flags: [ "READ" ] }
    ] });
    assert.match(source, /@be\.mapMethodAndWrap\("RebuildLocalTransform"\)\n@be\.mapPropertyReadOnly\("partTag"\)\n@be\.mapAttribute\(be\.READ, "animationOwner"\)\nexport class Probe/);
});

test("the parser reads the be rows as the records the legacy decorators made", () =>
{
    const source = [
        "@be.define(\"Probe\")",
        "export class Probe",
        "{",
        "  @be.mapAttribute(be.READWRITE | be.PERSIST)",
        "  @type.float32",
        "  value = 0;",
        "",
        "  @be.mapAttribute(be.READ | be.NOTIFY, \"damping\")",
        "  @type.float32",
        "  _damping = 0;",
        "",
        "  @be.mapAttribute__Index(be.READWRITE | be.PERSIST, \"Primary\", 3)",
        "  @type.float32",
        "  slots = 0;",
        "",
        "  @be.mapPropertyPersisted()",
        "  @type.float32",
        "  @meta.notImplemented",
        "  get saved()",
        "  {",
        "    return 0;",
        "  }",
        "",
        "  @be.mapMethodAndWrap()",
        "  @meta.notImplemented",
        "  Reset()",
        "  {",
        "  }",
        "}"
    ].join("\n");
    const parsed = parseClassFile(source);
    const byKey = Object.fromEntries(parsed.fields.map(item => [ item.key, item ]));
    assert.deepEqual(byKey.value.editFlags, [ "READ", "WRITE", "PERSIST" ]);
    assert.equal(byKey._damping.name, "damping");
    assert.deepEqual(byKey._damping.editFlags, [ "READ", "NOTIFY" ]);
    assert.equal(byKey.slots.name, "Primary");
    assert.equal(byKey.slots.index, 3);
    assert.equal(byKey.saved.role, "property");
    assert.equal(byKey.saved.persisted, true);
});

test("pointer kinds are type.object.ref, weak and embed, and the parser reads them back as the kinds they replace", () =>
{
    const source = render([
        field({ name: "owner", key: "owner", kind: "rootRef", typeArg: "Owner", flags: [ "READ" ], cppType: "OwnerPtr" }),
        field({ name: "parent", key: "parent", kind: "rootWeak", typeArg: "Parent", flags: [ "READ" ], cppType: "BlueWeakRef<Parent>" }),
        field({ name: "held", key: "held", kind: "root", typeArg: "Held", flags: [ "READ" ], cppType: "Held" })
    ]);
    assert.match(source, /@type\.object\.ref\("Owner"\)/);
    assert.match(source, /@type\.object\.weak\("Parent"\)/);
    assert.match(source, /@type\.object\.embed\("Held"\)/);
    assert.doesNotMatch(source, /@type\.root(?:Ref|Weak)?\(/);
    const parsed = Object.fromEntries(parseClassFile(source).fields.map(item => [ item.key, item ]));
    assert.equal(parsed.owner.kind, "rootRef");
    assert.equal(parsed.parent.kind, "rootWeak");
    assert.equal(parsed.held.kind, "root");
});

test("a raw pointer member is weak, a BluePtr or XPtr member is a counted reference", () =>
{
    const doc = { family: "probe", blueClass: "Pointers", cppClass: "Pointers", attributes: [
        { blueName: "raw", member: "m_raw", cppType: "Target*", flags: [ "READ" ], black: { beType: "IROOTPTR", wireType: "objectRef", cppType: "Target*" } },
        { blueName: "counted", member: "m_counted", cppType: "TargetPtr", flags: [ "READ" ], black: { beType: "IROOTPTR", wireType: "objectRef", cppType: "TargetPtr" } }
    ] };
    const kinds = Object.fromEntries(deriveExpectedFields(doc).fields.map(item => [ item.name, item.kind ]));
    assert.deepEqual(kinds, { raw: "rootWeak", counted: "rootRef" });
});

test("a class Carbon derives from IRoot directly inherits it, and a chooser names the enum as the runtime registers it", () =>
{
    const doc = { family: "probe", blueClass: "Direct", cppClass: "Direct", bases: [ "IRoot" ], blue: { exposures: [ { name: "Direct" } ], interfaces: [ { name: "Direct" } ] } };
    assert.match(renderClassFile(deriveExpectedFields(doc), { js: true, doc }), /@be\.define\("Direct"\)\n@be\.inherit\(IRoot\)\nexport class Direct extends IRoot/);
    const source = render([ field({ name: "font", key: "font", macro: "MAP_ATTRIBUTE_WITH_CHOOSER", flags: [ "READWRITE", "ENUM" ], enumType: "TriDebugFont", enumRegisteredName: "trinity.TriDebugFont" }) ]);
    assert.match(source, /@be\.mapAttributeWithChooser\(be\.READWRITE \| be\.ENUM, "trinity\.TriDebugFont"\)/);
});

test("@type.enum carries the registered enum name, and the comparison accepts it", () =>
{
    const expected = { fields: [ field({ name: "font", key: "font", kind: "int32", enumType: "TriDebugFont", enumRegisteredName: "trinity.TriDebugFont",
        macro: "MAP_ATTRIBUTE_WITH_CHOOSER", flags: [ "READWRITE", "ENUM" ] }) ], methods: [], meta: { className: "Probe", family: "probe" } };
    const source = renderClassFile(expected, { js: true });
    assert.match(source, /@type\.enum\("trinity\.TriDebugFont"\)/);
    const parsed = parseClassFile(source);
    assert.equal(parsed.fields[0].enumArg, "trinity.TriDebugFont");
    const notes = compareClass(expected, parsed, {}).fields.flatMap(item => item.notes || []).join(" ");
    assert.doesNotMatch(notes, /enum type differs/);
});
