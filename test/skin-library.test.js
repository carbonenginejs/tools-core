import assert from "node:assert/strict";
import test from "node:test";

import {
    CjsToolHttpProxy,
    CjsToolSkin,
    CjsToolSkinBuilder,
    CjsToolSkinrBuilder,
} from "../src/index.js";

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
        100: { _key: 100, groupID: 25, name: { en: "Special ship" }, published: true },
        101: { _key: 101, groupID: 25, name: { en: "Default ship" }, published: true },
        200: { _key: 200, groupID: 99, name: { en: "Not a ship" }, published: true },
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
});
