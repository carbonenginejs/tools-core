import assert from "node:assert/strict";
import test from "node:test";

import { ProjectGraphics } from "../src/sde/build/projectGraphics.js";
import { ProjectGraphicMaterialSets } from "../src/sde/build/projectGraphicMaterialSets.js";

test("graphics drops the container's empties, which is how that record says absent", () =>
{
    // graphicids.fsdbinary carries no presence word, so an empty string, an
    // empty list or a zero identifier is the only way it can say "nothing here".
    // Emitting them would be unanswerable downstream: a consumer cannot tell a
    // sofHullName of "" from a hull that was never set.
    const rows = ProjectGraphics({
        10: { graphicFile: "res:/dx9/model/worldobject/planet/moon.red", iconFolder: "", sofHullName: "", sofLayout: [], sofMaterialSetID: 0 },
        20: { graphicFile: "", sofHullName: "rifter", sofRaceName: "minmatar", sofLayout: [ "hangar_announcements" ], sofMaterialSetID: "38" }
    });

    assert.deepEqual(rows[10], { _key: 10, graphicFile: "res:/dx9/model/worldobject/planet/moon.red" });
    assert.deepEqual(rows[20], {
        _key: 20,
        sofHullName: "rifter",
        sofLayout: [ "hangar_announcements" ],
        // The reader returns an identifier string; the export publishes a number.
        sofMaterialSetID: 38,
        sofRaceName: "minmatar"
    });
    assert.equal(typeof rows[20].sofMaterialSetID, "number");
});

test("material sets keep a present-but-empty string, because presence is the fact", () =>
{
    // graphicmaterialsets.fsdbinary DOES carry a presence word, so the reader
    // has already dropped what the container calls absent. Sixteen published
    // rows carry an empty sofRaceHint or resPathInsert, and filtering on
    // emptiness here would silently drop them - the opposite rule to graphics,
    // on data that looks the same.
    const rows = ProjectGraphicMaterialSets({
        1: { description: "Ardishapur (Amarr Hulls)", sofRaceHint: "", material1: "ardishapur" },
        2: { description: "Other" }
    });

    assert.equal(rows[1].sofRaceHint, "");
    assert.ok("sofRaceHint" in rows[1]);
    assert.equal("sofRaceHint" in rows[2], false);
});

test("colours are rounded the way the exporter rounds them", () =>
{
    // Measured across 14,736 published components: at 6 places every one matches
    // exactly, while 5 and 7 each miss more than half. The container stores
    // float32, so 0.0941176488995552 is published as 0.094118.
    const rows = ProjectGraphicMaterialSets({
        1: {
            description: "x",
            colorHull: { r: 0.0941176488995552, g: 0.0941176488995552, b: 0.0941176488995552, a: 1 }
        }
    });

    assert.deepEqual(rows[1].colorHull, { r: 0.094118, g: 0.094118, b: 0.094118, a: 1 });
});

test("both projections refuse inputs they cannot honour", () =>
{
    assert.throws(() => ProjectGraphics(null), TypeError);
    assert.throws(() => ProjectGraphicMaterialSets(null), TypeError);
});
