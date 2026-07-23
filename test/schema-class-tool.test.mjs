import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    compareClass,
    deriveExpectedFields,
    parseClassFile
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
