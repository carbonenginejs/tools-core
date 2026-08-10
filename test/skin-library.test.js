import assert from "node:assert/strict";
import test from "node:test";

import {
    CjsToolHttpProxy,
    CjsToolSkin,
    CjsToolSkinBuilder,
    CjsToolSkinrBuilder,
} from "../src/index.js";
import { CjsToolSkinrPattern } from "../src/skin/CjsToolSkinrPattern.js";

const Tables = Object.freeze({
    skins: {
        11: { _key: 11, skinMaterialID: 100, types: [ 2 ], internalName: "Second" },
        10: { _key: 10, skinMaterialID: 100, types: [ 2, 1 ], internalName: "First" },
    },
    skinMaterials: {
        100: { _key: 100, displayName: { en: "Test" }, materialSetID: 1000 },
    },
    skinLicenses: {
        500: { _key: 500, duration: -1, licenseTypeID: 500, skinID: 10 },
        501: { _key: 501, duration: -1, licenseTypeID: 501, skinID: 999 },
    },
    graphicMaterialSets: {
        1000: {
            _key: 1000,
            custommaterial1: "pattern-primary",
            custommaterial2: "pattern-secondary",
            material1: "hull-primary",
            sofFactionName: "test",
        },
    },
    skinrComponentCategories: {
        3: { _key: 3, name: "Metallic" },
    },
    skinrComponentPointValues: {
        3: { _key: 3, _value: [
            { _key: 2, _value: 50 },
            { _key: 1, _value: 25 },
        ] },
    },
    skinrComponentRarities: {
        2: { _key: 2, name: { en: "Uncommon" }, rank: 2 },
    },
    skinrComponents: {
        53: {
            _key: 53,
            associatedTypeIds: [
                { licenseUsesGranted: -1, typeID: 83060 },
                { licenseUsesGranted: 1, typeID: 82957 },
            ],
            category: 3,
            name: { en: "Plasmic Test" },
            projectionTypeU: "repeat",
            projectionTypeV: "clamp-to-border",
            published: true,
            rarity: 2,
            resourceFile: "res:/materials/plasmic_test.red",
        },
        54: {
            _key: 54,
            associatedTypeIds: [],
            category: 3,
            name: { en: "Pattern Test" },
            // Both SDE projection labels, so the emitted layer must show two
            // different numbers rather than one repeated.
            projectionTypeU: "clamp-to-edge",
            projectionTypeV: "repeat",
            published: true,
            rarity: 2,
            resourceFile: "res:/texture/pattern/pattern_test.dds",
        },
    },
    skinrSlotCategories: {
        1: { _key: 1, name: "Material_slot" },
    },
    skinrSlotConfigurations: {
        5: {
            _key: 5,
            allowAllShips: true,
            config: [ 2, 1 ],
            name: "Default configuration",
            priority: 3,
        },
        3: {
            _key: 3,
            config: [ 1 ],
            name: "Special configuration",
            priority: 0,
            ships: [ 100 ],
        },
    },
    skinrSlotNames: {
        1: { _key: 1, name: "primary_nanocoating" },
        2: { _key: 2, name: "secondary_nanocoating" },
        3: { _key: 3, name: "tertiary_nanocoating" },
        4: { _key: 4, name: "tech_area" },
        5: { _key: 5, name: "pattern" },
        6: { _key: 6, name: "secondary_pattern" },
        7: { _key: 7, name: "pattern_material" },
        8: { _key: 8, name: "secondary_pattern_material" },
    },
    skinrSlots: {
        1: {
            _key: 1,
            allowedDesignComponentCategories: [ 3 ],
            category: 1,
            name: { en: "Primary Slot" },
        },
        2: {
            _key: 2,
            allowedDesignComponentCategories: [ 3 ],
            category: 1,
            name: { en: "Secondary Slot" },
        },
    },
    skinrTierThresholds: {
        4: { _key: 4, _value: [
            { _key: 2, _value: 175 },
            { _key: 1, _value: 125 },
        ] },
    },
    shipTreeElements: {
        30: { _key: 30, icon: "armor", name: { en: "Armor" } },
    },
    shipTreeFactions: {
        500001: {
            _key: 500001,
            elements: [ { _key: 1, _value: 30 } ],
            icon: "res:/faction.png",
        },
    },
    shipTreeGroups: {
        4: {
            _key: 4,
            elements: [ { _key: 1, _value: 30 } ],
            name: { en: "Frigates" },
            preReqSkills: [ {
                _key: 500001,
                skills: [ { _key: 3327, display: false, level: 1 } ],
            } ],
        },
    },
    typeElements: {
        100: { _key: 100, elements: [ { _key: 1, _value: 30 } ] },
    },
    types: {
        // 100 carries a factionID (a faction hull), 101 does not (an empire
        // hull), and 200 is not a ship at all - the three cases the
        // typeID -> factionID join has to separate.
        100: { _key: 100, groupID: 25, name: { en: "Special ship" }, published: true, factionID: 500029 },
        101: { _key: 101, groupID: 25, name: { en: "Default ship" }, published: true },
        200: { _key: 200, groupID: 99, name: { en: "Not a ship" }, published: true, factionID: 500003 },
    },
    groups: {
        25: { _key: 25, categoryID: 6, name: { en: "Frigate" } },
        99: { _key: 99, categoryID: 7, name: { en: "Module" } },
    },
});

function BuildOptions()
{
    return {
        tables: Tables,
        sourceTarget: "eve",
        sourceGame: "Eve",
        sourceProvider: "ccp",
        sourceBuild: "3436472",
    };
}

test("exports target-aware SKIN and SKINR builder families", () =>
{
    assert.equal(CjsToolSkinBuilder.schema, "carbonenginejs.skinLibrary");
    assert.equal(CjsToolSkinrBuilder.schema, "carbonenginejs.skinrLibrary");
    assert.throws(
        () => CjsToolSkin.buildSkin({ ...BuildOptions(), sourceTarget: "frontier" }),
        /does not use game Eve|does not support target frontier/u,
    );
});

test("builds API-shaped developer SKIN maps and reverse indexes", () =>
{
    const library = CjsToolSkin.buildSkin(BuildOptions());

    assert.equal(library.sourceBuild, "3436472");
    assert.equal(library.skins[10].skinID, 10);
    assert.deepEqual(library.typesToSkins[2], [ 10, 11 ]);
    assert.deepEqual(library.skinMaterialsToTypes[100], [ 1, 2 ]);
    assert.deepEqual(library.skinsToLicenses[10], [ 500 ]);
    assert.deepEqual(library.skinsToLicenses[999], [ 501 ]);
    assert.equal(library.skinMaterials[100].iconPath.endsWith("/100.png"), true);
    assert.equal(library.skinMaterialSets[1000].patternMaterial1, "pattern-primary");
    assert.equal(library.skinMaterialSets[1000].custommaterial1, undefined);
    assert.deepEqual(library.names["special ship"], [ {
        kind: "type",
        skinID: null,
        typeID: 100,
    } ]);
    assert.deepEqual(library.names.first, [
        { kind: "skin", skinID: 10, typeID: 1 },
        { kind: "skin", skinID: 10, typeID: 2 },
    ]);
    assert.equal(
        JSON.stringify(library),
        JSON.stringify(CjsToolSkin.buildSkin(BuildOptions())),
    );
});

test("builds normalized SKINR joins while preserving authored resources", () =>
{
    const library = CjsToolSkin.buildSkinr(BuildOptions());
    const component = library.components[53];

    assert.deepEqual(library.componentCategories[3].rarityPointValues, [
        { rarityID: 1, value: 25 },
        { rarityID: 2, value: 50 },
    ]);
    assert.equal(component.componentCategoryID, 3);
    assert.equal(component.componentRarityID, 2);
    assert.equal(component.addressUMode, 1);
    assert.equal(component.addressVMode, 4);
    assert.equal(component.resourceFile, "res:/materials/plasmic_test.red");
    assert.equal(component.sofPattern, "plasmic_test");
    assert.deepEqual(library.componentLicenses[82957], [
        { componentID: 53, licenseUsesGranted: 1 },
    ]);
    assert.equal(library.typesToSlotConfigurations[100], 3);
    assert.equal(library.typesToSlotConfigurations[101], 5);
    assert.equal(library.typesToSlotConfigurations[200], undefined);
    assert.equal(library.types, undefined);
    assert.deepEqual(library.shipTreeGroups[4].tierThresholds, [
        { threshold: 125, tier: 1 },
        { threshold: 175, tier: 2 },
    ]);
    assert.deepEqual(library.typeElements[100].elements, [
        { position: 1, shipTreeElementID: 30 },
    ]);
});

test("loads both library table sets once from an exact source", async () =>
{
    let calls = 0;
    const source = {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3436472",
        async LoadTables(names)
        {
            calls++;
            assert.equal(new Set(names).size, names.length);

            return Tables;
        },
    };
    const libraries = await CjsToolSkin.buildAllFromSource(source);

    assert.equal(calls, 1);
    assert.equal(libraries.skin.skins[10].skinID, 10);
    assert.equal(libraries.skinr.components[53].componentID, 53);

    // Authored faction slot conversion rides the library, keyed by factionID -
    // an attribute of a typeID, NOT a SOF faction. Every entry maps the four
    // cosmetic slots onto the four material layers, one to one.
    const slotsToLayers = libraries.skinr.skinrSlotsToMaterialLayerByFactionId;
    assert.ok(Object.keys(slotsToLayers).length > 0);
    for (const [ factionID, pairs ] of Object.entries(slotsToLayers))
    {
        assert.match(factionID, /^\d+$/, "faction keys are numeric factionIDs");
        assert.deepEqual(pairs.map(pair => pair.slotID).sort(), [ 1, 2, 3, 4 ]);
        assert.deepEqual(pairs.map(pair => pair.materialID).sort(), [ 1, 2, 3, 4 ]);
    }
    // 500003 is the entry v1 keyed as "amarrbase"; the values are unchanged.
    assert.deepEqual(slotsToLayers["500003"], [
        { slotID: 1, materialID: 4 },
        { slotID: 2, materialID: 1 },
        { slotID: 3, materialID: 2 },
        { slotID: 4, materialID: 3 },
    ]);

    // typeID -> factionID, joined from the SDE types table. This is the only
    // place a consumer holding a ship_type_id can get one: ESI's type record
    // carries no faction, so without this the slot conversion above is
    // unreachable.
    const typesToFactions = libraries.skinr.typesToFactions;
    assert.equal(typesToFactions[100], 500029, "a faction hull resolves its factionID");
    assert.ok(!(101 in typesToFactions), "an empire hull with no factionID is omitted, not null");
    assert.ok(!(200 in typesToFactions), "a non-ship is excluded even when it carries a factionID");
    // Every faction a hull claims must have a conversion, or the join is
    // useless for that hull.
    for (const factionID of Object.values(typesToFactions))
    {
        assert.ok(slotsToLayers[factionID], `factionID ${factionID} has a slot conversion`);
    }
});

test("serves whole libraries and exact matching JSON subtrees", async context =>
{
    const source = {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        build: "3436472",
        async LoadTables()
        {
            return Tables;
        },
    };
    const proxy = new CjsToolHttpProxy({
        sde: {
            async OpenTarget(target, build)
            {
                assert.equal(target, "eve");
                assert.equal(build, "latest");

                return source;
            },
        },
    });
    const server = proxy.CreateServer();

    await new Promise((resolve, reject) =>
    {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    context.after(() => new Promise(resolve => server.close(resolve)));

    const address = server.address();
    const root = `http://127.0.0.1:${address.port}`;
    const fullSkin = await (await fetch(`${root}/eve/latest/skin`)).json();
    const skin = await (await fetch(`${root}/eve/latest/skin/skins/10`)).json();
    const fullSkinr = await (await fetch(`${root}/eve/latest/skinr`)).json();
    const componentResponse = await fetch(`${root}/eve/latest/skinr/components/53`);
    const component = await componentResponse.json();
    const nameOptions = await (await fetch(
        `${root}/eve/latest/skin/lookup?name=${encodeURIComponent("First")}`
    )).json();
    const searchedOptions = await (await fetch(
        `${root}/eve/latest/skin/search?name=${encodeURIComponent("Special-Ship")}`
    )).json();

    assert.deepEqual(skin, fullSkin.skins[10]);
    assert.deepEqual(component, fullSkinr.components[53]);
    assert.deepEqual(nameOptions, fullSkin.names.first);
    assert.deepEqual(searchedOptions, fullSkin.names["special ship"]);
    assert.equal(componentResponse.headers.get("x-carbon-build"), "3436472");
    assert.equal((await fetch(`${root}/eve/latest/skinr/components/999`)).status, 404);

    const slotsToLayers = await (await fetch(
        `${root}/eve/latest/skinr/skinrSlotsToMaterialLayerByFactionId`
    )).json();
    const amarrSlotsToLayers = await (await fetch(
        `${root}/eve/latest/skinr/skinrSlotsToMaterialLayerByFactionId/500003`
    )).json();

    assert.deepEqual(slotsToLayers, fullSkinr.skinrSlotsToMaterialLayerByFactionId);
    assert.deepEqual(amarrSlotsToLayers, fullSkinr.skinrSlotsToMaterialLayerByFactionId["500003"]);
    assert.equal(
        (await fetch(`${root}/eve/latest/skinr/skinrSlotsToMaterialLayerByFactionId/999999`)).status,
        404,
    );
});

test("generates a SOF pattern carrying only SOF field names and value types", () =>
{
    const library = CjsToolSkinrBuilder.build(BuildOptions());

    // Type 100 carries factionID 500029, whose conversion is
    // slot1->material3, slot2->material4, slot3->material2, slot4->material1.
    const { dna, pattern, factionID } = CjsToolSkinrPattern.generate({
        library,
        dna: "cf1_t1:caldaribase:caldari",
        skin: {
            ship_type_id: 100,
            id: "TEST-SKIN",
            layout: {
                slots: [
                    { id: 1, configuration: { nanocoating: { id: 53 } } },
                    { id: 5, configuration: { pattern: {
                        id: 54,
                        configuration: {
                            projection: { slot1: true },
                            mirrored: true,
                            transform: { position: { x: 1, y: 2, z: 3 } },
                        },
                    } } },
                ],
            },
        },
    });

    assert.equal(factionID, 500029, "factionID comes from the library join, not the payload");

    // The primary nanocoating sits in cosmetic slot 1, which this faction feeds
    // to material3 - NOT material1. A slot-order fallback would put it first.
    assert.equal(dna, "cf1_t1:caldaribase:caldari"
        + ":mesh?none;none;plasmic_test;none"
        + ":pattern?test-skin;none;none");

    // Every emitted field is one an EveSOFDataPattern class declares.
    assert.deepEqual(Object.keys(pattern).sort(), [ "layer1", "layer2", "name", "projections", "sof6" ]);
    assert.equal(pattern.name, "test-skin");
    assert.equal(pattern.layer2, null, "no secondary_pattern slot in the payload");

    // The trap this conversion exists for: the SDE component carries
    // "clamp-to-edge"/"repeat" as STRINGS under these same two field names.
    assert.equal(pattern.layer1.projectionTypeU, 1);
    assert.equal(pattern.layer1.projectionTypeV, 0);
    assert.equal(typeof pattern.layer1.projectionTypeU, "number");
    assert.equal(pattern.layer1.textureName, "PatternMask1Map");
    assert.equal(pattern.layer1.materialSource, 4);
    assert.equal(pattern.layer1.textureResFilePath, "res:/texture/pattern/pattern_test.dds");
    assert.equal(pattern.layer1.blendMode, "normal", "authored blend mode survives; normal IS the overlay blend");

    // projection.slot1 targets cosmetic slot 1, which this faction feeds to
    // material3 - so mtl3, not mtl1.
    assert.deepEqual([
        pattern.layer1.isTargetMtl1, pattern.layer1.isTargetMtl2,
        pattern.layer1.isTargetMtl3, pattern.layer1.isTargetMtl4,
    ], [ false, false, true, false ]);

    // One hull projection, transforms as arrays rather than class instances.
    assert.equal(pattern.projections.length, 1);
    assert.equal(pattern.projections[0].name, "cf1_t1");
    assert.deepEqual(pattern.projections[0].transformLayer1, {
        isMirrored: true,
        position: [ 1, 2, 3 ],
        rotation: [ 0, 0, 0, 1 ],
        scaling: [ 1, 1, 1 ],
    });
    assert.equal(pattern.projections[0].transformLayer2, null);

    // Nothing SKINR-flavoured leaks through.
    const serialized = JSON.stringify(pattern);
    for (const leak of [ "clamp-to-edge", "clamp-to-border", "addressUMode", "nanocoating", "sofPattern" ])
    {
        assert.ok(!serialized.includes(leak), `pattern must not carry ${leak}`);
    }
});

test("a hull with no faction falls back to slot order, and a patternless skin has no pattern", () =>
{
    const library = CjsToolSkinrBuilder.build(BuildOptions());

    // Type 101 carries no factionID, so cosmetic slot 1 feeds material1.
    const { dna, pattern, factionID } = CjsToolSkinrPattern.generate({
        library,
        dna: "cf1_t1:caldaribase:caldari",
        skin: {
            ship_type_id: 101,
            id: "NO-FACTION",
            layout: { slots: [ { id: 1, configuration: { nanocoating: { id: 53 } } } ] },
        },
    });

    assert.equal(factionID, null);
    assert.equal(dna, "cf1_t1:caldaribase:caldari:mesh?plasmic_test;none;none;none");
    assert.equal(pattern, null, "no pattern slot means no pattern to insert");
});

test("an unknown pattern blend mode fails the build instead of silently becoming normal", () =>
{
    const library = CjsToolSkinrBuilder.build(BuildOptions());
    const skinWith = mode => ({
        ship_type_id: 100,
        id: "BLEND",
        layout: {
            pattern_blend_mode: mode,
            slots: [ { id: 5, configuration: { pattern: { id: 54, configuration: {} } } } ],
        },
    });

    // The five the payload may carry, all preserved verbatim.
    for (const mode of [ "normal", "subtract", "exclusion", "nested", "nested_inverted" ])
    {
        const { pattern } = CjsToolSkinrPattern.generate({
            library, dna: "cf1_t1:caldaribase:caldari", skin: skinWith(mode),
        });
        assert.equal(pattern.layer1.blendMode, mode);
    }

    // The consuming runtime maps an unrecognised string to its 0 fallback, so
    // these would arrive indistinguishable from a deliberate "normal".
    for (const mode of [ "multiply", "screen", "NESTED-INVERTED", "overlay" ])
    {
        assert.throws(
            () => CjsToolSkinrPattern.generate({
                library, dna: "cf1_t1:caldaribase:caldari", skin: skinWith(mode),
            }),
            /Unsupported SKINR pattern blend mode/u,
            `${mode} must be rejected`,
        );
    }
});
