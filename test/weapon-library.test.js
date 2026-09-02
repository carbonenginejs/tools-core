import assert from "node:assert/strict";
import test from "node:test";

import {
    CjsToolHttpProxy,
    CjsToolWeapon,
    CjsToolWeaponBuilder,
} from "../src/index.js";

const Tables = Object.freeze({
    marketGroups: {
        10: { _key: 10, name: { en: "Turrets & Launchers" }, parentGroupID: 9 },
        11: { _key: 11, name: { en: "Ammunition & Charges" } },
        140: { _key: 140, name: { en: "Missile Launchers" }, parentGroupID: 10 },
        640: { _key: 640, name: { en: "Light Missile Launchers" }, parentGroupID: 140 },
        114: { _key: 114, name: { en: "Missiles" }, parentGroupID: 11 },
        920: { _key: 920, name: { en: "Standard Light Missiles" }, parentGroupID: 114 },
    },
    groups: {
        384: { _key: 384, categoryID: 8, name: { en: "Light Missile" } },
        394: { _key: 394, categoryID: 8, name: { en: "Auto-Targeting Light Missile" } },
        509: { _key: 509, categoryID: 7, name: { en: "Missile Launcher Light" } },
    },
    graphics: {
        1000: {
            _key: 1000,
            graphicFile: "res:/dx9/model/Turret/Launcher/Light/Light_T1.red",
        },
        2000: {
            _key: 2000,
            graphicFile: "res:/dx9/model/turret/launcher/light/light_impact_inferno.red",
        },
        3000: {
            _key: 3000,
            graphicFile: "res:/dx9/model/turret/launcher/light/light_missile.red",
        },
        4000: { _key: 4000, graphicFile: "res:/unrelated/missile.red" },
    },
    types: {
        100: {
            _key: 100,
            graphicID: 1000,
            groupID: 509,
            iconID: 355,
            marketGroupID: 640,
            metaGroupID: 2,
            metaLevel: 5,
            name: { en: "Test Light Missile Launcher" },
            published: true,
            techLevel: 2,
        },
        101: {
            _key: 101,
            graphicID: 1000,
            groupID: 509,
            marketGroupID: 640,
            name: { en: "Unpublished Launcher" },
            published: false,
        },
        200: {
            _key: 200,
            graphicID: 2000,
            groupID: 384,
            marketGroupID: 920,
            name: { en: "Inferno Light Missile" },
            published: true,
        },
        201: {
            _key: 201,
            groupID: 394,
            marketGroupID: 920,
            name: { en: "Auto-Targeting Light Missile" },
            published: true,
        },
    },
    typeDogma: {
        100: {
            _key: 100,
            dogmaAttributes: [
                { attributeID: 604, value: 384 },
                { attributeID: 605, value: 394 },
            ],
        },
        200: {
            _key: 200,
            dogmaAttributes: [ { attributeID: 137, value: 509 } ],
        },
        201: {
            _key: 201,
            dogmaAttributes: [ { attributeID: 137, value: 509 } ],
        },
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

test("builds weapon TypeID, graphics, and exact dogma ammunition joins", () =>
{
    const library = CjsToolWeapon.build(BuildOptions());
    const weapon = library.types[100];
    const ammunition = library.ammunition[200];

    assert.equal(CjsToolWeaponBuilder.schema, "carbonenginejs.weaponLibrary");
    assert.equal(weapon.graphicID, 1000);
    assert.equal(weapon.graphicFile.endsWith("Light_T1.red"), true);
    assert.equal(weapon.resPath, "res:/dx9/model/turret/launcher/light/light_t1.black");
    assert.equal(weapon.kind, "launcher");
    assert.equal(weapon.slot, "launchers");
    assert.equal(weapon.size, 1);
    assert.deepEqual(weapon.compatibleSlots, [ "launchers" ]);
    assert.equal(weapon.iconID, 355);
    assert.equal(weapon.metaGroupID, 2);
    assert.equal(weapon.metaLevel, 5);
    assert.equal(weapon.techLevel, 2);
    assert.equal(weapon.published, true);
    assert.deepEqual(weapon.chargeGroupIDs, [ 384, 394 ]);
    assert.deepEqual(weapon.ammunitionTypeIDs, [ 200, 201 ]);
    assert.equal(library.types[101], undefined);
    assert.equal(ammunition.graphicRole, "impact");
    assert.equal(ammunition.resPath.endsWith("light_impact_inferno.black"), true);
    assert.equal(ammunition.projectileGraphicID, 3000);
    assert.deepEqual(ammunition.weaponTypeIDs, [ 100 ]);
    assert.equal(library.projectiles[3000].graphicRole, "projectile");
    assert.deepEqual(library.projectiles[3000].name, { en: "Light Missile" });
    assert.deepEqual(library.projectiles[3000].ammunitionTypeIDs, [ 200 ]);
    assert.equal(library.projectiles[4000], undefined);
    assert.deepEqual(library.names["test light missile launcher"], [ {
        kind: "weapon",
        typeID: 100,
    } ]);
    assert.deepEqual(library.names["light missile launchers"], [ {
        kind: "weapon",
        typeID: 100,
    } ]);
    assert.deepEqual(library.names["missile launchers"], [ {
        kind: "weapon",
        typeID: 100,
    } ]);
    assert.equal(library.names.missiles, undefined);
    assert.equal(library.marketGroups, undefined);
    assert.deepEqual(library.groups[384].ammunitionTypeIDs, [ 200 ]);
    assert.equal(JSON.stringify(library), JSON.stringify(CjsToolWeapon.build(BuildOptions())));
});

test("applies charge size when joining turret ammunition", () =>
{
    const tables = structuredClone(Tables);

    tables.marketGroups[88] = { _key: 88, name: { en: "Energy Turrets" }, parentGroupID: 10 };
    tables.marketGroups[557] = { _key: 557, name: { en: "Beam Lasers" }, parentGroupID: 88 };
    tables.marketGroups[567] = { _key: 567, name: { en: "Small" }, parentGroupID: 557 };
    tables.groups[53] = { _key: 53, categoryID: 7, name: { en: "Energy Weapon" } };
    tables.groups[86] = { _key: 86, categoryID: 8, name: { en: "Frequency Crystal" } };
    tables.graphics[1001] = {
        _key: 1001,
        graphicFile: "res:/dx9/model/turret/energy/beam/s/beam_t1.red",
    };
    tables.types[110] = {
        _key: 110,
        graphicID: 1001,
        groupID: 53,
        marketGroupID: 567,
        name: { en: "Small Beam Laser" },
        published: true,
    };
    tables.types[210] = {
        _key: 210,
        groupID: 86,
        marketGroupID: 920,
        name: { en: "Small Crystal" },
        published: true,
    };
    tables.types[211] = {
        _key: 211,
        groupID: 86,
        marketGroupID: 920,
        name: { en: "Medium Crystal" },
        published: true,
    };
    tables.typeDogma[110] = { _key: 110, dogmaAttributes: [
        { attributeID: 128, value: 1 },
        { attributeID: 604, value: 86 },
    ] };
    tables.typeDogma[210] = { _key: 210, dogmaAttributes: [
        { attributeID: 128, value: 1 },
        { attributeID: 137, value: 53 },
    ] };
    tables.typeDogma[211] = { _key: 211, dogmaAttributes: [
        { attributeID: 128, value: 2 },
        { attributeID: 137, value: 53 },
    ] };

    const library = CjsToolWeapon.build({ ...BuildOptions(), tables });

    assert.equal(library.types[110].kind, "turret");
    assert.equal(library.types[110].slot, "turrets");
    assert.deepEqual(library.types[110].ammunitionTypeIDs, [ 210 ]);
    assert.equal(library.ammunition[211].weaponTypeIDs.includes(110), false);
});

test("maps authored weapon branches and capital size to runtime slot collections", () =>
{
    const tables = structuredClone(Tables);

    for (const [ branchID, branchName, childID ] of [
        [ 88, "Energy Turrets", 888 ],
        [ 1014, "Bomb Launchers", 1015 ],
        [ 2431, "Precursor Turrets", 2432 ],
        [ 2741, "Vorton Projectors", 2742 ],
    ])
    {
        tables.marketGroups[branchID] = {
            _key: branchID,
            name: { en: branchName },
            parentGroupID: 10,
        };
        tables.marketGroups[childID] = {
            _key: childID,
            name: { en: `${branchName} family` },
            parentGroupID: branchID,
        };
    }

    tables.groups[53] = { _key: 53, categoryID: 7, name: { en: "Energy Weapon" } };
    tables.groups[86] = { _key: 86, categoryID: 8, name: { en: "Frequency Crystal" } };
    tables.graphics[1001] = { _key: 1001, graphicFile: "res:/turret/energy/xl/test.red" };
    tables.graphics[1002] = { _key: 1002, graphicFile: "res:/turret/launcher/bomb/test.red" };
    tables.graphics[1003] = { _key: 1003, graphicFile: "res:/turret/atomic/test.red" };
    tables.graphics[1004] = { _key: 1004, graphicFile: "res:/turret/chain/test.red" };

    for (const [ typeID, graphicID, marketGroupID, groupID, chargeGroupID, chargeSize ] of [
        [ 110, 1001, 888, 53, 86, 4 ],
        [ 111, 1002, 1015, 509, 384, null ],
        [ 112, 1003, 2432, 53, 86, 4 ],
        [ 113, 1004, 2742, 53, 86, 1 ],
    ])
    {
        tables.types[typeID] = {
            _key: typeID,
            graphicID,
            groupID,
            marketGroupID,
            name: { en: `Weapon ${typeID}` },
            published: true,
        };
        tables.typeDogma[typeID] = { _key: typeID, dogmaAttributes: [
            { attributeID: 128, value: chargeSize },
            { attributeID: 604, value: chargeGroupID },
        ] };
    }

    tables.types[210] = {
        _key: 210,
        groupID: 86,
        marketGroupID: 920,
        name: { en: "Capital Crystal" },
        published: true,
    };
    tables.typeDogma[210] = { _key: 210, dogmaAttributes: [
        { attributeID: 128, value: 4 },
        { attributeID: 137, value: 53 },
    ] };
    tables.types[211] = {
        _key: 211,
        groupID: 86,
        marketGroupID: 920,
        name: { en: "Small Crystal" },
        published: true,
    };
    tables.typeDogma[211] = { _key: 211, dogmaAttributes: [
        { attributeID: 128, value: 1 },
        { attributeID: 137, value: 53 },
    ] };

    const library = CjsToolWeapon.build({ ...BuildOptions(), tables });

    assert.equal(library.types[110].slot, "xlTurrets");
    assert.deepEqual(library.types[110].compatibleSlots, [ "xlTurrets" ]);
    assert.equal(library.types[111].slot, "bombs");
    assert.equal(library.types[112].slot, "atomics");
    assert.deepEqual(
        library.types[112].compatibleSlots,
        [ "atomics", "xlTurrets" ],
    );
    assert.equal(library.types[113].slot, "chains");
});

test("adds XL launcher groups to the shared XL hardpoint compatibility", () =>
{
    for (const groupName of [
        "Missile Launcher XL Cruise",
        "Missile Launcher Rapid Torpedo",
    ])
    {
        const tables = structuredClone(Tables);

        tables.groups[509].name = { en: groupName };
        const library = CjsToolWeapon.build({ ...BuildOptions(), tables });

        assert.equal(library.types[100].slot, "launchers", groupName);
        assert.equal(library.types[100].size, 4, groupName);
        assert.deepEqual(
            library.types[100].compatibleSlots,
            [ "launchers", "xlTurrets" ],
            groupName,
        );
    }
});

test("serves whole weapon library and exact compatibility routes", async context =>
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
    const root = `http://127.0.0.1:${address.port}/eve/latest/weapons`;
    const full = await (await fetch(root)).json();
    const weapon = await (await fetch(`${root}/types/100`)).json();
    const ammo = await (await fetch(`${root}/types/100/ammunition/200`)).json();
    const projectiles = await (await fetch(`${root}/projectiles`)).json();
    const candidates = await (await fetch(
        `${root}/lookup?name=${encodeURIComponent("Test Light Missile Launcher")}`,
    )).json();
    const familyOptions = await (await fetch(
        `${root}/lookup?name=${encodeURIComponent("Light Missile Launchers")}`,
    )).json();

    assert.deepEqual(weapon, full.types[100]);
    assert.deepEqual(ammo, full.ammunition[200]);
    assert.deepEqual(projectiles, full.projectiles);
    assert.deepEqual(candidates, full.names["test light missile launcher"]);
    assert.deepEqual(familyOptions, full.names["light missile launchers"]);
    assert.equal((await fetch(`${root}/types/100/ammunition/999`)).status, 404);
    assert.equal((await fetch(`${root}/types/999`)).status, 404);
    assert.equal((await fetch(`${root}/market-groups/640`)).status, 404);
});
