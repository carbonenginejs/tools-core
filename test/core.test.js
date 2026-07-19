import assert from "node:assert/strict";
import test from "node:test";

import { CjsToolCore } from "../src/index.js";

test("resolves identity to DNA and returns runtime-sof carbon.document JSON", () =>
{
    const core = new CjsToolCore({
        cache: {},
        sde: { ResolveDna: value => `${value.hull}:${value.faction}:${value.race}` },
        sof: {
            BuildFromDNA: dna => ({ schema: "carbon.document", version: 1, dna, objects: {} })
        }
    });
    const document = core.BuildTypeSofDocument({ hull: "rifter", faction: "minmatar", race: "minmatar" });
    assert.equal(document.schema, "carbon.document");
    assert.equal(document.dna, "rifter:minmatar:minmatar");
});

test("keeps compact graph projection outside the current contract", () =>
{
    const core = new CjsToolCore({
        cache: {},
        sof: { BuildFromDNA: () => ({ schema: "other.document" }) }
    });
    assert.throws(() => core.BuildSofDocument("rifter:minmatar:minmatar"), /unsupported document schema/);
});

test("builds plain SOF model values as the recommended boundary", async () =>
{
    const seen = [];
    const registry = { marker: true };
    const core = new CjsToolCore({
        cache: {},
        sofRegistry: registry,
        sde: { ResolveDna: value => `${value.hull}:${value.faction}:${value.race}` },
        sof: {
            BuildValuesFromDNA(dna, options)
            {
                seen.push(options.registry);
                return { _type: "EveShip2", _id: 1, dna, mesh: { _type: "Tr2Mesh" } };
            },
            async BuildValuesFromDNAAsync(dna, options)
            {
                seen.push(options.registry);
                return { _type: "EveShip2", dna };
            }
        }
    });

    const values = core.BuildTypeSofValues({ hull: "rifter", faction: "minmatar", race: "minmatar" });
    assert.equal(values._type, "EveShip2");
    assert.equal(values.dna, "rifter:minmatar:minmatar");
    assert.equal(values.mesh._type, "Tr2Mesh");

    const asyncValues = await core.BuildSofValuesAsync("rifter:minmatar:minmatar");
    assert.equal(asyncValues._type, "EveShip2");

    // The configured hydration registry threads into every values build.
    assert.deepEqual(seen, [registry, registry]);
});

test("rejects a carbon.document offered as model values", () =>
{
    const documentCore = new CjsToolCore({
        cache: {},
        sofRegistry: {},
        sof: { BuildValuesFromDNA: () => ({ schema: "carbon.document", nodes: [], roots: {} }) }
    });
    assert.throws(() => documentCore.BuildSofValues("rifter:minmatar:minmatar"), /carbon.document where plain model values/);

    const untypedCore = new CjsToolCore({
        cache: {},
        sofRegistry: {},
        sof: { BuildValuesFromDNA: () => ({ dna: "x" }) }
    });
    assert.throws(() => untypedCore.BuildSofValues("rifter:minmatar:minmatar"), /root _type/);
});
