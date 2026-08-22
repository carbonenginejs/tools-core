import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { CjsToolSdeDatabase } from "../src/sde/index.js";
import { CjsToolDogma } from "../src/dogma/CjsToolDogma.js";
import { CjsToolIndustry } from "../src/industry/CjsToolIndustry.js";
import { CjsToolLocalisation } from "../src/localisation/CjsToolLocalisation.js";

/**
 * Acceptance against real prepared SDEs, for every game version this serves.
 *
 * The synthetic suites prove the mechanism. They cannot prove the mechanism is
 * the one the data actually uses, because those fixtures were written from
 * the same reading of it - so this file drives the real thing, and it drives all
 * three targets rather than Eve alone. Eve, Serenity and Infinity do not carry
 * the same data: Infinity has roughly twice the dogma effects, and the
 * zh-primary targets name things differently.
 *
 * Skipped, not failed, when no prepared database is on this machine. Preparing
 * one is an acquisition step with a network in it, and the baseline suite has
 * to stay offline.
 */

const CACHE_ROOT = process.env.CJS_TOOL_CACHE
    ? path.join(process.env.CJS_TOOL_CACHE, "tool-core")
    : path.resolve(process.cwd(), "..", ".cache", "tool-core");

const TARGETS = Object.freeze([ "eve", "serenity", "infinity" ]);

/**
 * The Viator, and the two numbers the in-game fitting panel shows for it.
 *
 * Held as an acceptance check against whichever build is on this machine rather
 * than as constants the code may consult: if the hull is rebalanced this should
 * fail loudly and be updated, which is the point of having it.
 */
const VIATOR = 12743;
const ALL_FIVE = Object.freeze({
    mode: "manual",
    skills: [ { typeID: 3426, level: 5 }, { typeID: 3413, level: 5 } ]
});

/** The newest prepared build for a target, or null when there is none. */
function FindDatabase(target)
{
    const root = path.join(CACHE_ROOT, "custom", "targets", target, "builds");

    if (!fs.existsSync(root)) return null;

    const builds = fs.readdirSync(root)
        .filter(entry => /^\d+$/u.test(entry))
        .sort((left, right) => Number(right) - Number(left));

    for (const build of builds)
    {
        const filePath = path.join(root, build, "sde_v1.sqlite");

        if (fs.existsSync(filePath)) return { build, filePath };
    }

    return null;
}

async function OpenSource(target, found)
{
    const database = await CjsToolSdeDatabase.open(found.filePath, { readOnly: true });

    return {
        database,
        source: {
            target,
            game: target === "eve" ? "Eve" : target,
            provider: target === "eve" ? "ccp" : "netease",
            build: found.build,
            Table: name => database.Table(name),
            LoadTables: names => database.LoadTables(names),
            DatabaseFile: () => found.filePath
        }
    };
}

/**
 * Per-target work, as subtests of one parent.
 *
 * Subtests rather than top-level `test()` calls in a loop, because the package
 * linter reads any call indented four spaces as a class method and rejects its
 * lower-case name.
 */
test("dogma and industry against every prepared SDE", async (parent) =>
{
    for (const target of TARGETS)
    {
        const found = FindDatabase(target);

        // `false` when the database is present, never null and never a bare
        // string: a `skip` key that is merely present reports "# SKIP" while the
        // body still runs, which reads as a pass nobody executed.
        const skip = found ? false : `no prepared ${target} database under ${CACHE_ROOT}`;

        await parent.test(`${target}: published values, and level-V skills`, { skip }, async () =>
        {
            const { database, source } = await OpenSource(target, found);
            const dogma = new CjsToolDogma(source);
            const bare = await dogma.Evaluate(VIATOR, { mode: "none" });

            assert.equal(bare.base.cpuOutput, 250);
            assert.equal(bare.base.powerOutput, 135);
            assert.equal(bare.base.upgradeCapacity, 400);
            assert.deepEqual(bare.effective, bare.base);
            assert.equal(bare.build, source.build);

            const trained = await dogma.Evaluate(VIATOR, ALL_FIVE);

            assert.equal(trained.effective.cpuOutput, 312.5);
            assert.equal(trained.effective.powerOutput, 168.75);

            // Slots take no skill bonus and must survive untouched.
            assert.equal(trained.effective.hiSlots, bare.base.hiSlots);
            assert.equal(trained.effective.rigSlots, bare.base.rigSlots);

            // Every applied modifier names the skill that caused it.
            for (const entry of trained.applied)
            {
                assert.ok([ 3426, 3413 ].includes(entry.sourceTypeID));
                assert.equal(entry.sourceLevel, 5);
            }

            await database.Close();
        });

        await parent.test(`${target}: names come back in a language the SDE has`, { skip }, async () =>
        {
            const { database, source } = await OpenSource(target, found);
            const dogma = new CjsToolDogma(source);
            const result = await dogma.Evaluate(VIATOR, { mode: "none" });

            assert.ok(result.name.text, "every target names the Viator in some language");

            // Every target answers in English now, including the zh-primary
            // ones. This used to assert `zh` for serenity and infinity, which
            // faithfully recorded a bug in our own pipeline as though it were a
            // property of the data.
            assert.equal(result.name.language, "en");

            await database.Close();
        });

        await parent.test(`${target}: English is available even where the SDE has none`, { skip }, async () =>
        {
            const { database, source } = await OpenSource(target, found);

            if (target === "eve")
            {
                // The reference itself needs no crosswalk.
                const dogma = new CjsToolDogma(source);
                const result = await dogma.Evaluate(VIATOR, { mode: "none" }, { language: "en" });

                assert.equal(result.name.text, "Viator");
                assert.equal(result.name.source, "published");

                await database.Close();

                return;
            }

            const eve = await OpenSource("eve", FindDatabase("eve"));
            const localisation = new CjsToolLocalisation(source, { reference: eve.source });
            const dogma = new CjsToolDogma(source, { localisation });
            const result = await dogma.Evaluate(VIATOR, { mode: "none" }, { language: "en" });

            assert.equal(result.name.text, "Viator");
            assert.equal(result.name.language, "en");
            // `published`, not `crosswalk`. The name comes from the target's own
            // English table, so ResolveName short-circuits before the crosswalk
            // is ever consulted.
            //
            // That is not a smaller version of the same answer, it is a
            // different one: a crossed name is a reference target's label for a
            // shared id, and each target writes its own English, so serving the
            // crossed one here was the same class of mistake as `latest`
            // resolving across two worlds.
            assert.equal(result.name.source, "published");

            // No evidence, and no `local`. Both belonged to the crosswalk: they
            // said how an identity was established across two targets, and a
            // name taken from the target's own table crosses nothing.
            assert.equal(result.name.evidence, null);
            assert.equal(result.name.local, undefined);

            // The Chinese is still there, on the row rather than beside the
            // name, so a UI can show what the local target calls the hull. This
            // is the part the old `name.local` assertion was really protecting,
            // and it has to keep being proven — an English name that arrived by
            // discarding the Chinese would pass every assertion above.
            const row = await database.Table("types").Get(VIATOR);

            assert.equal(row.payload.name.zh, "旅行者级");
            assert.equal(row.payload.name.en, "Viator");

            await eve.database.Close();
            await database.Close();
        });

        await parent.test(`${target}: industry keeps inputs and reprocessing apart`, { skip }, async () =>
        {
            const { database, source } = await OpenSource(target, found);
            const industry = new CjsToolIndustry(source);
            const result = await industry.Type(VIATOR);

            assert.ok(result.blueprint, "the Viator is buildable on every target");
            assert.ok(result.blueprint.manufacturing.materials.length > 0);
            assert.deepEqual(
                result.blueprint.manufacturing.products.map(item => item.typeID),
                [ VIATOR ],
                "the blueprint found must be the one producing the type asked for"
            );
            assert.ok(result.reprocessedMaterials.length > 0);

            // The two lists are not the same list - but *how* they differ depends
            // on the tech level, which is why this asserts inequality and nothing
            // more. In one prepared eve SDE the T2 Viator reprocesses into
            // its manufacturing inputs at identical quantities, minus the T1 hull
            // it was built from and the R.A.M. consumed; the T1 Rifter keeps every
            // material but returns fewer of each, 32000 Tritanium in and 13333
            // out. Assuming either shape holds generally is exactly the mistake
            // this service exists to prevent.
            const inputs = result.blueprint.manufacturing.materials.map(item => [ item.typeID, item.quantity ]);
            const yields = result.reprocessedMaterials.map(item => [ item.typeID, item.quantity ]);

            assert.notDeepEqual(inputs, yields, "reprocessing yield must not be the manufacturing input list");

            await database.Close();
        });
    }
});
