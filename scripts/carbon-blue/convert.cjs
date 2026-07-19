#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCRIPT_DIR = __dirname;
const DEFAULT_CONFIG = path.join(SCRIPT_DIR, "config", "default.json");
const DEFAULT_CLASS_REPORT = path.join(SCRIPT_DIR, "reports", "classes-latest.json");
const GENERATED_CLASS_MARKER = "Generated Carbon/Blue class stub";

const Arg = Object.freeze({
    Config: "--config",
    CarbonRoot: "--carbon-root",
    Family: "--family",
    Report: "--report",
    MarkdownReport: "--markdown-report",
    Out: "--out",
    SchemaOut: "--schema-out",
    ClassOut: "--class-out",
    ClassReport: "--class-report",
    EmitSchema: "--emit-schema",
    EmitClasses: "--emit-classes",
    EmitStubs: "--emit-stubs",
    FailOnStall: "--fail-on-stall",
    Help: "--help",
    HelpShort: "-h"
});

const ExitCode = Object.freeze({
    Ok: 0,
    Stalls: 2
});

const BLUE_CALLS = [
    "BLUE_DEFINE",
    "BLUE_DEFINE_ABSTRACT",
    "BLUE_DEFINE_NONEXPOSED",
    "BLUE_DEFINE_NO_REGISTER",
    "BLUE_DEFINE_INTERFACE",
    "EXPOSURE_BEGIN",
    "EXPOSURE_CHAINTO",
    "MAP_INTERFACE",
    "MAP_ATTRIBUTE",
    "MAP_ATTRIBUTE_WITH_IID",
    "MAP_ATTRIBUTE_WITH_CHOOSER",
    "MAP_ATTRIBUTE_AS_CUSTOM_BINARY_BLOCK",
    "MAP_PROPERTY",
    "MAP_PROPERTY_READONLY",
    "MAP_PROPERTY_PERSISTED",
    "MAP_METHOD",
    "MAP_METHOD_AND_WRAP",
    "MAP_METHOD_AND_WRAP_OPTIONAL_ARGS",
    "MAP_METHOD_WITH_KEYWORD_ARGUMENTS"
];

const DEFAULT_BLACK_TYPE_OVERRIDES = Object.freeze([
    {
        cppType: "Tr2Lod",
        beType: "LONG",
        wireType: "enum",
        signed: true
    }
]);

let blackTypeOverrides = DEFAULT_BLACK_TYPE_OVERRIDES;

const JS_RESERVED = new Set([
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "export",
    "extends",
    "finally",
    "for",
    "function",
    "if",
    "import",
    "in",
    "instanceof",
    "new",
    "return",
    "super",
    "switch",
    "this",
    "throw",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "enum",
    "await",
    "implements",
    "interface",
    "package",
    "private",
    "protected",
    "public",
    "static",
    "let"
]);

function main()
{
    const options = parseArgs(process.argv.slice(2));
    const configPath = path.resolve(options.config || DEFAULT_CONFIG);
    const config = readJson(configPath);
    const carbonRootInput = options.carbonRoot || process.env.CARBONENGINE_ROOT || config.carbonRoot;
    if (!carbonRootInput)
    {
        throw new Error("CarbonEngine checkout is required. Pass --carbon-root, set CARBONENGINE_ROOT, or provide carbonRoot in the config.");
    }
    const carbonRoot = path.resolve(carbonRootInput);
    const selectedFamilies = selectFamilies(config, options.family);
    const report = scanFamilies(config, carbonRoot, selectedFamilies);

    setBlackTypeOverrides(config.blackTypeOverrides);
    report.configPath = toPosix(path.relative(process.cwd(), configPath));
    report.generatedAt = new Date().toISOString();
    report.canEmitSafely = report.stalls.length === 0;

    const reportPath = path.resolve(options.report || config.reportPath);
    writeJson(reportPath, report);

    const markdownPath = path.resolve(options.markdownReport || config.markdownReportPath);
    writeText(markdownPath, renderMarkdown(report));

    if (options.emitSchema)
    {
        emitSchemas(config, report, path.resolve(options.schemaOut || config.schemaOutputRoot || path.join(config.outputRoot, "schema")));
    }

    if (options.emitClasses)
    {
        emitClassFiles(
            config,
            report,
            path.resolve(options.classOut || config.classOutputRoot || path.join(config.outputRoot, "classes")),
            path.resolve(options.classReport || config.classReportPath || DEFAULT_CLASS_REPORT)
        );
    }

    if (options.emitStubs)
    {
        emitStubs(config, report, path.resolve(options.out || config.outputRoot));
    }

    printSummary(report, reportPath, markdownPath, options.emitStubs, options.emitSchema, options.emitClasses);

    if (report.stalls.length && options.failOnStall)
    {
        process.exitCode = ExitCode.Stalls;
    }
}

function parseArgs(argv)
{
    const options = {
        config: DEFAULT_CONFIG,
        emitStubs: false,
        emitSchema: false,
        emitClasses: false,
        failOnStall: false
    };

    for (let i = 0; i < argv.length; i++)
    {
        const arg = argv[i];

        switch (arg)
        {
            case Arg.Config:
                options.config = readArgValue(argv, ++i, arg);
                break;

            case Arg.CarbonRoot:
                options.carbonRoot = readArgValue(argv, ++i, arg);
                break;

            case Arg.Family:
                options.family = readArgValue(argv, ++i, arg);
                break;

            case Arg.Report:
                options.report = readArgValue(argv, ++i, arg);
                break;

            case Arg.MarkdownReport:
                options.markdownReport = readArgValue(argv, ++i, arg);
                break;

            case Arg.Out:
                options.out = readArgValue(argv, ++i, arg);
                break;

            case Arg.SchemaOut:
                options.schemaOut = readArgValue(argv, ++i, arg);
                break;

            case Arg.ClassOut:
                options.classOut = readArgValue(argv, ++i, arg);
                break;

            case Arg.ClassReport:
                options.classReport = readArgValue(argv, ++i, arg);
                break;

            case Arg.EmitSchema:
                options.emitSchema = true;
                break;

            case Arg.EmitClasses:
                options.emitClasses = true;
                break;

            case Arg.EmitStubs:
                options.emitStubs = true;
                break;

            case Arg.FailOnStall:
                options.failOnStall = true;
                break;

            case Arg.Help:
            case Arg.HelpShort:
                printHelp();
                process.exit(ExitCode.Ok);
                break;

            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function readArgValue(argv, index, arg)
{
    const value = argv[index];
    if (value === undefined)
    {
        throw new Error(`Missing value for ${arg}`);
    }
    return value;
}

function printHelp()
{
    console.log(`
Usage:
  node scripts/carbon-blue/convert.cjs [options]

Options:
  ${Arg.Config} <path>            Config file. Defaults to ${DEFAULT_CONFIG}
  ${Arg.CarbonRoot} <path>       CarbonEngine checkout. Defaults to config or CARBONENGINE_ROOT.
  ${Arg.Family} <name>            Only scan one configured family.
  ${Arg.Report} <path>            JSON report output path.
  ${Arg.MarkdownReport} <path>   Markdown report output path.
  ${Arg.Out} <path>               Stub output root.
  ${Arg.SchemaOut} <path>        Schema JSON output root.
  ${Arg.ClassOut} <path>         Real JS class output root.
  ${Arg.ClassReport} <path>      Real JS class generation report path.
  ${Arg.EmitSchema}              Emit transportable per-class JSON schemas.
  ${Arg.EmitClasses}             Emit missing real JS class stubs and report existing files.
  ${Arg.EmitStubs}               Emit inspection-only JS stubs.
  ${Arg.FailOnStall}            Exit ${ExitCode.Stalls} if fatal stalls are found.
`);
}

function selectFamilies(config, familyName)
{
    const families = config.families || [];

    if (familyName)
    {
        const family = families.find(x => x.name === familyName);
        if (!family)
        {
            throw new Error(`Unknown family "${familyName}"`);
        }
        return [family];
    }

    return families.filter(x => x.enabled !== false);
}

function scanFamilies(config, carbonRoot, families)
{
    const report = {
        carbonRoot: toPosix(carbonRoot),
        summary: {
            families: 0,
            files: 0,
            classes: 0,
            blueExposedClasses: 0,
            stalls: 0,
            warnings: 0,
            enumTypes: 0
        },
        stalls: [],
        warnings: [],
        enums: [],
        families: [],
        classes: []
    };

    const globalGeneratedNames = new Map();
    const globalEnums = new Map();

    for (const family of families)
    {
        const familyRoot = path.resolve(carbonRoot, family.root);
        const familyReport = scanFamily(config, carbonRoot, family, familyRoot, globalEnums);
        report.families.push(familyReport);
        report.classes.push(...familyReport.classes);
        report.stalls.push(...familyReport.stalls);
        report.warnings.push(...familyReport.warnings);

        for (const classInfo of familyReport.classes)
        {
            const existing = globalGeneratedNames.get(classInfo.generatedName);
            if (existing && existing.name !== classInfo.name)
            {
                report.stalls.push({
                    severity: "fatal",
                    type: "generated-name-collision",
                    message: `Generated name ${classInfo.generatedName} maps to both ${existing.name} and ${classInfo.name}`,
                    classes: [existing.name, classInfo.name]
                });
            }
            else
            {
                globalGeneratedNames.set(classInfo.generatedName, classInfo);
            }
        }
    }

    report.summary.families = report.families.length;
    report.summary.files = report.families.reduce((total, family) => total + family.files.length, 0);
    report.summary.classes = report.classes.length;
    report.summary.blueExposedClasses = report.classes.filter(x => x.blue && x.blue.isExposed).length;
    report.summary.stalls = report.stalls.length;
    report.summary.warnings = report.warnings.length;
    report.summary.enumTypes = globalEnums.size;
    report.enums = Array.from(globalEnums.values())
        .map(item => compactObject({
            name: item.name,
            qualifiedName: item.qualifiedName || null,
            ownerClass: item.ownerClass || null,
            source: item.source || null,
            family: item.family || null,
            line: item.line || null,
            values: item.values
        }))
        .sort((left, right) => String(left.qualifiedName || left.name).localeCompare(String(right.qualifiedName || right.name)));

    return report;
}

function scanFamily(config, carbonRoot, family, familyRoot, globalEnums)
{
    const files = fs.existsSync(familyRoot)
        ? walk(familyRoot, new Set([".h", ".hpp", ".cpp"]))
        : [];

    const byName = new Map();
    const warnings = [];
    const stalls = [];
    const pendingStructureDefs = [];

    if (!fs.existsSync(familyRoot))
    {
        stalls.push({
            severity: "fatal",
            type: "missing-family-root",
            family: family.name,
            path: toPosix(familyRoot),
            message: `Configured family root does not exist: ${toPosix(familyRoot)}`
        });
    }

    for (const file of files)
    {
        const text = fs.readFileSync(file, "utf8");
        const rel = toPosix(path.relative(carbonRoot, file));
        const ext = path.extname(file).toLowerCase();

        if (ext === ".h" || ext === ".hpp")
        {
            const parsed = parseHeaderFile(text, rel);
            for (const item of parsed.classes)
            {
                const record = getClassRecord(byName, item.name, family.name, config.classSuffix);
                record.headerFiles.add(rel);
                record.bases.push(...item.bases);
                record.fields.push(...item.fields);
                record.methods.push(...item.methods);
            }

            for (const item of parsed.enums)
            {
                registerEnumType(globalEnums, item, warnings, family.name);
            }
        }

        if (ext === ".cpp")
        {
            const isBlueFile = /_Blue\d*\.cpp$/i.test(path.basename(file)) || /_Blue\.cpp$/i.test(path.basename(file));
            const parsedCpp = isBlueFile ? { methods: [], constructorDefaults: [], structureDefs: [] } : parseCppFile(text, rel);
            for (const structureDef of parsedCpp.structureDefs || [])
            {
                pendingStructureDefs.push(structureDef);
            }
            for (const method of parsedCpp.methods)
            {
                const record = getClassRecord(byName, method.className, family.name, config.classSuffix);
                record.cppFiles.add(rel);
                record.methods.push({
                    name: method.name,
                    source: rel,
                    line: method.line,
                    kind: "definition"
                });
            }

            for (const defaults of parsedCpp.constructorDefaults)
            {
                const record = getClassRecord(byName, defaults.className, family.name, config.classSuffix);
                record.cppFiles.add(rel);

                for (const item of defaults.items)
                {
                    record.defaults[item.member] = item;
                }
            }

            if (isBlueFile)
            {
                const parsedBlue = parseBlueFile(text, rel);
                for (const item of parsedBlue.classes)
                {
                    const record = getClassRecord(byName, item.name, family.name, config.classSuffix);
                    record.blueFiles.add(rel);
                    record.blue.defines.push(...item.defines);
                    record.blue.exposures.push(...item.exposures);
                    record.blue.attributes.push(...item.attributes);
                    record.blue.properties.push(...item.properties);
                    record.blue.methods.push(...item.methods);
                    record.blue.interfaces.push(...item.interfaces);
                    record.blue.isExposed = true;
                }
            }
        }
    }

    attachStructureDefinitionAttributes(byName, pendingStructureDefs, family, config, warnings);

    const classes = Array.from(byName.values())
        .map(record => finalizeClassRecord(record, carbonRoot))
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const classInfo of classes)
    {
        if (classInfo.headerFiles.length > 1)
        {
            warnings.push({
                severity: "warning",
                type: "multiple-header-candidates",
                family: family.name,
                className: classInfo.name,
                files: classInfo.headerFiles,
                message: `${classInfo.name} has multiple header candidates`
            });
        }

        if (classInfo.blue.files.length > 1)
        {
            warnings.push({
                severity: "warning",
                type: "split-blue-exposure",
                family: family.name,
                className: classInfo.name,
                files: classInfo.blue.files,
                message: `${classInfo.name} has Blue exposure in multiple files`
            });
        }

        const duplicateAttrs = duplicates(classInfo.blue.attributes.map(x => x.name).filter(Boolean));
        for (const name of duplicateAttrs)
        {
            warnings.push({
                severity: "warning",
                type: "duplicate-blue-attribute",
                family: family.name,
                className: classInfo.name,
                attribute: name,
                message: `${classInfo.name} exposes duplicate Blue attribute "${name}"`
            });
        }

        if (classInfo.blue.isExposed && classInfo.headerFiles.length === 0)
        {
            warnings.push({
                severity: "warning",
                type: "blue-without-header",
                family: family.name,
                className: classInfo.name,
                files: classInfo.blue.files,
                message: `${classInfo.name} is Blue-exposed but no header class was found in this family`
            });
        }

        const fieldNames = new Set(classInfo.fields.map(x => x.name));
        for (const attr of classInfo.blue.attributes)
        {
            const memberRoot = getMemberRoot(attr.member);
            if (memberRoot && !fieldNames.has(memberRoot))
            {
                classInfo.reviewNotes.push({
                    type: "attribute-member-not-found",
                    attribute: attr.name,
                    member: attr.member
                });
            }
        }
    }

    return {
        name: family.name,
        root: toPosix(path.relative(carbonRoot, familyRoot)),
        files: files.map(file => toPosix(path.relative(carbonRoot, file))).sort(),
        classes,
        stalls,
        warnings
    };
}

function getClassRecord(byName, name, family, classSuffix)
{
    if (!byName.has(name))
    {
        byName.set(name, {
            name,
            family,
            generatedName: `${name}${classSuffix || "_ccp"}`,
            headerFiles: new Set(),
            cppFiles: new Set(),
            blueFiles: new Set(),
            bases: [],
            fields: [],
            methods: [],
            defaults: {},
            blue: {
                isExposed: false,
                defines: [],
                exposures: [],
                attributes: [],
                properties: [],
                methods: [],
                interfaces: []
            }
        });
    }

    return byName.get(name);
}

// Attaches BlueStructureDefinition entries to their owning class records as
// persisted (PERSIST) attributes, so raw wire structs that lack EXPOSE_TO_BLUE
// still emit their serialized field set. Runs after the family walk so member
// element-type resolution can see every scanned class field.
function attachStructureDefinitionAttributes(byName, structureDefs, family, config, warnings)
{
    for (const def of structureDefs)
    {
        let owner = def.owner;
        if (!owner && def.assocMember)
        {
            owner = resolveStructureListOwner(byName, def.assocMember, def.source);
        }
        if (!owner)
        {
            warnings.push(`Unresolved BlueStructureDefinition owner for ${def.arrayName} (${def.source}).`);
            continue;
        }

        const record = getClassRecord(byName, owner, family.name, config.classSuffix);
        for (const entry of def.entries)
        {
            const flags = ["PERSIST"];
            if (entry.chooser) flags.push("ENUM");
            record.blue.attributes.push({
                macro: "BLUE_STRUCTURE_DEFINITION",
                name: entry.field,
                nameExpression: null,
                nameSource: null,
                nameChooser: null,
                member: entry.field,
                description: null,
                flags,
                chooser: entry.chooser,
                beType: entry.beType,
                iid: null,
                source: def.source,
                line: 0
            });
        }
    }
}

// Disambiguated owner resolution: member names like `m_banners`/`m_transforms`
// can exist on multiple classes, so prefer the class whose cppFiles include the
// SetStructureDefinition call's own source file (the class that owns the member),
// then fall back to a unique global match.
function resolveStructureListOwner(byName, memberName, source)
{
    const candidates = [];
    for (const record of byName.values())
    {
        const field = (record.fields || []).find(item => item.name === memberName);
        if (!field) continue;
        const element = structureListElementType(field.type);
        if (element) candidates.push({ record, element });
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].element;

    const owning = candidates.find(candidate =>
        (candidate.record.cppFiles instanceof Set
            ? candidate.record.cppFiles.has(source)
            : Array.isArray(candidate.record.cppFiles) && candidate.record.cppFiles.includes(source)));
    return (owning || candidates[0]).element;
}

function finalizeClassRecord(record, carbonRoot)
{
    const headerFiles = Array.from(record.headerFiles).sort();
    const cppFiles = Array.from(record.cppFiles).sort();
    const blueFiles = Array.from(record.blueFiles).sort();
    const sourceFiles = unique([...headerFiles, ...cppFiles, ...blueFiles]).sort();
    const shape = {
        name: record.name,
        bases: unique(record.bases.map(x => x.trim()).filter(Boolean)).sort(),
        fields: dedupeObjects(record.fields, x => `${x.name}:${x.type || ""}`),
        methods: dedupeObjects(record.methods, x => `${x.name}:${x.kind || ""}`),
        defaults: Object.fromEntries(Object.entries(record.defaults).map(([key, value]) => [key, value.value]))
    };
    const blueShape = {
        defines: dedupeObjects(record.blue.defines, x => `${x.macro}:${x.name}:${x.line}`),
        exposures: dedupeObjects(record.blue.exposures, x => `${x.name}:${x.line}`),
        attributes: dedupeObjects(record.blue.attributes, x => `${x.name}:${x.member}:${x.flags}`),
        properties: dedupeObjects(record.blue.properties, x => `${x.name}:${x.macro}:${x.getter}:${x.setter}`),
        methods: dedupeObjects(record.blue.methods, x => `${x.name}:${x.target}:${x.macro}`),
        interfaces: dedupeObjects(record.blue.interfaces, x => `${x.name}:${x.line}`)
    };

    return {
        name: record.name,
        family: record.family,
        generatedName: record.generatedName,
        generatedFile: `${record.family}/${record.generatedName}.js`,
        headerFiles,
        cppFiles,
        blue: {
            isExposed: record.blue.isExposed,
            files: blueFiles,
            ...blueShape
        },
        fields: shape.fields,
        methods: shape.methods,
        defaults: record.defaults,
        bases: shape.bases,
        hashes: {
            sourceHash: hashSourceFiles(carbonRoot, sourceFiles),
            shapeHash: hashObject(shape),
            blueHash: hashObject(blueShape)
        },
        reviewNotes: []
    };
}

function registerEnumType(globalEnums, item, warnings, familyName)
{
    if (!item || !item.name || !Array.isArray(item.values) || !item.values.length) return;

    const name = String(item.name).trim();
    const values = item.values
        .map(value => ({
            name: value.name,
            value: Number.isInteger(value.value) ? value.value : null
        }))
        .filter(value => value.name && Number.isInteger(value.value));

    if (!values.length) return;

    const ownerClass = item.ownerClass || null;
    const qualifiedName = item.qualifiedName || (ownerClass ? `${ownerClass}::${name}` : name);
    const key = qualifiedName || name;
    const payload = compactObject({
        name,
        qualifiedName,
        ownerClass,
        source: item.source || null,
        family: familyName || null,
        line: item.line || null,
        values
    });

    const existing = globalEnums.get(key);
    if (!existing)
    {
        globalEnums.set(key, payload);
        return;
    }

    if (!enumValuesEqual(existing.values || [], payload.values || []))
    {
        warnings.push({
            severity: "warning",
            type: "enum-conflict",
            enumName: qualifiedName,
            existing: `${existing.family || "unknown"}:${existing.source || "unknown"}:${existing.line || "?"}`,
            incoming: `${payload.family || "unknown"}:${payload.source || "unknown"}:${payload.line || "?"}`,
            message: `Enum ${qualifiedName} has conflicting values between headers`
        });
    }
}

function enumValuesEqual(left, right)
{
    if (left.length !== right.length) return false;
    return left.every((item, index) => item.name === right[index].name && item.value === right[index].value);
}

function parseHeaderFile(text, source)
{
    const clean = normalizeHeaderClassMacros(stripComments(text));
    const classes = [];
    const classRanges = [];
    const classPattern = /\b(?:class|struct)\s+([A-Za-z_]\w*)\s*(?::\s*([^\{]+))?\s*\{/g;
    let match;

    while ((match = classPattern.exec(clean)))
    {
        const className = match[1];
        const bodyStart = match.index + match[0].length - 1;
        const bodyEnd = findMatchingBrace(clean, bodyStart);
        if (bodyEnd === -1) continue;

        const body = clean.slice(bodyStart + 1, bodyEnd);
        const bases = parseBases(match[2] || "");
        const fields = parseFields(body, source, lineOf(clean, bodyStart));
        const methods = parseMethodDeclarations(body, source, lineOf(clean, bodyStart));
        classes.push({ name: className, bases, fields, methods });
        classRanges.push({
            name: className,
            start: bodyStart,
            end: bodyEnd
        });
        classPattern.lastIndex = bodyEnd + 1;
    }

    const enums = parseEnumDeclarations(clean, source, classRanges);
    return { classes, enums };
}

function parseEnumDeclarations(text, source, classRanges = [])
{
    const enums = [];
    const enumPattern = /\benum(?:\s+class)?\s+([A-Za-z_]\w*)\b[^\{]*\{/g;
    let match;

    while ((match = enumPattern.exec(text)))
    {
        const enumName = match[1];
        const open = text.indexOf("{", match.index);
        if (open === -1) continue;

        const close = findMatchingBrace(text, open);
        if (close === -1) continue;

        const body = text.slice(open + 1, close);
        const values = parseEnumValues(body);

        if (values.length)
        {
            const ownerClass = findOwnerClassNameForOffset(classRanges, match.index);
            enums.push({
                name: enumName,
                qualifiedName: ownerClass ? `${ownerClass}::${enumName}` : enumName,
                ownerClass,
                source,
                line: lineOf(text, match.index),
                values
            });
        }

        const semicolon = text.indexOf(";", close);
        enumPattern.lastIndex = semicolon === -1 ? close + 1 : semicolon + 1;
    }

    return enums;
}

function findOwnerClassNameForOffset(classRanges, offset)
{
    let owner = null;
    for (const range of classRanges || [])
    {
        if (offset <= range.start || offset >= range.end) continue;
        if (!owner || range.start > owner.start)
        {
            owner = range;
        }
    }
    return owner ? owner.name : null;
}

function parseEnumValues(text)
{
    const values = [];
    const items = splitTopLevelArgs(text);
    let nextValue = null;

    for (const item of items)
    {
        const match = String(item).trim().match(/^([A-Za-z_]\w*)\s*(?:=\s*(.*))?$/s);
        if (!match) continue;

        const name = match[1];
        const assigned = match[2] !== undefined ? String(match[2]).trim() : "";
        let value = null;

        if (assigned)
        {
            value = parseEnumNumericValue(assigned);
            if (Number.isInteger(value))
            {
                nextValue = value;
            }
            else if (nextValue === null)
            {
                nextValue = values.length;
            }
        }

        if (!assigned)
        {
            value = nextValue === null ? values.length : nextValue;
        }

        if (Number.isInteger(value))
        {
            values.push({ name, value });
            nextValue = value + 1;
        }
    }

    return values;
}

function parseEnumNumericValue(text)
{
    const clean = String(text).trim();
    if (!clean) return null;

    const normalized = clean.replace(/\s+/g, "");

    if (/^[+-]?0x[0-9a-f]+$/i.test(normalized)) return Number.parseInt(normalized, 16);
    if (/^[+-]?\d+$/i.test(normalized)) return Number.parseInt(normalized, 10);

    return null;
}

function normalizeHeaderClassMacros(text)
{
    return text
        .replace(/\bBLUE(?:_BLUEIMPORT)?_CLASS(?:_ALLOW_DELAYED_DELETE)?\s*\(\s*([A-Za-z_]\w*)\s*\)/g, "class $1")
        .replace(/\bBLUE_INTERFACE\s*\(\s*([A-Za-z_]\w*)\s*\)/g, "class $1");
}

function parseCppFile(text, source)
{
    const clean = stripComments(text);
    const methods = [];
    const methodPattern = /\b([A-Za-z_]\w*)::(~?[A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*(?:const\s*)?(?:[:{]|\n\s*[{])/g;
    let match;

    while ((match = methodPattern.exec(clean)))
    {
        const className = match[1];
        const methodName = match[2];
        methods.push({
            className,
            name: methodName,
            args: match[3].trim(),
            source,
            line: lineOf(clean, match.index),
            kind: methodName === className ? "constructor" : methodName === `~${className}` ? "destructor" : "method"
        });
    }

    return {
        methods,
        constructorDefaults: parseConstructorDefaults(clean, source),
        structureDefs: parseStructureDefinitions(clean, source)
    };
}

// Parses `BlueStructureDefinition XxxStructureDef[] = { { "field", Be::TYPE, offset[, Chooser] }, ... }`.
// These declare wire persistence for raw structs that lack EXPOSE_TO_BLUE, so the
// entries are the persisted field set (a subset of the C++ struct members - runtime-only
// members such as sampler handles are intentionally absent). Owner resolution:
//   - offsetof(ClassName, member) inside an entry names the owner directly;
//   - a `XxxStructureDef` array name (not `s_`-prefixed) maps to class Xxx;
//   - `member.SetStructureDefinition(arrayName)` associates the array with a member whose
//     element type (resolved later from scanned fields) is the owner.
function parseStructureDefinitions(text, source)
{
    const clean = stripComments(text);
    const memberByArray = new Map();
    const setPattern = /(\w+)\s*\.\s*SetStructureDefinition\s*\(\s*(\w+)\s*\)/g;
    let setMatch;
    while ((setMatch = setPattern.exec(clean)))
    {
        memberByArray.set(setMatch[2], setMatch[1]);
    }

    const results = [];
    const arrayPattern = /BlueStructureDefinition\s+(\w+)\s*\[\]\s*=\s*\{/g;
    let arrayMatch;
    while ((arrayMatch = arrayPattern.exec(clean)))
    {
        const arrayName = arrayMatch[1];
        const bodyStart = arrayMatch.index + arrayMatch[0].length;
        const bodyEnd = clean.indexOf("};", bodyStart);
        if (bodyEnd === -1) continue;
        const body = clean.slice(bodyStart, bodyEnd);

        const entries = [];
        let ownerFromOffsetof = null;
        const entryPattern = /\{\s*"([A-Za-z_]\w*)"\s*,\s*Be::(\w+)\s*,\s*([\s\S]*?)\}/g;
        let entryMatch;
        while ((entryMatch = entryPattern.exec(body)))
        {
            const field = entryMatch[1];
            const beType = entryMatch[2];
            const tail = entryMatch[3];
            let chooser = null;
            const offsetof = tail.match(/offsetof\(\s*(\w+)\s*,\s*\w+\s*\)\s*(?:,\s*([A-Za-z_]\w*))?/);
            if (offsetof)
            {
                ownerFromOffsetof = offsetof[1];
                chooser = offsetof[2] || null;
            }
            else
            {
                const parts = tail.split(",").map(part => part.trim()).filter(Boolean);
                chooser = parts[1] || null;
            }
            entries.push({ field, beType, chooser });
        }
        if (!entries.length) continue;

        let owner = ownerFromOffsetof;
        if (!owner && !/^s_/.test(arrayName))
        {
            owner = arrayName.replace(/StructureDef$/, "");
        }
        results.push({
            arrayName,
            owner: owner || null,
            assocMember: memberByArray.get(arrayName) || null,
            entries,
            source
        });
    }
    return results;
}

// Resolves the element type held by a `P<Element>StructureList` / `<Element>Vector` member.
function structureListElementType(memberType)
{
    const match = String(memberType || "").match(/^P?(\w+?)(?:StructureList|Vector|List)$/);
    return match ? match[1] : null;
}

function parseConstructorDefaults(text, source)
{
    const constructors = [];
    const ctorPattern = /\b([A-Za-z_]\w*)::\1\s*\([^;{}]*\)\s*:/g;
    let match;

    while ((match = ctorPattern.exec(text)))
    {
        const className = match[1];
        const bodyStart = text.indexOf("{", ctorPattern.lastIndex);
        if (bodyStart === -1) continue;

        const initializerText = text.slice(ctorPattern.lastIndex, bodyStart).trim().replace(/,$/, "");
        const items = [];

        for (const entry of splitTopLevelArgs(initializerText))
        {
            const item = entry.trim().match(/^([A-Za-z_]\w*)\s*\((.*)\)$/s);
            if (!item) continue;

            const member = item[1];
            if (/^(PARENTLOCK|SUPER|BASE)$/i.test(member)) continue;

            const value = normalizeDefaultExpression(item[2]);
            if (!value) continue;

            items.push({
                member,
                value,
                source,
                line: lineOf(text, match.index)
            });
        }

        if (items.length) constructors.push({ className, items });
    }

    return constructors;
}

function normalizeDefaultExpression(value)
{
    return (value || "")
        .replace(/\s+/g, " ")
        .replace(/\s*,\s*/g, ", ")
        .trim();
}

function parseBlueFile(text, source)
{
    const calls = extractCalls(text, BLUE_CALLS);
    const choosers = parseVarChoosers(text);
    const byClass = new Map();
    const exposureStack = [];

    for (const call of calls)
    {
        const args = splitTopLevelArgs(call.args);

        if (call.name.startsWith("BLUE_DEFINE"))
        {
            const className = cleanIdentifier(args[0]);
            if (!className) continue;
            const record = getBlueClass(byClass, className);
            record.defines.push({
                macro: call.name,
                name: className,
                source,
                line: call.line
            });
        }
        else if (call.name === "EXPOSURE_BEGIN")
        {
            const className = cleanIdentifier(args[0]);
            if (!className) continue;
            const record = getBlueClass(byClass, className);
            record.exposures.push({
                macro: call.name,
                name: className,
                description: readCString(args[1]),
                source,
                line: call.line
            });
            exposureStack.push({ className, line: call.line });
        }
        else
        {
            const currentClass = findCurrentExposure(exposureStack, call.line);
            if (!currentClass) continue;
            const record = getBlueClass(byClass, currentClass);

            if (call.name.startsWith("MAP_ATTRIBUTE"))
            {
                record.attributes.push(parseAttributeCall(call, args, source, { choosers }));
            }
            else if (call.name.startsWith("MAP_PROPERTY"))
            {
                record.properties.push(parsePropertyCall(call, args, source));
            }
            else if (call.name.startsWith("MAP_METHOD"))
            {
                record.methods.push(parseMethodCall(call, args, source));
            }
            else if (call.name === "MAP_INTERFACE")
            {
                record.interfaces.push({
                    name: cleanIdentifier(args[0]) || cleanArg(args[0]),
                    line: call.line,
                    source
                });
            }
        }
    }

    return {
        classes: Array.from(byClass.values())
    };
}

function getBlueClass(byClass, className)
{
    if (!byClass.has(className))
    {
        byClass.set(className, {
            name: className,
            defines: [],
            exposures: [],
            attributes: [],
            properties: [],
            methods: [],
            interfaces: []
        });
    }

    return byClass.get(className);
}

function parseAttributeCall(call, args, source, context = {})
{
    const blueName = resolveBlueNameArg(args[0], context.choosers);

    if (call.name === "MAP_ATTRIBUTE_AS_CUSTOM_BINARY_BLOCK")
    {
        return {
            macro: call.name,
            name: blueName.name,
            nameExpression: blueName.expression,
            nameSource: blueName.source,
            nameChooser: blueName.chooser,
            member: null,
            description: null,
            flags: ["PERSISTONLY"],
            chooser: null,
            iid: null,
            source,
            line: call.line
        };
    }

    return {
        macro: call.name,
        name: blueName.name,
        nameExpression: blueName.expression,
        nameSource: blueName.source,
        nameChooser: blueName.chooser,
        member: cleanArg(args[1]),
        description: readCString(args[2]),
        flags: parseFlags(args[3]),
        chooser: call.name === "MAP_ATTRIBUTE_WITH_CHOOSER" ? cleanArg(args[4]) : null,
        iid: call.name === "MAP_ATTRIBUTE_WITH_IID" ? cleanArg(args[4]) : null,
        source,
        line: call.line
    };
}

function parsePropertyCall(call, args, source)
{
    return {
        macro: call.name,
        name: readCString(args[0]),
        getter: cleanArg(args[1]),
        setter: call.name === "MAP_PROPERTY_READONLY" ? null : cleanArg(args[2]),
        description: call.name === "MAP_PROPERTY_READONLY" ? readCString(args[2]) : readCString(args[3]),
        source,
        line: call.line
    };
}

function parseMethodCall(call, args, source)
{
    return {
        macro: call.name,
        name: readCString(args[0]),
        target: cleanArg(args[1]),
        description: readCString(args[2]),
        source,
        line: call.line
    };
}

function resolveBlueNameArg(arg, choosers)
{
    const expression = cleanArg(arg);
    const literal = readCString(arg);
    if (literal)
    {
        return {
            name: literal,
            expression: null,
            source: "literal",
            chooser: null
        };
    }

    const resolved = resolveChooserKeyExpression(expression, choosers);
    if (resolved)
    {
        return {
            name: resolved.key,
            expression,
            source: "varChooser",
            chooser: compactObject({
                name: resolved.chooserName,
                token: resolved.token,
                index: resolved.index,
                description: resolved.description || null
            })
        };
    }

    return {
        name: "",
        expression: expression || null,
        source: expression ? "expression" : null,
        chooser: null
    };
}

function resolveChooserKeyExpression(expression, choosers)
{
    if (!expression || !choosers || !choosers.size) return null;

    const match = expression.match(/(?:^|::)([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]\s*\.mKey\b/);
    if (!match) return null;

    const chooserName = match[1];
    const chooser = choosers.get(chooserName);
    if (!chooser) return null;

    const indexExpression = cleanArg(match[2]);
    const index = Number(indexExpression);
    const token = normalizeChooserToken(indexExpression);
    const entry = Number.isInteger(index) && String(index) === indexExpression
        ? chooser.byIndex.get(index)
        : chooser.byToken.get(token);

    if (!entry) return null;

    return {
        chooserName,
        key: entry.key,
        token: entry.token,
        index: entry.index,
        description: entry.description
    };
}

function parseVarChoosers(text)
{
    const clean = stripComments(text);
    const choosers = new Map();
    const pattern = /\b(?:const\s+)?Be::VarChooser\s+([A-Za-z_]\w*)\s*\[\]\s*=\s*\{/g;
    let match;

    while ((match = pattern.exec(clean)))
    {
        const name = match[1];
        const open = clean.indexOf("{", match.index);
        const close = findMatchingBrace(clean, open);
        if (open === -1 || close === -1) continue;

        const chooser = parseVarChooserBody(name, clean.slice(open + 1, close));
        if (chooser.values.length) choosers.set(name, chooser);
        pattern.lastIndex = close + 1;
    }

    return choosers;
}

function parseVarChooserBody(name, body)
{
    const values = [];
    const byIndex = new Map();
    const byToken = new Map();
    const entryPattern = /\{\s*"((?:\\.|[^"\\])*)"\s*,\s*BeCast\s*\((.*?)\)\s*,\s*"((?:\\.|[^"\\])*)"\s*\}/gs;
    let match;

    while ((match = entryPattern.exec(body)))
    {
        const index = values.length;
        const key = readCStringFragment(match[1]);
        const token = normalizeChooserToken(match[2]);
        const entry = {
            index,
            key,
            token,
            value: cleanArg(match[2]),
            description: readCStringFragment(match[3])
        };

        values.push(entry);
        byIndex.set(index, entry);
        if (token) byToken.set(token, entry);
    }

    return { name, values, byIndex, byToken };
}

function normalizeChooserToken(value)
{
    const cleaned = cleanArg(value).replace(/^BeCast\s*\((.*)\)$/s, "$1");
    const identifiers = cleaned.match(/[A-Za-z_]\w*/g);
    return identifiers ? identifiers[identifiers.length - 1] : cleaned;
}

function parseBases(tail)
{
    return String(tail || "")
        .split(",")
        .map(x => x.replace(/\b(public|private|protected|virtual)\b/g, "").trim())
        .filter(Boolean);
}

function parseFields(body, source, baseLine = 1)
{
    const nested = extractNestedStructFields(body, source, baseLine);
    const fields = [];
    const topLevelBody = maskRanges(body, nested.ranges);
    const lines = topLevelBody.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i].trim();
        if (!line || line.includes("(") || !line.endsWith(";")) continue;
        if (line.startsWith("}")) continue;
        if (/^(public|private|protected):$/.test(line)) continue;
        if (/^(using|typedef|friend|static_assert|enum)\b/.test(line)) continue;

        const declaration = line.replace(/;$/, "").trim();
        const parts = splitTopLevelArgs(declaration);
        if (!parts.length) continue;

        const first = parts[0].match(/^(.+?)\s+([A-Za-z_]\w*)\s*(?:\[[^\]]+\])?\s*(?:=\s*(.*))?$/s);
        if (!first) continue;

        const type = first[1].trim();
        fields.push({
            type,
            name: first[2],
            defaultValue: normalizeDefaultExpression(first[3]),
            source,
            line: baseLine + i
        });

        for (const part of parts.slice(1))
        {
            const next = part.trim().match(/^([A-Za-z_]\w*)\s*(?:\[[^\]]+\])?\s*(?:=\s*(.*))?$/s);
            if (!next) continue;

            fields.push({
                type,
                name: next[1],
                defaultValue: normalizeDefaultExpression(next[2]),
                source,
                line: baseLine + i
            });
        }
    }

    return [...fields, ...nested.fields];
}

function extractNestedStructFields(body, source, baseLine)
{
    const ranges = [];
    const fields = [];
    const pattern = /\bstruct\s+([A-Za-z_]\w*)\s*\{/g;
    let match;

    while ((match = pattern.exec(body)))
    {
        const structName = match[1];
        const open = body.indexOf("{", match.index);
        const close = findMatchingBrace(body, open);
        if (open === -1 || close === -1) continue;

        const semicolon = body.indexOf(";", close);
        if (semicolon === -1) continue;

        const tail = body.slice(close + 1, semicolon).trim();
        const memberMatch = tail.match(/^([A-Za-z_]\w*)$/);
        if (!memberMatch) continue;

        const memberName = memberMatch[1];
        const nestedBody = body.slice(open + 1, close);
        const nestedLine = baseLine + lineOf(body, open) - 1;
        const nestedFields = parseFields(nestedBody, source, nestedLine);

        fields.push({
            type: structName,
            name: memberName,
            source,
            line: baseLine + lineOf(body, close) - 1,
            nestedStruct: true
        });

        for (const field of nestedFields)
        {
            fields.push({
                ...field,
                name: `${memberName}.${field.name}`,
                parent: memberName,
                struct: structName,
                nested: true
            });
        }

        ranges.push([match.index, semicolon + 1]);
        pattern.lastIndex = semicolon + 1;
    }

    return { fields, ranges };
}

function maskRanges(text, ranges)
{
    let result = text;
    for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0]))
    {
        const mask = result.slice(start, end).replace(/[^\r\n]/g, " ");
        result = `${result.slice(0, start)}${mask}${result.slice(end)}`;
    }
    return result;
}

function parseMethodDeclarations(body, source, baseLine = 1)
{
    const methods = [];
    const lines = body.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i].trim();
        if (!line || !line.includes("(") || !line.endsWith(";")) continue;
        if (/^(if|for|while|switch|return)\b/.test(line)) continue;
        if (/^(using|typedef|friend|static_assert)\b/.test(line)) continue;

        const signature = line.replace(/;$/, "").trim();
        const open = signature.indexOf("(");
        const close = findMatchingParen(signature, open);
        if (open === -1 || close === -1) continue;

        const beforeParen = signature.slice(0, open).trim();
        const nameMatch = beforeParen.match(/([A-Za-z_~]\w*)$/);
        if (!nameMatch) continue;

        const returnType = beforeParen
            .slice(0, nameMatch.index)
            .replace(/\b(virtual|inline|static|explicit)\b/g, "")
            .replace(/\s+/g, " ")
            .trim();
        const args = signature.slice(open + 1, close).trim();
        const suffix = signature.slice(close + 1).trim();

        methods.push({
            name: nameMatch[1],
            returnType,
            args,
            parameters: parseParameters(args),
            isConst: /\bconst\b/.test(suffix),
            source,
            line: baseLine + i,
            kind: "declaration"
        });
    }

    return methods;
}

function parseParameters(args)
{
    if (!args || args === "void") return [];

    return splitTopLevelArgs(args).map((arg, index) => {
        const clean = arg.replace(/=.*/, "").replace(/\s+/g, " ").trim();
        const match = clean.match(/^(.+?)\s+([A-Za-z_]\w*)$/);

        if (!match)
        {
            return { index, name: null, type: clean };
        }

        return {
            index,
            name: match[2],
            type: match[1].trim()
        };
    });
}

function extractCalls(text, names)
{
    const escaped = names.map(escapeRegExp).join("|");
    const pattern = new RegExp(`\\b(${escaped})\\s*\\(`, "g");
    const calls = [];
    let match;

    while ((match = pattern.exec(text)))
    {
        const name = match[1];
        const open = text.indexOf("(", match.index + name.length);
        const close = findMatchingParen(text, open);
        if (close === -1) continue;

        calls.push({
            name,
            args: text.slice(open + 1, close),
            line: lineOf(text, match.index),
            index: match.index
        });
        pattern.lastIndex = close + 1;
    }

    return calls.sort((a, b) => a.index - b.index);
}

function findMatchingParen(text, open)
{
    return findMatching(text, open, "(", ")");
}

function findMatchingBrace(text, open)
{
    return findMatching(text, open, "{", "}");
}

function findMatching(text, open, left, right)
{
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let i = open; i < text.length; i++)
    {
        const char = text[i];
        const next = text[i + 1];

        if (lineComment)
        {
            if (char === "\n") lineComment = false;
            continue;
        }

        if (blockComment)
        {
            if (char === "*" && next === "/")
            {
                blockComment = false;
                i++;
            }
            continue;
        }

        if (quote)
        {
            if (escaped)
            {
                escaped = false;
            }
            else if (char === "\\")
            {
                escaped = true;
            }
            else if (char === quote)
            {
                quote = null;
            }
            continue;
        }

        if (char === "/" && next === "/")
        {
            lineComment = true;
            i++;
            continue;
        }

        if (char === "/" && next === "*")
        {
            blockComment = true;
            i++;
            continue;
        }

        if (char === "\"" || char === "'")
        {
            quote = char;
            continue;
        }

        if (char === left) depth++;
        if (char === right) depth--;
        if (depth === 0) return i;
    }

    return -1;
}

function splitTopLevelArgs(args)
{
    const parts = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let i = 0; i < args.length; i++)
    {
        const char = args[i];

        if (quote)
        {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = null;
            continue;
        }

        if (char === "\"" || char === "'")
        {
            quote = char;
            continue;
        }

        if (char === "(" || char === "{" || char === "[") depth++;
        else if (char === ")" || char === "}" || char === "]") depth--;
        else if (char === "," && depth === 0)
        {
            parts.push(args.slice(start, i).trim());
            start = i + 1;
        }
    }

    parts.push(args.slice(start).trim());
    return parts;
}

function readCString(arg)
{
    if (!arg) return "";

    const pieces = [];
    const pattern = /"((?:\\.|[^"\\])*)"/g;
    let match;

    while ((match = pattern.exec(arg)))
    {
        pieces.push(readCStringFragment(match[1]));
    }

    return pieces.join("");
}

function readCStringFragment(value)
{
    return String(value || "")
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\");
}

function parseFlags(arg)
{
    if (!arg) return [];
    return cleanArg(arg)
        .split("|")
        .map(x => x.trim().replace(/^Be::/, ""))
        .filter(Boolean);
}

function cleanIdentifier(arg)
{
    const value = cleanArg(arg);
    const match = value.match(/[A-Za-z_]\w*/);
    return match ? match[0] : null;
}

function cleanArg(arg)
{
    return (arg || "")
        .replace(/\s+/g, " ")
        .trim();
}

function stripComments(text)
{
    return text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
}

function findCurrentExposure(exposureStack, line)
{
    let current = null;
    for (const exposure of exposureStack)
    {
        if (exposure.line <= line) current = exposure.className;
        else break;
    }
    return current;
}

function getMemberRoot(member)
{
    if (!member) return null;
    const match = member.match(/([A-Za-z_]\w*)/);
    return match ? match[1] : null;
}

function emitSchemas(config, report, outputRoot)
{
    ensureDir(outputRoot);

    const rootIndex = {
        schemaVersion: 1,
        generatedAt: report.generatedAt,
        carbonRoot: report.carbonRoot,
        families: [],
        enums: Array.isArray(report.enums) ? report.enums.length : 0
    };

    for (const family of report.families)
    {
        const familyDir = path.join(outputRoot, family.name);
        ensureDir(familyDir);

        const familyIndex = {
            schemaVersion: 1,
            generatedAt: report.generatedAt,
            family: family.name,
            root: family.root,
            classes: []
        };

        for (const classInfo of family.classes)
        {
            const classMap = new Map(family.classes.map(item => [item.name, item]));
            const schema = renderClassSchema(classInfo, classMap);
            const fileName = `${classInfo.name}.json`;
            writeJson(path.join(familyDir, fileName), schema);
            familyIndex.classes.push({
                blueClass: schema.blueClass,
                cppClass: schema.cppClass,
                jsonFile: fileName,
                blueExposed: schema.blue.isExposed,
                reviewNotes: schema.reviewNotes.length,
                hashes: schema.hashes
            });
        }

        writeJson(path.join(familyDir, "index.json"), familyIndex);
        rootIndex.families.push({
            name: family.name,
            root: family.root,
            index: `${family.name}/index.json`,
            classes: familyIndex.classes.length
        });
    }

    writeJson(path.join(outputRoot, "index.json"), rootIndex);
    writeJson(path.join(outputRoot, "enums.json"), {
        schemaVersion: 1,
        generatedAt: report.generatedAt,
        carbonRoot: report.carbonRoot,
        enums: Array.isArray(report.enums) ? report.enums : []
    });
}

function renderClassSchema(classInfo, classMap)
{
    const reviewNotes = [];
    const attributes = classInfo.blue.attributes.map(attr => toAttributeSchema(classInfo, attr, reviewNotes, classMap));

    const schema = {
        schemaVersion: 1,
        family: classInfo.family,
        blueClass: classInfo.name,
        cppClass: classInfo.name,
        bases: classInfo.bases,
        parents: toParentSchemas(classInfo, classMap),
        source: compactObject({
            header: classInfo.headerFiles,
            cpp: classInfo.cppFiles,
            blue: classInfo.blue.files
        }),
        hashes: classInfo.hashes,
        blue: {
            isExposed: classInfo.blue.isExposed,
            defines: classInfo.blue.defines.map(toBlueDefineSchema),
            exposures: classInfo.blue.exposures.map(toBlueExposureSchema),
            interfaces: classInfo.blue.interfaces.map(toBlueInterfaceSchema)
        },
        black: toBlackClassSchema(classInfo, attributes),
        fields: classInfo.fields.map(field => toFieldSchema(classInfo, field)),
        attributes,
        properties: classInfo.blue.properties.map(prop => toPropertySchema(classInfo, prop, reviewNotes, classMap)),
        methods: classInfo.blue.methods.map(toBlueMethodSchema),
        reviewNotes
    };

    return schema;
}

function toParentSchemas(classInfo, classMap)
{
    return classInfo.bases.map(base => {
        const cppClass = cleanBaseName(base);
        const local = classMap && classMap.has(cppClass);
        return compactObject({
            cppClass,
            jsonFile: local ? `${cppClass}.json` : null,
            external: local ? null : true
        });
    });
}
function toBlueDefineSchema(item)
{
    return {
        macro: item.macro,
        name: item.name
    };
}

function toBlueExposureSchema(item)
{
    return compactObject({
        macro: item.macro || "EXPOSURE_BEGIN",
        name: item.name,
        description: item.description || null
    });
}

function toBlueInterfaceSchema(item)
{
    return {
        macro: "MAP_INTERFACE",
        name: item.name
    };
}

function toFieldSchema(classInfo, field)
{
    const defaultInfo = classInfo.defaults[field.name] || (field.defaultValue ? {
        member: field.name,
        value: field.defaultValue
    } : null);

    return compactObject({
        cppName: field.name,
        cppType: field.type,
        parent: field.parent || null,
        struct: field.struct || null,
        nested: field.nested || null,
        nestedStruct: field.nestedStruct || null,
        default: toDefaultSchema(defaultInfo, field.type)
    });
}

function toAttributeSchema(classInfo, attr, reviewNotes, classMap)
{
    const fieldInfo = resolveAttributeFieldInfo(classInfo, attr, classMap);
    const field = fieldInfo ? fieldInfo.field : null;
    const defaultInfo = resolveDefault(classInfo, attr, field, classMap);
    const black = toBlackAttributeSchema(classInfo, attr, fieldInfo, field, reviewNotes);
    const schema = compactObject({
        macro: attr.macro,
        blueName: attr.name || null,
        blueNameExpression: attr.nameExpression || null,
        blueNameSource: attr.nameSource && attr.nameSource !== "literal" ? attr.nameSource : null,
        blueNameChooser: attr.nameChooser || null,
        member: attr.member,
        cppType: field ? field.type : null,
        declaredOn: fieldInfo && fieldInfo.owner.name !== classInfo.name ? fieldInfo.owner.name : null,
        flags: attr.flags,
        description: attr.description || null,
        chooser: attr.chooser || null,
        iid: attr.iid || null,
        black,
        default: toDefaultSchema(defaultInfo, field ? field.type : null)
    });

    if (attr.member && !field)
    {
        reviewNotes.push({
            type: "attribute-cpp-type-unresolved",
            blueName: attr.name || null,
            member: attr.member
        });
    }

    return schema;
}

function toBlackClassSchema(classInfo, attributes)
{
    return {
        schemaVersion: 1,
        className: classInfo.name,
        fields: attributes
            .map(attribute => attribute.black)
            .filter(Boolean)
            .filter(field => field.persisted)
            .sort(compareBlackFields)
            .map(field => compactObject({
                name: field.name,
                nameExpression: field.nameExpression || null,
                fieldName: field.fieldName || null,
                cppName: field.cppName || null,
                member: field.member || null,
                memberPath: field.memberPath || null,
                memberRoot: field.memberRoot || null,
                indexToken: field.indexToken || null,
                indexKey: field.indexKey || null,
                cppType: field.cppType || null,
                enumType: field.enumType || null,
                beType: field.beType || null,
                wireType: field.wireType || null,
                container: field.container || null,
                length: field.length || null,
                signed: field.signed,
                macro: field.macro || null,
                flags: field.flags || null,
                source: field.source || null
            }))
    };
}

function compareBlackFields(a, b)
{
    const aFile = a.source?.file || "";
    const bFile = b.source?.file || "";
    if (aFile !== bFile) return aFile.localeCompare(bFile);

    const aLine = a.source?.line || 0;
    const bLine = b.source?.line || 0;
    if (aLine !== bLine) return aLine - bLine;

    return String(a.name || "").localeCompare(String(b.name || ""));
}

function toBlackAttributeSchema(classInfo, attr, fieldInfo, field, reviewNotes)
{
    const persisted = isBlackPersistedAttribute(attr);
    if (!persisted) return null;

    const memberPath = getMemberPath(attr.member);
    const memberRoot = getMemberRoot(attr.member);
    const indexed = parseIndexedMember(attr.member);
    const blackType = inferBlackWireType(field ? field.type : null, attr);
    const fieldName = getBlackFieldName(attr, memberRoot, field);
    const blackName = attr.name || attr.nameExpression || attr.member || fieldName;
    const enumType = blackType.wireType === "enum" ? inferBlackEnumType(field ? field.type : null) : null;

    if (!attr.name)
    {
        reviewNotes.push({
            type: "black-name-unresolved",
            attributeExpression: attr.nameExpression || null,
            member: attr.member || null
        });
    }

    if (!blackType.beType)
    {
        reviewNotes.push({
            type: "black-type-unresolved",
            blueName: attr.name || null,
            member: attr.member || null,
            cppType: field ? field.type : null
        });
    }

    return compactObject({
        persisted,
        name: blackName || null,
        nameExpression: attr.nameExpression || null,
        nameSource: attr.nameSource && attr.nameSource !== "literal" ? attr.nameSource : null,
        nameChooser: attr.nameChooser || null,
        fieldName,
        cppName: memberPath || memberRoot || (field ? field.name : null),
        member: attr.member || null,
        memberPath,
        memberRoot,
        indexToken: indexed ? indexed.indexToken : null,
        indexKey: indexed ? normalizeBlackIndexKey(indexed.indexToken) : null,
        cppType: field ? field.type : null,
        declaredOn: fieldInfo ? fieldInfo.owner.name : classInfo.name,
        enumType,
        beType: blackType.beType,
        wireType: blackType.wireType,
        container: blackType.container || null,
        length: blackType.length || null,
        signed: blackType.signed,
        macro: attr.macro,
        flags: attr.flags,
        source: compactObject({
            file: attr.source || null,
            line: attr.line || null
        })
    });
}

function inferBlackEnumType(cppType)
{
    if (!cppType) return null;
    const raw = normalizeCppTypeName(cppType);
    if (!raw) return null;
    if (raw.includes("::"))
    {
        const parts = raw.split("::");
        const tail = parts[parts.length - 1].trim();
        return tail || raw;
    }
    return raw;
}

function isBlackPersistedAttribute(attr)
{
    return attr.macro === "MAP_ATTRIBUTE_AS_CUSTOM_BINARY_BLOCK" ||
        attr.flags.includes("PERSIST") ||
        attr.flags.includes("PERSISTONLY");
}

function getBlackFieldName(attr, memberRoot, field)
{
    if (attr.name && attr.nameSource === "literal") return toPropertyName(attr.name);
    if (memberRoot) return toPropertyName(memberRoot.replace(/^m_/, ""));
    if (field?.name) return toPropertyName(field.name.replace(/^m_/, ""));
    if (attr.name) return toPropertyName(attr.name);
    return null;
}

function parseIndexedMember(value)
{
    const match = String(value || "").match(/^(.+)\[([^\]]+)\]$/);
    if (!match) return null;
    return {
        member: match[1],
        indexToken: cleanArg(match[2])
    };
}

function normalizeBlackIndexKey(indexToken)
{
    const number = Number(indexToken);
    if (Number.isInteger(number) && String(indexToken).trim() === String(number)) return number;

    const parts = normalizeChooserToken(indexToken)
        .replace(/^TYPE_/, "")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);
    if (!parts.length) return null;

    const pascal = parts
        .map(part => part === "FX" ? "FX" : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join("");

    return pascal ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : null;
}

function inferBlackWireType(cppType, attr)
{
    if (attr.macro === "MAP_ATTRIBUTE_AS_CUSTOM_BINARY_BLOCK")
    {
        return {
            beType: "BINARYBLOCK",
            wireType: "binaryBlock"
        };
    }

    if (!cppType) return { beType: null, wireType: null };

    const type = normalizeCppType(cppType);
    const typeOverride = resolveBlackTypeOverride(type, attr);
    if (typeOverride) return typeOverride;

    const name = normalizeCppTypeName(cppType);
    const vector = getVectorSpec(cppType, attr.name || attr.member);
    if (vector)
    {
        return {
            beType: "FLOATARRAY",
            wireType: "floatArray",
            length: vector.defaults.length
        };
    }

    if (isContainerLikeCppType(cppType))
    {
        return {
            beType: "IROOT",
            wireType: "container",
            container: inferBlackContainerKind(cppType)
        };
    }

    if (isPointerLikeCppType(cppType))
    {
        return {
            beType: "IROOTPTR",
            wireType: "objectRef"
        };
    }

    switch (name)
    {
        case "bool":
            return { beType: "BOOL", wireType: "bool" };

        case "float":
            return { beType: "FLOAT", wireType: "float32" };

        case "double":
            return { beType: "DOUBLE", wireType: "float64" };

        case "char":
        case "int8_t":
            return { beType: "BYTE", wireType: "int8", signed: true };

        case "uint8_t":
        case "byte":
        case "unsignedchar":
            return { beType: "BYTE", wireType: "uint8", signed: false };

        case "int16_t":
        case "short":
            return { beType: "SHORT", wireType: "int16", signed: true };

        case "uint16_t":
        case "ushort":
        case "unsignedshort":
            return { beType: "SHORT", wireType: "uint16", signed: false };

        case "uint":
        case "uint32_t":
        case "ulong":
        case "unsignedint":
        case "unsignedlong":
            return { beType: "ULONG", wireType: "uint32", signed: false };

        case "int":
        case "int32_t":
        case "long":
            return { beType: "LONG", wireType: "int32", signed: true };

        case "int64_t":
        case "longlong":
            return { beType: "INT64", wireType: "int64", signed: true };

        case "uint64_t":
        case "size_t":
        case "ulonglong":
            return { beType: "UINT64", wireType: "uint64", signed: false };

        case "std::wstring":
            return { beType: "STDWSTRING", wireType: "wstringRef" };

        case "std::string":
            return { beType: "STDSTRING", wireType: "stringRef" };

        case "BlueSharedStringW":
            return { beType: "SHAREDSTRINGW", wireType: "wstringRef" };

        case "BlueSharedString":
            return { beType: "SHAREDSTRING", wireType: "stringRef" };

        default:
            break;
    }

    if (/wchar_t\*$/.test(type)) return { beType: "WCSTRING", wireType: "wstringRef" };
    if (/char\*$/.test(type)) return { beType: "CSTRING", wireType: "stringRef" };
    if (attr.flags.includes("ENUM")) return { beType: "LONG", wireType: "enum", signed: true };
    if (/::[A-Za-z_]\w*(?:Type|Usage|Mode|Enum)?$/.test(type)) return { beType: "LONG", wireType: "enum", signed: true };
    if (/^[A-Z]\w*(?:Type|Usage|Mode|Enum)$/.test(name)) return { beType: "LONG", wireType: "enum", signed: true };

    return {
        beType: "IROOT",
        wireType: "inlineObject"
    };
}

function setBlackTypeOverrides(overrides)
{
    if (!Array.isArray(overrides) || !overrides.length)
    {
        blackTypeOverrides = DEFAULT_BLACK_TYPE_OVERRIDES;
        return;
    }

    blackTypeOverrides = overrides
        .filter(Boolean)
        .map(item => {
            if (!item || typeof item !== "object") return null;
            if (!item.cppType && !item.type) return null;

            return compactObject({
                typeName: normalizeCppTypeName(item.cppType || item.type),
                beType: item.beType || null,
                wireType: item.wireType || null,
                signed: item.signed === true ? true : item.signed === false ? false : null,
                container: item.container || null,
                length: item.length || null
            });
        })
        .filter(Boolean)
        .map(item => compactObject({
            beType: item.beType,
            wireType: item.wireType,
            signed: item.signed,
            container: item.container,
            length: item.length,
            typeName: item.typeName
        }))
        .filter(item => item.typeName && item.beType && item.wireType);

    if (!blackTypeOverrides.length)
    {
        blackTypeOverrides = DEFAULT_BLACK_TYPE_OVERRIDES;
    }
}

function resolveBlackTypeOverride(cppType, _attr)
{
    const name = normalizeCppTypeName(cppType);
    for (const item of blackTypeOverrides)
    {
        if (name === item.typeName)
        {
            return {
                beType: item.beType,
                wireType: item.wireType,
                container: item.container || null,
                length: item.length || null,
                signed: item.signed
            };
        }
    }

    return null;
}

function inferBlackContainerKind(cppType)
{
    const type = normalizeCppTypeName(cppType);
    if (/(?:^|::)map<|Map$/.test(type)) return "dict";
    if (/(?:^|::)set<|Set$/.test(type)) return "set";
    return "list";
}

function toPropertySchema(classInfo, prop, reviewNotes, classMap)
{
    const inferred = inferPropertyType(classInfo, prop, classMap);
    for (const note of inferred.reviewNotes)
    {
        reviewNotes.push(note);
    }

    return compactObject({
        macro: prop.macro,
        blueName: prop.name || null,
        getter: prop.getter || null,
        setter: prop.setter || null,
        readOnly: prop.macro === "MAP_PROPERTY_READONLY" || !prop.setter,
        cppType: inferred.cppType,
        getterReturnType: inferred.getterReturnType,
        setterParameterType: inferred.setterParameterType,
        description: prop.description || null
    });
}

function toBlueMethodSchema(method)
{
    return compactObject({
        macro: method.macro,
        blueName: method.name || null,
        target: method.target || null,
        description: method.description || null
    });
}

function inferPropertyType(classInfo, prop, classMap)
{
    const getter = findMethodDeclaration(classInfo, prop.getter, classMap);
    const setter = findMethodDeclaration(classInfo, prop.setter, classMap);
    const getterReturnType = getter && getter.returnType && getter.returnType !== "void" ? getter.returnType : null;
    const setterParameterType = setter && setter.parameters && setter.parameters[0] ? setter.parameters[0].type : null;
    const cppType = getterReturnType || setterParameterType || null;
    const reviewNotes = [];

    if (prop.getter && !getter)
    {
        reviewNotes.push({
            type: "property-getter-not-found",
            blueName: prop.name || null,
            getter: prop.getter
        });
    }

    if (prop.setter && !setter)
    {
        reviewNotes.push({
            type: "property-setter-not-found",
            blueName: prop.name || null,
            setter: prop.setter
        });
    }

    if (!cppType)
    {
        reviewNotes.push({
            type: "property-cpp-type-unresolved",
            blueName: prop.name || null,
            getter: prop.getter || null,
            setter: prop.setter || null
        });
    }
    else if (getterReturnType && setterParameterType && normalizeCppType(getterReturnType) !== normalizeCppType(setterParameterType))
    {
        reviewNotes.push({
            type: "property-cpp-type-mismatch",
            blueName: prop.name || null,
            getter: prop.getter || null,
            getterReturnType,
            setter: prop.setter || null,
            setterParameterType
        });
    }

    return {
        cppType,
        getterReturnType,
        setterParameterType,
        reviewNotes
    };
}

function findMethodDeclaration(classInfo, name, classMap, seen = new Set())
{
    if (!classInfo || !name || seen.has(classInfo.name)) return null;
    seen.add(classInfo.name);

    const method = classInfo.methods.find(item => item.kind === "declaration" && item.name === name);
    if (method) return method;

    if (!classMap) return null;

    for (const base of classInfo.bases)
    {
        const found = findMethodDeclaration(classMap.get(cleanBaseName(base)), name, classMap, seen);
        if (found) return found;
    }

    return null;
}

function normalizeCppType(type)
{
    return String(type || "")
        .replace(/\bconst\b/g, "")
        .replace(/\s+/g, "")
        .replace(/[&]+$/g, "");
}

function toDefaultSchema(defaultInfo, cppType)
{
    if (!defaultInfo) return null;

    const parsed = parseDefaultJsonValue(defaultInfo.value, cppType);
    return {
        cpp: defaultInfo.value,
        json: parsed.value,
        kind: parsed.kind
    };
}

function parseDefaultJsonValue(value, cppType)
{
    if (!value) return { kind: "none", value: null };

    const trimmed = value.trim();
    for (const reader of DEFAULT_VALUE_READERS)
    {
        if (reader.matches(cppType, trimmed))
        {
            return reader.read(trimmed, cppType);
        }
    }

    return { kind: "expression", value: null };
}

const DEFAULT_VALUE_READERS = [
    {
        matches: (cppType, value) => /^(NULL|nullptr)$/i.test(value),
        read: () => ({ kind: "null", value: null })
    },
    {
        matches: (cppType, value) => isStringCppType(cppType) && isCppStringLiteral(value),
        read: value => ({ kind: "string", value: readCppStringLiteral(value) })
    },
    {
        matches: (cppType, value) => isBoolCppType(cppType) && /^(true|false)$/i.test(value),
        read: value => ({ kind: "boolean", value: /^true$/i.test(value) })
    },
    {
        matches: (cppType, value) => isVectorLikeCppType(cppType) && isNumericListExpression(value),
        read: value => ({ kind: "array", value: readNumericListExpression(value) })
    },
    {
        matches: (cppType, value) => isNumberCppType(cppType) && isNumericLiteral(value),
        read: value => ({ kind: "number", value: readNumericLiteral(value) })
    },
    {
        matches: (cppType, value) => !cppType && isCppStringLiteral(value),
        read: value => ({ kind: "string", value: readCppStringLiteral(value) })
    },
    {
        matches: (cppType, value) => !cppType && /^(true|false)$/i.test(value),
        read: value => ({ kind: "boolean", value: /^true$/i.test(value) })
    },
    {
        matches: (cppType, value) => !cppType && isNumericLiteral(value),
        read: value => ({ kind: "number", value: readNumericLiteral(value) })
    },
    {
        matches: (cppType, value) => !cppType && isNumericListExpression(value),
        read: value => ({ kind: "array", value: readNumericListExpression(value) })
    }
];

function isStringCppType(cppType)
{
    return /(^|::)(string|wstring)$/.test(normalizeCppTypeName(cppType)) || /BlueSharedStringW?$/.test(normalizeCppTypeName(cppType));
}

function isBoolCppType(cppType)
{
    return normalizeCppTypeName(cppType) === "bool";
}

function isNumberCppType(cppType)
{
    return /^(u?int(8|16|32|64)?_t|int|uint|long|unsignedlong|short|unsignedshort|float|double|size_t)$/.test(normalizeCppTypeName(cppType));
}

function isVectorLikeCppType(cppType)
{
    return /^(Vector2|Vector3|Vector4|Quaternion|Color|ColorRGBA|Matrix3|Mat3|Matrix|Matrix4|Mat4|TriMatrix)$/.test(normalizeCppTypeName(cppType));
}

function normalizeCppTypeName(cppType)
{
    return normalizeCppType(cppType).replace(/\*/g, "");
}

function isCppStringLiteral(value)
{
    return /^(?:[LuU8]*\s*)?"/.test(value.trim());
}

function readCppStringLiteral(value)
{
    return readCString(value);
}

function isNumericLiteral(value)
{
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)f?$/i.test(value.trim()) || /^0x[0-9a-f]+$/i.test(value.trim());
}

function readNumericLiteral(value)
{
    const trimmed = value.trim();
    if (/^0x[0-9a-f]+$/i.test(trimmed)) return Number(trimmed);
    return Number(normalizeJsNumberToken(trimmed));
}

function isNumericListExpression(value)
{
    const parts = splitTopLevelArgs(unwrapCppConstructorExpression(value));
    return parts.length > 1 && parts.every(part => isNumericLiteral(part));
}

function readNumericListExpression(value)
{
    return splitTopLevelArgs(unwrapCppConstructorExpression(value)).map(readNumericLiteral);
}

function unwrapCppConstructorExpression(value)
{
    const trimmed = value.trim();
    const match = trimmed.match(/^[A-Za-z_:][A-Za-z0-9_:<>]*\s*\((.*)\)$/s);
    return match ? match[1].trim() : trimmed;
}

function compactObject(value)
{
    const result = {};
    for (const [key, item] of Object.entries(value))
    {
        if (item === undefined || item === null) continue;
        if (Array.isArray(item) && item.length === 0) continue;
        result[key] = item;
    }
    return result;
}
function emitClassFiles(config, report, outputRoot, classReportPath)
{
    ensureDir(outputRoot);

    const classReport = {
        generatedAt: report.generatedAt,
        outputRoot: toPosix(outputRoot),
        summary: {
            written: 0,
            updatedGenerated: 0,
            existsCompatible: 0,
            existsChanged: 0,
            existsClash: 0,
            generatedPathCollision: 0,
            invalidClassName: 0
        },
        files: []
    };
    const byRelativePath = new Map();
    const familyClassMaps = new Map(report.families.map(family => [
        family.name,
        new Map(family.classes.map(item => [item.name, item]))
    ]));

    for (const classInfo of report.classes)
    {
        const relativePath = `${classInfo.family}/${classInfo.name}.js`;
        const fullPath = path.join(outputRoot, relativePath);
        const classMap = familyClassMaps.get(classInfo.family) || new Map();
        const rendered = renderRealClassFile(classInfo, classMap);
        const item = {
            className: classInfo.name,
            family: classInfo.family,
            path: toPosix(relativePath)
        };

        if (!isIdentifier(classInfo.name))
        {
            item.status = "invalid-class-name";
            classReport.summary.invalidClassName++;
            classReport.files.push(item);
            continue;
        }

        if (byRelativePath.has(relativePath))
        {
            item.status = "generated-path-collision";
            item.collidesWith = byRelativePath.get(relativePath);
            classReport.summary.generatedPathCollision++;
            classReport.files.push(item);
            continue;
        }
        byRelativePath.set(relativePath, classInfo.name);

        if (fs.existsSync(fullPath))
        {
            const existing = inspectExistingClassFile(fullPath, classInfo.name, rendered);
            item.status = existing.status;
            item.exports = existing.exports;
            if (existing.existingHash !== existing.expectedHash)
            {
                item.existingHash = existing.existingHash;
                item.expectedHash = existing.expectedHash;
            }

            switch (existing.status)
            {
                case "updated-generated":
                    writeText(fullPath, rendered);
                    classReport.summary.updatedGenerated++;
                    break;

                case "exists-compatible":
                    classReport.summary.existsCompatible++;
                    break;

                case "exists-changed":
                    classReport.summary.existsChanged++;
                    break;

                case "exists-clash":
                    classReport.summary.existsClash++;
                    break;

                default:
                    throw new Error(`Unknown class file status: ${existing.status}`);
            }

            classReport.files.push(item);
            continue;
        }

        writeText(fullPath, rendered);
        item.status = "written";
        classReport.summary.written++;
        classReport.files.push(item);
    }

    writeJson(classReportPath, classReport);
    return classReport;
}

function inspectExistingClassFile(file, className, expectedText)
{
    const text = fs.readFileSync(file, "utf8");
    const exports = [];
    const pattern = /export\s+(?:default\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let match;

    while ((match = pattern.exec(text)))
    {
        exports.push(match[1]);
    }

    const normalizedText = normalizeGeneratedText(text);
    const normalizedExpected = normalizeGeneratedText(expectedText);
    const existingHash = hashText(normalizedText);
    const expectedHash = hashText(normalizedExpected);
    const compatible = exports.includes(className);

    let status;
    if (!compatible) status = "exists-clash";
    else if (existingHash === expectedHash) status = "exists-compatible";
    else if (isGeneratedClassStub(text)) status = "updated-generated";
    else status = "exists-changed";

    return {
        status,
        compatible,
        generated: isGeneratedClassStub(text),
        exports,
        existingHash,
        expectedHash
    };
}

function isGeneratedClassStub(text)
{
    return String(text || "").includes(GENERATED_CLASS_MARKER);
}

function renderRealClassFile(classInfo, classMap)
{
    const properties = getClassDataProperties(classInfo, classMap);
    const methodNames = getClassStubMethodNames(classInfo);
    const imports = unique(properties.flatMap(property => property.imports)).sort();
    const lines = [];

    if (imports.length)
    {
        lines.push(`import { ${imports.join(", ")} } from "gl-matrix";`);
        lines.push("");
    }

    lines.push("/**");
    lines.push(` * Generated Carbon/Blue class stub for ${classInfo.name}.`);
    lines.push(" *");
    lines.push(` * Source schema: ${classInfo.family}/${classInfo.name}.json`);
    lines.push(" * Replace this generated stub when a hand-written implementation is available.");
    for (const property of properties)
    {
        lines.push(` * @property {${property.jsDocType}} ${property.jsDocName} - ${property.description}`);
    }
    lines.push(" */");
    lines.push(`export class ${classInfo.name}`);
    lines.push("{");

    for (const property of properties)
    {
        lines.push(`    ${property.propertyName} = ${property.initializer};`);
    }

    if (properties.length && methodNames.length)
    {
        lines.push("");
    }

    for (const methodName of methodNames)
    {
        if (!isIdentifier(methodName)) continue;
        lines.push("    /**");
        lines.push(`     * Generated method stub for ${classInfo.name}.${methodName}.`);
        lines.push("     *");
        lines.push("     * @throws {Error} Always until this Carbon/Blue method is ported.");
        lines.push("     */");
        lines.push(`    ${methodName}()`);
        lines.push("    {");
        lines.push(`        throw new Error(${JSON.stringify(`Not implemented: ${classInfo.name}.${methodName}`)});`);
        lines.push("    }");
        lines.push("");
    }

    lines.push("}");
    lines.push("");
    return lines.join("\n");
}

function getClassDataProperties(classInfo, classMap)
{
    const result = [];
    const seen = new Set();

    for (const attr of classInfo.blue.attributes)
    {
        const name = attr.name || attr.member;
        if (!name || seen.has(name)) continue;
        seen.add(name);

        const fieldInfo = resolveAttributeFieldInfo(classInfo, attr, classMap);
        const field = fieldInfo ? fieldInfo.field : null;
        const cppType = field ? field.type : null;
        const defaultInfo = resolveDefault(classInfo, attr, field, classMap);
        const defaultSchema = toDefaultSchema(defaultInfo, cppType);
        const initializer = renderClassPropertyInitializer(defaultSchema, cppType, name);

        result.push({
            name,
            propertyName: toPropertyName(name),
            jsDocName: toJsDocPropertyName(name),
            cppType,
            defaultSchema,
            initializer: initializer.value,
            imports: initializer.imports,
            jsDocType: toJsDocType(cppType, initializer.shape),
            description: renderClassPropertyDescription(attr, cppType, defaultSchema, name),
            sourceIndex: result.length
        });
    }

    return result.sort(compareClassDataProperties);
}

function compareClassDataProperties(a, b)
{
    const aTransformRank = getTransformPropertyRank(a);
    const bTransformRank = getTransformPropertyRank(b);
    const aIsTransform = aTransformRank !== null;
    const bIsTransform = bTransformRank !== null;

    if (aIsTransform || bIsTransform)
    {
        if (aIsTransform !== bIsTransform) return aIsTransform ? -1 : 1;
        if (aTransformRank !== bTransformRank) return aTransformRank - bTransformRank;
        return a.sourceIndex - b.sourceIndex;
    }

    return comparePropertyNames(a.jsDocName, b.jsDocName);
}

function getTransformPropertyRank(property)
{
    const name = String(property.name || "");
    const lower = name.toLowerCase();
    const cppType = normalizeCppTypeName(property.cppType);

    if (lower.includes("position") || lower.includes("translation") || lower.includes("offset") || lower.includes("placementbias")) return 10;
    if (lower.includes("rotation") || lower.includes("orientation") || lower.includes("quaternion") || lower.includes("quat") || cppType === "Quaternion") return 20;
    if (lower.includes("scale") || lower.includes("scaling")) return 30;
    if (/^angle[XYZ]$/i.test(name)) return 40;
    if (lower.includes("matrix") || lower.includes("transform") || /^(Matrix3|Mat3|Matrix|Matrix4|Mat4|TriMatrix)$/.test(cppType)) return 50;

    return null;
}

function comparePropertyNames(a, b)
{
    return String(a || "").localeCompare(String(b || ""), "en", { sensitivity: "base" });
}

function toJsDocPropertyName(name)
{
    const propertyName = toPropertyName(name);
    if (propertyName.startsWith("["))
    {
        return String(name || "value").replace(/[^A-Za-z0-9_$]/g, "_");
    }
    return propertyName;
}

function renderClassPropertyDescription(attr, cppType, defaultSchema, blueName)
{
    const parts = [];
    if (blueName && blueName !== toJsDocPropertyName(blueName)) parts.push(`Blue name: ${blueName}`);
    if (cppType) parts.push(`Carbon type: ${cppType}`);
    if (attr.member && attr.member !== blueName) parts.push(`member: ${attr.member}`);
    return parts.join("; ") || "Carbon Blue attribute.";
}

function formatClassDefaultDescription(defaultSchema)
{
    if (!defaultSchema) return "undefined";
    if (defaultSchema.kind === "expression") return defaultSchema.cpp;
    return JSON.stringify(defaultSchema.json);
}

function renderClassPropertyInitializer(defaultSchema, cppType, propertyName)
{
    const vector = getVectorInitializer(defaultSchema, cppType, propertyName);
    if (vector) return vector;

    if (!defaultSchema)
    {
        return renderClassTypedFallbackInitializer(cppType) || {
            value: "null",
            imports: [],
            shape: "null"
        };
    }

    switch (defaultSchema.kind)
    {
        case "null":
            return { value: "null", imports: [], shape: "null" };

        case "boolean":
        case "number":
        case "string":
            return {
                value: JSON.stringify(defaultSchema.json),
                imports: [],
                shape: defaultSchema.kind
            };

        case "array":
            return {
                value: formatJsArray(defaultSchema.json),
                imports: [],
                shape: "array"
            };

        default:
            return renderClassTypedFallbackInitializer(cppType) || {
                value: "null",
                imports: [],
                shape: "null"
            };
    }
}

function renderClassTypedFallbackInitializer(cppType)
{
    if (isStringCppType(cppType)) return { value: "\"\"", imports: [], shape: "string" };
    if (isBoolCppType(cppType)) return { value: "false", imports: [], shape: "boolean" };
    if (isNumberCppType(cppType)) return { value: "0", imports: [], shape: "number" };
    if (isPointerLikeCppType(cppType)) return { value: "null", imports: [], shape: "null" };
    if (isContainerLikeCppType(cppType)) return { value: "[]", imports: [], shape: "array" };
    return null;
}

function isPointerLikeCppType(cppType)
{
    const type = normalizeCppTypeName(cppType);
    return /\*$/.test(normalizeCppType(cppType)) || /(?:Ptr|Ref)$/.test(type);
}

function isContainerLikeCppType(cppType)
{
    const type = normalizeCppTypeName(cppType);
    return /(?:^|::)(?:vector|list|set|map|hash_map|hash_set)<.+>$/.test(type) || /(?:Vector|List|Set|Map)$/.test(type);
}

function getVectorInitializer(defaultSchema, cppType, propertyName)
{
    const vector = getVectorSpec(cppType, propertyName);
    if (!vector) return null;

    const values = defaultSchema && defaultSchema.kind === "array"
        ? normalizeVectorValues(defaultSchema.json, vector.defaults)
        : vector.defaults;
    const value = arraysEqual(values, vector.createValues)
        ? `${vector.factory}.create()`
        : `${vector.factory}.fromValues(${values.map(formatJsNumber).join(",")})`;

    return {
        value,
        imports: [vector.importName],
        shape: vector.importName
    };
}

function getVectorSpec(cppType, propertyName)
{
    const type = normalizeCppTypeName(cppType);
    if (type === "Vector4" && isRotationLikePropertyName(propertyName))
    {
        return { importName: "quat", factory: "quat", defaults: [0, 0, 0, 1], createValues: [0, 0, 0, 1] };
    }

    switch (type)
    {
        case "Vector2":
            return { importName: "vec2", factory: "vec2", defaults: [0, 0], createValues: [0, 0] };

        case "Vector3":
            return { importName: "vec3", factory: "vec3", defaults: [0, 0, 0], createValues: [0, 0, 0] };

        case "Vector4":
        case "Color":
        case "ColorRGBA":
            return { importName: "vec4", factory: "vec4", defaults: [0, 0, 0, 0], createValues: [0, 0, 0, 0] };

        case "Quaternion":
            return { importName: "quat", factory: "quat", defaults: [0, 0, 0, 1], createValues: [0, 0, 0, 1] };

        case "Matrix3":
        case "Mat3":
            return {
                importName: "mat3",
                factory: "mat3",
                defaults: [
                    1, 0, 0,
                    0, 1, 0,
                    0, 0, 1
                ],
                createValues: [
                    1, 0, 0,
                    0, 1, 0,
                    0, 0, 1
                ]
            };

        case "Matrix":
        case "Matrix4":
        case "Mat4":
        case "TriMatrix":
            return {
                importName: "mat4",
                factory: "mat4",
                defaults: [
                    1, 0, 0, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0,
                    0, 0, 0, 1
                ],
                createValues: [
                    1, 0, 0, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0,
                    0, 0, 0, 1
                ]
            };

        default:
            return null;
    }
}

function isRotationLikePropertyName(name)
{
    return /(?:^|[^A-Za-z0-9])(?:rotation|quat|quaternion)|(?:rotation|quat|quaternion)/i.test(String(name || ""));
}

function arraysEqual(a, b)
{
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => Object.is(value, b[index]));
}

function normalizeVectorValues(values, defaults)
{
    const result = defaults.slice();
    for (let i = 0; i < result.length && i < values.length; i++)
    {
        if (typeof values[i] === "number" && Number.isFinite(values[i]))
        {
            result[i] = values[i];
        }
    }
    return result;
}

function formatJsArray(value)
{
    return `[${value.map(item => typeof item === "number" ? formatJsNumber(item) : JSON.stringify(item)).join(",")}]`;
}

function formatJsNumber(value)
{
    if (Object.is(value, -0)) return "-0";
    return Number.isFinite(value) ? String(value) : "0";
}

function toJsDocType(cppType, shape)
{
    if (shape === "vec2" || shape === "vec3" || shape === "vec4" || shape === "quat" || shape === "mat4") return shape;
    if (shape === "boolean") return "boolean";
    if (shape === "number") return "number";
    if (shape === "string") return "string";
    if (shape === "null") return "null";
    if (shape === "array") return "Array";

    if (isStringCppType(cppType)) return "string";
    if (isBoolCppType(cppType)) return "boolean";
    if (isNumberCppType(cppType)) return "number";
    if (isVectorLikeCppType(cppType))
    {
        const spec = getVectorSpec(cppType);
        return spec ? spec.importName : "Float32Array";
    }

    return "*";
}

function getClassStubMethodNames(classInfo)
{
    return unique([
        ...classInfo.methods.map(x => x.name),
        ...classInfo.blue.methods.map(x => x.target || x.name),
        ...classInfo.blue.properties.map(x => x.getter).filter(Boolean),
        ...classInfo.blue.properties.map(x => x.setter).filter(Boolean)
    ]).filter(name => name && !name.startsWith("~") && name !== classInfo.name && !isCppExposureMacro(name));
}
function emitStubs(config, report, outputRoot)
{
    ensureDir(outputRoot);
    writeText(path.join(outputRoot, "Blue.js"), renderGeneratedBluePlaceholder());

    for (const classInfo of report.classes)
    {
        const familyDir = path.join(outputRoot, classInfo.family);
        ensureDir(familyDir);
        writeText(path.join(outputRoot, classInfo.generatedFile), renderClassStub(config, classInfo));
    }
}

function renderGeneratedBluePlaceholder()
{
    return `// Generated inspection helper for Carbon Blue mirror stubs.
// This file is intentionally minimal; generated stubs are not runtime API.

/**
 * Minimal base class for generated Carbon Blue inspection stubs.
 *
 * Generated stubs are not runtime API; consumers should prefer schema JSON.
 */
export class Blue
{
}

export const meta = new Proxy({}, {
    get()
    {
        return (...args) => target => target;
    }
});
`;
}

function renderClassStub(config, classInfo)
{
    const source = {};
    if (classInfo.blue.files.length) source.blue = classInfo.blue.files;
    if (classInfo.cppFiles.length) source.cpp = classInfo.cppFiles;
    if (classInfo.headerFiles.length) source.header = classInfo.headerFiles;

    const lines = [];
    lines.push(`import { Blue, meta } from "${config.stubImport || "../Blue"}";`);
    lines.push("");
    lines.push(`@meta.define(${formatObject({ name: classInfo.name, source, hashes: classInfo.hashes })})`);
    lines.push("/**");
    lines.push(` * Generated CCP/Carbon source mirror stub for ${classInfo.name}.`);
    lines.push(" * Do not hand-edit generated output; edit converter inputs/config instead.");
    lines.push(" */");
    lines.push(`export class ${classInfo.generatedName} extends Blue`);
    lines.push("{");

    for (const attr of classInfo.blue.attributes)
    {
        const propertySource = attr.name || attr.member || "value";
        const property = toPropertyName(propertySource);
        const field = resolveAttributeField(classInfo, attr);
        const defaultInfo = resolveDefault(classInfo, attr, field);
        const attrMeta = {
            member: attr.member,
            type: field ? field.type : undefined,
            flags: attr.flags,
            default: defaultInfo ? defaultInfo.value : undefined
        };

        if (attr.name && property !== attr.name) attrMeta.name = attr.name;

        lines.push(`    @meta.attr(${formatInlineObject(attrMeta)})`);
        lines.push(`    ${property} = ${renderDefaultInitializer(defaultInfo)};`);
        lines.push("");
    }

    const methodNames = unique([
        ...classInfo.methods.map(x => x.name),
        ...classInfo.blue.methods.map(x => x.target || x.name),
        ...classInfo.blue.properties.map(x => x.getter).filter(Boolean),
        ...classInfo.blue.properties.map(x => x.setter).filter(Boolean)
    ]).filter(name => name && !name.startsWith("~") && name !== classInfo.name && !isCppExposureMacro(name));

    for (const methodName of methodNames)
    {
        if (!isIdentifier(methodName)) continue;
        lines.push("    /**");
        lines.push(`     * Generated stub for ${classInfo.name}.${methodName}.`);
        lines.push("     *");
        lines.push("     * @throws {Error} Always until this Carbon/Blue method is ported.");
        lines.push("     */");
        lines.push("    @meta.stub");
        lines.push(`    ${methodName}()`);
        lines.push("    {");
        lines.push(`        throw meta.notImplemented(${JSON.stringify(`${classInfo.name}.${methodName}`)});`);
        lines.push("    }");
        lines.push("");
    }

    lines.push("}");
    lines.push("");
    return lines.join("\n");
}

function isCppExposureMacro(name)
{
    return name === "EXPOSE_TO_BLUE" || /^DECLARE_/.test(name) || /^BLUE_/.test(name);
}
function resolveAttributeField(classInfo, attr, classMap)
{
    const info = resolveAttributeFieldInfo(classInfo, attr, classMap);
    return info ? info.field : null;
}

function resolveAttributeFieldInfo(classInfo, attr, classMap)
{
    const memberPath = getMemberPath(attr.member);
    if (!memberPath) return null;

    return findFieldInfo(classInfo, memberPath, classMap) || findFieldInfo(classInfo, getMemberRoot(attr.member), classMap);
}

function findFieldInfo(classInfo, name, classMap, seen = new Set())
{
    if (!classInfo || !name || seen.has(classInfo.name)) return null;
    seen.add(classInfo.name);

    const field = classInfo.fields.find(item => item.name === name);
    if (field) return { field, owner: classInfo };

    if (!classMap) return null;

    for (const base of classInfo.bases)
    {
        const baseInfo = classMap.get(cleanBaseName(base));
        const found = findFieldInfo(baseInfo, name, classMap, seen);
        if (found) return found;
    }

    return null;
}

function cleanBaseName(base)
{
    const match = String(base || "").match(/[A-Za-z_]\w*$/);
    return match ? match[0] : String(base || "");
}

function getMemberPath(member)
{
    if (!member) return null;
    const value = String(member).replace(/\[[^\]]+\]/g, "");
    const match = value.match(/[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/);
    return match ? match[0] : null;
}

function resolveDefault(classInfo, attr, field, classMap)
{
    const memberPath = getMemberPath(attr.member);
    const memberRoot = getMemberRoot(attr.member);
    const defaultFromConstructor = findDefaultInfo(classInfo, memberPath, classMap) || findDefaultInfo(classInfo, memberRoot, classMap);
    if (defaultFromConstructor) return defaultFromConstructor;

    if (!field || !field.defaultValue) return null;

    return {
        member: memberPath || memberRoot,
        value: field.defaultValue,
        source: field.source,
        line: field.line
    };
}

function findDefaultInfo(classInfo, member, classMap, seen = new Set())
{
    if (!classInfo || !member || seen.has(classInfo.name)) return null;
    seen.add(classInfo.name);

    if (classInfo.defaults && classInfo.defaults[member]) return classInfo.defaults[member];
    if (!classMap) return null;

    for (const base of classInfo.bases)
    {
        const found = findDefaultInfo(classMap.get(cleanBaseName(base)), member, classMap, seen);
        if (found) return found;
    }

    return null;
}

function renderDefaultInitializer(defaultInfo)
{
    if (!defaultInfo) return "undefined";

    const jsValue = defaultExpressionToJs(defaultInfo.value);
    return jsValue === undefined ? "undefined" : jsValue;
}

function defaultExpressionToJs(value)
{
    if (!value) return undefined;

    const trimmed = value.trim();
    if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase();
    if (/^(NULL|nullptr)$/i.test(trimmed)) return "null";
    if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)f?$/i.test(trimmed)) return normalizeJsNumberToken(trimmed);
    if (/^0x[0-9a-f]+$/i.test(trimmed)) return trimmed;
    if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) return trimmed;

    const parts = splitTopLevelArgs(trimmed);
    if (parts.length > 1 && parts.every(part => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)f?$/i.test(part.trim())))
    {
        return `[${parts.map(part => normalizeJsNumberToken(part.trim())).join(", ")}]`;
    }

    return undefined;
}

function normalizeJsNumberToken(value)
{
    let result = String(value).trim().replace(/f$/i, "");
    if (/^[+-]?\d+\.$/.test(result)) result = result.slice(0, -1);
    if (result.startsWith("-.")) result = `-0${result.slice(1)}`;
    else if (result.startsWith("+.")) result = `0${result.slice(1)}`;
    else if (result.startsWith(".")) result = `0${result}`;
    return result;
}
function formatInlineObject(value)
{
    const entries = Object.entries(value)
        .filter(([, item]) => item !== undefined && item !== null && !(Array.isArray(item) && !item.length));

    if (!entries.length) return "{}";

    return `{ ${entries.map(([key, item]) => `${formatInlineKey(key)}: ${formatInlineValue(item)}`).join(", ")} }`;
}

function formatInlineKey(key)
{
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function formatInlineValue(value)
{
    if (Array.isArray(value)) return `[${value.map(formatInlineValue).join(", ")}]`;
    if (value && typeof value === "object") return formatInlineObject(value);
    return JSON.stringify(value);
}

function renderMarkdown(report)
{
    const lines = [];
    lines.push("# Carbon Blue Conversion Report");
    lines.push("");
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(`Carbon root: \`${report.carbonRoot}\``);
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`- Families: ${report.summary.families}`);
    lines.push(`- Files: ${report.summary.files}`);
    lines.push(`- Classes: ${report.summary.classes}`);
    lines.push(`- Blue-exposed classes: ${report.summary.blueExposedClasses}`);
    lines.push(`- Stalls: ${report.summary.stalls}`);
    lines.push(`- Warnings: ${report.summary.warnings}`);
    lines.push("");

    if (report.stalls.length)
    {
        lines.push("## Stalls");
        lines.push("");
        for (const stall of report.stalls)
        {
            lines.push(`- ${stall.type}: ${stall.message}`);
        }
        lines.push("");
    }

    if (report.warnings.length)
    {
        lines.push("## Warnings");
        lines.push("");
        for (const warning of report.warnings.slice(0, 100))
        {
            lines.push(`- ${warning.type}: ${warning.message}`);
        }
        if (report.warnings.length > 100)
        {
            lines.push(`- ... ${report.warnings.length - 100} more warnings omitted from markdown summary`);
        }
        lines.push("");
    }

    lines.push("## Families");
    lines.push("");
    lines.push("| Family | Files | Classes | Blue Exposed |");
    lines.push("|---|---:|---:|---:|");
    for (const family of report.families)
    {
        lines.push(`| ${family.name} | ${family.files.length} | ${family.classes.length} | ${family.classes.filter(x => x.blue.isExposed).length} |`);
    }
    lines.push("");
    return lines.join("\n");
}

function printSummary(report, reportPath, markdownPath, emittedStubs, emittedSchemas, emittedClasses)
{
    console.log(`Carbon Blue scan complete.`);
    console.log(`  Families: ${report.summary.families}`);
    console.log(`  Files: ${report.summary.files}`);
    console.log(`  Classes: ${report.summary.classes}`);
    console.log(`  Blue-exposed classes: ${report.summary.blueExposedClasses}`);
    console.log(`  Stalls: ${report.summary.stalls}`);
    console.log(`  Warnings: ${report.summary.warnings}`);
    console.log(`  Report: ${toPosix(reportPath)}`);
    console.log(`  Markdown: ${toPosix(markdownPath)}`);
    if (emittedSchemas)
    {
        console.log(`  Schemas emitted for transport.`);
    }
    if (emittedClasses)
    {
        console.log(`  Real JS class report updated.`);
    }
    if (emittedStubs)
    {
        console.log(`  Stubs emitted for inspection.`);
    }
}

function toPropertyName(name)
{
    const candidate = String(name || "value").replace(/[^A-Za-z0-9_$]/g, "_");
    const safe = /^[A-Za-z_$]/.test(candidate) ? candidate : `_${candidate}`;
    if (isIdentifier(safe))
    {
        return safe;
    }
    return `[${JSON.stringify(String(name))}]`;
}

function isIdentifier(value)
{
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) && !JS_RESERVED.has(value);
}

function formatObject(value)
{
    return JSON.stringify(value, null, 4);
}

function walk(root, exts)
{
    const results = [];
    const entries = fs.readdirSync(root, { withFileTypes: true });

    for (const entry of entries)
    {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory())
        {
            results.push(...walk(fullPath, exts));
        }
        else if (exts.has(path.extname(entry.name).toLowerCase()))
        {
            results.push(fullPath);
        }
    }

    return results.sort();
}

function normalizeGeneratedText(text)
{
    return String(text || "").replace(/\r\n/g, "\n").trimEnd() + "\n";
}

function hashText(text)
{
    return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}
function hashSourceFiles(carbonRoot, sourceFiles)
{
    const hash = crypto.createHash("sha256");
    for (const rel of sourceFiles)
    {
        const fullPath = path.resolve(carbonRoot, rel);
        if (!fs.existsSync(fullPath)) continue;
        hash.update(rel);
        hash.update("\0");
        hash.update(fs.readFileSync(fullPath));
        hash.update("\0");
    }
    return `sha256:${hash.digest("hex")}`;
}

function hashObject(value)
{
    return `sha256:${crypto.createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value)
{
    if (Array.isArray(value))
    {
        return `[${value.map(stableStringify).join(",")}]`;
    }

    if (value && typeof value === "object")
    {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }

    return JSON.stringify(value);
}

function duplicates(items)
{
    const seen = new Set();
    const dupes = new Set();
    for (const item of items)
    {
        if (seen.has(item)) dupes.add(item);
        else seen.add(item);
    }
    return Array.from(dupes).sort();
}

function dedupeObjects(items, keyFn)
{
    const byKey = new Map();
    for (const item of items)
    {
        const key = keyFn(item);
        if (!byKey.has(key))
        {
            byKey.set(key, item);
        }
    }
    return Array.from(byKey.values()).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
}

function unique(items)
{
    return Array.from(new Set(items));
}

function readJson(file)
{
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value)
{
    writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, text)
{
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, text, "utf8");
}

function ensureDir(dir)
{
    fs.mkdirSync(dir, { recursive: true });
}

function toPosix(file)
{
    return String(file).replace(/\\/g, "/");
}

function lineOf(text, index)
{
    return text.slice(0, index).split(/\r?\n/).length;
}

function escapeRegExp(value)
{
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (require.main === module)
{
    main();
}

module.exports = { DEFAULT_CONFIG, DEFAULT_CLASS_REPORT };
