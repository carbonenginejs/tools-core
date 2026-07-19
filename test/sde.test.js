import assert from "node:assert/strict";
import test from "node:test";

import { CjsSde } from "../src/index.js";

function CreateSde()
{
    return new CjsSde({
        build: 3435006,
        types: {
            587: { name: { en: "Rifter" }, graphicID: 42 },
            588: { name: "Rifter Alias", graphicID: 42 }
        },
        graphics: {
            42: { sofHullName: "rifter", sofFactionName: "minmatar", sofRaceName: "minmatar" }
        },
        skins: {
            9001: { internalName: "Test Skin", types: [ 587 ], skinMaterialID: 7001 },
            9002: { internalName: "Licensed Skin", skinMaterialID: 7001 }
        },
        skinLicenses: {
            8001: { skinID: 9002, typeID: 588 }
        },
        skinMaterials: {
            7001: { materialSetID: 6001, graphicMaterialSetID: 5001 }
        },
        materialSets: {
            6001: { name: "Test Material Set" }
        },
        graphicMaterialSets: {
            5001: {
                sofFactionName: "angel",
                material1: "metallic",
                material2: "paint",
                material3: "none",
                material4: "none",
                sofPatternName: "stripes",
                patternMaterial1: "red",
                patternMaterial2: "black"
            }
        }
    });
}

test("resolves names, type IDs, and shared graphic IDs deterministically", () =>
{
    const sde = CreateSde();

    assert.equal(sde.build, 3435006);
    assert.equal(sde.GetTypeByName("rifter").id, "587");
    assert.deepEqual(sde.GetTypesForGraphic(42).map(value => value.id), [ "587", "588" ]);
    assert.equal(sde.GetGraphicID(587), "42");
    assert.deepEqual(sde.ResolveName("Rifter"), {
        kind: "type",
        typeID: "587",
        skinID: null
    });
    assert.deepEqual(sde.LookupName("Test Skin"), [ {
        kind: "skin",
        typeID: "587",
        skinID: "9001"
    } ]);
    assert.deepEqual(sde.LookupName("test-skin"), []);
    assert.deepEqual(sde.SearchName("test-skin"), [ {
        kind: "skin",
        typeID: "587",
        skinID: "9001"
    } ]);
    assert.deepEqual(sde.ResolveSearchName("test_skin"), {
        kind: "skin",
        typeID: "587",
        skinID: "9001"
    });
    assert.equal(sde.ResolveDna({ name: "Rifter" }), "rifter:minmatar:minmatar");
    assert.equal(sde.ResolveTypeDna(587), "rifter:minmatar:minmatar");
    assert.equal(sde.ResolveGraphicDna(42), "rifter:minmatar:minmatar");
});

test("joins skin and material-set identities into SOF DNA", () =>
{
    const resolved = CreateSde().Resolve({ typeID: 587, skinID: 9001 });

    assert.equal(resolved.graphicID, "42");
    assert.equal(resolved.skinMaterialID, "7001");
    assert.equal(resolved.materialSetID, "6001");
    assert.equal(resolved.graphicMaterialSetID, "5001");
    assert.equal(resolved.materialSetName, "Test Material Set");
    assert.equal(
        resolved.dna,
        "rifter:angel:minmatar:mesh?metallic;paint;none;none:pattern?stripes;red;black"
    );
    assert.equal(CreateSde().ResolveSkinDna(9001), resolved.dna);
    assert.equal(CreateSde().ResolveDna({ name: "Test Skin" }), resolved.dna);
    assert.equal(CreateSde().ResolveSkin(9002).typeID, "588");
    assert.equal(CreateSde().ResolveDna({ name: "Licensed Skin" }), resolved.dna);

    assert.throws(
        () => CreateSde().ResolveDna({ typeID: 588, skinID: 9001 }),
        /not available for type 588/
    );
});
