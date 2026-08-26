#!/usr/bin/env node
/**
 * Builds a target-profile SDE from one client's own files.
 *
 * NetEase publishes no static data export, so unlike CCP's there is nothing to
 * download: this is the only way one exists. It is generated per build from the
 * client, which is why the build number here always equals the resource build
 * rather than trailing it the way an acquired export does.
 *
 * Usage:
 *   node bin/cjs-sde-build.js --target serenity --out ./serenity.sqlite
 *   node bin/cjs-sde-build.js --target infinity --language en
 *
 * `--target` names the build profile. `--build` defaults to `latest`, which is
 * a request to resolve a
 * build number and nothing more: the resolved number is what labels the export,
 * because an export labelled `latest` cannot be matched to the resources it was
 * built from.
 */
import path from "node:path";
import process from "node:process";

import { CjsToolIndexCache, CjsToolIndex } from "../src/indexing/index.js";
import {
    CJS_DEFAULT_LANGUAGES,
    CJS_LOCALIZATION_FILES,
    CjsToolSdeBuild,
    CjsToolSdeBuildProfileRegistry,
    CjsToolSdeDatabase,
    CjsToolSdeLocalization,
    CjsToolSdeLocalizationTable,
    CjsToolSdeTables,
    DeriveRoleGroupIDs,
    ProjectUniverse,
} from "../src/sde/index.js";

import {
    ReadEmbeddedSchemaContainer,
    ReadSchemaBoundContainer,
    ReadStaticContainer,
} from "@carbonenginejs/runtime/resource/formats/static";

/**
 * Schema-bound containers, whose layout ships beside them as a `.schema`.
 *
 * Nothing is derived for these: the reader is handed both files and the schema
 * states the whole layout. Order matters here and nowhere else in this tool -
 * `mapSolarSystems` omits the value it inherits from its constellation, so the
 * constellations have to be decoded first.
 */
/**
 * Reads `--name value` arguments.
 *
 * @param {string[]} argv Raw arguments.
 * @returns {object} Parsed options.
 */
function ParseArguments(argv)
{
    // English first, Chinese beside it. See CjsToolSdeLocalization for why both:
    // English so every type is nameable by a consumer, Chinese because it is
    // what the client displays and what corroborates the type identity against
    // CCP's export. A comma-separated list selects others.
    const options = {
        target: null,
        build: "latest",
        language: CJS_DEFAULT_LANGUAGES.join(","),
        out: null,
        cache: null,
        timeout: 300000
    };

    for (let index = 0; index < argv.length; index += 1)
    {
        const key = argv[index].replace(/^--/u, "");

        if (Object.hasOwn(options, key)) options[key] = argv[index + 1];
    }

    if (!options.target)
    {
        throw new TypeError("Name the client target: --target serenity | --target infinity");
    }

    return options;
}

const options = ParseArguments(process.argv.slice(2));

// The resource cache is cwd-relative by default, so a tool run from anywhere
// but the cache's own directory silently re-downloads everything - the
// localisation tables alone are 40-75 MB each. Naming it explicitly is the
// difference between a warm build and a cold one.
const cacheDirectory = options.cache ?? process.env.CJS_TOOL_CACHE ?? null;
// The default request timeout is 30s, which a localisation pickle does not
// reliably finish inside: they are 8 MB stored, from a Chinese CDN, and a
// timeout here fails the whole build after the download has mostly happened.
const index = new CjsToolIndex({
    requestTimeoutMs: Number(options.timeout),
    ...(cacheDirectory ? { cache: new CjsToolIndexCache({ directory: cacheDirectory }) } : {})
});
const source = await index.OpenTarget(options.target, options.build);
const resolved = await index.ResolveTargetBuild(options.target, options.build);
const profile = new CjsToolSdeBuildProfileRegistry().Get(resolved.target);

// The resolved number, never the alias it was asked with.
const output = options.out ?? path.resolve(`${resolved.target}_${resolved.build}_sde_v1.sqlite`);

process.stdout.write(
    `${resolved.target} | provider ${resolved.provider} | build ${resolved.build} | language ${options.language}\n`
);

const tables = new CjsToolSdeTables(profile, { build: resolved.build });

// types stores nameID and descriptionID, not text; the strings live here. One
// table per language, presented to the projections as one.
const languages = options.language.split(",").map(entry => entry.trim()).filter(Boolean);
const loaded = [];

for (const language of languages)
{
    const file = CJS_LOCALIZATION_FILES[language];

    if (!file) throw new Error(`Unknown language ${language}`);

    // The export keys English under `en`; the file is named `en-us`.
    const table = CjsToolSdeLocalizationTable.fromBytes(
        (await source.Fetch(`res:/localizationfsd/localization_fsd_${file}.pickle`)).bytes
    );

    loaded.push([ language, table ]);
    process.stdout.write(`  ${`localisation ${language}`.padEnd(20)} ${table.size} labels
`);
}

const localization = new CjsToolSdeLocalization(loaded);

// Only reached for a table that cannot answer for several languages at once;
// the multi-language path ignores it. Kept as the primary rather than the raw
// option string, which is now a list.
const primaryLanguage = languages[0];


const groupedSources = profile.ListSources().filter(descriptor => descriptor.dataset);
const groupedStaticPaths = new Set(groupedSources.map(descriptor => descriptor.path));

for (const descriptor of profile.SourcesByContainer("static"))
{
    const { table, path: resPath } = descriptor;

    if (groupedStaticPaths.has(resPath)) continue;

    const fetched = await source.Fetch(resPath);
    const records = await ReadStaticContainer(fetched.bytes, resPath);
    tables.AddDecodedTable(table, profile.Project(table, records, {
        localization,
        language: primaryLanguage,
    }));

    process.stdout.write(`  ${table.padEnd(20)} ${Object.keys(records).length} rows\n`);
}

for (const [ resPath, descriptors ] of GroupSourcesByPath(groupedSources))
{
    const read = descriptors[0].container === "static"
        ? ReadStaticContainer
        : ReadEmbeddedSchemaContainer;
    const records = await read((await source.Fetch(resPath)).bytes, resPath);

    for (const descriptor of descriptors)
    {
        const { table, dataset: key } = descriptor;
        const dataset = records[key];

        if (!dataset)
        {
            process.stdout.write(`  ${table.padEnd(20)} SKIPPED - ${resPath} has no ${key}\n`);
            continue;
        }

        tables.AddDecodedTable(table, profile.Project(table, dataset, {
            localization,
            language: primaryLanguage,
        }));

        process.stdout.write(`  ${table.padEnd(20)} ${Object.keys(dataset).length} rows\n`);
    }
}

const decoded = {};
const skipped = [];

for (const descriptor of profile.SourcesByContainer("fsdbinary"))
{
    const { table, path: resPath } = descriptor;
    const reader = profile.GetReader(table);

    if (!reader) throw new Error(`SDE profile ${profile.target} has no reader for ${table}`);

    try
    {
        decoded[table] = reader.ReadJSON((await source.Fetch(resPath)).bytes);
    }
    catch (error)
    {
        // A layout is per-publisher, and two of these tables have diverged:
        // `dynamicItemAttributes` has a different layout on CCP, Serenity and
        // Infinity, and `schools` has one CCP layout and one NetEase layout.
        // A reader pinned to CCP's cannot read those, and that is a table to
        // derive rather than a fault to stop the export for - the other sixty
        // are fine and an export missing one table beats no export at all.
        if (error.code !== "CJS_FSD_SCHEMA_UNSUPPORTED") throw error;

        skipped.push([ table, error.actualSchemaID, error.expectedSchemaID ]);
    }
}

const projected = {};

// The rest are ordinary enough to be described rather than coded: one spec per
// table, run through the same projector. Each reproduces CCP's export exactly
// when run over CCP's own files, which is the check that makes the NetEase
// output trustworthy - there is nothing to compare that one against.
for (const [ table, records ] of Object.entries(decoded))
{
    projected[table] = profile.Project(table, records, {
        localization,
        language: primaryLanguage,
    });
}

for (const [ table, actual, expected ] of skipped)
{
    process.stdout.write(`  ${table.padEnd(20)} SKIPPED - this publisher's layout is ${actual}, `
        + `the reader is pinned to ${expected}\n`);
}

// One published column is computed rather than read. The client stores the
// role-to-group relation once, as a bit set on the group; the export publishes
// it on the role.
if (projected.corporationRoles && decoded.corporationRoleGroups)
{
    DeriveRoleGroupIDs(projected.corporationRoles, decoded.corporationRoleGroups);
}

// The map tables. These are read last because they need the localisation table
// above, and projected in declaration order because one of them reads another.
const universe = {};

for (const descriptor of profile.SourcesByContainer("schemabound"))
{
    const { table, path: resPath } = descriptor;
    const container = await source.Fetch(resPath);
    const schema = await source.Fetch(resPath.replace(/\.static$/u, ".schema"));

    universe[table] = await ReadSchemaBoundContainer(container.bytes, schema.bytes, resPath);
    projected[table] = profile.Project(table, universe[table], {
        localization,
        language: primaryLanguage,
        parents: { constellationID: universe.mapConstellations },
    });
}

// The celestial tables. One container holds all six, nested three deep, and it
// also supplies the solar-system columns the systems container has no room for -
// the topology flags, the star, the anchoring rules and the faction.
// Landmarks share the embedded-schema family with the celestial container.
const landmarksPath = profile.GetSource("landmarks").path;

projected.landmarks = profile.Project(
    "landmarks",
    await ReadEmbeddedSchemaContainer((await source.Fetch(landmarksPath)).bytes, landmarksPath),
    { localization, language: primaryLanguage }
);

const contentPath = profile.GetSource("mapPlanets").path;
const celestials = ProjectUniverse(
    ReadEmbeddedSchemaContainer((await source.Fetch(contentPath)).bytes, contentPath),
    { localization, language: primaryLanguage }
);

for (const [ system, columns ] of Object.entries(celestials.solarSystemColumns))
{
    const row = projected.mapSolarSystems?.[system];

    if (!row) continue;

    // Merged into alphabetical order rather than appended. The export's payload
    // interleaves the two sources, and everything else here goes to trouble to
    // match its key order - two exports differing only in key order compare as
    // different JSON.
    const merged = { ...row, ...columns };

    for (const key of Object.keys(row)) delete row[key];

    for (const key of Object.keys(merged).sort()) row[key] = merged[key];
}

for (const table of [ "mapPlanets", "mapMoons", "mapAsteroidBelts", "mapStars", "mapStargates", "mapSecondarySuns" ])
{
    projected[table] = celestials[table];
}

for (const [ table, rows ] of Object.entries(projected))
{
    tables.AddDecodedTable(table, rows);
    process.stdout.write(`  ${table.padEnd(20)} ${Object.keys(rows).length} rows\n`);
}

const database = await CjsToolSdeDatabase.create(output);

// Identity comes from the registry's resolution, never from the client name or
// the build alias that produced it.
const build = new CjsToolSdeBuild(tables, {
    target: resolved,
    client: resolved.client,
    context: { decoded, localization, language: primaryLanguage },
});

await build.WriteTo(database);
await database.Close();

process.stdout.write(`\nwritten ${output}\n`);
process.stdout.write(`cache key ${JSON.stringify(build.CachePathKey())}\n`);

function GroupSourcesByPath(sources)
{
    const result = new Map();

    for (const source of sources)
    {
        const values = result.get(source.path) ?? [];

        values.push(source);
        result.set(source.path, values);
    }

    return result;
}
