/**
 * Projects decoded FSD records into export rows from a declarative table spec.
 *
 * The first three tables each got their own projection module, and by the
 * seventh the modules were the same twenty lines with a different field list.
 * What actually differs between tables is data — which fields copy through,
 * which are identifiers, which are labels, and what the exporter renames — so
 * that is what this module takes.
 *
 * A table whose shape is genuinely peculiar still gets its own module;
 * `graphicMaterialSets` keeps one because its colour rounding is a measured
 * rule rather than a field list. This is for the ordinary majority.
 */
import { NormalizeLabelText } from "./projectTypes.js";
import { CJS_DEFAULT_LANGUAGE } from "./projectTypes.js";

/**
 * Resolves one label into the export's per-language object.
 *
 * @param {object} localization Localisation table exposing `Get(labelId)`.
 * @param {number|string|null|undefined} labelId Label identifier.
 * @param {string} language Language key.
 * @returns {object|undefined} Per-language object, or undefined when unresolved.
 */
function ProjectLabel(localization, labelId, language)
{
    if (labelId === null || labelId === undefined) return undefined;

    // A table carrying several languages answers for all of them at once.
    // Without this the export would publish whichever single language the
    // build was run with, which is how the NetEase exports ended up with
    // Chinese and no English.
    if (typeof localization.GetLanguages === "function") return localization.GetLanguages(labelId);


    const text = typeof localization.GetNormalized === "function"
        ? localization.GetNormalized(labelId)
        : NormalizeLabelText(localization.Get(labelId));

    return text === null || text === undefined ? undefined : { [language]: text };
}

/**
 * Projects one decoded value according to the spec.
 *
 * `UINT_32_IDENTIFIER` decodes to a string because an identifier is a key and
 * not a quantity; the export publishes numbers, so the conversion happens here
 * rather than in the reader, which is describing the file correctly.
 */
function ProjectValue(value, field, spec)
{
    if (spec.positions?.includes(field) && value && typeof value === "object")
    {
        return Object.fromEntries(Object.entries(value).map(([ axis, n ]) => [ axis, RoundSingle(n) ]));
    }

    if (spec.identifiers?.includes(field)) return Number(value);
    if (spec.singles?.includes(field)) return RoundSingle(value);
    if (spec.enums?.[field]) return spec.enums[field][value] ?? value;

    return value;
}

/**
 * Rounds a widened single to the six decimal places the export publishes.
 *
 * A float32 widened to a double gains digits it never had:
 * `dogmaAttributes.defaultValue` 0.7 arrives as 0.699999988079071 and the
 * export says 0.7. Thirteen of 2,866 attributes differ by exactly that at build
 * 3466501.
 *
 * Six decimal places, not the shortest decimal that round-trips as a single:
 * the shortest form is right for the thirteen small values and wrong for the
 * two large ones, where the export publishes 149599993856 - the single's exact
 * value - rather than 149600000000. Rounding satisfies both, and it is the same
 * rule `graphicMaterialSets` colours were measured to follow.
 *
 * @param {number} value Widened single.
 * @returns {number} Rounded value.
 */
function RoundSingle(value)
{
    const number = Number(value);

    return Number.isFinite(number) ? Number(number.toFixed(6)) : number;
}

/**
 * Recursively orders object keys, which is how the export publishes them.
 *
 * A `.static` container holds the export's own JSON but in the client's key
 * order. Values compare equal and the documents do not, which matters because
 * two exports are compared as JSON.
 */
function SortKeys(value)
{
    if (Array.isArray(value)) return value.map(SortKeys);

    if (!value || typeof value !== "object") return value;

    const result = {};

    for (const key of Object.keys(value).sort()) result[key] = SortKeys(value[key]);

    return result;
}

/**
 * Orders one row's fields the way the export publishes them: `_key` first, then
 * alphabetically.
 *
 * @param {object} row Projected row.
 * @returns {object} The same fields, ordered.
 */
function SortRowKeys(row)
{
    const ordered = {};

    if ("_key" in row) ordered._key = row._key;

    for (const field of Object.keys(row).sort())
    {
        if (field !== "_key") ordered[field] = row[field];
    }

    return ordered;
}

/**
 * Projects the named fields of one entry - a list item, or a map entry the
 * export flattens alongside its key.
 *
 * Fields are ordered by the spec rather than by the record, because the export's
 * entries are key-ordered and a consumer comparing two exports as JSON would
 * otherwise see every entry as different. A field absent from the entry is
 * omitted rather than published as null: `epicArcs.missions` carries
 * `failMissionID` on some missions and not others.
 *
 * An entry may nest further - a map inside a map entry, a list of objects
 * carrying labels of its own - so this recurses through the same three
 * operators the top level uses. `shipTreeGroups.preReqSkills` is two maps deep
 * and `typeBonus.types` is a map whose values are label-bearing lists.
 *
 * @param {object} entry Decoded entry.
 * @param {object} entrySpec Spec supplying `fields` and the per-field rules.
 * @param {object} [into] Object to project into, so a flattened map entry can
 *   keep its `_key` first.
 * @param {object} [context] `{ localization, language }`, needed only by an
 *   entry that resolves labels.
 * @returns {object} Projected entry.
 */
function ProjectEntry(entry, entrySpec, into = {}, context = {})
{
    for (const field of entrySpec.fields ?? [])
    {
        const value = entry[field];

        if (value === undefined || value === null) continue;

        // An identifier list nested inside an entry, which is one level deeper
        // than `identifiers` reaches. `epicArcs.missions[].nextMissions` and
        // `dynamicItemAttributes.inputOutputMapping[].applicableTypes` are both
        // this shape, and both are meaningless as strings.
        if (entrySpec.identifierLists?.includes(field))
        {
            if (!Array.isArray(value) || !value.length) continue;

            into[field] = value.map(Number);
            continue;
        }

        if (entrySpec.maps?.[field])
        {
            const entries = ProjectMap(value, entrySpec.maps[field], context);

            if (entries.length) into[field] = entries;
            continue;
        }

        if (entrySpec.lists?.[field])
        {
            if (!Array.isArray(value) || !value.length) continue;

            into[field] = ProjectList(value, entrySpec.lists[field], context);
            continue;
        }

        // The client stores 0 and 1 where the export publishes a boolean.
        // `shipTreeGroups.preReqSkills[].skills[].display` is the only one so
        // far, and it is stored as a number in a record with no other numbers
        // to confuse it with.
        if (entrySpec.booleans?.includes(field))
        {
            into[field] = Boolean(value);
            continue;
        }

        into[field] = entrySpec.identifiers?.includes(field) ? Number(value)
            : entrySpec.singles?.includes(field) ? RoundSingle(value)
                : value;
    }

    for (const [ field, published ] of Object.entries(entrySpec.labels ?? {}))
    {
        const label = ProjectLabel(context.localization, entry[field], context.language);

        if (label) into[published] = label;
    }

    return entrySpec.sorted === false ? into : SortRowKeys(into);
}

/**
 * Projects a list of decoded entries, such as `modifierInfo`.
 */
function ProjectList(entries, listSpec, context = {})
{
    // A list of bare identifiers rather than of objects, which is how
    // typeLists' six include/exclude lists are stored.
    if (!listSpec.fields && !listSpec.labels)
    {
        return entries.map(entry => listSpec.identifier ? Number(entry) : entry);
    }

    return entries.map(entry => ProjectEntry(entry, listSpec, {}, context));
}

/**
 * Projects a map field into the flat list of entries the export publishes.
 *
 * The export has three shapes for a map and the spec picks between them, because
 * nothing in the decoded record distinguishes them:
 *
 * - a plain field name means `[{ _key, _value }]`, which is what a scalar map
 *   like `npcCorporations.exchangeRates` or `stationOperations.stationTypes`
 *   publishes;
 * - `{ key, value }` names those two properties instead, for a scalar map the
 *   export gave real names - `expertSystems.skillsGranted` is published as
 *   `[{ level, typeID }]`, not as key/value pairs;
 * - `fields` spreads a record-valued map's own fields alongside `_key`, which is
 *   how `npcCorporations.divisions`, `contrabandTypes.factions`,
 *   `epicArcs.missions` and `dynamicItemAttributes.attributeIDs` are published.
 *
 * @param {object} value Decoded map.
 * @param {object|string} mapSpec Published field name, or a spec.
 * @returns {Array<object>} Entries, ordered by key.
 */
function ProjectMap(value, mapSpec, context = {})
{
    const spec = typeof mapSpec === "string" ? { as: mapSpec } : mapSpec;

    return Object.entries(value)
        .map(([ innerKey, innerValue ]) =>
        {
            const key = Number(innerKey);

            if (spec.fields || spec.labels) return ProjectEntry(innerValue, spec, { _key: key }, context);

            const keyName = spec.key ?? "_key";
            const valueName = spec.value ?? "_value";
            // A map whose values are themselves lists of records, which
            // `typeBonus.types` is: typeID to that type's list of bonuses.
            const projected = spec.valueList ? ProjectList(innerValue, spec.valueList, context)
                : spec.singles?.includes(valueName) ? RoundSingle(innerValue)
                    : spec.identifiers?.includes(valueName) ? Number(innerValue) : innerValue;

            // Named key/value entries are published in the export's own field
            // order, which is alphabetical, not key-then-value.
            return keyName < valueName
                ? { [keyName]: key, [valueName]: projected }
                : { [valueName]: projected, [keyName]: key };
        })
        .sort((left, right) => (left._key ?? left[spec.key]) - (right._key ?? right[spec.key]));
}

/**
 * Projects one colour to the channels and precision the export publishes.
 *
 * Which channels survive is a per-table fact, not a general one:
 * `graphicMaterialSets` publishes all four, `metaGroups` publishes three and
 * drops alpha entirely.
 */
function ProjectColor(color, colorSpec)
{
    if (!color || typeof color !== "object") return undefined;

    const projected = {};

    for (const channel of colorSpec.channels)
    {
        const value = Number(color[channel]);

        if (!Number.isFinite(value)) return undefined;

        projected[channel] = Number(value.toFixed(colorSpec.precision));
    }

    return projected;
}

/**
 * Removes empty arrays at every depth.
 *
 * The client writes `"skills": []` where the export says nothing, and it is the
 * only difference between the two for whole tables. `strings` extends the same
 * rule to `""`, which `industryAssemblyLines` needs and `blueprints` does not: applying this rule alone
 * takes `blueprints` from 5,071 of 5,082 rows matching to all 5,082. An empty
 * list and an absent one are the same statement, and the exporter picks the
 * shorter way of making it.
 *
 * @param {*} value Decoded value.
 * @returns {*} Value without empty arrays.
 */
function PruneEmptyArrays(value, strings = false)
{
    if (Array.isArray(value)) return value.map(entry => PruneEmptyArrays(entry, strings));

    if (!value || typeof value !== "object") return value;

    const pruned = {};

    for (const [ field, entry ] of Object.entries(value))
    {
        const projected = PruneEmptyArrays(entry, strings);

        if (Array.isArray(projected) && projected.length === 0) continue;
        if (strings && projected === "") continue;

        pruned[field] = projected;
    }

    return pruned;
}

/**
 * Rewrites keys at every depth: snake_case to camelCase, then renames, then
 * drops.
 *
 * The newer datasets name fields in snake_case and CCP's exporter camelCases
 * them, so `base_material_multiplier` is published as
 * `baseMaterialMultiplier`. The order matters: renames are written in the
 * camelCased spelling, because that is the one a reader of the spec will see in
 * the export.
 *
 * @param {*} value Decoded value.
 * @param {object} spec Table spec supplying `rename` and `drop`.
 * @returns {*} Value with its keys rewritten.
 */
function RewriteKeys(value, spec)
{
    if (Array.isArray(value)) return value.map(entry => RewriteKeys(entry, spec));

    if (!value || typeof value !== "object") return value;

    const rewritten = {};

    for (const [ field, entry ] of Object.entries(value))
    {
        // A trailing "id" segment becomes ID, not Id: the client's type_id is
        // published as typeID. The runtime FSD decoder owns the same rule for schema field
        // names; this is the .static side of it.
        const camel = field
            .split("_")
            .map((segment, index) => segment.toLowerCase() === "id"
                ? "ID"
                : index === 0 ? segment : segment.charAt(0).toUpperCase() + segment.slice(1))
            .join("");
        const named = spec.rename?.[camel] ?? camel;

        if (spec.drop?.includes(named)) continue;

        rewritten[named] = RewriteKeys(entry, spec);
    }

    return rewritten;
}

/**
 * Projects decoded records into export rows.
 *
 * @param {object} records Decoded records keyed by record identity.
 * @param {object} spec Table projection spec.
 * @param {object} [options] Projection options.
 * @param {object} [options.localization] Localisation table, required by any
 *   spec that declares labels.
 * @param {string} [options.language] Language key, defaulting to English.
 * @returns {object} Export-shaped rows keyed by record identity.
 */
export function ProjectRecords(records, spec, options = {})
{
    if (!records || typeof records !== "object")
    {
        throw new TypeError("Record projection requires decoded records.");
    }

    if (!spec || typeof spec !== "object")
    {
        throw new TypeError("Record projection requires a table spec.");
    }

    const labels = Object.entries(spec.labels ?? {});
    const localization = options.localization ?? null;

    if (labels.length && (!localization || typeof localization.Get !== "function"))
    {
        throw new TypeError(
            `Projecting ${spec.table} requires a localisation table exposing Get(labelId).`,
        );
    }

    const language = options.language ?? CJS_DEFAULT_LANGUAGE;
    const rows = {};

    for (const [ key, record ] of Object.entries(records))
    {
        const row = { _key: Number(key) };

        // A map-valued record: the export flattens the inner map to a list of
        // key/value pairs under one field name of its own choosing.
        if (spec.entriesField)
        {
            row[spec.entriesField] = Object.entries(record)
                .map(([ innerKey, value ]) => ({ _key: Number(innerKey), _value: value }))
                .sort((left, right) => left._key - right._key);
            rows[key] = row;
            continue;
        }

        // A scalar-valued map has no record to walk. The export still publishes
        // an object, under a name the exporter chose rather than one the file
        // carries, so the spec has to supply it.
        if (spec.valueField)
        {
            row[spec.valueField] = ProjectValue(record, spec.valueField, spec);
            rows[key] = row;
            continue;
        }

        // A `.static` container already holds the export's own JSON, so there
        // is nothing to project but the exporter's one editorial habit.
        if (spec.passthrough)
        {
            const rewritten = spec.camelCaseKeys ? RewriteKeys(record, spec) : record;
            const pruned = spec.pruneEmptyArrays
                ? PruneEmptyArrays(rewritten, spec.pruneEmptyStrings === true)
                : rewritten;

            Object.assign(row, spec.sortKeys ? SortKeys(pruned) : pruned);

            // A passthrough table can still carry a label identifier the export
            // resolves to text - dbuffCollections has one - so labels apply here
            // as well, and the identifier they replace is dropped.
            for (const [ field, published ] of labels)
            {
                const label = ProjectLabel(localization, row[field], language);

                delete row[field];

                if (label) row[published] = label;
            }

            rows[key] = spec.sortKeys ? SortKeys(row) : row;
            continue;
        }

        for (const field of spec.copy ?? [])
        {
            const value = record[field];

            if (value === undefined || value === null) continue;
            if (spec.omitWhenZero?.includes(field) && Number(value) === 0) continue;
            if (spec.omitWhenFalse?.includes(field) && value !== true) continue;

            // A schema-declared default is not the same statement as a value.
            // `systems.securityClass` defaults to the empty string, and the
            // export says nothing at all for those 3,297 systems.
            if (spec.omitWhenEmpty?.includes(field) && value === "") continue;

            // The client stores a value on every child; the export publishes it
            // only where the child disagrees with its parent. `wormholeClassID`
            // sits on all 8,113 systems that have one and on the constellation
            // above them, and the export publishes 692 - exactly the 692 that
            // differ. See the coverage page for the field where this rule does
            // not hold and the column is therefore not generated.
            if (spec.omitWhenInherited?.[field])
            {
                const parents = options.parents?.[spec.omitWhenInherited[field]];
                const parent = parents?.[record[spec.omitWhenInherited[field]]];

                if (parent && parent[field] === value) continue;
            }

            row[spec.rename?.[field] ?? field] = ProjectValue(value, field, spec);
        }

        // One field of a list of records, published as a bare list. The export
        // does this where the client stores an edge and the export wants only
        // the far end of it.
        for (const [ field, pluckSpec ] of Object.entries(spec.pluck ?? {}))
        {
            const entries = record[field];

            if (!Array.isArray(entries) || !entries.length) continue;

            const plucked = entries.map(entry => Number(entry[pluckSpec.field]));

            row[pluckSpec.as] = pluckSpec.sorted ? plucked.sort((a, b) => a - b) : plucked;
        }

        for (const [ field, objectSpec ] of Object.entries(spec.objects ?? {}))
        {
            const value = record[field];

            if (!value || typeof value !== "object") continue;

            row[field] = Object.fromEntries(objectSpec.fields
                .filter(name => value[name] !== undefined)
                .map(name => [ name, objectSpec.identifiers?.includes(name) ? Number(value[name]) : value[name] ]));
        }

        for (const [ field, colorSpec ] of Object.entries(spec.colors ?? {}))
        {
            const color = ProjectColor(record[field], colorSpec);

            if (color) row[spec.rename?.[field] ?? field] = color;
        }

        for (const [ field, listSpec ] of Object.entries(spec.lists ?? {}))
        {
            const entries = record[field];

            // An empty list and an absent one are the same statement, and the
            // export makes it by saying nothing.
            if (!Array.isArray(entries) || !entries.length) continue;

            row[spec.rename?.[field] ?? field] = ProjectList(entries, listSpec, { localization, language });
        }

        // A map field the export flattens to a sorted list of entries.
        // `entriesField` does this for a whole record; this does it for one
        // field of an ordinary one. See ProjectMap for the three shapes.
        for (const [ field, mapSpec ] of Object.entries(spec.maps ?? {}))
        {
            const value = record[field];

            if (!value || typeof value !== "object") continue;

            const entries = ProjectMap(value, mapSpec, { localization, language });

            // An empty map and an absent one are the same statement, as they are
            // for a list.
            if (!entries.length) continue;

            row[typeof mapSpec === "string" ? mapSpec : mapSpec.as ?? field] = entries;
        }

        for (const [ field, published ] of labels)
        {
            const label = ProjectLabel(localization, record[field], language);

            if (label) row[published] = label;
        }

        // The export orders a row's fields alphabetically; this builds it in
        // operator order, which put every resolved label last. Values compared
        // equal and the documents did not, on every table with a label - which
        // is most of them - and two exports are compared as JSON. `_key` leads
        // because underscore sorts after the letters and the export puts it
        // first regardless.
        rows[key] = SortRowKeys(row);
    }

    return rows;
}

export default ProjectRecords;
