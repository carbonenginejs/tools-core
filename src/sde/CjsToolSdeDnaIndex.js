/**
 * The inverse of DNA resolution: which hulls and skins produce a given DNA.
 *
 * Forward resolution answers type + skin -> DNA. Nothing answered the other
 * way, so a DNA from a bug report, a tool or a conversation named no ship, and
 * a pattern could not list the skins that use it.
 *
 * Built here rather than in a second module because the strings have to be
 * byte-identical to the ones `CjsToolSde` emits — the lowercasing, the field
 * aliases, the `none` placeholder for an unfed layer. A separate implementation
 * would drift on one of those and produce an index that silently misses.
 *
 * ## A DNA is a record, not a string
 *
 * Only the first three segments are positional:
 *
 *     <hull>:<faction>:<race>
 *
 * Everything after them is a named clause — `mesh?`, `pattern?`,
 * `respathinsert?` — and **the clauses may appear in any order**. Two DNAs
 * differing only in clause order are the same DNA. So the index stores and
 * matches the parsed record, and nothing here compares whole DNA strings or
 * takes a prefix of one past the base. A string comparison would have reported
 * two spellings of one skin as two different skins, silently and only for the
 * skins whose clauses happen to be emitted in an unusual order.
 *
 * ## What it costs
 *
 * One pass over the skins, and one over the licences to group them by skin
 * first. That grouping is the whole reason this does not call
 * `GetSkinTypeIDs`, which rescans every licence per skin: at roughly 7,000
 * skins and 11,800 licences that is 80 million comparisons for an answer one
 * pass already has.
 *
 * @see /docs/contracts/dna-reverse-index.md
 */

/** A clause segment: a name, `?`, and a `;`-joined body. */
const CLAUSE = /^([a-z0-9_]+)\?([\s\S]*)$/;

/** How many leading segments are positional: hull, faction, race. */
const BASE_SEGMENTS = 3;

/**
 * The categories this index answers with: ships and structures.
 *
 * A graphic is shared by everything modelled on that hull, so without this the
 * Apocalypse's `ab1_t1` also answers with its blueprints (category 9), the NPC
 * entities flying it (11), and a Large Collidable Object wreck of it (2). None
 * is a space object a visitor can hold, and all of them carry the ship's name.
 */
const SPACE_OBJECT_CATEGORIES = Object.freeze(new Set([ 6, 65 ]));

/** Clause name in a DNA -> field name on a match record. */
const CLAUSE_FIELDS = Object.freeze({
    mesh: "mesh",
    pattern: "pattern",
    respathinsert: "resPathInsert"
});

/**
 * Every map a bare term is tested against, in the order they are reported.
 *
 * All of them, because a visitor typing a fragment does not know which part of a
 * DNA it is, and does not need to: the index knows. `bases` is included so
 * `ardishapur:amarr` — a fragment spanning two segments, which belongs to no
 * single one — still resolves.
 */
const SEGMENTS = Object.freeze([
    "bases", "hulls", "factions", "races", "patterns", "materials", "inserts"
]);

/**
 * Splits a DNA into its fixed base and its clauses, keyed by clause name.
 *
 * Unknown clause names are kept rather than dropped: this format has already
 * produced one clause nobody had recorded, and a matcher that discards what it
 * does not recognise would answer confidently with the rest.
 */
export function SplitDna(dna)
{
    const parts = String(dna ?? "").split(":");
    const clauses = new Map();

    for (const segment of parts.slice(BASE_SEGMENTS))
    {
        const match = segment.match(CLAUSE);

        if (match) clauses.set(match[1], match[2]);
    }

    return { base: parts.slice(0, BASE_SEGMENTS).join(":"), parts, clauses };
}

/**
 * Builds the reverse index over an already-loaded `CjsToolSde`.
 *
 * @param {Object} sde - a CjsToolSde holding the prepared tables
 * @returns {Object} the index document
 */
export function BuildDnaIndex(sde)
{
    const entries = [];
    const bases = new Map();
    const hulls = new Map();
    const factions = new Map();
    const races = new Map();
    const patterns = new Map();
    const materials = new Map();
    const inserts = new Map();

    // A graphic per base, which is what makes a skin's icon findable.
    //
    // Graphics are keyed by hull *and faction*: `ab1_t1` has one row for the
    // plain hull and separate rows for kador and khanid, each with its own icon
    // in the same folder. So the icon a skin should show is the one belonging to
    // its own base — not the hull's, which is what a consumer reaching for
    // `types.graphicID` gets, and which is the same picture for every skin.
    const graphics = new Map();

    for (const graphic of sde.Graphics())
    {
        const base = [ graphic.sofHullName, graphic.sofFactionName, graphic.sofRaceName ]
            .filter(Boolean)
            .join(":")
            .toLowerCase();

        if (!base || !graphic.iconFolder || graphics.has(base)) continue;

        graphics.set(base, { graphicID: graphic._key, iconFolder: graphic.iconFolder });
    }

    // A hull wearing no skin is a record like any other: `skinID: null`, and no
    // clauses, because it has none.
    //
    // It is here rather than synthesised by consumers, which is what they had to
    // do while the index held only skins — and a consumer inventing a hull row
    // from a skin match cannot help asserting things the hull does not say.
    // Megathron is `gb2_t1:gallentebase:gallente` and one of its skins is
    // `gb2_t1:yc125_gallente:gallente`, so searching `yc125` produced a Megathron
    // row whose own DNA contains no `yc125` anywhere. As a record it simply does
    // not match, with no rule needed to exclude it: the six parts a DNA has are
    // the whole of what any record is matched on.
    for (const type of sde.Types())
    {
        // Most types have no graphic at all — skills, minerals — and asking for
        // graphic `undefined` is an error rather than a miss.
        if (type.graphicID == null || !IsSpaceObject(sde, type)) continue;

        const graphic = sde.GetGraphic(type.graphicID);

        if (!graphic?.sofHullName) continue;

        const base = [ graphic.sofHullName, graphic.sofFactionName, graphic.sofRaceName ]
            .filter(Boolean).join(":").toLowerCase();
        const at = entries.length;

        entries.push({
            base,
            mesh: null,
            pattern: null,
            resPathInsert: null,
            typeID: type._key,
            skinID: null,
            dna: base,
            // A hull is not a skin and is on every shard.
            visibleTranquility: true,
            visibleSerenity: true
        });

        const parts = base.split(":");

        Add(bases, base, at);
        Add(hulls, parts[0], at);
        if (parts[1]) Add(factions, parts[1], at);
        if (parts[2]) Add(races, parts[2], at);
    }

    for (const { skinID, typeID } of EachSkinUse(sde))
    {
        // The same rule as the hulls above: a licence can name a type that is not
        // a space object, and one filter for everything the index answers with
        // beats two that can disagree.
        if (!IsSpaceObject(sde, sde.GetType(typeID))) continue;

        // A skin that names a type its source does not carry is a broken row
        // rather than a reason to abandon the index; it is skipped and the rest
        // still resolves.
        const dna = TryResolve(sde, skinID, typeID);

        if (!dna) continue;

        const { base, parts, clauses } = SplitDna(dna);
        const at = entries.length;
        const entry = {
            base,
            mesh: null,
            pattern: null,
            resPathInsert: null,
            typeID,
            skinID,
            dna,
            // Which shard the skin is visible on, carried rather than filtered:
            // a Serenity-only skin is real data and this index serves every
            // target. A consumer showing one shard filters on it.
            visibleTranquility: sde.GetSkin(skinID)?.visibleTranquility ?? null,
            visibleSerenity: sde.GetSkin(skinID)?.visibleSerenity ?? null
        };

        for (const [ name, body ] of clauses)
        {
            const field = CLAUSE_FIELDS[name];

            if (field) entry[field] = body;
        }

        entries.push(entry);

        Add(bases, base, at);
        Add(hulls, parts[0], at);
        Add(factions, parts[1], at);
        Add(races, parts[2], at);

        // The pattern clause names the pattern first, then its two materials.
        const [ pattern, ...patternMaterials ] = entry.pattern?.split(";") ?? [];

        if (pattern && pattern !== "none") Add(patterns, pattern, at);

        // Materials are indexed as themselves, so "which skins use
        // black_gunmetal_metallic" is a lookup rather than a scan. They come
        // from both clauses because a material is the same thing in either.
        for (const material of [ ...(entry.mesh?.split(";") ?? []), ...patternMaterials ])
        {
            if (material && material !== "none") Add(materials, material, at);
        }

        if (entry.resPathInsert) Add(inserts, entry.resPathInsert, at);
    }

    return {
        schema: "carbon.dnaIndex",
        schemaVersion: 2,
        build: sde.build ?? null,
        entries,
        bases: Sorted(bases),
        hulls: Sorted(hulls),
        factions: Sorted(factions),
        races: Sorted(races),
        patterns: Sorted(patterns),
        materials: Sorted(materials),
        inserts: Sorted(inserts),
        graphics: Object.fromEntries(graphics)
    };
}

/**
 * Answers a query against a built index.
 *
 * Resolution is by lookup rather than by guessing at the shape of the input.
 * The index already holds every base, hull, faction, race and pattern name, so
 * "is this part of a DNA" is exact membership and there is no heuristic to get
 * wrong:
 *
 *   contains a colon   DNA-shaped: match the base, then the clauses by name
 *   no colon           tested against all four segment maps
 *
 * A term legitimately matches several: `amarr` is a race and part of many
 * faction names. Every match is returned, because the caller knows which they
 * meant and this does not.
 *
 * A match is **exact** when the query names the same clauses the DNA carries,
 * with the same bodies — not when the strings are equal, which they need not be
 * for two spellings of one DNA.
 *
 * @param {Object} index - a document from `BuildDnaIndex`
 * @param {String} query
 * @param {Object} [options]
 * @param {Number} [options.limit=40] - most matches returned
 * @returns {Object} `{ query, total, truncated, matches: [{ base, mesh, pattern,
 *                      resPathInsert, typeID, skinID, dna, exact }] }`
 */
export function QueryDnaIndex(index, query, options = {})
{
    const limit = NormalizeLimit(options.limit);
    const term = String(query ?? "").trim().toLowerCase();

    if (!term) return { query: term, total: 0, truncated: false, matches: [] };

    const matches = term.includes(":")
        ? MatchByDna(index, term)
        : MatchBySegment(index, term);

    // Exact first: someone who typed a whole DNA named one thing, and it should
    // not be somewhere in the middle of the near misses.
    // Exact first, then by how much of the record the query did not account for.
    //
    // `extra` counts the clauses a match carries that the query never named. A
    // search for a base has nothing to say about mesh or pattern, so a plainly
    // dressed skin answers it more directly than one loaded with three clauses
    // the visitor did not ask about — and a bare hull, which carries none,
    // answers it most directly of all. This is term coverage, the same signal
    // any search ranks by, rather than a preference for short strings: name a
    // clause and the DNAs carrying it stop being penalised for it.
    matches.sort((left, right) =>
        (left.exact ? 0 : 1) - (right.exact ? 0 : 1)
        || left.extra - right.extra
        || right.matched - left.matched
        || left.base.localeCompare(right.base)
        || (left.skinID ?? 0) - (right.skinID ?? 0));

    // The total is the count before the limit, always. A caller that shows "40"
    // when there are 489 has not been told it is looking at a page of a larger
    // answer, and neither has the person reading it.
    // `at` is how a match is deduplicated while being gathered — the entry's
    // position — and is meaningless to a caller holding one record. It does not
    // leave here, or the next implementer treats it as part of the contract.
    const page = matches.slice(0, limit).map(({ at, ...match }) => match);

    // The graphic for each base on this page, keyed rather than copied onto
    // every match: a page is one hull's skins far more often than not, so the
    // same folder string would otherwise be repeated a couple of hundred times.
    const graphics = {};

    for (const match of page)
    {
        const graphic = index.graphics?.[match.base];

        if (graphic) graphics[match.base] = graphic;
    }

    return {
        query: term,
        total: matches.length,
        truncated: matches.length > limit,
        graphics,
        matches: page
    };
}

/**
 * DNA-shaped input: the base positionally, then the clauses by name.
 *
 * The base may be partial — `ab1_t1:ardi` is a question, not a typo — so a base
 * that is not itself a key is matched as a prefix over the bases. Past the base
 * nothing is a prefix of anything: clauses are matched by name, in any order,
 * and only the last one typed may be incomplete, because that is the one still
 * being written.
 */
function MatchByDna(index, term)
{
    const { base, parts, clauses } = SplitDna(term);
    const typed = [ ...clauses ];
    const partial = parts.length > BASE_SEGMENTS ? parts[parts.length - 1] : null;

    // Fewer than three segments is a partial base; so is a third segment still
    // being typed. Both resolve the same way, against the bases.
    const bases = index.bases?.[base] && parts.length >= BASE_SEGMENTS
        ? [ base ]
        : Object.keys(index.bases ?? {}).filter(key => key.startsWith(parts.slice(0, BASE_SEGMENTS).join(":")));

    const matches = [];

    for (const key of bases)
    {
        for (const at of index.bases[key] ?? [])
        {
            const entry = index.entries[at];

            if (!entry || !MatchesClauses(entry, typed, partial)) continue;

            matches.push({
                ...entry,
                exact: IsExact(entry, key, base, typed),
                ...Accounting(entry, typed)
            });
        }
    }

    return matches;
}

/** Whether an entry carries every clause the query named. */
function MatchesClauses(entry, typed, partial)
{
    for (const [ name, body ] of typed)
    {
        const field = CLAUSE_FIELDS[name];

        // A clause the index does not model cannot be confirmed, so it is not
        // quietly ignored — the entry does not match.
        if (!field) return false;

        const value = entry[field];

        if (value == null) return false;

        // The clause still being typed matches by prefix; every other must be
        // whole, or `pattern?x` would match every pattern beginning with x while
        // the visitor believed they had named one.
        const incomplete = partial != null && partial.startsWith(`${name}?`) && partial.endsWith(body);

        if (incomplete ? !value.startsWith(body) : value !== body) return false;
    }

    return true;
}

/**
 * How well a record is accounted for by what was typed.
 *
 * `extra` is the clauses the record carries that the query never named, and
 * `matched` is the clauses it named that the record carries. Ranking wants both:
 * fewest unaccounted first, so a search naming no clause is answered by a plain
 * skin rather than one wearing three the visitor never mentioned; then most
 * accounted for, so among records with nothing left over, the one that explains
 * more of itself from the same typing wins.
 *
 * This is coverage — how much of the record the query explains — not a
 * preference for short DNAs. Name a clause and the records carrying it stop
 * being penalised for it, which a length rule could not do.
 */
function Accounting(entry, typed)
{
    const carried = Object.values(CLAUSE_FIELDS).filter(field => entry[field] != null);
    const named = new Set(typed.map(([ name ]) => CLAUSE_FIELDS[name]).filter(Boolean));

    return {
        extra: carried.filter(field => !named.has(field)).length,
        matched: carried.filter(field => named.has(field)).length
    };
}

/** Exact when the base is whole and the clause sets agree, order aside. */
function IsExact(entry, key, base, typed)
{
    if (key !== base) return false;

    const carried = Object.values(CLAUSE_FIELDS).filter(field => entry[field] != null);

    if (carried.length !== typed.length) return false;

    return typed.every(([ name, body ]) => entry[CLAUSE_FIELDS[name]] === body);
}

/**
 * A bare term, tested against every indexed part as a substring.
 *
 * Substring rather than whole-value, because the point of an index is that a
 * fragment finds things: `ardis` should find Ardishapur, and `gunmetal` should
 * find every skin wearing a gunmetal material. A whole-value lookup only ever
 * answers someone who already knew the answer.
 *
 * The scan is over the *distinct values* — a few thousand strings — not over the
 * entries, so it stays a few milliseconds however many skins there are. `exact`
 * marks a value matched whole, so those sort first and typing a complete name
 * does not bury it under the fragments it is contained in.
 */
function MatchBySegment(index, term)
{
    const matches = [];
    const seen = new Set();

    for (const kind of SEGMENTS)
    {
        const map = index[kind];

        if (!map) continue;

        for (const [ value, positions ] of Object.entries(map))
        {
            if (!value.includes(term)) continue;

            const exact = value === term;

            for (const at of positions)
            {
                // First map to answer wins the record, but a whole-value match
                // upgrades one already taken as a fragment: the same entry can
                // be reached by both, and the better claim should be the one
                // that survives.
                if (seen.has(at))
                {
                    if (exact) matches.find(match => match.at === at).exact = true;
                    continue;
                }
                seen.add(at);

                const entry = index.entries[at];

                // A bare term names no clause, so nothing it finds is accounted
                // for by name — every clause the record carries is unexplained.
                if (entry) matches.push({ ...entry, at, exact, ...Accounting(entry, []) });
            }
        }
    }

    return matches;
}

/**
 * Every (skin, type) pair the source declares, from one pass over each table.
 *
 * A skin reaches its types two ways — a `types` field on the skin itself, and
 * licence rows pointing at it — and both are real. They are unioned per skin so
 * a hull declared twice is still one use.
 */
function* EachSkinUse(sde)
{
    const bySkin = new Map();

    for (const license of sde.SkinLicenses())
    {
        const skinID = Id(license, "skinID", "skinId");
        const typeID = Id(license, "typeID", "typeId");

        if (skinID && typeID) Add(bySkin, skinID, typeID);
    }

    for (const skin of sde.Skins())
    {
        const skinID = Id(skin, "skinID", "skinId", "_key");

        if (!skinID) continue;

        const declared = Ids(skin, "types", "typeIDs", "typeIds", "typeID", "typeId");

        for (const typeID of declared) Add(bySkin, skinID, typeID);

        for (const typeID of bySkin.get(skinID) ?? []) yield { skinID, typeID };

        bySkin.delete(skinID);
    }
}

/**
 * Whether a type is a ship or structure a visitor could actually be looking at.
 *
 * `published` alone is not enough — an unpublished NPC entity and a published
 * blueprint both carry the hull's graphic and the hull's name — and the category
 * alone is not enough either, since retired ships keep their category. Both.
 *
 * A source without `groups` cannot be filtered, and is left unfiltered rather
 * than emptied: a missing optional table must not silently delete the index.
 */
function IsSpaceObject(sde, type)
{
    if (!type?.published) return false;

    const group = sde.GetGroup(type.groupID);

    return group?.categoryID == null || SPACE_OBJECT_CATEGORIES.has(Number(group.categoryID));
}

/** Resolves one pair, answering null rather than throwing on a broken row. */
function TryResolve(sde, skinID, typeID)
{
    try
    {
        return sde.ResolveSkinDna(skinID, typeID) || null;
    }
    catch (error)
    {
        return null;
    }
}

/** A caller's limit, or the default. Absent, unparseable and zero all default. */
function NormalizeLimit(value)
{
    const limit = Number(value);

    return Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 40;
}

function Add(map, key, value)
{
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
}

/** Plain object of sorted arrays, so the document is stable between builds. */
function Sorted(map)
{
    return Object.fromEntries([ ...map ]
        .sort(([ left ], [ right ]) => String(left).localeCompare(String(right)))
        .map(([ key, values ]) => [ key, [ ...values ].sort((left, right) => left - right) ]));
}

function Id(record, ...names)
{
    for (const name of names)
    {
        const value = record?.[name];

        if (value !== undefined && value !== null && value !== "") return Number(value);
    }

    return null;
}

function Ids(record, ...names)
{
    for (const name of names)
    {
        const value = record?.[name];

        if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
        if (value !== undefined && value !== null && value !== "") return [ Number(value) ];
    }

    return [];
}
