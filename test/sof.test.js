import assert from "node:assert/strict";
import test from "node:test";

import { EveSOF } from "@carbonenginejs/runtime/sof";
import { CjsToolSofRepository, ExpandSofDefaults } from "../src/sof/index.js";

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
    let prepareDefaultsCount = 0;
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
        loadMode: "full",
        async prepareDefaults()
        {
            prepareDefaultsCount++;
        },
        createSof(options)
        {
            createCount++;
            receivedFiles = options.resFileIndex;
            const sof = EveSOF.Create(options);

            const buildValues = (dna, options = {}) =>
            {
                valuesCount++;
                return {
                    _type: "EveShip2",
                    dna,
                    ...(options.populateDefaults
                        ? { display: true, reflectionMode: 3 }
                        : {}),
                };
            };
            sof.BuildValuesFromDNA = buildValues;
            sof.BuildValuesFromDNAAsync = async (dna, options) =>
                buildValues(dna, options);

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

    const expanded = await first.BuildExpandedValuesAsync("ab1_t1:amarrbase:amarr");
    assert.deepEqual(expanded, {
        _type: "EveShip2",
        dna: "ab1_t1:amarrbase:amarr",
        display: true,
        reflectionMode: 3,
    });
    assert.equal(valuesCount, 1);
    assert.equal(prepareDefaultsCount, 1);
    assert.equal(first.loadMode, "full");
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

test("defaults to generic-first SOF loading and fetches indexed records on demand", async () =>
{
    const basePath = "res:/dx9/model/spaceobjectfactory";
    const genericPath = `${basePath}/generic.black`;
    const hullPath = `${basePath}/hulls/ab1_t1.black`;
    const matchedPaths = [
        "res:/alpha.dds",
        SOF_DATA_PATH_FOR_TEST,
        genericPath,
        hullPath,
    ];
    const records = new Map([
        [genericPath, { materialPrefixes: [], variants: [] }],
        [hullPath, {
            name: "ab1_t1",
            buildClass: 0,
            geometryResFilePath: "res:/ab1_t1.gr2",
            opaqueAreas: [],
        }],
    ]);
    const fetched = [];
    let lazySource;
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
            fetched.push(logicalPath);
            return { bytes: records.get(logicalPath) };
        },
    };
    const repository = new CjsToolSofRepository({
        createSof(options)
        {
            assert.equal(Object.hasOwn(options, "black"), false);
            assert.equal(typeof options.lazyData.source, "function");
            lazySource = options.lazyData.source;

            const sof = EveSOF.Create({
                black: {
                    hull: [],
                    faction: [],
                    race: [],
                    material: [],
                    layout: [],
                    pattern: [],
                    generic: { materialPrefixes: [], variants: [] },
                },
            });
            const library = {
                async FetchHull(name)
                {
                    const value = await lazySource(`${basePath}/hulls/${name}.black`);
                    sof.dataMgr.UpdateHull(name, value);
                    return value;
                },
            };

            sof.InitializeAsync = () => lazySource(genericPath);
            sof.GetSofLibraryBuilder = () => library;
            return sof;
        },
    });
    const catalog = await repository.OpenSource(source);

    assert.equal(catalog.loadMode, "lazy");
    assert.deepEqual(fetched, [genericPath]);
    assert.deepEqual(catalog.ListHulls(), [ "ab1_t1" ]);
    assert.equal(catalog.GetHull("ab1_t1"), null);
    assert.equal((await catalog.GetHullAsync("AB1_T1")).name, "ab1_t1");
    assert.equal((await catalog.GetHullAsync("ab1_t1")).name, "ab1_t1");
    assert.equal(await catalog.GetHullAsync("missing"), null);
    assert.deepEqual(fetched, [genericPath, hullPath]);
});

test("default lazy loading runs through the installed combined runtime", async () =>
{
    const basePath = "res:/dx9/model/spaceobjectfactory";
    const genericPath = `${basePath}/generic.black`;
    const hullPath = `${basePath}/hulls/ab1_t1.black`;
    const records = new Map([
        [genericPath, { materialPrefixes: [], variants: [] }],
        [hullPath, {
            name: "ab1_t1",
            buildClass: 0,
            geometryResFilePath: "res:/ab1_t1.gr2",
            opaqueAreas: [],
        }],
    ]);
    const fetched = [];
    const source = {
        target: "eve",
        game: "Eve",
        provider: "ccp",
        buildRef: "latest",
        build: "3435006",
        client: "tranquility",
        Match()
        {
            return [genericPath, hullPath].map(logicalPath => ({ logicalPath }));
        },
        async Fetch(logicalPath)
        {
            fetched.push(logicalPath);
            return { bytes: records.get(logicalPath) };
        },
    };

    const catalog = await new CjsToolSofRepository().OpenSource(source);

    assert.deepEqual(fetched, [genericPath]);
    assert.deepEqual(catalog.ListHulls(), [ "ab1_t1" ]);
    assert.equal((await catalog.GetHullAsync("AB1_T1")).name, "ab1_t1");
    assert.deepEqual(fetched, [genericPath, hullPath]);
});

test("default expansion applies registered combined-runtime class defaults", async () =>
{
    const sparse = { _type: "EveShip2" };
    const expanded = await ExpandSofDefaults(sparse);

    assert.notEqual(expanded, sparse);
    assert.equal(expanded._type, "EveShip2");
    assert.equal(expanded.display, true);
    assert.equal(Object.hasOwn(sparse, "display"), false);
});

const SOF_DATA_PATH_FOR_TEST = "res:/dx9/model/spaceobjectfactory/data.black";

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
