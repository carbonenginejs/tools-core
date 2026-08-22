import assert from "node:assert/strict";
import test from "node:test";

import { BuildTypeExtras } from "../src/sde/build/buildTypeExtras.js";

const LABELS = new Map([
    [ 732059, "Unparalleled innovation has led to undeniable strength." ],
    [ 732060, "Joroutte Duvolle" ],
]);
const LOCALIZATION = { Get: (id) => LABELS.get(Number(id)) ?? null };

test("manufacturers stay identifiers and the quote resolves to text", () =>
{
    const built = BuildTypeExtras({
        28661: { manufacturers: [ "1000109" ], quoteID: 732059, quoteAuthorID: 732060 },
    }, LOCALIZATION);

    // The identifier is the join key into npcCorporations, so it stays a number
    // rather than becoming "Duvolle Laboratories".
    assert.deepEqual(built.types["28661"], {
        manufacturers: [ 1000109 ],
        quote: { en: "Unparalleled innovation has led to undeniable strength." },
        quoteAuthor: { en: "Joroutte Duvolle" },
    });
});

test("a type carrying nothing is omitted rather than published empty", () =>
{
    const built = BuildTypeExtras({
        1: { manufacturers: [] },
        2: {},
        3: { manufacturers: [ "1000109" ] },
    }, LOCALIZATION);

    assert.deepEqual(Object.keys(built.types), [ "3" ]);
});

test("an unresolved label is omitted, not published as empty text", () =>
{
    const built = BuildTypeExtras({ 9: { quoteID: 999999, manufacturers: [ "1" ] } }, LOCALIZATION);

    assert.equal("quote" in built.types["9"], false);
    assert.deepEqual(built.types["9"].manufacturers, [ 1 ]);
});

test("the language names the published key", () =>
{
    const built = BuildTypeExtras({ 9: { quoteID: 732060 } }, LOCALIZATION, { language: "zh" });

    assert.deepEqual(built.types["9"].quote, { zh: "Joroutte Duvolle" });
});

test("it refuses inputs it cannot build from", () =>
{
    assert.throws(() => BuildTypeExtras(null, LOCALIZATION), /decoded type records/u);
    assert.throws(() => BuildTypeExtras({}, {}), /localisation table/u);
});
