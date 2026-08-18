/**
 * Machine-guessed English names, for types no source can name.
 *
 * ## Why this is not blind translation
 *
 * The reference source publishes its type names in eight languages, so it is a
 * 49212-entry local-to-English dictionary for exactly this vocabulary, written
 * by the people who named the things. Most of what a local-only source adds is
 * built out of that vocabulary rather than beside it:
 *
 * ```text
 * 加达里海军霍克比尔级 翻新组件   ->  Caldari Navy Hookbill Refurbishment Component
 * 超大型护盾回充增量器 I 翻新组件  ->  X-Large Shield Booster I Refurbishment Component
 * ```
 *
 * The base is a real item the reference source already names; only the affix is
 * local. So a guess is composed from a verified translation plus a known affix,
 * and 4164 of 8275 gaps resolve from five affixes alone. That is a very different claim from
 * translating a sentence, and it is why the result is worth keeping.
 *
 * ## It is still a guess, and is labelled one
 *
 * Nothing here is authority. A guess is written to its own file, reported with
 * `source: "ai"` and a confidence, and always loses to a hand-written name. The
 * point is to give a consumer something readable for 8000 types nobody is going
 * to translate by hand, not to pretend it is the reference source's wording.
 *
 * Confidence is measured, not asserted:
 *
 * - `composed` - the whole name was covered by dictionary entries and known
 *   affixes, with nothing left over in the local language.
 * - `partial` - some of it translated. The untranslated fragments are kept
 *   in place, so the result reads as half-translated instead of silently
 *   dropping meaning, and `untranslated` lists them.
 *
 * A name that translates to nothing at all is not emitted.
 */

/**
 * Local vocabulary the reference source does not contain.
 *
 * Hand-written, because these are words a local source added and the reference
 * source has no counterpart for: the refurbishment system, season passes,
 * celebration boosters and SKIN wording. Ordered longest first so that
 * `永久涂装` wins over `涂装`.
 *
 * Every entry is a literal reading rather than an invented marketing name. A
 * guess that reads plainly can be corrected by someone who knows better; one
 * that reads like official copy invites being trusted.
 */
export const LOCAL_VOCABULARY = Object.freeze([
    [ "翻新组件", "Refurbishment Component" ],
    // Chosen from measured frequency rather than intuition: every entry below
    // was among the most common fragments left untranslated by the dictionary
    // alone, counted over all 8275 gaps.
    [ "特别版建筑涂层", "Special Edition Structure SKIN" ],
    [ "重型攻击导弹", "Heavy Assault Missile" ],
    [ "耐用性增强", "Durability Enhancement" ],
    [ "自动加农炮", "AutoCannon" ],
    [ "轻型导弹", "Light Missile" ],
    [ "重型导弹", "Heavy Missile" ],
    [ "巡航导弹", "Cruise Missile" ],
    [ "资源储备箱", "Resource Cache" ],
    [ "采掘行动", "Mining Operation" ],
    [ "猎捕行动", "Hunting Operation" ],
    [ "天空之境", "Realm of the Sky" ],
    [ "国庆限定", "National Day Limited" ],
    [ "新春限定", "New Spring Limited" ],
    [ "早春惊喜", "Early Spring Surprise" ],
    [ "无法升级", "Not Upgradable" ],
    [ "轨道弹", "Charge" ],
    [ "榴弹炮", "Howitzer" ],
    [ "无人机", "Drone" ],
    [ "增效剂", "Booster" ],
    [ "增效器", "Amplifier" ],
    [ "自选箱", "Choice Crate" ],
    [ "储备箱", "Cache" ],
    [ "尤尔节", "Yoiul Festival" ],
    [ "工会日", "Union Day" ],
    [ "联合矿业", "ORE" ],
    [ "加达里", "Caldari" ],
    [ "盖伦特", "Gallente" ],
    [ "米玛塔尔", "Minmatar" ],
    [ "古斯塔斯", "Guristas" ],
    [ "血袭者", "Blood Raiders" ],
    [ "天蛇", "Serpentis" ],
    [ "萨沙", "Sansha" ],
    [ "艾玛", "Amarr" ],
    [ "帝国", "Empire" ],
    [ "共和国", "Republic" ],
    [ "联邦", "Federation" ],
    [ "星系", "System" ],
    [ "鱼雷", "Torpedo" ],
    [ "火箭", "Rocket" ],
    [ "晶体", "Crystal" ],
    [ "纤维", "Fiber" ],
    [ "存根", "Stub" ],
    [ "技能", "Skill" ],
    [ "导航", "Navigation" ],
    [ "圣诞", "Christmas" ],
    [ "晨曦", "Dawn" ],
    [ "长弓", "Longbow" ],
    [ "金秋", "Golden Autumn" ],
    [ "早春", "Early Spring" ],
    [ "新春", "New Spring" ],
    [ "立夏", "Start of Summer" ],
    [ "立冬", "Start of Winter" ],
    [ "大寒", "Major Cold" ],
    [ "大雪", "Major Snow" ],
    [ "大暑", "Major Heat" ],
    [ "凛冬", "Midwinter" ],
    [ "龙腾", "Dragon" ],
    [ "国庆", "National Day" ],
    [ "限定", "Limited" ],
    [ "基础", "Basic" ],
    [ "调频", "Frequency" ],
    [ "明眸", "Clarity" ],
    [ "硬壳", "Hardshell" ],
    [ "火枪", "Musket" ],
    [ "效能", "Efficiency" ],
    [ "技能速成特别许可证", "Special Skill Training Certificate" ],
    [ "速成许可证", "Accelerated Training Certificate" ],
    [ "大脑加速器", "Cerebral Accelerator" ],
    [ "突变质体箱", "Mutaplasmid Crate" ],
    [ "原型模板", "Prototype Template" ],
    [ "通行凭证", "Season Pass" ],
    [ "限定涂装", "Limited SKIN" ],
    [ "永久涂装", "Permanent SKIN" ],
    [ "涂装", "SKIN" ],
    [ "蓝图", "Blueprint" ],
    [ "宝箱", "Treasure Chest" ],
    [ "礼券", "Voucher" ],
    [ "徽章", "Badge" ],
    [ "模块", "Module" ],
    [ "碎片", "Fragment" ],
    [ "药剂", "Booster" ],
    [ "庆典", "Celebration" ],
    [ "赛季", "Season" ],
    [ "限时", "Limited Time" ],
    [ "新年", "New Year" ],
    [ "冠军", "Champion" ],
    [ "试验型", "Experimental" ],
    [ "试炼", "Trial" ],
    [ "实验区", "Test Zone" ],
    [ "改良型", "Improved" ],
    [ "旗舰级", "Capital" ],
    [ "精英级", "Elite" ],
    [ "级", "" ]
]);

/**
 * Patterns applied after substitution, where word order has to change.
 *
 * `型` is the clearest case and the single most common leftover - 779 of them.
 * As a substitution it can only ever produce `A Type`, because a table maps a
 * fragment in place; the English needs `Type A`, which takes a rule that can see
 * what came before it. Dates are the same shape: `YC124年12月` reads as
 * `YC124 December`, not `YC124 year 12 month`.
 */
export const PATTERN_RULES = Object.freeze([
    [ /(\d+)\s*周年/gu, (match, value) => `${value}th Anniversary` ],
    [ /([A-Za-z0-9]+)\s*型/gu, (match, value) => `Type ${value}` ],
    [ /(\d{4})\s*年\s*(\d{1,2})\s*月/gu, (match, year, month) => `${year} ${MONTHS[Number(month) - 1] ?? month}` ],
    [ /(\d{1,2})\s*月/gu, (match, month) => MONTHS[Number(month) - 1] ?? match ],
    [ /(\d{4})\s*年/gu, (match, year) => year ]
]);

const MONTHS = Object.freeze([
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]);

/** Type suffixes that mean "of the thing named before me". */
const COMPOSITION_AFFIXES = Object.freeze([
    "翻新组件",
    "原型模板",
    "突变质体箱",
    "蓝图",
    "模块",
    "碎片",
    "涂装"
]);

const CJK = /[㐀-䶿一-鿿豈-﫿]/u;

/**
 * Builds the zh-to-en dictionary from a source that publishes both.
 *
 * Types only. Group names were tried and dropped: they translate categories
 * rather than items, and matching them inside an item name produced worse
 * readings than leaving the fragment untranslated.
 */
export async function BuildNameDictionary(source)
{
    const dictionary = new Map();
    const table = source.Table("types");
    let offset = 0;

    for (;;)
    {
        const page = await table.List({ limit: 1000, offset });

        if (!page.length) break;

        for (const record of page)
        {
            const row = record?.payload ?? record;

            if (row.name?.zh && row.name?.en && !dictionary.has(row.name.zh))
            {
                dictionary.set(row.name.zh, row.name.en);
            }
        }

        offset += page.length;
    }

    return dictionary;
}

/**
 * The local source's own names, mapped to English through shared type IDs.
 *
 * The second dictionary, and the one that fixes the case the reference source
 * cannot. A target can rename a hull, so the two sources carry different local
 * names for it, and a local-only SKIN named after that hull then matches nothing
 * in the reference source's local names. Both carry the hull under the same type
 * ID, though, so the crosswalk already knows the answer - this is that same
 * identity, indexed by the local name instead of the ID.
 *
 * Built per target, because two targets do not always rename to the same word.
 */
export async function BuildLocalDictionary(localSource, referenceSource)
{
    const reference = referenceSource.Table("types");
    const table = localSource.Table("types");
    const dictionary = new Map();
    let offset = 0;

    for (;;)
    {
        const page = await table.List({ limit: 1000, offset });

        if (!page.length) break;

        for (const record of page)
        {
            const row = record?.payload ?? record;
            const zh = row.name?.zh;

            if (!zh || dictionary.has(zh)) continue;

            const foreign = await reference.Get(String(record.id));
            const english = (foreign?.payload ?? foreign)?.name?.en;

            if (english) dictionary.set(zh, english);
        }

        offset += page.length;
    }

    return dictionary;
}

/** Merges dictionaries, first writer winning, for the substitution pass. */
export function MergeDictionaries(...dictionaries)
{
    const merged = new Map();

    for (const dictionary of dictionaries)
    {
        for (const [ zh, en ] of dictionary) if (!merged.has(zh)) merged.set(zh, en);
    }

    return merged;
}

/**
 * Guesses an English name for one Chinese one.
 *
 * Returns null when nothing could be translated, because a name that is still
 * entirely Chinese is not a guess, it is the input.
 */
export function GuessEnglishName(chinese, dictionary)
{
    const text = String(chinese ?? "").trim();

    if (!text) return null;

    const exact = dictionary.get(text);

    // Verified outright, not guessed - the same product under another ID.
    if (exact) return { text: exact, confidence: "composed", method: "dictionary", untranslated: [] };

    const composed = Compose(text, dictionary);

    if (composed) return composed;

    return Substitute(text, dictionary);
}

/**
 * `<known item> <affix>`, which is most of what a local source adds.
 *
 * Recursive on the base so `X 蓝图 翻新组件` composes both ways round, and the
 * base is looked up whole rather than by parts - a whole-name hit is a
 * translation the reference source published, not something this file assembled.
 */
function Compose(text, dictionary)
{
    for (const affix of COMPOSITION_AFFIXES)
    {
        if (!text.endsWith(affix)) continue;

        const base = text.slice(0, -affix.length).trim();

        if (!base) continue;

        const english = dictionary.get(base) ?? Compose(base, dictionary)?.text;

        if (!english) continue;

        const suffix = LookupLocal(affix);

        return {
            text: `${english} ${suffix}`.trim(),
            confidence: "composed",
            method: "dictionary+affix",
            untranslated: []
        };
    }

    return null;
}

/**
 * Longest-match substitution over whatever is left.
 *
 * The fallback, and the one that produces `partial`. Chinese that matched
 * nothing stays where it was: a reader can see precisely which part is
 * untranslated, and the missing piece is usually a date or an event name where
 * leaving it is better than inventing one.
 */
function Substitute(input, dictionary)
{
    // Word-order rules first: they consume the fragments that a flat table
    // cannot place correctly, and what survives them is ordinary vocabulary.
    const text = ApplyPatterns(input);
    const phrases = Phrases(dictionary);
    const segments = [];
    let index = 0;
    let translatedChars = 0;
    let chineseChars = 0;

    while (index < text.length)
    {
        let matched = null;

        for (const [ phrase, english ] of phrases)
        {
            if (phrase.length <= text.length - index && text.startsWith(phrase, index))
            {
                matched = [ phrase, english ];
                break;
            }
        }

        if (matched)
        {
            if (matched[1]) segments.push({ text: matched[1], translated: true });

            translatedChars += matched[0].length;
            index += matched[0].length;
            continue;
        }

        const character = text[index];
        const chinese = CJK.test(character);

        if (chinese) chineseChars++;

        const last = segments[segments.length - 1];

        // Runs of untranslated characters stay together, so a leftover reads as
        // one word rather than as spaced-out characters.
        if (last && !last.translated && last.chinese === chinese) last.text += character;
        else segments.push({ text: character, translated: false, chinese });

        index++;
    }

    if (!translatedChars) return null;

    const untranslated = segments.filter(segment => segment.chinese).map(segment => segment.text);

    return {
        text: Join(segments),
        confidence: chineseChars ? "partial" : "composed",
        method: "substitution",
        coverage: Number((translatedChars / (translatedChars + chineseChars)).toFixed(3)),
        untranslated
    };
}

function ApplyPatterns(text)
{
    let result = text;

    for (const [ pattern, replace ] of PATTERN_RULES) result = result.replace(pattern, replace);

    return result;
}

/**
 * Joins segments, inserting the spaces Chinese does not write.
 *
 * Without this, two adjacent matches produce `SKINTreasure Chest`. Punctuation
 * and existing whitespace suppress the space, so quotes and brackets are not
 * pushed away from what they enclose.
 */
function Join(segments)
{
    let result = "";

    for (const segment of segments)
    {
        const previous = result[result.length - 1];
        const next = segment.text[0];

        if (result && NeedsSpace(previous, next, result)) result += " ";

        result += segment.text;
    }

    return result.replace(/\s+/gu, " ").trim();
}

const NO_SPACE_BEFORE = new Set([ ")", "]", "}", ",", ".", "!", "?", ":", ";", "”", "’", "、", "。", "%" ]);
const NO_SPACE_AFTER = new Set([ "(", "[", "{", "“", "‘", "-", "/", "×" ]);
const QUOTES = new Set([ "'", "\"" ]);

function NeedsSpace(previous, next, sofar)
{
    if (!previous || !next) return false;
    if (/\s/u.test(previous) || /\s/u.test(next)) return false;
    if (NO_SPACE_BEFORE.has(next) || NO_SPACE_AFTER.has(previous)) return false;

    // A straight quote is opening or closing depending only on what precedes
    // it, and the two want opposite spacing: `'Musket' Booster`, never
    // `' Musket'Booster`.
    if (QUOTES.has(previous)) return !Opening(sofar, sofar.length - 1);
    if (QUOTES.has(next)) return Opening(sofar, sofar.length);

    return true;
}

function Opening(text, index)
{
    const before = text[index - 1];

    return !before || /[\s([{]/u.test(before);
}

/**
 * The substitution table, longest phrase first, built once per dictionary.
 *
 * Single characters are excluded. A one-character match is nearly always
 * coincidental inside a longer word and produces confident nonsense, which is
 * the failure mode worth designing against.
 */
const phraseCache = new WeakMap();

function Phrases(dictionary)
{
    if (phraseCache.has(dictionary)) return phraseCache.get(dictionary);

    const phrases = [];

    for (const [ zh, en ] of dictionary) if (zh.length > 1) phrases.push([ zh, en ]);

    for (const [ zh, en ] of LOCAL_VOCABULARY) if (zh.length > 1) phrases.push([ zh, en ]);

    phrases.sort((left, right) => right[0].length - left[0].length);
    phraseCache.set(dictionary, phrases);

    return phrases;
}

function LookupLocal(phrase)
{
    for (const [ zh, en ] of LOCAL_VOCABULARY) if (zh === phrase) return en;

    return phrase;
}
