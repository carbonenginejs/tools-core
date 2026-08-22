import assert from "node:assert/strict";
import test from "node:test";

import { ProjectTypes, NormalizeLabelText, CJS_DEFAULT_LANGUAGE } from "../src/sde/build/projectTypes.js";

const localization = {
    Get(labelId)
    {
        return {
            1: "Rifter",
            2: "A frigate.\r\nWith two lines.",
            3: "Trailing space ",
            4: "   ",
            5: "Caldari – Navy"
        }[Number(labelId)] ?? null;
    }
};

const record = (overrides = {}) => ({
    nameID: 1,
    groupID: "25",
    factionID: "500002",
    mass: 1067000,
    metaLevel: 0,
    portionSize: 1,
    published: true,
    isDynamicType: false,
    ...overrides
});

test("English is the default, keyed the way the export keys it", () =>
{
    // The file is localization_fsd_en-us.pickle but the export publishes "en".
    assert.equal(CJS_DEFAULT_LANGUAGE, "en");

    const rows = ProjectTypes({ 587: record() }, localization);

    assert.deepEqual(rows[587].name, { en: "Rifter" });
    assert.equal(rows[587]._key, 587);
});

test("identifiers become numbers, because the export publishes numbers", () =>
{
    // UINT_32_IDENTIFIER decodes to a string - an identifier is a key, not a
    // quantity - and the reader is right to do that. The conversion is the
    // export's shape, so it belongs here.
    const rows = ProjectTypes({ 587: record() }, localization);

    assert.equal(rows[587].groupID, 25);
    assert.equal(rows[587].factionID, 500002);
    assert.equal(typeof rows[587].groupID, "number");
});

test("labels are normalised the way the exporter normalises them", () =>
{
    const rows = ProjectTypes({
        1: record({ descriptionID: 2 }),
        2: record({ nameID: 3 }),
        3: record({ descriptionID: 4 }),
        4: record({ nameID: 5 })
    }, localization);

    // CRLF becomes LF: 16,125 of 34,299 English descriptions differ from the
    // export by nothing else.
    assert.equal(rows[1].description.en, "A frigate.\nWith two lines.");

    // Trailing whitespace is dropped: fifteen English names carry one.
    assert.equal(rows[2].name.en, "Trailing space");

    // A label that resolves to blank is omitted, not emitted as "".
    assert.equal(rows[3].description, undefined);

    // Escaped non-ASCII survives - comparing raw is the documented trap.
    assert.equal(rows[4].name.en, "Caldari – Navy");
});

test("zero is dropped where the record stores it and kept where a bit guards it", () =>
{
    const rows = ProjectTypes({
        1: record({ mass: 0, capacity: 0, radius: 0, basePrice: 0, volume: 0, metaLevel: 0 })
    }, localization);

    // Unguarded numerics: the record always stores them, so the export omits
    // the zeros.
    for (const field of [ "mass", "capacity", "radius", "basePrice", "volume" ])
    {
        assert.equal(rows[1][field], undefined, `${field} must be omitted when zero`);
    }

    // metaLevel is presence-guarded. The decoder only supplies it when its bit
    // is set, so a supplied 0 is a real published 0 and must survive.
    assert.equal(rows[1].metaLevel, 0);
});

test("isDynamicType is emitted only when true", () =>
{
    // 89 of 52,863 types are dynamic; the export says nothing about the rest.
    const rows = ProjectTypes({ 1: record(), 2: record({ isDynamicType: true }) }, localization);

    assert.equal(rows[1].isDynamicType, undefined);
    assert.equal(rows[2].isDynamicType, true);
});

test("fields the record does not store are never invented", () =>
{
    // The export publishes packagedVolume and isRepackable; the record stores
    // neither, and a guess is indistinguishable from a measurement downstream.
    const rows = ProjectTypes({ 587: record() }, localization);

    assert.equal(rows[587].packagedVolume, undefined);
    assert.equal(rows[587].isRepackable, undefined);
});

test("the projection refuses inputs it cannot honour", () =>
{
    assert.throws(() => ProjectTypes(null, localization), TypeError);
    assert.throws(() => ProjectTypes({}, {}), TypeError);
});

test("the join key is derived one way, and exported so a join cannot drift", () =>
{
    // English names are used to join records grouped without an identifier
    // relationship. If a join derived its key differently - or skipped the
    // normalisation - it would silently miss the rows this fixes.
    assert.equal(NormalizeLabelText("Trailing space "), "Trailing space");
    assert.equal(NormalizeLabelText("Two\r\nlines"), "Two\nlines");
    assert.equal(NormalizeLabelText("   "), null);
    assert.equal(NormalizeLabelText(null), null);

    // A table that owns the rule is preferred over the local fallback, so the
    // two can never disagree about what a key is.
    const owning = {
        Get: () => "raw ",
        GetNormalized: () => "owned"
    };

    assert.deepEqual(ProjectTypes({ 1: { nameID: 1 } }, owning)[1].name, { en: "owned" });

    // A table offering only Get still works: only Get is required of it.
    assert.deepEqual(
        ProjectTypes({ 1: { nameID: 1 } }, { Get: () => "fallback " })[1].name,
        { en: "fallback" }
    );
});
