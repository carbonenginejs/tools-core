import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolTypes } from "../src/types/CjsToolTypes.js";


/**
 * A fake SDE. Only the reads the answer makes, so a lookup this composition
 * is not supposed to do shows up as an unknown table rather than as a pass.
 */
function makeSource(tables)
{
    const read = [];

    return {
        read,
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3466501",
        Table(name)
        {
            return {
                async Get(id)
                {
                    read.push(`${name}/${id}`);

                    const row = tables[name]?.[String(id)];

                    return row ? { id: String(id), payload: row } : null;
                },
            };
        },
        async LoadTables()
        {
            return {};
        },
    };
}

const TABLES = {
    types: {
        587: {
            name: { en: "Rifter", de: "Rifter DE" },
            groupID: 25,
            metaGroupID: 1,
            factionID: 500002,
            raceID: 2,
            graphicID: 46,
            techLevel: 1,
        },
        // Everything a label could be read from is missing.
        999: { name: { en: "Bare" }, groupID: 9999 },
    },
    groups: {
        25: { name: { en: "Frigate", de: "Fregatte" }, categoryID: 6 },
        9999: { name: { en: "Orphan" } },
    },
    categories: { 6: { name: { en: "Ship", de: "Schiff" } } },
    metaGroups: { 1: { name: { en: "Tech I" } } },
    factions: { 500002: { name: { en: "Minmatar Republic" } } },
    races: { 2: { name: { en: "Minmatar" } } },
    graphics: {
        46: {
            // As the SDE writes it: legacy container name, mixed case.
            graphicFile: "res:/dx9/model/ship/minmatar/Frigate/mf1/mf1_t1.red",
            iconFolder: "res:/dx9/model/ship/minmatar/Frigate/mf1/icons",
        },
    },
};


test("a composed type names its taxonomy beside the identifiers", async () =>
{
    const source = makeSource(TABLES);
    const answer = await new CjsToolTypes(source).Answer(587, { language: "en" });

    // The identifiers stay primary - they are the join keys, and a consumer
    // that only got names could not ask anything else about them.
    assert.equal(answer.groupID, 25);
    assert.equal(answer.metaGroupID, 1);
    assert.equal(answer.factionID, 500002);

    // Shaped like every other name in the answer: the text and the language it
    // was actually read in, so a consumer can see when it did not get the one
    // it asked for.
    assert.deepEqual(answer.groupName, { text: "Frigate", language: "en" });
    assert.deepEqual(answer.metaGroupName, { text: "Tech I", language: "en" });
    assert.deepEqual(answer.factionName, { text: "Minmatar Republic", language: "en" });
    assert.deepEqual(answer.raceName, { text: "Minmatar", language: "en" });

    // The category is the GROUP's, and it is what answers "is this a ship".
    assert.equal(answer.categoryID, 6);
    assert.deepEqual(answer.categoryName, { text: "Ship", language: "en" });

    // Artwork is a loadable path, not the SDE's own string: `.red` is the
    // legacy container name and the resource route does not serve it.
    assert.deepEqual(answer.graphics, {
        model: "res:/dx9/model/ship/minmatar/frigate/mf1/mf1_t1.black",
        iconFolder: "res:/dx9/model/ship/minmatar/frigate/mf1/icons",
    });
});

test("labels follow the language the answer was asked in", async () =>
{
    const answer = await new CjsToolTypes(makeSource(TABLES)).Answer(587, { language: "de" });

    assert.deepEqual(answer.groupName, { text: "Fregatte", language: "de" });
    assert.deepEqual(answer.categoryName, { text: "Schiff", language: "de" });

    // The SDE carries no German meta group name, so the answer falls back
    // and SAYS SO. That is why a name is a pair rather than a string: a bare
    // "Tech I" here is indistinguishable from a German string that happens to
    // read the same, and a consumer rendering a language switcher needs to
    // know which of the two it got.
    assert.deepEqual(answer.metaGroupName, { text: "Tech I", language: "en" });
});

test("an unreadable label is omitted, and never fails the type", async () =>
{
    const answer = await new CjsToolTypes(makeSource(TABLES)).Answer(999, { language: "en" });

    assert.equal(answer.typeID, 999);
    assert.equal(answer.groupID, 9999);
    assert.deepEqual(answer.groupName, { text: "Orphan", language: "en" });

    // The group carries no categoryID, so neither category field appears -
    // absent means we have no reading, and a defaulted 0 would read as a real
    // category to anything comparing ids.
    assert.equal("categoryID" in answer, false);
    assert.equal("categoryName" in answer, false);
    assert.equal("metaGroupName" in answer, false);
    assert.equal("factionName" in answer, false);
});

test("it reads no table it does not need", async () =>
{
    const source = makeSource(TABLES);

    await new CjsToolTypes(source).Answer(999, { language: "en" });

    // No metaGroups or factions lookup for a type carrying neither id, and no
    // categories lookup for a group that names no category. Composition that
    // reads unconditionally is how a narrow answer quietly becomes expensive.
    assert.deepEqual(source.read, [ "types/999", "groups/9999" ]);
});

test("an unknown type is null, not an empty answer", async () =>
{
    assert.equal(await new CjsToolTypes(makeSource(TABLES)).Answer(1, {}), null);
    assert.equal(await new CjsToolTypes(makeSource(TABLES)).Variations(1, {}), null);
});

test("traits keep the number apart from the sentence, and resolve the unit", async () =>
{
    const tables = {
        ...TABLES,
        typeBonus: {
            587: {
                types: [ {
                    _key: 3327,
                    _value: [
                        { bonus: 5, unitID: 105, importance: 2, bonusText: { en: "bonus to turret damage" } },
                        { bonus: 7.5, unitID: 105, importance: 1, bonusText: { en: "bonus to turret falloff" } },
                    ],
                } ],
                roleBonuses: [ { bonus: 50, unitID: 105, bonusText: { en: "bonus to armor plate hitpoints" } } ],
            },
        },
        dogmaUnits: { 105: { displayName: { en: "%" }, name: "Percentage" } },
    };

    tables.types[3327] = { name: { en: "Small Projectile Turret" } };

    const answer = await new CjsToolTypes(makeSource(tables)).Traits(587, { language: "en" });

    assert.equal(answer.skillBonuses.length, 1);
    assert.equal(answer.skillBonuses[0].skillTypeID, 3327);
    assert.deepEqual(answer.skillBonuses[0].skillName, { text: "Small Projectile Turret", language: "en" });

    // Importance is the SDE's own ordering and it is not the array order.
    assert.deepEqual(
        answer.skillBonuses[0].bonuses.map(entry => entry.text.text),
        [ "bonus to turret falloff", "bonus to turret damage" ]
    );

    const [ first ] = answer.skillBonuses[0].bonuses;

    assert.equal(first.bonus, 7.5);
    assert.deepEqual(first.unit, { text: "%", language: "en" });
    // Two fields, not one string: joining them is a presentation decision.
    assert.deepEqual(first.text, { text: "bonus to turret falloff", language: "en" });

    assert.equal(answer.roleBonuses[0].bonus, 50);
});

test("a type with no bonus row has no traits, which is not a failure", async () =>
{
    const answer = await new CjsToolTypes(makeSource(TABLES)).Traits(587, {});

    assert.deepEqual(answer, { typeID: 587, skillBonuses: [], roleBonuses: [] });
    assert.equal(await new CjsToolTypes(makeSource(TABLES)).Traits(1, {}), null);
});

test("mastery takes the highest requirement across a tier's certificates", async () =>
{
    const tables = {
        ...TABLES,
        masteries: { 587: { _value: [ { _key: 0, _value: [ 96, 99 ] }, { _key: 1, _value: [ 96 ] } ] } },
        certificates: {
            96: { skillTypes: [
                { _key: 3327, basic: 1, standard: 3 },
                // 0 is the SDE saying "not required at this tier", and a
                // requirement of level zero would render as a real one.
                { _key: 3413, basic: 0, standard: 4 },
            ] },
            99: { skillTypes: [ { _key: 3327, basic: 4, standard: 5 } ] },
        },
    };

    tables.types[3327] = { name: { en: "Small Projectile Turret" } };
    tables.types[3413] = { name: { en: "Power Grid Management" } };

    const answer = await new CjsToolTypes(makeSource(tables)).Mastery(587, { language: "en" });

    assert.equal(answer.complete, true);
    // Tier is zero-based in the SDE and one-based everywhere it is shown.
    assert.deepEqual(answer.levels.map(level => level.level), [ 1, 2 ]);

    const [ basic ] = answer.levels;

    assert.equal(basic.certificateCount, 2);
    // 4 from certificate 99 beats 1 from certificate 96: the tier requires the
    // hardest of its certificates, not the last one read.
    assert.deepEqual(basic.requirements, [
        { typeID: 3327, level: 4, name: { text: "Small Projectile Turret", language: "en" } },
    ]);
});

test("an unreadable certificate answers incomplete rather than easier", async () =>
{
    const tables = {
        ...TABLES,
        masteries: { 587: { _value: [ { _key: 0, _value: [ 96, 12345 ] } ] } },
        certificates: { 96: { skillTypes: [ { _key: 3327, basic: 3 } ] } },
    };

    const answer = await new CjsToolTypes(makeSource(tables)).Mastery(587, {});

    // Dropping the missing certificate would leave a SHORTER requirement list,
    // which reads as a mastery the character has already earned.
    assert.equal(answer.complete, false);
    assert.deepEqual(answer.levels, []);
});

test("variations anchor on the parent, and the parent is one of them", async () =>
{
    const tables = {
        ...TABLES,
        types: {
            ...TABLES.types,
            588: { name: { en: "Rifter Fleet Issue" }, groupID: 25, variationParentTypeID: 587 },
            589: { name: { en: "Retired" }, groupID: 25, variationParentTypeID: 587, published: false },
        },
    };
    const source = makeSource(tables);

    source.Table = (name) => ({
        async Get(id)
        {
            const row = tables[name]?.[String(id)];

            return row ? { id: String(id), payload: row } : null;
        },
        async Find(field, value)
        {
            assert.equal(field, "variationParentTypeID");

            return Object.entries(tables[name] ?? {})
                .filter(([ , row ]) => String(row.variationParentTypeID) === String(value))
                .map(([ id, row ]) => ({ id, payload: { ...row, _key: Number(id) } }));
        },
    });

    // Asked about the VARIANT, answered about the family: a caller looking at a
    // faction hull means "what else is this ship", and the SDE's pointer
    // only ever goes upward.
    const answer = await new CjsToolTypes(source).Variations(588, { language: "en" });

    assert.equal(answer.parentTypeID, 587);
    assert.deepEqual(answer.variations.map(entry => entry.typeID), [ 587, 588 ]);
    assert.equal(answer.variations[0].typeID, 587, "the parent comes first");
    assert.deepEqual(answer.variations[1].groupName, { text: "Frigate", language: "en" });
    assert.equal(answer.variations[1].categoryID, 6);

    // 589 is in the SDE and out of the game. Listing it beside current hulls
    // presents something nobody can fly as a choice.
    assert.equal(answer.variations.some(entry => entry.typeID === 589), false);
});
