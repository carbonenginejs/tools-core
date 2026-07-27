import assert from "node:assert/strict";
import test from "node:test";

import { EveSOF } from "@carbonenginejs/runtime-sof";
import { CjsToolSofRepository } from "../src/sof/index.js";

test("opens and reuses one GPU-free exact-build SOF catalog", async () =>
{
    const data = CreateData();
    const matchedPaths = [
        "res:/zeta.dds",
        "res:/dx9/model/spaceobjectfactory/data.black",
        "res:/alpha.dds",
        "res:/alpha.dds",
    ];
    let fetchCount = 0;
    let createCount = 0;
    let valuesCount = 0;
    let receivedFiles = null;
    const source = {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        buildRef: "latest",
        build: "3435006",
        client: "tranquility",
        Match(pattern, options)
        {
            assert.equal(pattern, "res:/**");
            assert.deepEqual(options, { root: "res" });

            return matchedPaths.map(logicalPath => ({ logicalPath }));
        },
        async Fetch(logicalPath)
        {
            assert.equal(
                logicalPath,
                "res:/dx9/model/spaceobjectfactory/data.black",
            );
            fetchCount++;

            return { bytes: data };
        },
    };
    const repository = new CjsToolSofRepository({
        createSof(options)
        {
            createCount++;
            receivedFiles = options.resFileIndex;
            const sof = EveSOF.Create(options);

            sof.BuildValuesFromDNA = () =>
            {
                valuesCount++;
                throw new Error("runtime-trinity-backed values were not expected");
            };

            return sof;
        },
    });
    const [ first, second ] = await Promise.all([
        repository.OpenSource(source),
        repository.OpenSource(source),
    ]);

    assert.equal(first, second);
    assert.equal(fetchCount, 1);
    assert.equal(createCount, 1);
    assert.deepEqual(receivedFiles, [
        "res:/alpha.dds",
        "res:/dx9/model/spaceobjectfactory/data.black",
        "res:/zeta.dds",
    ]);
    assert.deepEqual(first.ListHulls(), [ "ab1_t1", "zz1_t1" ]);
    assert.deepEqual(first.ListFactions(), [ "amarrbase" ]);
    assert.deepEqual(first.ListRaces(), [ "amarr" ]);
    assert.deepEqual(first.ListMaterials(), [ "gold" ]);
    assert.deepEqual(first.ListLayouts(), [ "antennae" ]);
    assert.deepEqual(first.ListPatterns(), [ "alpha", "stripes" ]);
    assert.deepEqual(first.ListHullPatterns("AB1_T1"), [ "alpha", "stripes" ]);
    assert.deepEqual(first.ListHullPatterns("zz1_t1"), []);
    assert.equal(first.ListHullPatterns("missing"), null);
    assert.equal(first.GetHull("AB1_T1").name, "ab1_t1");
    assert.deepEqual(first.GetMaterial("GOLD").parameters.PaintColor, [1, 2, 3, 4]);
    assert.equal(first.GetPatternHull("STRIPES", "AB1_T1").layerAndProjection.length, 2);
    assert.equal(first.GetPatternHull("stripes", "missing"), null);
    assert.deepEqual(first.InspectDna("ab1_t1:amarrbase:amarr"), {
        buildable: true,
        valid: true,
        error: null,
    });

    const document = await first.BuildDocumentAsync(
        "ab1_t1:amarrbase:amarr:pattern?stripes;none;none",
    );

    assert.equal(document.schema, "carbon.document");
    assert.equal(valuesCount, 0);
    assert.equal(first.target, "eve");
    assert.equal(first.build, "3435006");

    const groups = first.GetDnaVisibilityGroups("ab1_t1:amarrbase:amarr");

    assert.deepEqual(groups.declared, [ "primary", "holiday_19" ]);
    assert.deepEqual(groups.visible, [ "primary" ]);
    assert.deepEqual(groups.hidden, [ "police" ]);
    assert.deepEqual(
        groups.sets.map(set => [ set.kind, set.visibilityGroup, set.visible ]),
        [ [ "hullDecalSets", "primary", true ], [ "hullDecalSets", "police", false ] ],
    );
    assert.equal(first.GetDnaVisibilityGroups("missing:amarrbase:amarr"), null);
});

function CreateData()
{
    return {
        hull: [
            {
                name: "zz1_t1",
                buildClass: 0,
                geometryResFilePath: "res:/zz1_t1.gr2",
                opaqueAreas: [],
            },
            {
                name: "ab1_t1",
                buildClass: 0,
                geometryResFilePath: "res:/ab1_t1.gr2",
                boundingSphere: [0, 0, 0, 1],
                opaqueAreas: [],
                decalSets: [
                    { visibilityGroup: "primary", items: [] },
                    { visibilityGroup: "police", items: [] },
                ],
            },
        ],
        faction: [{
            name: "amarrbase",
            visibilityGroupSet: {
                visibilityGroups: [ { str: "primary" }, { str: "holiday_19" } ],
            },
        }],
        race: [{ name: "amarr" }],
        material: [{
            name: "gold",
            parameters: [{ name: "PaintColor", value: [1, 2, 3, 4] }],
        }],
        layout: [{ name: "antennae" }],
        pattern: [
            {
                name: "stripes",
                layer1: { textureName: "PatternTex" },
                projections: [{
                    name: "ab1_t1",
                    transformLayer1: { position: [1, 2, 3] },
                }],
            },
            {
                name: "alpha",
                layer1: { textureName: "PatternTex" },
                projections: [{
                    name: "AB1_T1",
                    transformLayer1: {},
                }],
            },
        ],
        generic: {
            materialPrefixes: [],
            variants: [],
        },
    };
}
