import assert from "node:assert/strict";
import test from "node:test";

import {
    CjsToolLocalisation,
    GuessEnglishName,
    NAME_EVIDENCE,
    NAME_SOURCES,
    ReadGuessedNames,
    ReadManualNames
} from "../src/localisation/index.js";

/**
 * A zh-primary source and the English one it borrows names from.
 *
 * Every case that matters is here: the same object named identically in Chinese
 * by both sources, the same object renamed locally, a type only the zh-primary
 * side has, and an ID whose structure disagrees.
 */
function CreateSource(target, types)
{
    return {
        target,
        build: target === "eve" ? "3466501" : "3466054",
        Table()
        {
            return {
                async Get(id)
                {
                    const row = types[String(id)];

                    return row ? { table: "types", id: Number(id), payload: row } : null;
                },
                async List({ limit = 100, offset = 0 } = {})
                {
                    return Object.entries(types)
                        .slice(offset, offset + limit)
                        .map(([ id, row ]) => ({ table: "types", id: Number(id), payload: row }));
                }
            };
        }
    };
}

const EVE = CreateSource("eve", {
    100: { groupID: 25, published: true, name: { en: "Test Frigate", zh: "测试护卫舰" } },
    181: { groupID: 83, published: true, name: { en: "Depleted Uranium S", zh: "贫铀弹 S" } },
    300: { groupID: 40, published: true, name: { en: "No Chinese Here" } },
    900: { groupID: 4041, published: true, name: { en: "Reused Identifier", zh: "甲" } }
});

const SERENITY = CreateSource("serenity", {
    // Both sources name it identically in Chinese: identity confirmed.
    100: { groupID: 25, published: true, name: { zh: "测试护卫舰" } },
    // Same object, renamed locally - uranium became molybdenum.
    181: { groupID: 83, published: true, name: { zh: "硬钼弹 S" } },
    // Shared ID, no Chinese on the reference side to compare against.
    300: { groupID: 40, published: true, name: { zh: "没有英文" } },
    // Structure disagrees: the only signal that an ID may mean something else.
    900: { groupID: 4072, published: true, name: { zh: "乙" } },
    // Exists only here, so no English exists anywhere.
    85282: { groupID: 303, published: true, name: { zh: "增效剂" } },
    // Unpublished, and therefore not part of the gap list by default.
    85283: { groupID: 303, published: false, name: { zh: "内部物品" } }
});

test("an identical Chinese name confirms the identity outright", async () =>
{
    const localisation = new CjsToolLocalisation(SERENITY, { reference: EVE });
    const name = await localisation.English(100);

    assert.equal(name.text, "Test Frigate");
    assert.equal(name.source, NAME_SOURCES.crosswalk);
    assert.equal(name.evidence, NAME_EVIDENCE.chineseIdentical);
    assert.equal(name.referenceBuild, "3466501");
});

test("a local rename is the same object, and is labelled as one", async () =>
{
    const localisation = new CjsToolLocalisation(SERENITY, { reference: EVE });
    const name = await localisation.English(181);

    assert.equal(name.text, "Depleted Uranium S");
    assert.equal(name.evidence, NAME_EVIDENCE.localRename);
});

test("a shared id with nothing to compare says so rather than claiming proof", async () =>
{
    const localisation = new CjsToolLocalisation(SERENITY, { reference: EVE });
    const name = await localisation.English(300);

    assert.equal(name.text, "No Chinese Here");
    assert.equal(name.evidence, NAME_EVIDENCE.idOnly);
});

test("a structural disagreement refuses the name instead of guessing", async () =>
{
    const localisation = new CjsToolLocalisation(SERENITY, { reference: EVE });

    assert.equal(await localisation.English(900), null);
});

test("a type only the local target has cannot be named until someone writes one", async () =>
{
    const bare = new CjsToolLocalisation(SERENITY, { reference: EVE });

    assert.equal(await bare.English(85282), null);

    const filled = new CjsToolLocalisation(SERENITY, {
        reference: EVE,
        manual: ReadManualNames({ 85282: { en: "Synth Booster", note: "named from its group" } })
    });
    const name = await filled.English(85282);

    assert.equal(name.text, "Synth Booster");
    assert.equal(name.source, NAME_SOURCES.manual);
});

test("a target with its own English never consults the reference", async () =>
{
    const localisation = new CjsToolLocalisation(EVE, {
        reference: {
            target: "never",
            build: "0",
            Table()
            {
                throw new Error("the reference must not be read when the target has English");
            }
        }
    });
    const name = await localisation.English(100);

    assert.equal(name.text, "Test Frigate");
    assert.equal(name.source, NAME_SOURCES.published);
    assert.equal(name.evidence, null);
});

test("with no reference at all, a nameless type stays nameless", async () =>
{
    const localisation = new CjsToolLocalisation(SERENITY, {});

    assert.equal(await localisation.English(100), null);
    assert.equal(localisation.Describe().reference, null);
});

test("the gap list is what a human has to write, and nothing else", async () =>
{
    const localisation = new CjsToolLocalisation(SERENITY, { reference: EVE });
    const gaps = await localisation.Gaps();

    // 900 is refused by structure and 85282 has no counterpart; the unpublished
    // 85283 is excluded, and everything nameable is absent.
    assert.deepEqual(gaps.map(gap => gap.typeID).sort((left, right) => left - right), [ 900, 85282 ]);
    assert.equal(gaps[0].names.zh, "乙");

    const withUnpublished = await localisation.Gaps({ publishedOnly: false });

    assert.equal(withUnpublished.length, 3);
});

test("manual names accept both spellings and reject unusable keys", () =>
{
    const manual = ReadManualNames({
        100: "Shorthand Name",
        200: { en: "Long Form", note: "why" },
        300: { note: "no name here" },
        abc: "not an id",
        "-4": "negative"
    });

    assert.equal(manual.get(100).en, "Shorthand Name");
    assert.equal(manual.get(200).note, "why");
    assert.equal(manual.has(300), false);
    assert.equal(manual.size, 2);
});

test("a guess is used only where nothing verified exists, and is labelled", async () =>
{
    const guesses = ReadGuessedNames({
        names: {
            // A type the crosswalk can already name: the guess must lose.
            100: { en: "Guessed Frigate", confidence: "partial" },
            // The Serenity-only type, which nothing else can name.
            85282: { en: "National Day Limited Booster Type A", confidence: "composed" },
            // The refused reused identifier: a guess is allowed here, because it
            // is composed from the local name rather than the suspect ID.
            900: { en: "Something Local", confidence: "partial" }
        }
    });
    const localisation = new CjsToolLocalisation(SERENITY, { reference: EVE, guesses });

    const verified = await localisation.English(100);

    assert.equal(verified.text, "Test Frigate");
    assert.equal(verified.source, NAME_SOURCES.crosswalk);

    const guessed = await localisation.English(85282);

    assert.equal(guessed.text, "National Day Limited Booster Type A");
    assert.equal(guessed.source, NAME_SOURCES.ai);
    assert.equal(guessed.confidence, "composed");

    const afterRefusal = await localisation.English(900);

    assert.equal(afterRefusal.source, NAME_SOURCES.ai);
});

test("a hand-written name outranks a guess for the same type", async () =>
{
    const localisation = new CjsToolLocalisation(SERENITY, {
        reference: EVE,
        manual: ReadManualNames({ 85282: "Synth Blue Pill" }),
        guesses: ReadGuessedNames({ names: { 85282: { en: "Machine Guess", confidence: "composed" } } })
    });
    const name = await localisation.English(85282);

    assert.equal(name.text, "Synth Blue Pill");
    assert.equal(name.source, NAME_SOURCES.manual);
});

test("guesses do not shrink the list of names a human still owes", async () =>
{
    const localisation = new CjsToolLocalisation(SERENITY, {
        reference: EVE,
        guesses: ReadGuessedNames({ names: { 85282: { en: "Machine Guess" }, 900: { en: "Another" } } })
    });
    const gaps = await localisation.Gaps();

    // Unchanged by the guesses: a machine reading is not verification.
    assert.deepEqual(gaps.map(gap => gap.typeID).sort((left, right) => left - right), [ 900, 85282 ]);
});

test("composition names a local rename the dictionary cannot match", () =>
{
    // The reference writes the Vindicator 惩戒者级; the local target writes 惩戒级. Only
    // the local dictionary, built through shared type IDs, carries the latter.
    const dictionary = new Map([ [ "惩戒级", "Vindicator" ] ]);
    const guess = GuessEnglishName("惩戒级圣诞限定涂装", dictionary);

    assert.equal(guess.text, "Vindicator Christmas Limited SKIN");
    assert.equal(guess.confidence, "composed");
});

test("word order rules fix what a flat table cannot", () =>
{
    const dictionary = new Map([ [ "大脑加速器", "Cerebral Accelerator" ] ]);

    assert.equal(GuessEnglishName("大脑加速器A型", dictionary).text, "Cerebral Accelerator Type A");
    assert.equal(GuessEnglishName("2024年12月大脑加速器", dictionary).text, "2024 December Cerebral Accelerator");
    assert.equal(GuessEnglishName("4周年大脑加速器", dictionary).text, "4th Anniversary Cerebral Accelerator");
});

test("an untranslatable name is refused rather than half-invented", () =>
{
    const dictionary = new Map([ [ "大脑加速器", "Cerebral Accelerator" ] ]);

    assert.equal(GuessEnglishName("完全未知的东西", dictionary), null);
    assert.equal(GuessEnglishName("", dictionary), null);

    // Partial keeps the untranslated run in place and says what it was.
    const partial = GuessEnglishName("未知大脑加速器", dictionary);

    assert.equal(partial.confidence, "partial");
    assert.deepEqual(partial.untranslated, [ "未知" ]);
    assert.match(partial.text, /Cerebral Accelerator$/u);
});
