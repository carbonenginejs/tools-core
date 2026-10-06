import assert from "node:assert/strict";
import test from "node:test";
import { CjsToolSofRepository } from "../src/sof/CjsToolSofRepository.js";

// Opt in with an exact-build tools resource base, for example
// CJS_SOF_LAYOUT_RESOURCE_BASE=http://localhost:5510/eve/3579973.
// Acquire through tools HTTP only; no decoded game data is checked in.
//
// CCP never published some materials that factions name: the Victorious
// Venom factions (tournament-xx-bs, tournament-xx) name
// grey_blue_graffiti_colorshift_matt, and lavatiger names rock_lightgray_sand.
// In game these skins render with the stock grey. Carbon's GetMaterialData
// returns nullptr for such a name (EveSOFDataMgr.cpp:273-281) and the build
// carries on; the lazy catalog must too.
const resourceBase = process.env.CJS_SOF_LAYOUT_RESOURCE_BASE;
const MATERIALS = "res:/dx9/model/spaceobjectfactory/materials/";
const DNAS = [
    [ "Python Victorious Venom", "conb1_xx:tournament-xx-bs:concord:mesh?none;none;none;none:pattern?xx_prize;purple_graffiti_colorshift_polished;green_neon_graffiti_polished", "grey_blue_graffiti_colorshift_matt" ],
    [ "Enforcer Victorious Venom", "conc1_t1:tournament-xx:concord:mesh?none;none;none;none:pattern?xx_prize;purple_graffiti_colorshift_polished;green_neon_graffiti_polished", "grey_blue_graffiti_colorshift_matt" ],
    [ "Apocalypse Lavacore", "ab1_t1:lavatiger:amarr:mesh?orange_fire_polished;black_gunmetal_metallic;black_deadstar_matt;none:pattern?lavatiger_amarr;orange_burnt_mirror;black_gunmetal_metallic:respathinsert?base", "rock_lightgray_sand" ],
];

/** A composed source over tools HTTP: the build's resfile list, and decoded records. */
async function HttpSource(fetched)
{
    const build = await (await fetch(resourceBase + "/build")).json();
    const paths = await (await fetch(resourceBase + "/resfiles")).json();
    return {
        target: build.target,
        game: build.game,
        provider: build.provider,
        buildRef: build.build,
        build: build.build,
        client: build.client,
        Match()
        {
            return paths.map(logicalPath => ({ logicalPath }));
        },
        async Fetch(logicalPath)
        {
            fetched.push(logicalPath);
            const response = await fetch(resourceBase + "/resources/" + logicalPath.slice(5) + "?format=json");
            if (!response.ok) throw new Error("Resource file not found: " + logicalPath);
            return { bytes: (await response.json()).object };
        },
    };
}

/** Builds one real DNA through a fresh lazy catalog, its unpublished material absent. */
async function BuildsWithMaterialAbsent([ , dna, missing ])
{
    const fetched = [];
    const source = await HttpSource(fetched);
    assert.equal(source.Match().some(item => item.logicalPath === MATERIALS + missing + ".black"), false, "the material is unpublished");

    const catalog = await new CjsToolSofRepository().OpenSource(source);
    const values = await catalog.BuildValuesAsync(dna);

    assert.ok(values && typeof values === "object", "the DNA builds");
    assert.equal(await catalog.GetMaterialAsync(missing), null, "the unpublished material is absent");
    assert.equal(fetched.includes(MATERIALS + missing + ".black"), false, "an unindexed material is never fetched");
}

test(`real ${DNAS[0][0]} DNA builds through the lazy catalog with its unpublished material absent`, { skip: !resourceBase }, () => BuildsWithMaterialAbsent(DNAS[0]));
test(`real ${DNAS[1][0]} DNA builds through the lazy catalog with its unpublished material absent`, { skip: !resourceBase }, () => BuildsWithMaterialAbsent(DNAS[1]));
test(`real ${DNAS[2][0]} DNA builds through the lazy catalog with its unpublished material absent`, { skip: !resourceBase }, () => BuildsWithMaterialAbsent(DNAS[2]));
