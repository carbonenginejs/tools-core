import assert from "node:assert/strict";
import test from "node:test";

import { CJS_TOOL_SDE_TABLE_PROJECTIONS } from "../src/sde/build/tableProjections.js";
import { ProjectRecords } from "../src/sde/build/projectRecords.js";

const CJS_TABLE_PROJECTIONS = CJS_TOOL_SDE_TABLE_PROJECTIONS;

const LABELS = new Map([
    [ 1, "Frigate" ],
    [ 2, "Item Damage" ],
    [ 3, "  Trailing  " ],
]);

const LOCALIZATION = { Get: (id) => LABELS.get(Number(id)) ?? null };

test("identifiers become numbers, because the reader returns them as keys", () =>
{
    const rows = ProjectRecords(
        { 25: { categoryID: "6", iconID: "1443", published: true, nameID: 1 } },
        CJS_TABLE_PROJECTIONS.groups,
        { localization: LOCALIZATION, language: "en" },
    );

    // UINT_32_IDENTIFIER decodes to a string because an identifier is a key
    // rather than a quantity; the export publishes numbers.
    assert.equal(rows["25"].categoryID, 6);
    assert.equal(rows["25"].iconID, 1443);
    assert.equal(rows["25"].published, true);
    assert.deepEqual(rows["25"].name, { en: "Frigate" });
    assert.equal(rows["25"]._key, 25);
});

test("a label that resolves to nothing is not published as an empty one", () =>
{
    const rows = ProjectRecords(
        { 1: { nameID: 99 }, 2: { nameID: 3 } },
        CJS_TABLE_PROJECTIONS.categories,
        { localization: LOCALIZATION, language: "en" },
    );

    assert.equal("name" in rows["1"], false);
    // Whitespace is trimmed the way the exporter trims it.
    assert.deepEqual(rows["2"].name, { en: "Trailing" });
});

test("the exporter's renames are applied, not the client's names", () =>
{
    const rows = ProjectRecords(
        { 3: { categoryID: "7", name: "damage", displayNameID: 2, attributeID: "3", defaultValue: 0 } },
        CJS_TABLE_PROJECTIONS.dogmaAttributes,
        { localization: LOCALIZATION, language: "en" },
    );

    assert.equal(rows["3"].attributeCategoryID, 7);
    assert.equal("categoryID" in rows["3"], false);
    assert.deepEqual(rows["3"].displayName, { en: "Item Damage" });

    // attributeID repeats the record key and the export does not publish it.
    assert.equal("attributeID" in rows["3"], false);
});

test("a widened single is rounded to the six places the export publishes", () =>
{
    const rows = ProjectRecords(
        {
            1656: { defaultValue: 0.699999988079071, name: "a" },
            5432: { defaultValue: 149599993856, name: "b" },
        },
        CJS_TABLE_PROJECTIONS.dogmaAttributes,
        { localization: LOCALIZATION, language: "en" },
    );

    // Both cases at once: the small value loses the digits float32 never had,
    // and the large one keeps the exact value rather than being shortened.
    assert.equal(rows["1656"].defaultValue, 0.7);
    assert.equal(rows["5432"].defaultValue, 149599993856);
});

test("an empty list is the same statement as an absent one", () =>
{
    const rows = ProjectRecords(
        {
            18: { dogmaAttributes: [ { attributeID: "182", value: 3386 } ], dogmaEffects: [] },
            19: { dogmaAttributes: [], dogmaEffects: [] },
        },
        CJS_TABLE_PROJECTIONS.typeDogma,
    );

    assert.deepEqual(rows["18"].dogmaAttributes, [ { attributeID: 182, value: 3386 } ]);
    assert.equal("dogmaEffects" in rows["18"], false);
    assert.deepEqual(rows["19"], { _key: 19 });
});

test("metaGroups colours drop alpha, which graphicMaterialSets keeps", () =>
{
    const rows = ProjectRecords(
        { 1: { color: { r: 0.7803921699523926, g: 0.6666666865348816, b: 0.04313725605607033, a: 1 } } },
        CJS_TABLE_PROJECTIONS.metaGroups,
        { localization: LOCALIZATION, language: "en" },
    );

    assert.deepEqual(rows["1"].color, { b: 0.043137, g: 0.666667, r: 0.780392 });
});

test("icon projection retains an optional description beside the source file", () =>
{
    const rows = ProjectRecords(
        { 355: { description: "Energy weapon", iconFile: "res:/UI/Texture/Icons/13_64_10" } },
        CJS_TABLE_PROJECTIONS.icons,
    );

    assert.deepEqual(rows["355"], {
        _key: 355,
        description: "Energy weapon",
        iconFile: "res:/UI/Texture/Icons/13_64_10",
    });
});

test("a spec that needs labels refuses to run without a table", () =>
{
    assert.throws(
        () => ProjectRecords({ 1: { nameID: 1 } }, CJS_TABLE_PROJECTIONS.categories),
        /requires a localisation table/u,
    );

    // typeDogma declares no labels, so it needs none.
    assert.doesNotThrow(() => ProjectRecords({ 1: {} }, CJS_TABLE_PROJECTIONS.typeDogma));
});

test("a record-valued map is flattened with its own fields beside the key", () =>
{
    const rows = ProjectRecords(
        {
            1000001: {
                divisions: {
                    22: { divisionNumber: 1, leaderID: "3008500", size: 37 },
                    23: { divisionNumber: 2, leaderID: "3008486", size: 41 },
                },
            },
        },
        CJS_TABLE_PROJECTIONS.npcCorporations,
        { localization: LOCALIZATION, language: "en" },
    );

    // Not [{_key,_value}]: the entry's fields sit alongside its key, which is
    // how the export publishes divisions, contraband factions and arc missions.
    assert.deepEqual(rows["1000001"].divisions, [
        { _key: 22, divisionNumber: 1, leaderID: 3008500, size: 37 },
        { _key: 23, divisionNumber: 2, leaderID: 3008486, size: 41 },
    ]);
});

test("a scalar map the export gave real names does not publish _key and _value", () =>
{
    const rows = ProjectRecords(
        { 1: { skillsGranted: { 3450: 2 } } },
        CJS_TABLE_PROJECTIONS.expertSystems,
        { localization: LOCALIZATION, language: "en" },
    );

    assert.deepEqual(rows["1"].skillsGranted, [ { level: 2, typeID: 3450 } ]);
});

test("an identifier list nested inside an entry is converted, one level deeper", () =>
{
    const rows = ProjectRecords(
        {
            100: {
                missions: {
                    14118: { agentID: "3019356", failMissionID: "14118", nextMissions: [ "14119", "14120" ] },
                },
            },
        },
        CJS_TABLE_PROJECTIONS.epicArcs,
        { localization: LOCALIZATION, language: "en" },
    );

    assert.deepEqual(rows["100"].missions, [
        { _key: 14118, agentID: 3019356, failMissionID: 14118, nextMissions: [ 14119, 14120 ] },
    ]);
});

test("an empty map is the same statement as an absent one", () =>
{
    const rows = ProjectRecords(
        { 1: { skillsGranted: {}, durationDays: 30 } },
        CJS_TABLE_PROJECTIONS.expertSystems,
        { localization: LOCALIZATION, language: "en" },
    );

    assert.equal("skillsGranted" in rows["1"], false);
    assert.equal(rows["1"].durationDays, 30);
});

test("a row's fields are ordered the way the export publishes them", () =>
{
    const rows = ProjectRecords(
        { 25: { categoryID: "6", published: true, nameID: 1 } },
        CJS_TABLE_PROJECTIONS.groups,
        { localization: LOCALIZATION, language: "en" },
    );

    // _key leads and the rest are alphabetical. Building in operator order put
    // every resolved label last, so values compared equal and the documents did
    // not - and two exports are compared as JSON.
    assert.deepEqual(Object.keys(rows["25"]), [ "_key", "categoryID", "name", "published" ]);
});

test("an entry resolves labels of its own, however deeply it is nested", () =>
{
    const rows = ProjectRecords(
        {
            582: {
                roleBonuses: [ { bonus: 300, importance: 1, nameID: 1, unitID: 105 } ],
                types: { 3330: [ { bonus: 10, importance: 2, nameID: 2, unitID: 105 } ] },
            },
        },
        CJS_TABLE_PROJECTIONS.typeBonus,
        { localization: LOCALIZATION, language: "en" },
    );

    // The label is resolved inside a list item, and inside a list that is the
    // value of a map entry - two and three levels below the row.
    assert.deepEqual(rows["582"].roleBonuses, [
        { bonus: 300, bonusText: { en: "Frigate" }, importance: 1, unitID: 105 },
    ]);
    assert.deepEqual(rows["582"].types, [
        { _key: 3330, _value: [ { bonus: 10, bonusText: { en: "Item Damage" }, importance: 2, unitID: 105 } ] },
    ]);
});

test("a map nested inside a map entry projects, and 0 becomes false", () =>
{
    const rows = ProjectRecords(
        { 4: { preReqSkills: { 500001: { skills: { 3327: { display: 0, level: 1 } } } } } },
        CJS_TABLE_PROJECTIONS.shipTreeGroups,
        { localization: LOCALIZATION, language: "en" },
    );

    // The client stores 0 and 1; the export publishes a boolean.
    assert.deepEqual(rows["4"].preReqSkills, [
        { _key: 500001, skills: [ { _key: 3327, display: false, level: 1 } ] },
    ]);
});
