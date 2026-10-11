// carbon-class lineage and overload checks: what a Carbon declaration says a
// JavaScript class must extend, inherit, map and chain to, and how Carbon's
// overload sets map onto `Name__Discriminator` methods.
//
// Sources of the rules:
// - extends / inherit: operator ruling 2026-10-11 - `extends` is the base that
//   CARRIES STATE (Carbon's concrete base, even when Carbon lists interfaces
//   first, `AudEmitter : IBlueEventListener, ..., AudGameObjResource`,
//   AudEmitter.h:23), every other base comes through `@meta.blue.inherit`, and
//   only what is an IRoot in Carbon becomes one.
// - interface / chainTo: Carbon's `_Blue.cpp` table - `MAP_INTERFACE` lines
//   and `EXPOSURE_END()` / `EXPOSURE_CHAINTO( P )` (BlueExposureMacros.h:129-175).
//   Every exposed class carries its own table: one that inherits IRoot's would
//   answer QueryInterface as IRoot.
// - overloads: docs/agent-rules.md rule 9 (`CarbonName__Discriminator`, the
//   bare name kept by one overload or used as a router, type-tagged funnels).
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Schema documents by class name
// ---------------------------------------------------------------------------

/**
 * Builds a lookup from Carbon class name to its schema document across the
 * whole schema tree, reading documents lazily.
 * @param {string|null} schemaRoot Schema tree root holding `index.json`.
 * @returns {(name: string) => object|null} Resolver; null for an unscanned name.
 */
export function createSchemaDocResolver(schemaRoot)
{
    const paths = new Map();
    const cache = new Map();
    const rootIndex = schemaRoot ? path.join(schemaRoot, "index.json") : null;
    if (rootIndex && fs.existsSync(rootIndex))
    {
        for (const family of JSON.parse(fs.readFileSync(rootIndex, "utf8")).families || [])
        {
            const familyIndex = path.join(schemaRoot, family.index);
            if (!fs.existsSync(familyIndex)) continue;
            for (const item of JSON.parse(fs.readFileSync(familyIndex, "utf8")).classes || [])
            {
                const file = path.join(schemaRoot, family.name, item.jsonFile);
                for (const name of [ item.cppClass, item.blueClass ])
                {
                    // First family wins; a name scanned in two families is the same declaration twice.
                    if (name && !paths.has(name)) paths.set(name, file);
                }
            }
        }
    }
    return name =>
    {
        if (!paths.has(name)) return null;
        if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(paths.get(name), "utf8")));
        return cache.get(name);
    };
}

/** Last `::` segment, without template arguments. */
function baseName(name)
{
    return String(name || "").replace(/<[\s\S]*$/, "").trim().split("::").pop().trim();
}

const docBases = doc => (Array.isArray(doc?.bases) ? doc.bases : []).map(baseName).filter(Boolean);

/** Whether a scanned class holds state of its own or through any base. */
function carriesState(doc, resolveDoc, seen)
{
    const name = doc.cppClass || doc.blueClass;
    if (seen.has(name)) return false;
    seen.add(name);
    if (doc.declarationKind === "interface") return false;
    const fields = (Array.isArray(doc.fields) ? doc.fields : []).filter(field => !field.static);
    if (fields.length || (doc.attributes || []).length || (doc.black?.fields || []).length) return true;
    return docBases(doc).some(base =>
    {
        const baseDoc = resolveDoc(base);
        return baseDoc ? carriesState(baseDoc, resolveDoc, seen) : false;
    });
}

/**
 * Classifies one Carbon base.
 * - `IRoot`: Blue's root interface.
 * - `interface`: `BLUE_INTERFACE`, or a plain class with no state (pure or
 *   behaviour-only; `@meta.blue.inherit` carries its methods completely).
 * - `state`: a class with fields of its own or through its bases.
 * An unscanned base is judged by name (`I` + capital = interface) and marked
 * `known: false`.
 * @param {string} name Base name.
 * @param {Function} resolveDoc Schema document resolver.
 * @returns {{name: string, kind: string, known: boolean}} Classification.
 */
export function classifyCarbonBase(name, resolveDoc)
{
    if (name === "IRoot") return { name, kind: "IRoot", known: true };
    const doc = resolveDoc(name);
    if (!doc) return { name, kind: /^I[A-Z]/.test(name) ? "interface" : "state", known: false };
    return { name, kind: carriesState(doc, resolveDoc, new Set()) ? "state" : "interface", known: true };
}

/** Every Carbon base reachable from a class, by name. */
export function carbonBaseClosure(name, resolveDoc, out = new Set())
{
    for (const base of docBases(resolveDoc(name)))
    {
        if (out.has(base)) continue;
        out.add(base);
        carbonBaseClosure(base, resolveDoc, out);
    }
    return out;
}

const blueName = item => baseName(typeof item === "string" ? item : item?.name);

/**
 * What Carbon says the JavaScript class must declare.
 * @param {object} doc Class schema document.
 * @param {{resolveDoc?: Function}} [options] Resolver for base documents.
 * @returns {object} `{ className, bases, extends, inherit, exposed, interfaces,
 *   chainTo, chainKnown, isIRoot, notes, declaration, exposure }`.
 */
export function deriveCarbonLineage(doc, options = {})
{
    const resolveDoc = options.resolveDoc || (() => null);
    const className = doc.cppClass || doc.blueClass || null;
    const bases = docBases(doc).map(base => classifyCarbonBase(base, resolveDoc));
    const stateful = bases.filter(base => base.kind === "state");
    const notes = [];

    const extendsBase = stateful[0]?.name ?? bases[0]?.name ?? null;
    const reached = new Set(extendsBase && extendsBase !== "IRoot" ? carbonBaseClosure(extendsBase, resolveDoc) : []);
    if (extendsBase) reached.add(extendsBase);
    const inherit = [];
    for (const base of bases)
    {
        if (base.name === extendsBase || reached.has(base.name) || inherit.includes(base.name)) continue;
        inherit.push(base.name);
        for (const reachedBase of carbonBaseClosure(base.name, resolveDoc)) reached.add(reachedBase);
    }
    if (stateful.length > 1)
    {
        notes.push(`Carbon has ${stateful.length} bases that carry state (${stateful.map(base => base.name).join(", ")}); `
            + `extends takes ${stateful[0].name}, and inherit installs the others' methods but not their fields: linearise by hand.`);
    }
    for (const base of bases.filter(item => !item.known && item.kind === "state"))
    {
        notes.push(`${base.name} is not in the scanned schema; judged ${base.kind} by its name.`);
    }

    const exposures = Array.isArray(doc.blue?.exposures) ? doc.blue.exposures : [];
    const exposed = exposures.length > 0;
    const interfaces = [];
    const interfaceSites = {};
    for (const item of doc.blue?.interfaces || [])
    {
        const name = blueName(item);
        if (!name || name === className || interfaces.includes(name)) continue;
        interfaces.push(name);
        if (item?.source) interfaceSites[name] = { source: item.source, line: item.line };
    }
    const chainKnown = Boolean(doc.blue && Object.hasOwn(doc.blue, "chainTo"));
    const chainTo = chainKnown && doc.blue.chainTo ? blueName(doc.blue.chainTo) : null;
    const chainSite = doc.blue?.chainTo?.source ? { source: doc.blue.chainTo.source, line: doc.blue.chainTo.line } : null;
    const isIRoot = extendsBase === "IRoot" || reached.has("IRoot") || bases.some(base => base.name === "IRoot");

    return {
        className,
        bases,
        extends: extendsBase,
        inherit,
        exposed,
        interfaces,
        interfaceSites,
        chainTo,
        chainSite,
        chainKnown,
        isIRoot,
        notes,
        declaration: Array.isArray(doc.declarations) && doc.declarations.length ? doc.declarations[0] : null,
        exposure: exposures[0] ? { source: exposures[0].source, line: exposures[0].line } : null
    };
}

// ---------------------------------------------------------------------------
// Class-level decorators in a JavaScript source file
// ---------------------------------------------------------------------------

const identifierList = text => String(text || "").split(",").map(item => item.trim()).filter(item => /^[A-Za-z_$][\w$]*$/.test(item));

/**
 * Reads `@meta.blue.inherit`, `@meta.blue.interface` and `@meta.blue.chainTo`
 * for the exported class, in decorator form above it and in the imperative
 * form `meta.blue.interface(...)(Class)` used by files that must stay plain
 * JavaScript.
 * @param {string} src Comment-stripped source.
 * @param {string} jsClassName The class identifier.
 * @param {number} classIndex Offset of the `export class` declaration.
 * @returns {{inherit: string[], interfaces: string[]|null, chainTo: string|null}}
 *   `interfaces` is null when the class declares no own table.
 */
export function parseClassLineage(src, jsClassName, classIndex)
{
    const result = { inherit: [], interfaces: null, chainTo: null };
    // Decorators sit between the previous statement and the declaration.
    const head = src.slice(0, classIndex);
    const start = Math.max(head.lastIndexOf(";"), head.lastIndexOf("}")) + 1;
    const decorators = head.slice(start);
    const take = (kind, args) =>
    {
        if (kind === "inherit") result.inherit.push(...identifierList(args));
        else if (kind === "interface") (result.interfaces ??= []).push(...identifierList(args));
        else if (kind === "chainTo") result.chainTo = identifierList(args)[0] ?? null;
    };
    for (const match of decorators.matchAll(/@meta\.blue\.(inherit|interface|chainTo)\s*\(([^)]*)\)/g)) take(match[1], match[2]);
    const name = jsClassName.replace(/[$]/g, "\\$");
    const imperative = new RegExp(`\\bmeta\\.blue\\.(inherit|interface|chainTo)\\s*\\(([^)]*)\\)\\s*\\(\\s*${name}\\s*\\)`, "g");
    for (const match of src.slice(classIndex).matchAll(imperative)) take(match[1], match[2]);
    return result;
}

// ---------------------------------------------------------------------------
// The JavaScript chain of a class, read statically from its imports
// ---------------------------------------------------------------------------

function nearestPackage(file)
{
    for (let dir = path.dirname(file); ; dir = path.dirname(dir))
    {
        const candidate = path.join(dir, "package.json");
        if (fs.existsSync(candidate)) return { dir, manifest: JSON.parse(fs.readFileSync(candidate, "utf8")) };
        if (path.dirname(dir) === dir) return null;
    }
}

/** Resolves a relative or `#` package-import specifier to a file. */
function resolveSpecifier(specifier, fromFile)
{
    if (specifier.startsWith("."))
    {
        const target = path.resolve(path.dirname(fromFile), specifier);
        return fs.existsSync(target) ? target : null;
    }
    if (!specifier.startsWith("#")) return null;
    const pkg = nearestPackage(fromFile);
    const imports = pkg?.manifest.imports || {};
    if (typeof imports[specifier] === "string") return path.resolve(pkg.dir, imports[specifier]);
    for (const [ pattern, target ] of Object.entries(imports))
    {
        if (!pattern.endsWith("/*") || typeof target !== "string") continue;
        const prefix = pattern.slice(0, -1);
        if (specifier.startsWith(prefix)) return path.resolve(pkg.dir, target.replace("*", specifier.slice(prefix.length)));
    }
    return null;
}

const stripJsComments = text => String(text).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

/** Finds the file that declares `name`, following imports and re-exports from `file`. */
function findDeclaringFile(name, file, seen = new Set())
{
    if (!file || seen.has(file) || seen.size > 200 || !fs.existsSync(file)) return null;
    seen.add(file);
    const src = stripJsComments(fs.readFileSync(file, "utf8"));
    if (new RegExp(`\\bclass\\s+${name}\\b`).test(src)) return file;
    for (const match of src.matchAll(/\b(?:import|export)\s*(\{[^}]*\}|\*)\s*from\s*["']([^"']+)["']/g))
    {
        const names = match[1] === "*" ? null : match[1].slice(1, -1).split(",").map(part => part.trim().split(/\s+as\s+/));
        const entry = names?.find(([ original, alias ]) => (alias || original) === name);
        if (names && !entry) continue;
        const next = resolveSpecifier(match[2], file);
        const found = findDeclaringFile(entry ? entry[0] : name, next, seen);
        if (found) return found;
    }
    return null;
}

/**
 * The class's JavaScript ancestors with their declared bases, read from source.
 * Stops at a base it cannot resolve.
 * @param {string} filePath The checked class file.
 * @param {string|null} base Its `extends` identifier.
 * @returns {Array<{name: string, inherit: string[], file: string}>} Nearest first.
 */
export function resolveJsChain(filePath, base)
{
    const chain = [];
    let file = filePath, name = base;
    while (name && chain.length < 32)
    {
        const declaring = findDeclaringFile(name, file);
        if (!declaring) { chain.push({ name, inherit: [], file: null }); break; }
        const src = stripJsComments(fs.readFileSync(declaring, "utf8"));
        const match = new RegExp(`class\\s+${name}\\b(?:\\s+extends\\s+([A-Za-z_$][\\w$]*))?`).exec(src);
        const lineage = parseClassLineage(src, name, match ? match.index : src.length);
        chain.push({ name, inherit: lineage.inherit, file: declaring });
        file = declaring;
        name = match?.[1] ?? null;
    }
    return chain;
}

// ---------------------------------------------------------------------------
// Lineage comparison
// ---------------------------------------------------------------------------

const where = site => site ? `${site.source}:${site.line}` : "Carbon";

/**
 * Compares a parsed class with its Carbon lineage. Kinds follow the
 * 2026-10-11 IRoot audit: extends-differs, no-extends, extends-no-carbon-base,
 * missing-inherit, extra-inherit, indirect-inherit, no-own-table,
 * missing-mapped, extra-mapped, table-not-exposed, chain-missing,
 * chain-differs, chain-extra.
 * @param {object} lineage From deriveCarbonLineage.
 * @param {{base: string|null, lineage: object}} parsed From parseClassFile.
 * @param {object} [options] `reportOnly` (maintained file: warnings, not drift),
 *   `jsChain` (from resolveJsChain), `resolveDoc`, `aliases` (JS name -> Carbon name).
 * @returns {object[]} Results with verdict "lineage".
 */
export function compareLineage(lineage, parsed, options = {})
{
    const resolveDoc = options.resolveDoc || (() => null);
    const carbonName = name => options.aliases?.[name] ?? name;
    const severity = options.reportOnly ? "warning" : "error";
    const results = [];
    const push = (kind, name, note, expected, actual, site) => results.push({
        name, verdict: "lineage", kind, severity, symbol: severity === "error" ? "cross" : "warn",
        notes: [ `${note} (${where(site)})` ], expected, actual
    });

    const declared = parsed.lineage || { inherit: [], interfaces: null, chainTo: null };
    const jsBase = parsed.base ? carbonName(parsed.base) : null;
    const baseNames = lineage.bases.map(base => base.name);
    const stateful = lineage.bases.filter(base => base.kind === "state").map(base => base.name);
    const decl = lineage.declaration;

    // extends: the state-carrying base; any other stateful Carbon base counts as
    // a deliberate linearisation of Carbon's multiple concrete bases.
    if (!jsBase && lineage.extends)
        push("no-extends", "<extends>", `Carbon's base ${lineage.extends} carries the class; the JS class extends nothing`, { extends: lineage.extends }, { extends: null }, decl);
    else if (jsBase && !lineage.extends)
        push("extends-no-carbon-base", "<extends>", `Carbon declares no base; the JS class extends ${parsed.base}`, { extends: null }, { extends: parsed.base }, decl);
    else if (jsBase && jsBase !== lineage.extends && !stateful.includes(jsBase))
    {
        const why = baseNames.includes(jsBase) ? `${jsBase} is an interface base while ${lineage.extends} carries state` : `${jsBase} is not a Carbon base`;
        push("extends-differs", "<extends>", `extends ${parsed.base}, Carbon's state-carrying base is ${lineage.extends}: ${why}`, { extends: lineage.extends, bases: baseNames }, { extends: parsed.base }, decl);
    }

    // inherit: every remaining Carbon base is reached through the JS chain or declared.
    const chain = options.jsChain || [];
    const reachable = new Set([ jsBase, ...declared.inherit.map(carbonName) ]);
    for (const link of chain)
    {
        reachable.add(carbonName(link.name));
        for (const name of link.inherit) reachable.add(carbonName(name));
    }
    for (const name of [ ...reachable ]) if (name) for (const base of carbonBaseClosure(name, resolveDoc)) reachable.add(base);
    const chainEnded = chain.length === 0 || chain[chain.length - 1].file !== null;
    for (const name of lineage.inherit)
    {
        if (reachable.has(name)) continue;
        if (!chainEnded) continue; // an unresolved ancestor may supply it
        push("missing-inherit", `<inherit:${name}>`, `Carbon base ${name} is neither inherited nor reached through the JS chain`, { inherit: name }, null, decl);
    }
    const closure = new Set();
    for (const base of baseNames) { closure.add(base); for (const reached of carbonBaseClosure(base, resolveDoc)) closure.add(reached); }
    for (const raw of declared.inherit)
    {
        const name = carbonName(raw);
        if (baseNames.includes(name)) continue;
        if (closure.has(name)) push("indirect-inherit", `<inherit:${raw}>`, `inherits ${raw}, which Carbon reaches only through another base`, null, { inherit: raw }, decl);
        else push("extra-inherit", `<inherit:${raw}>`, `inherits ${raw}, which is not among Carbon's bases`, null, { inherit: raw }, decl);
    }

    // interface table
    const site = lineage.exposure || decl;
    if (lineage.exposed && declared.interfaces === null)
        push("no-own-table", "<interface>", `Carbon exposes the class; declare its own @meta.blue.interface(${lineage.interfaces.join(", ")})`, { interfaces: lineage.interfaces }, { interfaces: null }, site);
    else if (!lineage.exposed && declared.interfaces !== null)
        push("table-not-exposed", "<interface>", "the JS class declares an exposure table; Carbon does not expose it", { interfaces: null }, { interfaces: declared.interfaces }, site);
    else if (lineage.exposed)
    {
        const mapped = declared.interfaces.map(carbonName);
        for (const name of lineage.interfaces)
            if (!mapped.includes(name)) push("missing-mapped", `<interface:${name}>`, `Carbon maps ${name}`, { interface: name }, null, lineage.interfaceSites?.[name] || site);
        for (const name of mapped)
            if (!lineage.interfaces.includes(name)) push("extra-mapped", `<interface:${name}>`, `maps ${name}, which Carbon does not`, null, { interface: name }, site);
    }

    // chain
    if (lineage.exposed && lineage.chainKnown)
    {
        const jsChain = declared.chainTo ? carbonName(declared.chainTo) : null;
        if (lineage.chainTo && !jsChain) push("chain-missing", "<chainTo>", `Carbon chains to ${lineage.chainTo} (EXPOSURE_CHAINTO)`, { chainTo: lineage.chainTo }, { chainTo: null }, lineage.chainSite || site);
        else if (!lineage.chainTo && jsChain) push("chain-extra", "<chainTo>", `chains to ${declared.chainTo}; Carbon ends the table with EXPOSURE_END`, { chainTo: null }, { chainTo: declared.chainTo }, site);
        else if (lineage.chainTo && jsChain !== lineage.chainTo) push("chain-differs", "<chainTo>", `chains to ${declared.chainTo}; Carbon chains to ${lineage.chainTo}`, { chainTo: lineage.chainTo }, { chainTo: declared.chainTo }, site);
    }
    return results;
}

// ---------------------------------------------------------------------------
// Overloads (agent-rules rule 9)
// ---------------------------------------------------------------------------

const typeKey = type => String(type || "").replace(/\bconst\b/g, "").replace(/[&*\s]/g, "");

// Parameter types a JavaScript value carries without a wrapper: numbers, booleans,
// strings and Carbon's string types. `uint32_t` is NOT native - JS cannot tell it
// from a float (agent-rules 9), so an integer overload never keeps the bare name.
const NATIVE_TYPE = /^(float|double|bool|char|wchar_t|BlueSharedString|BlueString|std::string|std::wstring|BeString|BeWString)$/;

/** A parameter type as JavaScript sees it: every string type is one, float and double are one. */
function jsTypeKey(type)
{
    const key = typeKey(type);
    if (/^(char|wchar_t|BlueSharedString|BlueString|std::string|std::wstring|BeString|BeWString|std::string_view)$/.test(key)) return "string";
    if (key === "float" || key === "double") return "number";
    return key;
}

/**
 * Carbon's overload sets for a class: own native declarations sharing a name
 * with different parameter types. A const / non-const pair is one entry, and a
 * default argument is not an overload (rule 9, "Not overloads").
 * @param {object} doc Class schema document.
 * @returns {Map<string, object[]>} Name -> overload declarations (two or more).
 */
export function deriveOverloadSets(doc)
{
    const className = doc.cppClass || doc.blueClass;
    const byName = new Map();
    for (const method of doc.nativeMethods || [])
    {
        if (method.declaredOn && method.declaredOn !== className) continue;
        const name = method.cppName || method.target;
        if (!name || name.startsWith("~") || name === className || name.startsWith("operator")) continue;
        // A call inside an inline body read as a declaration (`Update( &v, time );`,
        // `this->RegisterChild( child );`) has no parameter types or no return type.
        if ((method.parameters || []).some(parameter => !parameter.type || !parameter.name || /^[&*]/.test(parameter.type))) continue;
        if (method.returnType !== undefined && (!method.returnType || /->|\breturn\b/.test(method.returnType))) continue;
        // A template forwarder (`template<class T> bool HasOption( T* owner, ... )`,
        // Tr2DebugRenderer.h:28) has no JavaScript form of its own.
        if ((method.parameters || []).some(parameter => /^[A-Z]$/.test(typeKey(parameter.type)))) continue;
        // JavaScript has one string type and one number type for floating point: overloads
        // that differ only there (`SetName( const char* )` / `SetName( const BlueSharedString& )`,
        // EveLocator2.h:22-26) are one JS method. Integers stay distinct (agent-rules 9).
        const key = (method.parameters || []).map(parameter => jsTypeKey(parameter.type)).join(",");
        if (!byName.has(name)) byName.set(name, new Map());
        if (!byName.get(name).has(key)) byName.get(name).set(key, method);
    }
    const sets = new Map();
    for (const [ name, signatures ] of byName) if (signatures.size > 1) sets.set(name, [ ...signatures.values() ]);
    return sets;
}

const words = text => String(text || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1);

const signature = method => `${method.cppName || method.target}(${(method.parameters || []).map(parameter => parameter.type).join(", ")})`;

// Discriminator words that name a C++ type by meaning (agent-rules 9: `GetValueAt__Ticks` for `Be::Time`).
const DISCRIMINATOR_TYPE_WORDS = { ticks: [ "time" ] };

/** How well a discriminator names an overload: its words found in the parameter types and names. */
function discriminatorScore(discriminator, overload, siblings)
{
    const tokens = words(discriminator);
    if (!tokens.length) return 0;
    const own = new Set((overload.parameters || []).flatMap(parameter => [ ...words(typeKey(parameter.type)), ...words(parameter.name) ]));
    // Words every overload shares say nothing about which one this is.
    const shared = new Set([ ...own ].filter(word => siblings.every(other => (other.parameters || []).some(parameter =>
        words(typeKey(parameter.type)).includes(word) || words(parameter.name).includes(word)))));
    let score = 0;
    for (const token of tokens) if (own.has(token) && !shared.has(token)) score++;
    // A discriminator that names a type by meaning matches parameter TYPES only:
    // every `Update` overload has a parameter NAMED `time`, only one is `Be::Time`.
    const typed = other => alias => (other.parameters || []).some(parameter => words(typeKey(parameter.type)).includes(alias));
    for (const token of tokens)
        for (const alias of DISCRIMINATOR_TYPE_WORDS[token] || [])
            if (typed(overload)(alias) && !siblings.every(other => typed(other)(alias))) score += 2;
    // The whole discriminator inside one parameter type: `UInt32` names `uint32_t`, `GpuBuffer` names `ITr2GpuBuffer*`.
    const whole = String(discriminator).toLowerCase();
    if ((overload.parameters || []).some(parameter => typeKey(parameter.type).toLowerCase().replace(/_t$/, "").endsWith(whole))
        && !siblings.every(other => other === overload || (other.parameters || []).some(parameter => typeKey(parameter.type).toLowerCase().replace(/_t$/, "").endsWith(whole)))) score += 3;
    // Appended parameters are named by the extra parameter: an exact name hit on the last parameter wins.
    const last = (overload.parameters || []).at(-1);
    if (last && words(last.name).join("") === words(discriminator).join("")) score += 2;
    return score;
}

/** The overloads whose parameter names are exactly the JS method's: ports keep Carbon's names. */
function sameParameterNames(method, overloads)
{
    const names = (method.parameters || []).map(name => name.replace(/^\.\.\./, "").toLowerCase());
    if (!names.length) return [];
    return overloads.filter(overload => (overload.parameters || []).length === names.length
        && overload.parameters.every((parameter, index) => String(parameter.name || "").toLowerCase() === names[index]));
}

/**
 * Checks each Carbon overload set against the class's methods: every overload
 * covered exactly once, by a `Name__Discriminator` method or by the bare name;
 * a bare name marked `@meta.adapted` or `@meta.notSupported` while every
 * overload has its own method is the router of rule 9; a JS method named after
 * a Carbon `<Name>Internal` funnel covers the set.
 * @param {Map<string, object[]>} sets From deriveOverloadSets.
 * @param {object[]} methods Parsed JS methods (name, parameters, implStatusNames).
 * @param {object} [options] `reportOnly`, `nativeNames` (every Carbon method name of the class).
 * @returns {{results: object[], credited: Set<string>}} Results with verdict
 *   "overload", and the JS method names the check accounted for.
 */
export function compareOverloads(sets, methods, options = {})
{
    const severity = options.reportOnly ? "warning" : "error";
    const results = [];
    const credited = new Set();
    const push = (kind, name, note, expected, actual) => results.push({
        name, verdict: "overload", kind, severity, symbol: severity === "error" ? "cross" : "warn", notes: [ note ], expected, actual
    });
    const nativeNames = new Set(options.nativeNames || []);
    const byName = new Map(methods.map(method => [ method.name.replace(/^_/, ""), method ]));

    for (const [ name, overloads ] of sets)
    {
        const variants = methods.filter(method => method.name.replace(/^_/, "").startsWith(`${name}__`));
        const bare = byName.get(name) || null;
        // Rule 9's type-tagged funnel: the overloads only compute a tag and call
        // `<Name>Internal`, which JS exposes instead (Tr2VariableStore.h:70-80).
        const funnel = nativeNames.has(`${name}Internal`) ? byName.get(`${name}Internal`) || null : null;
        if (funnel) credited.add(funnel.name);
        if (!variants.length && !bare && !funnel) continue; // not ported at all; method coverage reports that
        const covered = new Map(); // overload -> methods
        for (const variant of variants)
        {
            credited.add(variant.name);
            const discriminator = variant.name.replace(/^_/, "").slice(name.length + 2);
            // One weighted score: the discriminator's words and types, plus +3 when the JS
            // parameter names are exactly Carbon's (ports keep them, but not always:
            // Tr2Effect's Tr2BufferAL overload calls its parameter `value`, Tr2Effect.h:102).
            const named = new Set(sameParameterNames(variant, overloads));
            const scored = overloads.map(overload => ({ overload, score: discriminatorScore(discriminator, overload, overloads) + (named.has(overload) ? 3 : 0) }))
                .filter(item => item.score > 0);
            const count = variant.parameters?.length;
            const best = Math.max(0, ...scored.map(item => item.score));
            let candidates = scored.filter(item => item.score === best).map(item => item.overload);
            if (candidates.length > 1 && count !== undefined) candidates = candidates.filter(overload => (overload.parameters || []).length === count);
            if (!candidates.length && count !== undefined)
            {
                const free = overloads.filter(overload => !covered.has(overload) && (overload.parameters || []).length === count);
                if (free.length === 1) candidates = free;
            }
            if (candidates.length !== 1)
            {
                push("overload-unmatched", variant.name, candidates.length
                    ? `${variant.name} matches ${candidates.length} Carbon overloads equally: ${candidates.map(signature).join("; ")}`
                    : `${variant.name} names no Carbon overload of ${name}: ${overloads.map(signature).join("; ")}`,
                { overloads: overloads.map(signature) }, { method: variant.name });
                continue;
            }
            if (!covered.has(candidates[0])) covered.set(candidates[0], []);
            covered.get(candidates[0]).push(variant.name);
        }
        const uncovered = overloads.filter(overload => !covered.has(overload));
        if (bare)
        {
            credited.add(bare.name);
            // When variants cover every overload, the bare name is rule 9's router
            // (marked adapted or notSupported) and keeps none. Otherwise it keeps one;
            // its status says nothing either way (an argument-order adaptation is adapted too).
            if (uncovered.length === 1) covered.set(uncovered.shift(), [ bare.name ]);
            else if (uncovered.length)
            {
                // Rule 9: the bare name keeps "the overload JavaScript represents
                // natively, or the shorter one". Arity first, then native types, then length.
                const count = bare.parameters?.length;
                let fit = uncovered.filter(overload => (overload.parameters || []).length === count);
                if (fit.length !== 1)
                {
                    // Judge only the parameters that tell the overloads apart (a shared
                    // `Vector3*` out-parameter is not what makes one of them native).
                    const pool = fit.length ? fit : uncovered;
                    const differs = index => new Set(pool.map(overload => typeKey(overload.parameters?.[index]?.type))).size > 1;
                    fit = pool.filter(overload => (overload.parameters || []).every((parameter, index) => !differs(index) || NATIVE_TYPE.test(typeKey(parameter.type))));
                }
                if (fit.length > 1)
                {
                    const shortest = Math.min(...fit.map(overload => (overload.parameters || []).length));
                    fit = fit.filter(overload => (overload.parameters || []).length === shortest);
                }
                if (fit.length === 1) { covered.set(fit[0], [ bare.name ]); uncovered.splice(uncovered.indexOf(fit[0]), 1); }
            }
        }
        if (funnel) uncovered.length = 0;
        for (const overload of uncovered)
            push("overload-uncovered", `${name}(${(overload.parameters || []).map(parameter => typeKey(parameter.type)).join(",")})`,
                `Carbon overload ${signature(overload)} has no ${name}__Discriminator method and the bare name does not keep it`,
                { overload: signature(overload) }, null);
        for (const [ overload, names ] of covered)
            if (names.length > 1) push("overload-duplicate", names.join("|"), `${names.join(" and ")} both cover ${signature(overload)}`, { overload: signature(overload) }, { methods: names });
    }
    return { results, credited };
}
