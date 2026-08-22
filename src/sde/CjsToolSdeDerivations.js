/**
 * Tables we compute from an SDE, rather than tables a source ships.
 *
 * An SDE arrives two ways — an acquired archive through `Import`, a generated
 * one through `ImportTables` — and a derived table is a pure function of the
 * rows either one just wrote. So the derivation belongs to the *SDE*, not to
 * the source: there is no reverse index per source, there is one derivation
 * that runs against whichever database was written last.
 *
 * That is why this is invoked from `CjsToolSdeDatabase` after the import commits,
 * which is the single point both paths traverse. A second call site — one
 * in the archive path, one in the generator — is how the two drift.
 *
 * ## Stored beside the database, not inside it
 *
 * Both importers copy their source verbatim, so a computed table written into
 * `sde_rows` would be indistinguishable from data the source shipped. These
 * are written as files next to the `.sqlite`, named with the version token of
 * the derivation that produced them, so an artifact from an older rule cannot
 * be mistaken for a current one.
 *
 * ## Adding one
 *
 * Append to `DERIVATIONS`. A derivation declares what it needs, so an SDE
 * missing an input is skipped rather than half-built — the register is the only
 * place that has to change.
 *
 * @see /docs/contracts/dna-reverse-index.md
 */
import fs from "node:fs/promises";
import path from "node:path";

import { CjsToolSde } from "./CjsToolSde.js";
import { BuildDnaIndex } from "./CjsToolSdeDnaIndex.js";
import { BuildMapIndex, MAP_INDEX_TABLES } from "../map/CjsToolMapIndex.js";

/**
 * The register.
 *
 * `version` is the token in the filename and must be bumped whenever the rule
 * changes meaning, because the inputs are otherwise immutable and nothing else
 * would invalidate the artifact.
 */
const DERIVATIONS = Object.freeze([
    Object.freeze({
        name: "dnaIndex",
        version: 2,
        requires: Object.freeze([ "types", "graphics", "skins", "skinMaterials", "skinLicenses" ]),
        Build: (sde) => BuildDnaIndex(sde)
    }),
    // Takes the raw tables rather than the `CjsToolSde` join layer, because that
    // layer is the identity tables — types, graphics, skins — and the map is
    // not identity. Widening it to carry eight thousand solar systems so one
    // derivation can reach them would put the cluster in memory for every
    // consumer that only ever wanted to resolve a hull.
    Object.freeze({
        name: "mapIndex",
        version: 1,
        requires: Object.freeze([ "mapSolarSystems", "mapStargates" ]),
        Build: (sde, tables) => BuildMapIndex(tables)
    }),
    // Cross-export, and therefore not built here. English names for a source
    // that carries none are a function of TWO sources - this one and a
    // reference - and the import path can only see the database it just wrote. It is
    // registered so that the artifact has one name, one version token and one
    // path rule like every other derivation; `bin/cjs-localisation-guess.js`
    // is what writes it, and a consumer that finds no artifact simply serves
    // no guessed names.
    // Type fields the published SDE omits: the NPC corporations that
    // manufacture a type, and the show-info quote with its attribution. Written outside this package, by whatever holds the reading
    // half - the same path rule and version token as every other derivation, so
    // a consumer that finds no artifact simply serves no extras.
    //
    // Deliberately NOT folded into the sde table route. That route answers with
    // the published row, and a reading of ours inside it would be
    // indistinguishable from something the source shipped. It is composed into
    // the types topic instead, which is where composed answers belong.
    Object.freeze({
        name: "typeExtras",
        version: 1,
        crossExport: true,
        requires: Object.freeze([ "types" ]),
        Build: null
    }),
    Object.freeze({
        name: "englishNames",
        version: 1,
        crossExport: true,
        requires: Object.freeze([ "types" ]),
        Build: null
    })
]);

/**
 * Every table any derivation may read, so the load happens once.
 *
 * `mapMoons` is here and is genuinely optional: `mapIndex` uses it to name the
 * stations that orbit moons exactly, and degrades to the parent planet without
 * it. It is the largest table in the SDE, so if this load ever becomes a
 * cost worth cutting, that is the one to drop and the fallback already exists.
 */
const INPUT_TABLES = Object.freeze([
    "types", "graphics", "skins", "skinMaterials", "skinLicenses",
    "graphicMaterialSets", "groups",
    ...MAP_INDEX_TABLES, "mapMoons"
]);

/**
 * Runs every derivation whose inputs the database carries.
 *
 * Failure here does not fail the import. The SDE is written and correct; a
 * derived table is a convenience computed from it, and losing one means a
 * consumer rebuilds it in memory, which it can already do. An import rolled
 * back because a derivation threw would lose the expensive artifact to protect
 * the cheap one.
 *
 * @param {Object} database - the CjsToolSdeDatabase that just committed an import
 * @param {Object} [options]
 * @param {Function} [options.onWarning] - called with a message per failure
 * @returns {Promise<Array>} one record per derivation written
 */
export async function RunDerivations(database, options = {})
{
    const warn = typeof options.onWarning === "function" ? options.onWarning : () => {};
    const written = [];

    let tables;
    let present;
    let identity = {};

    try
    {
        tables = await database.LoadTables(INPUT_TABLES);
        present = new Set(Object.keys(tables).filter(name => HasRows(tables[name])));
        identity = await database.GetMetadata();
    }
    catch (error)
    {
        warn(`derivations skipped: ${error?.message ?? error}`);

        return written;
    }

    for (const derivation of DERIVATIONS)
    {
        // A cross-export derivation needs a source this database is not, so
        // running it here could only ever write an empty artifact over a good
        // one.
        if (derivation.crossExport) continue;

        const missing = derivation.requires.filter(name => !present.has(name));

        if (missing.length)
        {
            warn(`${derivation.name} skipped: source has no ${missing.join(", ")}`);
            continue;
        }

        try
        {
            // Stamped with the target, because the file has left the process.
            // In memory a derived document belongs to the source that built it
            // and needs no identity; on disk two sources' artifacts are
            // otherwise distinguishable only by a build number that happens to
            // differ. Applies to every derivation, so it is stamped here rather
            // than remembered by each one.
            const document = {
                ...derivation.Build(new CjsToolSde(tables), tables),
                target: identity.target ?? null
            };
            const file = DerivationPath(database.filePath, derivation);

            await fs.writeFile(file, `${JSON.stringify(document)}\n`);
            written.push(Object.freeze({ name: derivation.name, version: derivation.version, file }));
        }
        catch (error)
        {
            warn(`${derivation.name} failed: ${error?.message ?? error}`);
        }
    }

    return Object.freeze(written);
}

/** Where one derivation's artifact sits for a given database. */
export function DerivationPath(databaseFile, derivation)
{
    return path.join(
        path.dirname(path.resolve(databaseFile)),
        `${derivation.name}_v${derivation.version}.json`,
    );
}

/**
 * Writes an artifact for a derivation this pass cannot build itself.
 *
 * The cross-export case: same path rule, same version token, same stamping, so
 * a reader cannot tell - and does not need to - which pass produced it.
 */
export async function WriteDerivation(databaseFile, name, document, identity = {})
{
    const derivation = DERIVATIONS.find(entry => entry.name === name);

    if (!derivation) throw new Error(`Unknown derivation ${name}`);

    const file = DerivationPath(databaseFile, derivation);

    await fs.writeFile(file, `${JSON.stringify({ ...document, target: identity.target ?? null })}
`);

    return { name, version: derivation.version, file };
}

/** The register, for a consumer that wants to find an artifact without one. */
export function ListDerivations()
{
    return DERIVATIONS;
}

/**
 * Reads one derivation's artifact back, or null when it is not on disk.
 *
 * `QueryDna` does not use this — it rebuilds its index in memory from tables it
 * has already loaded, because the identity tables are small and it needs them
 * anyway. `mapIndex` is the opposite case: rebuilding it would mean loading
 * `mapMoons`, the largest table in the SDE, into a serving process to name
 * a few thousand stations. Reading six megabytes of JSON that was computed once
 * at import is the cheaper and more consistent answer — consistent because a
 * consumer reading the file and a request reading the service then see the same
 * names, which a from-memory rebuild without `mapMoons` would not guarantee.
 *
 * @param {String} databaseFile
 * @param {String} name - the derivation's registered name
 * @returns {Promise<Object|null>}
 */
export async function ReadDerivation(databaseFile, name)
{
    const derivation = DERIVATIONS.find(entry => entry.name === name);

    if (!derivation) return null;

    try
    {
        const text = await fs.readFile(DerivationPath(databaseFile, derivation), "utf8");

        return JSON.parse(text);
    }
    catch
    {
        // Absent, unreadable, or written by an older rule under a different
        // version token, which is the same thing as absent. Every caller has a
        // documented answer for null; none of them is improved by an exception.
        return null;
    }
}

function HasRows(table)
{
    return Boolean(table) && Object.keys(table).length > 0;
}
